// Verify only the injected wallpaper UI and its media. Do not inspect or enter chat text.
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
import {ROOT} from '../src/catalog.mjs';import {CdpSession,listVerifiedTargets} from '../src/cdp.mjs';
const probe=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-File','scripts/Probe-Host.ps1'],{windowsHide:true,encoding:'utf8'}).replace(/^\uFEFF/,''));
const targets=await listVerifiedTargets(probe);assert.equal(targets.length,1);const c=await new CdpSession(targets[0].url).connect();
const session=JSON.parse(await fs.readFile(path.join(ROOT,'.local/session.json'),'utf8')),url=new URL(session.url),headers={'X-Lab-Token':url.hash.slice(1),'Content-Type':'application/json',Origin:url.origin};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function api(route,body){for(let i=0;i<15;i++){const r=await fetch(url.origin+'/api/'+route,{headers,method:body?'POST':'GET',...(body?{body:JSON.stringify(body)}:{})});if(r.status===409){await sleep(200);continue;}const v=await r.json();if(!r.ok)throw Error(v.error);return v;}throw Error('Theme busy');}
async function evaluate(expression){const r=await c.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function until(expression){for(let i=0;i<80;i++){if(await evaluate(expression))return;await sleep(200);}throw Error('Native check timed out: '+expression);}
const lib=`document.querySelector('#ark-theme-controls').shadowRoot.querySelector('#wallpaper-library').shadowRoot`;
const initial=(await api('state')).settings,report={version:'0.7.0',host:probe.package.version,results:[]};let changed=false;
try{
  assert.equal((await api('state')).serviceVersion,'0.7.0');await c.call('Page.bringToFront');
  if(!(await api('state')).native.applied)await api('native',{action:'apply',media:'video'});
  await until(`!!window.__ARK_THEME_LAB_V1__?.player`);
  await api('settings',{...initial,sceneId:'eyja',wallpaper:null,activePlaylistId:null,motion:true,playbackPaused:false,mode:'balanced',quality:'original'});changed=true;
  await until(`window.__ARK_THEME_LAB_V1__.player.diagnostics().sceneId==='eyja'&&window.__ARK_THEME_LAB_V1__.player.diagnostics().standbyReady`);
  await evaluate(`document.querySelector('#ark-theme-nav-button').shadowRoot.querySelector('button').click()`);
  assert.equal(await evaluate(`${lib}.querySelectorAll('.card').length`),4);
  const before=await evaluate(`window.__ARK_THEME_LAB_V1__.player.diagnostics()`);
  await evaluate(`(()=>{const e=${lib}.querySelector('.inline-scale');e.value=113;e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await sleep(1300);
  const after=await evaluate(`window.__ARK_THEME_LAB_V1__.player.diagnostics()`);assert.equal(after.activeSlot,before.activeSlot);assert.ok(after.slots[after.activeSlot].time>=before.slots[before.activeSlot].time);assert.equal((await api('state')).settings.wallpaper.view.scale,1.13);
  const geometry=await evaluate(`(()=>{const els=[...document.querySelectorAll('nav[data-app-navigation-rail],aside.app-shell-left-panel,main[data-app-shell-main-surface],[data-composer-body]')];const rects=()=>els.map(e=>{const r=e.getBoundingClientRect();return[r.x,r.y,r.width,r.height]});const style=document.querySelector('#ark-theme-lab-style'),themed=rects();style.disabled=true;const native=rects();style.disabled=false;return{preserved:JSON.stringify(themed)===JSON.stringify(native),rail:getComputedStyle(document.querySelector('nav[data-app-navigation-rail]')).backgroundColor};})()`);assert.equal(geometry.preserved,true);assert.equal(geometry.rail,'rgba(0, 0, 0, 0)');
  const bounds=await evaluate(`(()=>{const r=${lib}.querySelector('.shell').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1};})()`);const shot=await c.call('Page.captureScreenshot',{format:'png',clip:bounds,captureBeyondViewport:false});await fs.writeFile(path.join(ROOT,'test-results/native-v07-library.png'),Buffer.from(shot.data,'base64'));
  await evaluate(`${lib}.querySelector('.dismiss').click()`);
  report.results.push({check:'native library exposes all four Eyja variants; direct scaling persists without reload; original layout and transparent rail preserved',geometry});
  // Measure source pixels only, not private page content. Account for hidden windows.
  await evaluate(`(()=>{const canvas=document.createElement('canvas');canvas.width=96;canvas.height=54;const ctx=canvas.getContext('2d',{willReadFrequently:true});window.__ARK_NATIVE_V07__={samples:[],timer:0};const p=window.__ARK_NATIVE_V07__;p.timer=setInterval(()=>{const d=window.__ARK_THEME_LAB_V1__.player.diagnostics(),v=document.querySelectorAll('#ark-theme-media video')[d.activeSlot];if(!v||v.readyState<2||document.hidden||!d.enabled)return;ctx.drawImage(v,0,0,96,54);const a=ctx.getImageData(0,0,96,54).data;let sum=0;for(let j=0;j<a.length;j+=4)sum+=a[j]+a[j+1]+a[j+2];p.samples.push({at:performance.now(),time:v.currentTime,mean:sum/(5184*3),sceneId:d.sceneId,transition:d.transitioning});},100);})()`);
  await sleep(62000);
  const pixels=await evaluate(`(()=>{const p=window.__ARK_NATIVE_V07__;clearInterval(p.timer);const result={samples:p.samples,diagnostics:window.__ARK_THEME_LAB_V1__.player.diagnostics(),hidden:document.hidden};delete window.__ARK_NATIVE_V07__;return result;})()`);
  await fs.writeFile(path.join(ROOT,'test-results/native-v07-pixels.json'),JSON.stringify(pixels,null,2));
  assert.ok(pixels.samples.length>400,`insufficient visible playback: ${pixels.samples.length}`);assert.equal(pixels.samples.filter(s=>s.mean<8).length,0);assert.ok(pixels.diagnostics.events.filter(e=>e.type==='loop'&&e.sceneId==='eyja').length>=2);
  report.results.push({check:'native Eyja two natural loops',sampleCount:pixels.samples.length,minLuma:Math.min(...pixels.samples.map(s=>s.mean)),events:pixels.diagnostics.events.filter(e=>e.type==='loop')});
  await api('settings',{...(await api('state')).settings,sceneId:'official-202307865',wallpaper:{sceneId:'official-202307865'},activePlaylistId:null});
  await until(`window.__ARK_THEME_LAB_V1__.player.diagnostics().sceneId==='official-202307865'&&!window.__ARK_THEME_LAB_V1__.player.diagnostics().transitioning`);
  const fill=await evaluate(`(()=>{const d=window.__ARK_THEME_LAB_V1__.player.diagnostics(),canvas=document.querySelectorAll('#ark-theme-media canvas')[d.activeSlot],a=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let sum=0;for(let i=0;i<a.length;i+=4)sum+=a[i]+a[i+1]+a[i+2];const r=canvas.getBoundingClientRect();return{mean:sum/(a.length/4*3),opacity:canvas.style.opacity,fullBleed:r.left<=0&&r.right>=innerWidth,fit:document.querySelectorAll('#ark-theme-media video')[d.activeSlot].style.objectFit};})()`);assert.ok(fill.mean>10);assert.equal(fill.opacity,'1');assert.equal(fill.fullBleed,true);assert.equal(fill.fit,'contain');report.results.push({check:'native official full-frame video has full-bleed edge backing rather than black bars',fill});
  await fs.writeFile(path.join(ROOT,'test-results/native-v07-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{
  await evaluate(`if(window.__ARK_NATIVE_V07__){clearInterval(window.__ARK_NATIVE_V07__.timer);delete window.__ARK_NATIVE_V07__}`).catch(()=>{});
  const now=(await api('state')).settings;if(changed&&['eyja','official-202307865'].includes(now.sceneId))await api('settings',initial);
  c.close();
}
