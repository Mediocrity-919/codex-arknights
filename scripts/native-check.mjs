// Live desktop check: never types into, submits, or replaces a native composer.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT, mediaPath, nativeFileUrl } from '../src/catalog.mjs';
import { CdpSession, listVerifiedTargets } from '../src/cdp.mjs';
const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(ROOT,'scripts/Probe-Host.ps1')],{windowsHide:true,encoding:'utf8'});
const probe=JSON.parse(stdout.replace(/^\uFEFF/,''));assert.equal(probe.debuggerVerified,true);
const targets=await listVerifiedTargets(probe);assert.equal(targets.length,1);
const cdp=await new CdpSession(targets[0].url).connect();
const saved=JSON.parse(await fs.readFile(path.join(ROOT,'.local/session.json'),'utf8')), uri=new URL(saved.url);
const headers={'X-Lab-Token':uri.hash.slice(1),'Content-Type':'application/json',Origin:uri.origin};
async function api(route,body){const response=await fetch(`${uri.origin}/api/${route}`,{headers,method:body?'POST':'GET',...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw new Error(data.error);return data;}
async function evaluate(expression){const result=await cdp.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const output=path.join(ROOT,'test-results');await fs.mkdir(output,{recursive:true});
let report={testedAt:new Date().toISOString(),version:probe.package.version};
try {
  await api('native',{action:'remove'});
  const baseline=await evaluate(`(()=>{const pick=s=>[...document.querySelectorAll(s)].find(e=>e.getBoundingClientRect().width>0);const main=pick('main[data-app-shell-main-surface]'),composer=pick('[data-composer-body]'),input=pick('[data-codex-composer][contenteditable]');window.__ARK_VALIDATION__={main,composer,input,focus:document.activeElement};const rect=e=>{const r=e.getBoundingClientRect();return[r.x,r.y,r.width,r.height]};return{main:rect(main),composer:rect(composer),inputOpacity:getComputedStyle(input).opacity,mainBackground:getComputedStyle(main).backgroundColor,composerBackground:getComputedStyle(composer).backgroundColor};})()`);
  const initial=(await api('state')).settings;
  await api('native',{action:'apply',media:'video',targetId:targets[0].id});await pause(2500);
  const applied=await evaluate(`(()=>{const b=window.__ARK_VALIDATION__,rect=e=>{const r=e.getBoundingClientRect();return[r.x,r.y,r.width,r.height]};const index=window.__ARK_THEME_LAB_V1__.player.diagnostics().activeSlot;const video=document.querySelectorAll('#ark-theme-lab-layer video')[index];return{main:rect(b.main),composer:rect(b.composer),nodesPreserved:b.main.isConnected&&b.composer.isConnected&&b.input.isConnected,focusPreserved:document.activeElement===b.focus,inputOpacity:getComputedStyle(b.input).opacity,composerBackground:getComputedStyle(b.composer).backgroundColor,media:{width:video.videoWidth,height:video.videoHeight,time:video.currentTime,paused:video.paused,error:video.error?.code??null},panelHidden:document.querySelector('#ark-theme-controls').shadowRoot.querySelector('.panel').hidden};})()`);
  assert.deepEqual(applied.main,baseline.main);assert.deepEqual(applied.composer,baseline.composer);assert.equal(applied.nodesPreserved,true);assert.equal(applied.inputOpacity,baseline.inputOpacity);assert.equal(applied.panelHidden,true);
  report.layout={unchanged:true,focusPreserved:applied.focusPreserved};report.navIntegrated=await evaluate("!!document.querySelector('nav[data-app-navigation-rail] #ark-theme-nav-button')");assert.equal(report.navIntegrated,true);report.video=applied.media;
  await evaluate(`(()=>{const root=document.querySelector('#ark-theme-controls').shadowRoot;document.querySelector('#ark-theme-nav-button').shadowRoot.querySelector('.toggle').click();const slider=root.querySelector('#composerOpacity');slider.value='85';slider.dispatchEvent(new Event('input'));})()`);
  await pause(1300);
  const tuned=await evaluate(`(()=>{const b=window.__ARK_VALIDATION__;return{inputOpacity:getComputedStyle(b.input).opacity,composerBackground:getComputedStyle(b.composer).backgroundColor,wallpaperOpacity:document.querySelector('#ark-theme-media').style.opacity,panelOpen:window.__ARK_THEME_LAB_V1__.panelOpen};})()`);
  assert.equal(tuned.wallpaperOpacity,String(initial.strength));assert.equal(tuned.inputOpacity,baseline.inputOpacity);assert.match(tuned.composerBackground, /0\.15\)/);assert.equal((await api('state')).settings.composerOpacity,.15);report.transparency={independent:true,persists:true,...tuned};
  const image=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(path.join(output,'native-theme-controls.png'),Buffer.from(image.data,'base64'));
  report.sceneSwitches=[];
  for(const id of ['yaoyue','shu-1','shu-2','eyja']) {
    await evaluate(`(()=>{const selector=document.querySelector('#ark-theme-controls').shadowRoot.querySelector('#scene');selector.value=${JSON.stringify(id)};selector.dispatchEvent(new Event('change'));})()`);
    let loaded=false, media;
    for(let retry=0;retry<20;retry++) {
      await pause(500);
      const state=await api('state');
      media=await evaluate(`(()=>{const index=window.__ARK_THEME_LAB_V1__.player.diagnostics().activeSlot;const v=document.querySelectorAll('#ark-theme-lab-layer video')[index];return{sourceMatches:v?.getAttribute('src')===${JSON.stringify(nativeFileUrl(mediaPath(id)))},width:v?.videoWidth??0,height:v?.videoHeight??0,time:v?.currentTime??0,error:v?.error?.code??null,panelOpen:window.__ARK_THEME_LAB_V1__?.panelOpen};})()`);
      if(state.settings.sceneId===id && media.sourceMatches && media.width>0 && media.time>0){loaded=true;break;}
    }
    assert.equal(loaded,true);assert.equal(media.error,null);assert.equal(media.panelOpen,true);report.sceneSwitches.push({id,...media});
  }
  await api('settings',initial);
  await evaluate(`document.querySelector('#ark-theme-controls').shadowRoot.querySelector('.close').click()`);
  await api('native',{action:'remove'});
  const restored=await evaluate(`(()=>{const b=window.__ARK_VALIDATION__;return{layer:!!document.querySelector('#ark-theme-lab-layer'),controls:!!document.querySelector('#ark-theme-controls'),mainBackground:getComputedStyle(b.main).backgroundColor,composerBackground:getComputedStyle(b.composer).backgroundColor,inputConnected:b.input.isConnected};})()`);
  assert.equal(restored.layer,false);assert.equal(restored.controls,false);assert.equal(restored.mainBackground,baseline.mainBackground);assert.equal(restored.composerBackground,baseline.composerBackground);assert.equal(restored.inputConnected,true);report.restore={passed:true};
  await api('native',{action:'apply',media:'video',targetId:targets[0].id});await pause(1500);
  await evaluate('delete window.__ARK_VALIDATION__');
  report.finalState=(await api('state')).native;
  await fs.writeFile(path.join(output,'native-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} finally {await evaluate('delete window.__ARK_VALIDATION__').catch(()=>{});cdp.close();}
