// Isolated UI verification; never changes the user's queues or compositions.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {ROOT,scenes,defaults} from '../src/catalog.mjs';
import {startServer} from '../src/server.mjs';
const require=createRequire(path.join(process.env.ARK_TEST_MODULES,'package.json')),{chromium}=require('playwright');
const dir=await fs.mkdtemp(path.join(ROOT,'.local','controls-test-'));
const lab=await startServer({stateDir:dir,probeHost:async()=>({debuggerVerified:false})});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1550,height:1000}}),errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));
const sample=scenes.find(s=>s.role==='complete');
const seed=async savedWallpapers=>{
  const r=await fetch(`${lab.origin}/api/settings`,{method:'POST',headers:{'X-Lab-Token':lab.token,'Content-Type':'application/json',Origin:lab.origin},body:JSON.stringify({...defaults,sceneId:sample.id,motion:false,wallpaper:{sceneId:sample.id},savedWallpapers,playlists:[{id:'test-queue',name:'我的队列',items:[{id:'first',wallpaper:{sceneId:sample.id}}]}]})});
  assert.equal(r.ok,true);await page.goto('about:blank');await page.goto(lab.url);await page.locator('#theme-open').click();
};
try{
  const ui=page.locator('#wallpaper-library');
  await seed([]);await ui.locator('.save-picker').click();await ui.locator('.saved-empty').waitFor();
  assert.match(await ui.locator('.saved-menu').textContent(),/暂无已保存的组合/);
  await page.screenshot({path:path.join(ROOT,'test-results/controls-empty.png')});
  await page.keyboard.press('Escape');assert.equal(await ui.locator('.saved-menu').isVisible(),false);assert.equal(await ui.locator('.shell').isVisible(),true);
  checks.push('空组合列表说明明确；Escape 只关闭列表');
  await seed([{id:'first',name:'午后风景',wallpaper:{sceneId:sample.id}},{id:'second',name:'夜间构图',wallpaper:{sceneId:sample.id}}]);
  await ui.locator('.save-picker').click();await ui.locator('.saved-menu').waitFor();
  assert.equal(await ui.locator('.saved-menu button').first().evaluate(e=>e.getRootNode().activeElement===e),true);
  await page.keyboard.press('ArrowDown');assert.equal(await ui.locator('.saved-menu button').nth(1).evaluate(e=>e.getRootNode().activeElement===e),true);
  await page.screenshot({path:path.join(ROOT,'test-results/controls-saved-menu.png')});
  await page.keyboard.press('Enter');await ui.locator('.editor').waitFor();assert.equal(await ui.locator('.editor-name').inputValue(),'夜间构图');assert.equal(await ui.locator('.saved-menu').isVisible(),false);
  await ui.locator('.editor-close').click();await ui.locator('.save-picker').click();await ui.locator('.heading h2').click();assert.equal(await ui.locator('.saved-menu').isVisible(),false);
  checks.push('组合列表支持方向键、Enter 打开对应构图与点击外部关闭');
  await ui.locator('.queues').click();const toggle=ui.getByRole('switch',{name:'循环播放'});await toggle.waitFor();
  assert.equal(await toggle.isChecked(),true);await toggle.uncheck();await ui.locator('.queue-save-state').filter({hasText:'已自动保存'}).waitFor({state:'attached'});
  const saved=JSON.parse(await fs.readFile(path.join(dir,'settings.json'),'utf8'));assert.equal(saved.playlists[0].loop,false);
  await toggle.focus();await page.keyboard.press('Space');await ui.locator('.queue-save-state').filter({hasText:'已自动保存'}).waitFor({state:'attached'});
  await page.screenshot({path:path.join(ROOT,'test-results/controls-loop-switch.png')});
  await page.reload();await page.locator('#theme-open').click();await ui.locator('.queues').click();assert.equal(await toggle.isChecked(),true);
  checks.push('循环开关支持鼠标、空格操作；开关状态保存并在重开后恢复');
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(ROOT,'test-results/controls-usability.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors},null,2));
}catch(e){await page.screenshot({path:path.join(ROOT,'test-results/controls-failure.png')}).catch(()=>{});throw e;}
finally{await browser.close();await lab.close();if(path.dirname(dir)!==path.join(ROOT,'.local'))throw Error('Unexpected test directory');await fs.rm(dir,{recursive:true,force:true});}
