// User-operation acceptance against the shipped server/UI, with disposable media.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {ROOT,defaults,scenes,professions,resourceCatalog} from '../src/catalog.mjs';
import {startServer} from '../src/server.mjs';
import {createWallpaperPlayer} from '../src/wallpaper-runtime.mjs';
import {createMediaDeck} from '../src/compositor.mjs';
if(!globalThis.ARK_ACCEPTANCE_FIXTURE_INFO)throw Error('Use the acceptance fixture preload');
const require=createRequire(path.join(process.env.ARK_TEST_MODULES,'package.json')),{chromium}=require('playwright');
const dir=await fs.mkdtemp(path.join(ROOT,'.local','operations-')),lab=await startServer({stateDir:dir,probeHost:async()=>({debuggerVerified:false,reason:'No signed-in client in CI'})});
const browser=await chromium.launch({headless:true,executablePath:process.env.ARK_CHROME??'C:/Program Files/Google/Chrome/Application/chrome.exe'}),page=await browser.newPage({viewport:{width:1600,height:1000}}),checks=[],errors=[];
page.setDefaultTimeout(18000);page.on('pageerror',e=>errors.push(e.message));
const api=async(route,body)=>{const r=await fetch(lab.origin+'/api/'+route,{method:body?'POST':'GET',headers:{'X-Lab-Token':lab.token,Origin:lab.origin,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const value=await r.json();assert.equal(r.ok,true,JSON.stringify(value));return value;};
const ui=page.locator('#wallpaper-library'),record=name=>checks.push({name,passed:true});
const range=async(selector,value)=>ui.locator(selector).evaluate((e,v)=>{e.value=String(v);e.dispatchEvent(new Event('input',{bubbles:true}));},value);
const saved=()=>JSON.parse(require('node:fs').readFileSync(path.join(dir,'settings.json'),'utf8'));
const until=async fn=>{const start=Date.now();while(!await fn()){if(Date.now()-start>15000)throw Error('Operation did not persist');await new Promise(r=>setTimeout(r,100));}};
try{
 await api('settings',{...defaults,sceneId:'welcome',motion:false});await page.goto(lab.url);await page.locator('#test-input').fill('中文输入保留 / attachment fixture');await page.locator('#theme-open').click();
 await ui.locator('[data-kind="static"]').click();await ui.locator('[data-category="operator"]').click();
 for(const profession of professions){await ui.locator('.classes button').filter({hasText:profession}).click();assert.ok(await ui.locator('.card').count()>0);}
 record('静态八职业均可切换，列表有内容');
 await ui.locator('.search input').fill('___no_such_operator___');await ui.locator('.empty').waitFor();await ui.locator('.search input').fill('');await ui.locator('.classes button').first().click();
 await ui.locator('.sort').selectOption('name');await ui.locator('.next').click();assert.equal(await ui.locator('.previous').isEnabled(),true);await ui.locator('.previous').click();
 record('空搜索可恢复、名称排序和分页前后切换');
 await ui.locator('.search input').fill('Mon3tr');await ui.locator('.card').first().click();assert.ok(await ui.locator('.card').count()>=3);
 await ui.locator('.card').nth(1).click();await ui.locator('.view').click();await ui.locator('.full').waitFor();await ui.locator('.zoom-toggle').click();await ui.locator('.full-close').click();record('同一干员多款立绘、原图查看、原始尺寸与返回');
 await range('.inline-scale',135);await ui.locator('.apply').click();await ui.locator('.status').filter({hasText:'已应用'}).waitFor();await until(()=>saved().wallpaper?.subject.scale===1.35);
 await range('.inline-x',63);await until(()=>saved().wallpaper.subject.x===63);await ui.locator('.inline-reset').click();await until(()=>saved().wallpaper.subject.scale===1);
 record('应用静态干员、即时缩放和水平移动、重置图层');
 await ui.locator('[data-inline-target="background"]').click();const background=scenes.find(s=>s.role==='scene');await ui.locator('.inline-background').selectOption(background.id);await range('.inline-scale',112);await until(()=>saved().wallpaper.backgroundId===background.id&&saved().wallpaper.background.scale===1.12);record('人物与背景独立构图、背景选择及缩放');
 for(const [name,value] of [['strength',81],['shade',20],['panel',72],['composerOpacity',45],['chromeBlur',0],['summaryBlur',0],['composerBlur',0]]){const control=ui.locator(`[data-appearance="${name}"]`);if(await control.count())await range(`[data-appearance="${name}"]`,value);}
 await until(()=>saved().strength===.81);record('透明度、遮罩及磨砂调节保存');
 await ui.locator('.dismiss').click();assert.equal(await page.locator('#test-input').inputValue(),'中文输入保留 / attachment fixture');await page.locator('#wallpaper-adjust').click();await ui.locator('.shell.adjust').waitFor();assert.equal(await ui.locator('.inline-scale').isVisible(),true);await range('.inline-scale',123);await until(()=>saved().wallpaper.subject.scale===1.23||saved().wallpaper.background.scale===1.23);await ui.locator('.dismiss').click();await page.locator('#theme-open').click();record('独立透明调整面板与壁纸页面同步，原输入内容保留');
 await ui.locator('[data-kind="dynamic"]').click();await ui.locator('.search input').fill('伊内丝');await ui.locator('.card').first().click();assert.ok(await ui.locator('.card').count()>=2);await ui.locator('.card').last().click();await ui.locator('.play').click();await ui.locator('.preview video').waitFor();record('动态干员多时装选择和视频预览');
 await ui.locator('.download-resource').click();await ui.locator('.resource-performance').selectOption('economy');await until(()=>lab.resources.publicState().capabilities.performance==='economy');await ui.locator('.resource-quality').selectOption('original');await until(()=>lab.resources.publicState().capabilities.quality==='original');
 await ui.locator('.resource-4k').click();await until(()=>lab.resources.publicState().jobs.some(j=>j.quality==='4k'&&j.status==='complete'));await ui.locator('.resource-delete-quality').selectOption('4k');await ui.locator('.resource-plan-delete').click();await ui.locator('.resource-confirm').waitFor();await ui.locator('.resource-confirm-delete').click();await ui.locator('.resource-message').filter({hasText:'已删除'}).waitFor();record('原片／已有派生文件选择、省资源模式、确认删除闲置派生文件');
 await ui.locator('.resource-close').click();await ui.locator('.dismiss').click();await page.reload();await page.locator('#theme-open').click();assert.equal(saved().strength,.81);record('重开保留壁纸与画面配置');
 await page.setViewportSize({width:800,height:900});await page.screenshot({path:path.join(ROOT,'test-results/acceptance-narrow.png')});assert.ok(await ui.locator('.dismiss').isVisible());await ui.locator('.dismiss').click();record('窄窗口可退出壁纸中心');

 // Exercise real runtime transitions naturally, using generated colored clips.
 await page.setViewportSize({width:1280,height:720});await page.goto(lab.origin+'/test');await page.setContent('<style>body{margin:0;background:#000}#deck{position:fixed;inset:0;overflow:hidden}</style><div id="deck"></div>');
 const dynamic=scenes.find(s=>s.official&&s.clips.length===3),wall=scenes.find(s=>s.role==='complete'),media=id=>lab.origin+'/media/'+id+'/video?key='+lab.token;
 const catalog=[dynamic,wall].map(s=>({...s,poster:lab.origin+'/media/'+s.id+'/poster?key='+lab.token,video:s.kind==='dynamic'?media(s.id):null,clips:s.clips?.map(c=>({...c,video:media(c.id)}))}));
 await page.evaluate(({runtime,deck,catalog,id})=>{window.events=[];window.player=eval(`(${runtime})`)(document.querySelector('#deck'),{catalog,onState:e=>events.push(e)},eval(`(${deck})`));return player.update({sceneId:id,motion:true});},{runtime:createWallpaperPlayer.toString(),deck:createMediaDeck.toString(),catalog,id:dynamic.id});
 await page.waitForFunction(()=>player.diagnostics().standbyReady);await page.evaluate(()=>{window.samples=[];window.timer=setInterval(()=>{const d=player.diagnostics(),v=document.querySelectorAll('#deck video')[d.activeSlot];if(!v||v.readyState<2)return;const canvas=document.createElement('canvas');canvas.width=16;canvas.height=9;const ctx=canvas.getContext('2d');ctx.drawImage(v,0,0,16,9);const bytes=ctx.getImageData(0,0,16,9).data;let total=0;for(let i=0;i<bytes.length;i+=4)total+=bytes[i]+bytes[i+1]+bytes[i+2];samples.push(total/(16*9*3));},50);});
 await page.waitForTimeout(19500);const playback=await page.evaluate(()=>{clearInterval(timer);return{samples:samples.length,black:samples.filter(n=>n<8).length,events:events.filter(e=>e.committed).map(e=>e.clipIndex),slots:document.querySelectorAll('#deck video').length};});assert.ok(playback.samples>100);assert.equal(playback.black,0);assert.deepEqual(playback.events.slice(0,6),[0,1,2,0,1,2]);assert.equal(playback.slots,2);checks.push({name:'三动作自然连播两轮：抽样黑帧为零且只有两个视频槽',passed:true,...playback});
 await page.evaluate(()=>player.setEnabled(false));const before=await page.evaluate(()=>player.diagnostics().elapsedMs);await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>player.diagnostics().elapsedMs),before);await page.evaluate(()=>player.destroy());assert.equal(await page.locator('#deck video').count(),0);record('暂停冻结轮播时钟；销毁后释放视频元素');
 assert.deepEqual(errors,[]);
}catch(e){await page.screenshot({path:path.join(ROOT,'test-results/acceptance-operations-failure.png')}).catch(()=>{});checks.push({name:'failure',passed:false,error:e.message});process.exitCode=1;}
finally{await fs.writeFile(path.join(ROOT,'test-results/acceptance-operations.json'),JSON.stringify({fixture:globalThis.ARK_ACCEPTANCE_FIXTURE_INFO,checks,errors},null,2));console.log(JSON.stringify({checks,errors}));await browser.close();await lab.close();}
