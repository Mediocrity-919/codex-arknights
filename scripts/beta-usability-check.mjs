import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {ROOT,defaults,scenes} from '../src/catalog.mjs';
import {startServer} from '../src/server.mjs';
const require=createRequire(path.join(process.env.ARK_TEST_MODULES,'package.json')),{chromium}=require('playwright');
const dir=await fs.mkdtemp(path.join(ROOT,'.local','beta-ui-test-')),lab=await startServer({stateDir:dir,probeHost:async()=>({debuggerVerified:false})});
const browser=await chromium.launch({headless:true,executablePath:process.env.ARK_CHROME??'C:/Program Files/Google/Chrome/Application/chrome.exe'}),page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));
const api=async(route,body)=>{const r=await fetch(lab.origin+'/api/'+route,{method:body?'POST':'GET',headers:{'X-Lab-Token':lab.token,Origin:lab.origin,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.equal(r.ok,true);return r.json();};
try{
  await api('settings',{...defaults,sceneId:'welcome',motion:false});await page.goto(lab.url);await page.locator('#theme-open').click();const ui=page.locator('#wallpaper-library');
  await ui.locator('[data-category="operator"]').click();await ui.locator('.search input').fill('Mon3tr');await ui.locator('.card').first().click();await ui.locator('.edit').click();
  await ui.locator('.editor-name').fill('构图一');await ui.locator('.edit-scale').fill('145');await ui.locator('.editor-save').click();await ui.locator('.editor-message').filter({hasText:'构图已保存'}).waitFor();
  let state=await api('state');assert.equal(state.settings.savedWallpapers.length,1);const originalId=state.settings.savedWallpapers[0].id;
  await ui.locator('.editor-save-copy').click();await page.waitForFunction(()=>document.querySelector('#wallpaper-library').shadowRoot.querySelector('.save-picker small').textContent==='2');
  assert.equal((await api('state')).settings.savedWallpapers.length,2);await ui.locator('.editor-close').click();await ui.locator('.save-picker').click();await ui.locator('.manage-compositions').click();
  const first=ui.locator('.collection-row').first();await first.locator('input').fill('我的构图');await first.getByRole('button',{name:'重命名',exact:true}).click();await ui.locator('.collections-message').filter({hasText:'名称已保存'}).waitFor();
  state=await api('state');assert.equal(state.settings.savedWallpapers[0].id,originalId);assert.equal(state.settings.savedWallpapers[0].name,'我的构图');
  await first.getByRole('button',{name:'删除组合',exact:true}).click();await ui.locator('.collections-message').filter({hasText:'仅删除构图配置'}).waitFor();assert.equal((await api('state')).settings.savedWallpapers.length,1);
  await ui.locator('.collections-undo').click();await page.waitForFunction(()=>document.querySelector('#wallpaper-library').shadowRoot.querySelectorAll('.collection-row').length===2);
  await ui.locator('.collection-row').last().getByRole('button',{name:'打开构图'}).click();assert.equal(await ui.locator('.edit-scale').inputValue(),'145');await ui.locator('.editor-apply').click();await ui.locator('.editor-message').filter({hasText:'已应用当前构图'}).waitFor();assert.equal((await api('state')).settings.wallpaper.subject.scale,1.45);await ui.locator('.editor-close').click();
  checks.push('组合保存、另存不覆盖、按 ID 重命名、删除/撤销、重开构图与应用完整闭环');
  await ui.locator('[data-kind="dynamic"]').click();await ui.locator('.search input').fill('伊内丝');await ui.locator('.card').first().click();await ui.locator('.download-resource').click();
  await ui.locator('.resource-original').click();await page.waitForFunction(()=>document.querySelector('#wallpaper-library').shadowRoot.querySelector('.resource-jobs')?.textContent.includes('已完成'));
  await ui.locator('.resource-4k').click();await page.waitForFunction(()=>document.querySelector('#wallpaper-library').shadowRoot.querySelectorAll('.resource-job').length===2&&document.querySelector('#wallpaper-library').shadowRoot.querySelector('.resource-job').textContent.includes('已完成'));
  await ui.locator('.resource-quality').selectOption('original');await ui.locator('.resource-message').filter({hasText:'播放偏好已保存'}).waitFor();assert.equal((await api('state')).resources.capabilities.quality,'original');
  await ui.locator('.resource-delete-quality').selectOption('original');await ui.locator('.resource-plan-delete').click();await ui.locator('.resource-confirm').waitFor();assert.match(await ui.locator('.resource-confirm p').textContent(),/将删除 3 个文件/);await ui.locator('.resource-cancel-delete').click();
  await page.screenshot({path:path.join(ROOT,'test-results/beta-resource-center.png')});checks.push('资源中心选择原片/已有 4K、任务反馈、画质偏好与删除预检查；实际用户素材未被删除');
  await ui.locator('.cache-enabled').uncheck();await page.waitForFunction(()=>document.querySelector('#wallpaper-library').shadowRoot.querySelector('.cache-enabled').checked===false);
  await ui.locator('.cache-limit').selectOption('0.5');await page.waitForTimeout(400);assert.equal((await api('state')).resources.cache.limitBytes,512*1024*1024);assert.equal((await api('state')).resources.cache.enabled,false);
  await ui.locator('.cache-clear').click();await page.waitForTimeout(200);assert.equal((await api('state')).settings.savedWallpapers.length,2);await ui.locator('.cache-limit').selectOption('2');await ui.locator('.cache-enabled').check();await page.waitForTimeout(400);assert.equal((await api('state')).resources.cache.enabled,true);
  await ui.locator('.playback-cache-controls').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(ROOT,'test-results/playback-cache-controls.png')});checks.push('播放缓存开关、容量上限、清理闲置缓存；队列和组合不受影响');
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(ROOT,'test-results/beta-usability.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors},null,2));
}catch(e){await page.screenshot({path:path.join(ROOT,'test-results/beta-ui-failure.png')}).catch(()=>{});console.error(errors);throw e;}
finally{await browser.close();await lab.close();if(path.dirname(dir)!==path.join(ROOT,'.local'))throw Error('Unexpected test path');await fs.rm(dir,{recursive:true,force:true});}
