// Verify only our UI and native structural geometry. Never read/send chat text.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {ROOT} from '../src/catalog.mjs';
import {CdpSession,listVerifiedTargets} from '../src/cdp.mjs';
const probe=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-File','scripts/Probe-Host.ps1'],{windowsHide:true,encoding:'utf8'}).replace(/^\uFEFF/,''));
assert.equal(probe.debuggerVerified,true);const targets=await listVerifiedTargets(probe);assert.equal(targets.length,1);const c=await new CdpSession(targets[0].url).connect();
const session=JSON.parse(await fs.readFile(path.join(ROOT,'.local/session.json'),'utf8')),url=new URL(session.url);
const headers={'X-Lab-Token':url.hash.slice(1)},wait=ms=>new Promise(r=>setTimeout(r,ms));
const api=async()=>{const r=await fetch(url.origin+'/api/state',{headers});assert.equal(r.ok,true);return r.json();};
async function evaluate(expression){const r=await c.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;}
const lib=`document.querySelector('#ark-theme-controls')?.shadowRoot.querySelector('#wallpaper-library')?.shadowRoot`;
const click=selector=>evaluate(`${lib}.querySelector(${JSON.stringify(selector)}).click();true`);
async function until(expression){for(let n=0;n<60;n++){if(await evaluate(expression))return;await wait(120);}throw Error('Timed out: '+expression);}
const setInput=(selector,value)=>evaluate(`(()=>{const e=${lib}.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
const results=[];let originalScale=null,inSettings=false;
try{
  assert.equal((await api()).serviceVersion,'0.8.0');
  await until(`!!${lib}&&!!document.querySelector('#ark-wallpaper-adjust-button')`);
  await c.call('Page.bringToFront');
  await evaluate(`window.__ARK_SURFACE_CHECK__={url:location.href,composers:[...document.querySelectorAll('[data-composer-body]')],main:[...document.querySelectorAll('main[data-app-shell-main-surface]')].find(e=>e.getBoundingClientRect().width>0)};true`);
  await evaluate(`document.querySelector('#ark-theme-nav-button').shadowRoot.querySelector('button').click();true`);
  await until(`${lib}.querySelector('.shell').hidden===false&&!${lib}.querySelector('.shell').classList.contains('adjust')`);
  const geometry=await evaluate(`(()=>{const a=${lib}.querySelector('.shell'),b=window.__ARK_SURFACE_CHECK__.main;const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};return{page:rect(a),main:rect(b),radius:getComputedStyle(a).borderRadius,hidden:getComputedStyle(b).opacity,inert:b.inert,originalComposers:window.__ARK_SURFACE_CHECK__.composers.every(e=>e.isConnected)};})()`);
  assert.deepEqual(geometry.page,geometry.main);assert.equal(geometry.radius,'0px');assert.equal(geometry.hidden,'0');assert.equal(geometry.inert,true);assert.equal(geometry.originalComposers,true);
  await wait(350);let shot=await c.call('Page.captureScreenshot',{format:'png',clip:{...geometry.page,scale:1},captureBeyondViewport:false});await fs.writeFile(path.join(ROOT,'test-results/native-v08-page.png'),Buffer.from(shot.data,'base64'));
  results.push({check:'real desktop main-area page, no centered modal margins, native input tree retained',geometry});

  await click('.adjust-current');await until(`${lib}.querySelector('.shell').classList.contains('adjust')`);
  const panel=await evaluate(`(()=>{const e=${lib}.querySelector('.shell'),r=e.getBoundingClientRect();return{width:r.width,height:r.height,background:getComputedStyle(e).backgroundColor,nativeMainRestored:!window.__ARK_SURFACE_CHECK__.main.inert,previewVideoCount:${lib}.querySelector('.preview').querySelectorAll('video').length,videoCount:document.querySelectorAll('#ark-theme-media video').length};})()`);
  assert.equal(panel.width,300);assert.equal(panel.nativeMainRestored,true);assert.equal(panel.previewVideoCount,0);assert.equal(panel.videoCount,2);
  originalScale=await evaluate(`Number(${lib}.querySelector('.inline-scale').value)`);const changed=originalScale>=390?originalScale-1:originalScale+1;
  await setInput('.inline-scale',changed);await click('.browse-wallpapers');await until(`!${lib}.querySelector('.shell').classList.contains('adjust')`);
  assert.equal(await evaluate(`Number(${lib}.querySelector('.inline-scale').value)`),changed);
  await setInput('.inline-scale',originalScale);await click('.adjust-current');await until(`${lib}.querySelector('.shell').classList.contains('adjust')`);
  assert.equal(await evaluate(`Number(${lib}.querySelector('.inline-scale').value)`),originalScale);originalScale=null;
  await click('.preview-only');assert.equal(await evaluate(`document.querySelector('#root').inert&&getComputedStyle(document.querySelector('#root')).opacity==='0'`),true);
  await wait(180);shot=await c.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(path.join(ROOT,'test-results/native-v08-adjust.png'),Buffer.from(shot.data,'base64'));
  await click('.collapse-adjust');assert.ok(await evaluate(`${lib}.querySelector('.shell').getBoundingClientRect().height<125`));await click('.collapse-adjust');
  await c.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await c.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await until(`${lib}.querySelector('.shell').hidden`);assert.equal(await evaluate(`document.querySelector('#root').inert`),false);
  assert.equal(await evaluate(`window.__ARK_SURFACE_CHECK__.composers.every(e=>e.isConnected)`),true);
  results.push({check:'real floating panel, no preview decoder, bidirectional scale sync, full wallpaper view, collapse and native Escape key-up fallback restoration',panel});

  await evaluate(`(async()=>{if([...document.querySelectorAll('[data-settings-panel-slug]')].some(e=>e.checkVisibility()))return;const p=[...document.querySelectorAll('[aria-label="打开个人资料菜单"]')].find(e=>e.checkVisibility());p.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'mouse',button:0}));p.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerType:'mouse',button:0}));p.click();await new Promise(r=>setTimeout(r,150));[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.checkVisibility()&&e.textContent.includes('设置')).click();})()`);inSettings=true;
  await until(`!!document.querySelector('#ark-wallpaper-settings-entry')?.checkVisibility()`);
  await evaluate(`document.querySelector('#ark-wallpaper-settings-entry').click();true`);await until(`${lib}.querySelector('.shell').hidden===false`);
  const settingsFit=await evaluate(`(()=>{const a=${lib}.querySelector('.shell').getBoundingClientRect(),b=document.querySelector('[data-ark-settings-surface]').getBoundingClientRect();return ['x','y','width','height'].every(k=>Math.abs(a[k]-b[k])<1)})()`);assert.equal(settingsFit,true);
  await click('.adjust-current');await until(`${lib}.querySelector('.shell').classList.contains('adjust')`);assert.equal(await evaluate(`document.querySelectorAll('[data-ark-wallpaper-covered]').length`),0);
  await click('.dismiss');await evaluate(`document.querySelector('[class*="_ApplicationMenuTopBar_"] button[aria-label="返回"]').click();true`);inSettings=false;
  await until(`location.href===window.__ARK_SURFACE_CHECK__.url`);
  // The native router can remount composers when leaving Settings. Verify its
  // restored input surface; identity is asserted above across our own UI only.
  await until(`[...document.querySelectorAll('[data-composer-body]')].some(e=>e.getBoundingClientRect().width>0)`);
  assert.equal(await evaluate(`document.querySelectorAll('[data-ark-wallpaper-covered],[data-ark-wallpaper-peek]').length`),0);
  results.push({check:'native Settings → Wallpaper uses its content area, adjustment restores settings, native Back returns to the original route and visible composer'});
  const result={version:'0.8.0',realHost:true,results};await fs.writeFile(path.join(ROOT,'test-results/native-v08-surfaces.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{
  if(originalScale!==null)await setInput('.inline-scale',originalScale).catch(()=>{});
  await evaluate(`if(${lib}&&!${lib}.querySelector('.shell').hidden)${lib}.querySelector('.dismiss').click();true`).catch(()=>{});
  if(inSettings)await evaluate(`document.querySelector('[class*="_ApplicationMenuTopBar_"] button[aria-label="返回"]')?.click();true`).catch(()=>{});
  await evaluate(`delete window.__ARK_SURFACE_CHECK__`).catch(()=>{});c.close();
}
