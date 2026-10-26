import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {ROOT} from '../src/catalog.mjs';
import {CdpSession,listVerifiedTargets} from '../src/cdp.mjs';
const session=JSON.parse(await fs.readFile(path.join(ROOT,'.local/session.json'),'utf8'));
const url=new URL(session.url),response=await fetch(`${url.origin}/api/state`,{headers:{'X-Lab-Token':url.hash.slice(1)}}),state=await response.json();
const version=JSON.parse(await fs.readFile(path.join(ROOT,'package.json'),'utf8')).version;
assert.equal(state.serviceVersion,version);assert.equal(state.native.applied,true);assert.equal(state.native.error,null);assert.equal(state.native.playback.firstFrameReady,true);
const before=JSON.parse((await fs.readFile(path.resolve(ROOT,process.argv[2]??'.local/backups/v091-queues/playlists-before-deploy.json'),'utf8')).replace(/^\uFEFF/,''));
const beforeList=Array.isArray(before)?before:before.playlists??[before];
const contents=lists=>lists.map(q=>({id:q.id,name:q.name,items:q.items.map(i=>({id:i.id,wallpaper:i.wallpaper,duration:i.duration,cycles:i.cycles}))}));
assert.deepEqual(contents(state.settings.playlists),contents(beforeList));
const probe=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-File','scripts/Probe-Host.ps1'],{cwd:ROOT,windowsHide:true,encoding:'utf8'}).replace(/^\uFEFF/,''));
const targets=await listVerifiedTargets(probe);assert.equal(targets.length,1);const c=await new CdpSession(targets[0].url).connect();
try{
  const result=await c.call('Runtime.evaluate',{expression:`(()=>{const r=document.querySelector('#ark-theme-controls')?.shadowRoot.querySelector('#wallpaper-library')?.shadowRoot;return{queueList:!!r?.querySelector('.queue-list'),addButton:r?.querySelector('.queue-add-wallpaper')?.textContent,targetPicker:!!r?.querySelector('.queue-target'),loopSwitch:!!r?.querySelector('.queue-loop'),saveConfirmation:typeof window.__ARK_THEME_LAB_V1__?.confirmSave==='function',background:r?getComputedStyle(r.querySelector('.queue-view')).backgroundColor:null};})()`,returnByValue:true});
  const ui=result.result.value;assert.equal(ui.queueList,true);assert.equal(ui.targetPicker,true);assert.equal(ui.loopSwitch,true);assert.equal(ui.saveConfirmation,true);
  const controls=(await c.call('Runtime.evaluate',{expression:`(()=>{const r=document.querySelector('#ark-theme-controls').shadowRoot.querySelector('#wallpaper-library').shadowRoot;return{savedMenu:r.querySelector('.saved-menu')?.getAttribute('popover'),savedButton:r.querySelector('.save-picker')?.tagName,loopRole:r.querySelector('.queue-loop')?.getAttribute('role'),loopAppearance:getComputedStyle(r.querySelector('.queue-loop')).appearance};})()`,returnByValue:true})).result.value;
  assert.deepEqual(controls,{savedMenu:'auto',savedButton:'BUTTON',loopRole:'switch',loopAppearance:'none'});
  if(before.savedWallpapers)assert.deepEqual(state.settings.savedWallpapers,before.savedWallpapers);
  ui.controls=controls;
  const beta=(await c.call('Runtime.evaluate',{expression:`(()=>{const r=document.querySelector('#ark-theme-controls').shadowRoot.querySelector('#wallpaper-library').shadowRoot;return{compositionManager:!!r.querySelector('.collections'),resourceCenter:!!r.querySelector('.resource-panel'),toolConfiguration:!!r.querySelector('.resource-configure-tools')};})()`,returnByValue:true})).result.value;
  assert.deepEqual(beta,{compositionManager:true,resourceCenter:true,toolConfiguration:true});
  const bridgeId=crypto.randomUUID();
  await c.call('Runtime.evaluate',{expression:`(()=>{const s=window.__ARK_THEME_LAB_V1__;window.__arkBetaBridge={original:s.receiveResources,done:false};s.receiveResources=p=>{window.__arkBetaBridge.original(p);const r=p.results?.find(r=>r.id===${JSON.stringify(bridgeId)});if(r){window.__arkBetaBridge.done=true;window.__arkBetaBridge.ok=!r.error&&typeof r.value?.capabilities?.upscale==='boolean';}};s.resourceRequests.push({id:${JSON.stringify(bridgeId)},action:'status',payload:{}});})()`});
  try{const began=Date.now();while(true){const result=(await c.call('Runtime.evaluate',{expression:'({done:window.__arkBetaBridge.done,ok:window.__arkBetaBridge.ok})',returnByValue:true})).result.value;if(result.done){assert.equal(result.ok,true);beta.resourceBridgeRoundTrip=true;break;}if(Date.now()-began>8000)throw Error('Native resource bridge did not reply');await new Promise(r=>setTimeout(r,150));}}
  finally{await c.call('Runtime.evaluate',{expression:'(()=>{const s=window.__ARK_THEME_LAB_V1__;if(s&&window.__arkBetaBridge)s.receiveResources=window.__arkBetaBridge.original;delete window.__arkBetaBridge;})()'});}
  ui.beta=beta;
  const report={version:state.serviceVersion,nativeApplied:true,firstFrameReady:true,existingQueuesPreserved:state.settings.playlists.length,ui};
  await fs.writeFile(path.join(ROOT,'test-results/queue-native.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{c.close();}
