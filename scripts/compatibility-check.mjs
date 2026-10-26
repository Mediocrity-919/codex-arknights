import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {ROOT,defaults,scenes} from '../src/catalog.mjs';
import {startServer} from '../src/server.mjs';
import {nativeLayer} from '../src/native-layer.mjs';
import {createWallpaperLibrary} from '../src/wallpaper-library.mjs';
import {createWallpaperPlayer} from '../src/wallpaper-runtime.mjs';
import {createMediaDeck} from '../src/compositor.mjs';
const require=createRequire(path.join(process.env.ARK_TEST_MODULES,'package.json')),{chromium}=require('playwright');
const dir=await fs.mkdtemp(path.join(ROOT,'.local','compatibility-')),lab=await startServer({stateDir:dir,probeHost:async()=>({debuggerVerified:false})}),browser=await chromium.launch({headless:true,executablePath:process.env.ARK_CHROME??'C:/Program Files/Google/Chrome/Application/chrome.exe'}),checks=[],errors=[];
const html=`<style>body{background:#181818;color:white;margin:0}nav{position:absolute;inset:40px auto 0 0;width:50px}aside{position:absolute;left:50px;top:40px;width:200px}main{position:absolute;inset:40px 0 0 250px}</style><div id="root"><aside class="app-shell-left-panel"><nav data-app-navigation-rail><div><button data-sidebar-destination="images">图像</button></div></nav></aside><main data-app-shell-main-surface><div data-composer-body><textarea>fixture</textarea></div></main></div>`;
const scene={...scenes.find(s=>s.id==='welcome'),poster:'app://fs/@fs/D:/fixture.svg',thumb:'app://fs/@fs/D:/fixture.svg'};
const payload={settings:{...defaults,sceneId:'welcome',motion:false},poster:scene.poster,scenes:[scene]};
const expression=`(async()=>{const location={protocol:'app:',get href(){return window.location.href}};const Image=class extends window.Image{set src(v){super.src=v==='app://fs/@fs/D:/fixture.svg'?${JSON.stringify(`${lab.origin}/media/welcome/poster?key=${lab.token}`)}:v;}get src(){return super.src;}};return (${nativeLayer.toString()})('apply',${JSON.stringify(payload)},${createMediaDeck.toString()},${createWallpaperLibrary.toString()},${createWallpaperPlayer.toString()});})()`;
try{
  const pages=await Promise.all([browser.newPage({bypassCSP:true}),browser.newPage({bypassCSP:true})]);
  for(const [i,p] of pages.entries()){p.on('pageerror',e=>errors.push(e.message));await p.goto(lab.origin+'/test');await p.setContent(html);await p.locator('textarea').fill(`window-${i}`);assert.equal((await p.evaluate(expression)).applied,true);}
  await pages[0].evaluate(()=>window.__ARK_THEME_LAB_V1__.cleanup());assert.equal(await pages[0].locator('#ark-theme-controls').count(),0);assert.equal(await pages[1].locator('#ark-theme-controls').count(),1);assert.equal(await pages[0].locator('textarea').inputValue(),'window-0');assert.equal(await pages[1].locator('textarea').inputValue(),'window-1');
  checks.push('两个独立宿主页面的主题与输入互相隔离，恢复其中一个不影响另一个');
  await pages[1].evaluate(()=>document.querySelector('nav').remove());await pages[1].waitForFunction(()=>!window.__ARK_THEME_LAB_V1__,{timeout:6000});assert.equal(await pages[1].locator('#ark-theme-controls').count(),0);assert.equal(await pages[1].locator('textarea').inputValue(),'window-1');checks.push('运行中宿主结构改变时自动清理，输入原样保留');
  await pages[0].setContent('<div id="root"><main>unrecognized future client</main><textarea>preserved</textarea></div>');const before=await pages[0].content();await assert.rejects(pages[0].evaluate(expression));assert.equal(await pages[0].content(),before);checks.push('未知客户端结构拒绝接入，不改动原页面');
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(ROOT,'test-results/compatibility.json'),JSON.stringify({checks,errors,scope:'模拟宿主契约测试；不代表所有未来客户端或实机多窗口验收'},null,2));console.log(JSON.stringify({checks,errors},null,2));
}finally{await browser.close();await lab.close();if(path.dirname(dir)!==path.join(ROOT,'.local'))throw Error('Unexpected fixture directory');await fs.rm(dir,{recursive:true,force:true});}
