import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {ROOT} from '../src/catalog.mjs';
import {CdpSession,listVerifiedTargets} from '../src/cdp.mjs';
const probe=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-File','scripts/Probe-Host.ps1'],{windowsHide:true,encoding:'utf8'}).replace(/^\uFEFF/,''));
const targets=await listVerifiedTargets(probe);if(targets.length!==1)throw Error('Expected one verified target');const c=await new CdpSession(targets[0].url).connect();
async function run(expression){const r=await c.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;}
let opened=false;
try {
 opened=await run(`(async()=>{if([...document.querySelectorAll('[data-settings-panel-slug]')].some(e=>e.checkVisibility()))return false;const p=[...document.querySelectorAll('[aria-label="打开个人资料菜单"]')].find(e=>e.checkVisibility());p.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'mouse',button:0}));p.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerType:'mouse',button:0}));p.click();await new Promise(r=>setTimeout(r,150));[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.checkVisibility()&&e.textContent.includes('设置')).click();await new Promise(r=>setTimeout(r,600));return true;})()`);
 const result=await run(`(async()=>{document.querySelector('#ark-wallpaper-settings-entry').click();const sh=document.querySelector('#ark-theme-controls').shadowRoot.querySelector('#wallpaper-library').shadowRoot;sh.querySelector('[data-kind="static"]').click();sh.querySelector('[data-category="operator"]').click();await Promise.all([...sh.querySelectorAll('.card img')].slice(0,12).map(img=>img.decode()));return{embedded:sh.querySelector('.shell').classList.contains('embedded'),count:sh.querySelector('.total').textContent,background:getComputedStyle(sh.querySelector('.shell')).backgroundImage,settingsEntrySelected:document.querySelector('#ark-wallpaper-settings-entry').getAttribute('aria-pressed'),nativeSelectedBackground:getComputedStyle(document.querySelector('[data-settings-panel-slug="general-settings"]')).backgroundColor};})()`);
 const shot=await c.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(path.join(ROOT,'test-results/native-settings-library-final.png'),Buffer.from(shot.data,'base64'));console.log(JSON.stringify(result));
}finally{
 await run(`document.querySelector('#ark-theme-controls')?.shadowRoot.querySelector('#wallpaper-library')?.shadowRoot.querySelector('.dismiss').click()`);
 if(opened)await run(`document.querySelector('[class*="_ApplicationMenuTopBar_"] button[aria-label="返回"]').click()`);
 c.close();
}
