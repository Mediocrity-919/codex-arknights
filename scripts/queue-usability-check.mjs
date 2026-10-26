import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {ROOT,scenes,defaults} from '../src/catalog.mjs';
import {createWallpaperLibrary} from '../src/wallpaper-library.mjs';
import {createWallpaperPlayer} from '../src/wallpaper-runtime.mjs';
import {createMediaDeck} from '../src/compositor.mjs';
import {startServer} from '../src/server.mjs';
const require=createRequire(path.join(process.env.ARK_TEST_MODULES,'package.json')),{chromium}=require('playwright');
const dir=await fs.mkdtemp(path.join(ROOT,'.local','queue-test-')),lab=await startServer({stateDir:dir,probeHost:async()=>({debuggerVerified:false})});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1550,height:1000}}),errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));
const api=async(route,body)=>{const r=await fetch(`${lab.origin}/api/${route}`,{method:body?'POST':'GET',headers:{'X-Lab-Token':lab.token,'Content-Type':'application/json',Origin:lab.origin},...(body?{body:JSON.stringify(body)}:{})});const v=await r.json();assert.equal(r.ok,true,JSON.stringify(v));return v;};
const saved=async()=>JSON.parse(await fs.readFile(path.join(dir,'settings.json'),'utf8'));
const full=scenes.filter(s=>s.role==='complete'),art=scenes.find(s=>s.kind==='static'&&s.operator==='Mon3tr'),bg=scenes.find(s=>s.role==='scene');
const awaitSaved=async()=>page.locator('#wallpaper-library .queue-save-state').filter({hasText:'已自动保存'}).waitFor({state:'attached'});
try{
  await api('settings',{...defaults,sceneId:full[0].id,motion:false,wallpaper:{sceneId:full[0].id},playlists:[{id:'q1',name:'队列 1',items:[{id:'a',wallpaper:{sceneId:full[0].id}}]}]});
  await page.goto(lab.url);await page.locator('#theme-open').click();const ui=page.locator('#wallpaper-library');await ui.locator('.queues').click();
  await ui.locator('.queue-new').click();await ui.locator('.queue-name').fill('夜间队列');await awaitSaved();let state=await saved();assert.equal(state.playlists.length,2);const q2=state.playlists.find(q=>q.name==='夜间队列').id;
  await ui.locator('[data-queue-id="q1"]').click();assert.equal(await ui.locator('.queue-item').count(),1);await ui.locator(`[data-queue-id="${q2}"]`).click();
  await ui.locator('.queue-add-wallpaper').click();assert.match(await ui.locator('.queue-add-banner').textContent(),/夜间队列/);
  await ui.locator('[data-kind="static"]').click();await ui.locator('[data-category="background"]').click();await ui.locator('.queue-card-add').nth(0).click();await ui.locator('.queue-card-add').nth(1).click();
  assert.equal(await ui.locator('.queue-view').isVisible(),false);assert.match(await ui.locator('.queue-add-banner').textContent(),/本次已添加 2 项/);
  await ui.locator('.queue-add-done').click();await awaitSaved();assert.equal(await ui.locator('.queue-item').count(),2);assert.equal((await saved()).playlists.find(q=>q.id==='q1').items.length,1);
  await ui.locator('.queue-close').click();await ui.locator('.add-queue').click();assert.equal(await ui.locator('.queue-target').inputValue(),q2);await ui.locator('.queue-target').selectOption('q1');await ui.locator('.queue-picker-confirm').click();await awaitSaved();assert.equal((await saved()).playlists.find(q=>q.id==='q1').items.length,2);
  await ui.locator('.add-queue').click();assert.equal(await ui.locator('.queue-target').inputValue(),'q1');await ui.locator('.queue-picker-cancel').click();
  await page.reload();await page.locator('#theme-open').click();await ui.locator('.queues').click();assert.equal(await ui.locator('.queue-list button').count(),2);await ui.locator(`[data-queue-id="${q2}"]`).click();assert.equal(await ui.locator('.queue-item').count(),2);
  await ui.locator('.queue-loop').uncheck();await awaitSaved();assert.equal((await saved()).playlists.find(q=>q.id===q2).loop,false);
  await ui.locator('.queue-delete').click();await awaitSaved();assert.equal((await saved()).playlists.length,1);await ui.locator('.queue-undo').click();await awaitSaved();assert.equal((await saved()).playlists.length,2);
  await ui.locator('.queue-item').nth(1).getByTitle('向前移动',{exact:true}).click();await awaitSaved();state=await saved();assert.equal(state.playlists.find(q=>q.id===q2).items.length,2);
  await page.screenshot({path:path.join(ROOT,'test-results/queue-manager.png')});
  checks.push('两个队列独立自动保存、连续添加、指定目标、记住上次目标、重开恢复、循环开关、排序、删除撤销');

  // Isolated fault injection exercises saves that overlap queue switching and edits.
  await page.goto(lab.origin+'/test');await page.setContent('<div id="library"></div>');
  const catalog=[...full.slice(0,3),art,bg].map(s=>({...s,poster:`${lab.origin}/media/${s.id}/poster?key=${lab.token}`,thumb:`${lab.origin}/media/${s.id}/thumb?key=${lab.token}`}));
  await page.evaluate(({lib,runtime,deck,catalog,settings})=>{
    window.savedState=settings;window.failSave=true;window.commits=[];
    window.ui=eval(`(${lib})`)(document.querySelector('#library'),{scenes:catalog,selectedId:settings.sceneId,settings,createMediaDeck:eval(`(${deck})`),createWallpaperPlayer:eval(`(${runtime})`),onApply:async()=>true,onChange:async patch=>{await new Promise(r=>setTimeout(r,300));if(failSave)throw Error('模拟磁盘写入失败');savedState={...savedState,...structuredClone(patch)};commits.push(structuredClone(savedState));ui.update(savedState.sceneId,savedState);return true;}});ui.open();
  },{lib:createWallpaperLibrary.toString(),runtime:createWallpaperPlayer.toString(),deck:createMediaDeck.toString(),catalog,settings:{...defaults,sceneId:full[0].id,playlists:[]}});
  const isolated=page.locator('#library');await isolated.locator('.queues').click();await isolated.locator('.queue-new').click();await isolated.locator('.queue-name').fill('草稿甲');await isolated.locator('.queue-new').click();await isolated.locator('.queue-name').fill('草稿乙');
  await isolated.locator('.queue-save-state').filter({hasText:'保存失败'}).waitFor();assert.equal(await isolated.locator('.queue-list button').count(),2);
  await page.evaluate(()=>failSave=false);await isolated.locator('.queue-save').click();await isolated.locator('.queue-name').fill('修改中的乙');await isolated.locator('.queue-list button').first().click();await isolated.locator('.queue-name').fill('修改中的甲');
  await isolated.locator('.queue-save-state').filter({hasText:'已自动保存'}).waitFor({state:'attached'});const recovered=await page.evaluate(()=>savedState.playlists);assert.deepEqual(recovered.map(q=>q.name),['修改中的甲','修改中的乙']);
  checks.push('保存失败保留两条草稿；重试期间切换和修改不会被较早的写入结果覆盖');

  // Real 4K decoder: queue edits keep its time, action and two-slot allocation.
  await page.goto(lab.origin+'/test');await page.setContent('<style>body{margin:0}#deck{position:absolute;inset:0;overflow:hidden}</style><div id="deck"></div>');
  const dynamic=scenes.find(s=>s.official&&s.clips.length===3),media=(id,type)=>`${lab.origin}/media/${id}/${type}?key=${lab.token}`;
  const playbackCatalog=[dynamic,...full.slice(0,2)].map(s=>({...s,poster:media(s.id,'poster'),video:s.kind==='dynamic'?media(s.id,'video'):null,clips:s.clips?.map(c=>({...c,video:media(c.id,'video')}))}));
  await page.evaluate(({runtime,deck,catalog,id,fullId})=>{window.events=[];window.player=eval(`(${runtime})`)(document.querySelector('#deck'),{catalog,onState:e=>events.push(e)},eval(`(${deck})`));window.cfg={sceneId:id,motion:true,activePlaylistId:'play',playlists:[{id:'play',name:'播放',cycles:2,items:[{id:'video',wallpaper:{sceneId:id}},{id:'image',wallpaper:{sceneId:fullId}}]}]};return player.update(cfg);},{runtime:createWallpaperPlayer.toString(),deck:createMediaDeck.toString(),catalog:playbackCatalog,id:dynamic.id,fullId:full[0].id});
  await page.waitForFunction(()=>player.diagnostics().standbyReady);await page.waitForTimeout(750);const before=await page.evaluate(()=>player.diagnostics());
  await page.evaluate(async()=>{const q=cfg.playlists[0];q.items.reverse();await player.update(cfg);q.name='改名不重播';await player.update(cfg);q.items.push({id:'extra',wallpaper:{...q.items[0].wallpaper}});await player.update(cfg);q.items[1].wallpaper.view={scale:1.8,x:30,y:50};await player.update(cfg);cfg.playlists.push({id:'other',name:'其他',items:[]});await player.update(cfg);});
  const after=await page.evaluate(()=>player.diagnostics());assert.equal(after.activeSlot,before.activeSlot);assert.equal(after.clipIndex,before.clipIndex);assert.ok(after.slots[after.activeSlot].time>=before.slots[before.activeSlot].time);assert.equal(after.entryIndex,1);assert.equal(after.events.filter(e=>e.type==='scene').length,1);assert.equal(await page.locator('#deck video').count(),2);
  await page.evaluate(async()=>{cfg.playlists[0].items.splice(1,1);return player.update(cfg);});assert.equal(await page.evaluate(()=>player.diagnostics().sceneId),full[0].id);
  checks.push('4K 视频播放中插入、排序、改名、调构图与编辑其他队列均不重置当前解码器或播放时间；删除当前项正常衔接');
  await page.evaluate(()=>player.destroy());
  await page.evaluate(({runtime,deck,catalog,ids})=>{window.endEvents=[];window.player=eval(`(${runtime})`)(document.querySelector('#deck'),{catalog,onState:e=>endEvents.push(e)},eval(`(${deck})`));return player.update({sceneId:ids[0],motion:true,activePlaylistId:'once',playlists:[{id:'once',loop:false,duration:1,items:ids.map((id,i)=>({id:String(i),wallpaper:{sceneId:id}}))}]});},{runtime:createWallpaperPlayer.toString(),deck:createMediaDeck.toString(),catalog:playbackCatalog,ids:full.slice(0,2).map(s=>s.id)});
  await page.waitForFunction(()=>endEvents.some(e=>e.queueEnded));assert.equal(await page.evaluate(()=>player.diagnostics().entryIndex),1);assert.equal(await page.evaluate(()=>player.diagnostics().enabled),false);
  checks.push('关闭循环后播完最后一张停止并保留画面');
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(ROOT,'test-results/queue-usability.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors},null,2));
}catch(e){await page.screenshot({path:path.join(ROOT,'test-results/queue-failure.png')}).catch(()=>{});console.error(JSON.stringify({errors}));throw e;}
finally{await browser.close();await lab.close();if(path.dirname(dir)!==path.join(ROOT,'.local'))throw Error('Unexpected test directory');await fs.rm(dir,{recursive:true,force:true});}
