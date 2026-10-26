import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ROOT,scenes} from '../src/catalog.mjs';
import {CdpSession,listVerifiedTargets} from '../src/cdp.mjs';
const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(ROOT,'scripts/Probe-Host.ps1')],{windowsHide:true});
const targets=await listVerifiedTargets(JSON.parse(stdout.replace(/^\uFEFF/,'')));assert.equal(targets.length,1);
const cdp=await new CdpSession(targets[0].url).connect();
async function run(expression){const r=await cdp.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
const session=JSON.parse(await fs.readFile(path.join(ROOT,'.local/session.json'),'utf8')),uri=new URL(session.url);
const headers={'X-Lab-Token':uri.hash.slice(1),'Content-Type':'application/json',Origin:uri.origin};
async function api(route,body){const r=await fetch(`${uri.origin}/api/${route}`,{headers,method:body?'POST':'GET',...(body?{body:JSON.stringify(body)}:{})});const v=await r.json();if(!r.ok)throw new Error(v.error);return v;}
const initial=(await api('state')).settings, report={date:new Date().toISOString(),probes:[]};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(expression,timeout=15000){const start=Date.now();while(Date.now()-start<timeout){if(await run(expression))return;await delay(150);}throw new Error('Playback condition timed out');}
try {
  await run(`window.__ARK_TEST__={controls:document.querySelector('#ark-theme-controls'),media:document.querySelector('#ark-theme-media'),sample:false,blank:0};window.__ARK_TEST__.tick=()=>{const t=window.__ARK_TEST__;if(t.sample&&![...document.querySelectorAll('#ark-theme-media video')].some(v=>v.readyState>=2&&Number(v.style.opacity)>.99))t.blank++;t.frame=requestAnimationFrame(t.tick);};window.__ARK_TEST__.tick();`);
  for(const scene of scenes.filter(scene=>scene.kind==='dynamic')) {
    await api('settings',{...initial,sceneId:scene.id,focusX:scene.focusX,focusY:scene.focusY,motion:true,quality:'original',mode:'balanced'});
    await waitFor(`(()=>{const d=window.__ARK_THEME_LAB_V1__.player.diagnostics();return d.sceneId===${JSON.stringify(scene.id)}&&!d.transitioning&&d.standbyReady})()`);
    const before=await run(`window.__ARK_THEME_LAB_V1__.player.diagnostics().events.filter(e=>e.type==='loop').length`);
    await run(`(async()=>{const d=window.__ARK_THEME_LAB_V1__.player.diagnostics(),v=document.querySelectorAll('#ark-theme-media video')[d.activeSlot];window.__ARK_TEST__.sample=false;const seeked=new Promise(r=>v.addEventListener('seeked',r,{once:true}));v.currentTime=v.duration-1.1;await seeked;await new Promise(r=>v.requestVideoFrameCallback(r));window.__ARK_TEST__.sample=true;})()`);
    await waitFor(`(()=>{const d=window.__ARK_THEME_LAB_V1__.player.diagnostics();return d.events.filter(e=>e.type==='loop').length>${before}&&!d.transitioning&&d.standbyReady})()`);
    const d=await run('window.__ARK_THEME_LAB_V1__.player.diagnostics()');
    const seam=d.events.findLast(e=>e.type==='loop'),preload=d.events.findLast(e=>e.type==='preload');
    assert.equal(await run('window.__ARK_TEST__.blank'),0);assert.equal(d.videoCount,2);
    report.probes.push({sceneId:scene.id,seam,preload});
    console.log(JSON.stringify(report.probes.at(-1)));
  }
  await run('window.__ARK_TEST__.sample=false');await api('settings',initial);await waitFor(`(()=>{const d=window.__ARK_THEME_LAB_V1__.player.diagnostics();return d.sceneId===${JSON.stringify(initial.sceneId)}&&!d.transitioning})()`);
  const count=await run(`window.__ARK_THEME_LAB_V1__.player.diagnostics().events.filter(e=>e.type==='loop').length`);
  if(scenes.find(s=>s.id===initial.sceneId)?.kind==='dynamic'&&initial.sceneId!=='yaoyue'&&initial.motion&&initial.mode!=='focus'&&initial.quality==='original') {
    await waitFor(`window.__ARK_THEME_LAB_V1__.player.diagnostics().events.filter(e=>e.type==='loop').length>${count}`,40000);
    report.naturalLoop=await run(`window.__ARK_THEME_LAB_V1__.player.diagnostics().events.findLast(e=>e.type==='loop')`);
  }
  report.retained=await run(`({controls:window.__ARK_TEST__.controls===document.querySelector('#ark-theme-controls'),media:window.__ARK_TEST__.media===document.querySelector('#ark-theme-media'),blankFrames:window.__ARK_TEST__.blank,rail:!!document.querySelector('nav[data-app-navigation-rail] #ark-theme-nav-button')})`);
  assert.equal(report.retained.controls,true);assert.equal(report.retained.media,true);assert.equal(report.retained.blankFrames,0);assert.equal(report.retained.rail,true);
  await fs.writeFile(path.join(ROOT,'test-results/native-playback-results.json'),JSON.stringify(report,null,2));
  const image=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(path.join(ROOT,'test-results/native-v03.png'),Buffer.from(image.data,'base64'));
  console.log(JSON.stringify(report,null,2));
} finally {await run('if(window.__ARK_TEST__){cancelAnimationFrame(window.__ARK_TEST__.frame);delete window.__ARK_TEST__}').catch(()=>{});await api('settings',initial).catch(()=>{});cdp.close();}
