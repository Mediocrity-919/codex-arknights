// Reversible desktop UI verification. No chat content is read, entered, or sent.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {ROOT,scenes} from '../src/catalog.mjs';
import {CdpSession,listVerifiedTargets} from '../src/cdp.mjs';
const probe=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-File','scripts/Probe-Host.ps1'],{windowsHide:true,encoding:'utf8'}).replace(/^\uFEFF/,''));
assert.equal(probe.debuggerVerified,true);const targets=await listVerifiedTargets(probe);assert.equal(targets.length,1);const c=await new CdpSession(targets[0].url).connect();
const session=JSON.parse(await fs.readFile(path.join(ROOT,'.local/session.json'),'utf8')),url=new URL(session.url);
const headers={'X-Lab-Token':url.hash.slice(1),'Content-Type':'application/json',Origin:url.origin};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function api(route,body){for(let n=0;n<12;n++){const r=await fetch(url.origin+'/api/'+route,{headers,method:body?'POST':'GET',...(body?{body:JSON.stringify(body)}:{})});if(r.status===409){await wait(200);continue;}const v=await r.json();if(!r.ok)throw Error(v.error);return v;}throw Error('Theme busy');}
async function evaluate(expression){const r=await c.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;}
const lib=`document.querySelector('#ark-theme-controls').shadowRoot.querySelector('#wallpaper-library').shadowRoot`;
async function click(selector){return evaluate(`${lib}.querySelector(${JSON.stringify(selector)}).click()`);}
async function until(expression){for(let n=0;n<40;n++){if(await evaluate(expression))return;await wait(250);}throw Error('Timed out: '+expression);}
const initial=(await api('state')).settings, results=[];
let finished=false;
try{
 assert.equal((await api('state')).serviceVersion,'0.7.0');assert.equal((await api('state')).native.applied,true);
 await evaluate(`window.__ARK_LIBRARY_CHECK__={url:location.href,input:document.querySelector('[data-codex-composer][contenteditable]')};true`);
 await evaluate(`(async()=>{if([...document.querySelectorAll('[data-settings-panel-slug]')].some(e=>e.checkVisibility()))return;const p=[...document.querySelectorAll('[aria-label="打开个人资料菜单"]')].find(e=>e.checkVisibility());p.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'mouse',button:0}));p.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerType:'mouse',button:0}));p.click();await new Promise(r=>setTimeout(r,150));[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.checkVisibility()&&e.textContent.includes('设置')).click();await new Promise(r=>setTimeout(r,600));})()`);
 await until(`!!document.querySelector('#ark-wallpaper-settings-entry')?.checkVisibility()`);
 const surface=await evaluate(`(()=>{const e=document.querySelector('[data-ark-settings-surface]'),style=document.querySelector('#ark-theme-lab-style');if(!e)return null;const rect=()=>{const r=e.getBoundingClientRect();return[r.x,r.y,r.width,r.height]};const themed={rect:rect(),background:getComputedStyle(e).backgroundColor};style.disabled=true;const native={rect:rect(),background:getComputedStyle(e).backgroundColor};style.disabled=false;return{themed,native};})()`);
 assert.ok(surface);assert.equal(surface.themed.background,'rgba(0, 0, 0, 0)');assert.deepEqual(surface.themed.rect,surface.native.rect);results.push({check:'settings surface transparent, original geometry preserved',surface});
 let shot=await c.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(path.join(ROOT,'test-results/native-settings-wallpaper.png'),Buffer.from(shot.data,'base64'));
 await evaluate(`document.querySelector('#ark-wallpaper-settings-entry').click()`);
 assert.equal(await evaluate(`${lib}.querySelector('.shell').classList.contains('embedded')`),true);
 await click('[data-kind="static"]');await click('[data-category="operator"]');await click('[data-profession="先锋"]');
 await evaluate(`(()=>{const e=${lib}.querySelector('input[type=search]');e.value='伊内丝';e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await click('.card');await click('.view');await until(`${lib}.querySelector('.full img')?.naturalWidth>0`);
 const size=await evaluate(`({width:${lib}.querySelector('.full img').naturalWidth,height:${lib}.querySelector('.full img').naturalHeight})`);assert.ok(size.width>=1024);await click('.full-close');
 const art=scenes.find(s=>s.operator==='伊内丝'&&s.variantKey==='skin1');await click(`.card[data-id="${art.id}"]`);await click('.apply');await until(`window.__ARK_THEME_LAB_V1__.player.diagnostics().sceneId===${JSON.stringify(art.id)}`);await wait(1300);assert.equal((await api('state')).settings.sceneId,art.id);
 assert.equal(await evaluate(`[...document.querySelectorAll('#ark-theme-media [data-ark-image-slot]')].find(e=>e.style.opacity==='1').querySelectorAll('img').length`),2);
 await api('native',{action:'apply',media:'video'});await until(`window.__ARK_THEME_LAB_V1__.player.diagnostics().sceneId===${JSON.stringify(art.id)}`);
 assert.equal(await evaluate(`document.querySelectorAll('#ark-wallpaper-settings-entry').length`),1);
 await evaluate(`document.querySelector('#ark-wallpaper-settings-entry').click()`);await evaluate(`(()=>{const e=${lib}.querySelector('input[type=search]');e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await click('[data-kind="dynamic"]');await click('[data-category="background"]');await click('.apply');await until(`window.__ARK_THEME_LAB_V1__.player.diagnostics().sceneId==='yaoyue'&&window.__ARK_THEME_LAB_V1__.player.diagnostics().activeSlot!==null`);await wait(1300);
 results.push({check:'native original PNG preview, static apply/save/remount, then dynamic background resumes',originalSize:size});
 // Return through the native back button; preserve the actual composer instance.
 await click('.dismiss');await evaluate(`document.querySelector('[class*="_ApplicationMenuTopBar_"] button[aria-label="返回"]').click()`);await wait(700);
 assert.equal(await evaluate(`document.querySelector('#ark-wallpaper-settings-entry')===null`),true);
 await evaluate(`document.querySelector('#ark-theme-nav-button').shadowRoot.querySelector('button').click()`);
 assert.equal(await evaluate(`${lib}.querySelector('.shell').hidden`),false);assert.equal(await evaluate(`${lib}.querySelector('.shell').classList.contains('embedded')`),false);
 await click('[data-kind="static"]');await click('[data-category="operator"]');await wait(700);
 shot=await c.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(path.join(ROOT,'test-results/native-wallpaper-library.png'),Buffer.from(shot.data,'base64'));
 await click('.tune');assert.equal(await evaluate(`${lib}.querySelector('.inline-scale').checkVisibility()`),true);assert.equal(await evaluate(`${lib}.querySelector('.shell').hidden`),false);await click('.dismiss');
 results.push({check:'settings entry removed on route exit, left rail opens the same library, current-wallpaper adjustment remains in the same panel'});
 await api('settings',initial);await until(`window.__ARK_THEME_LAB_V1__.player.diagnostics().sceneId===${JSON.stringify(initial.sceneId)}`);
 await fs.writeFile(path.join(ROOT,'test-results/native-library-results.json'),JSON.stringify({version:'0.7.0',results},null,2));console.log(JSON.stringify({version:'0.7.0',results},null,2));finished=true;
}finally{if(!finished){try{await api('settings',initial);}catch{}}await evaluate(`delete window.__ARK_LIBRARY_CHECK__`).catch(()=>{});c.close();}
