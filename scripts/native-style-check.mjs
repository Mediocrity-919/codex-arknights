// Read-only native navigation and reversible theme controls. Never enter/send chat text.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ROOT} from '../src/catalog.mjs';
import {CdpSession,listVerifiedTargets} from '../src/cdp.mjs';
const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-File',path.join(ROOT,'scripts/Probe-Host.ps1')],{windowsHide:true,encoding:'utf8'});
const probe=JSON.parse(stdout.replace(/^\uFEFF/,''));assert.equal(probe.debuggerVerified,true);
const targets=await listVerifiedTargets(probe);assert.equal(targets.length,1);
const c=await new CdpSession(targets[0].url).connect();
const saved=JSON.parse(await fs.readFile(path.join(ROOT,'.local/session.json'),'utf8')),u=new URL(saved.url);
const headers={'X-Lab-Token':u.hash.slice(1),'Content-Type':'application/json',Origin:u.origin};
async function api(route,body){for(let i=0;i<8;i++){const r=await fetch(`${u.origin}/api/${route}`,{headers,method:body?'POST':'GET',...(body?{body:JSON.stringify(body)}:{})});if(r.status===409){await wait(180);continue;}const data=await r.json();if(!r.ok)throw new Error(data.error);return data;}throw new Error('Theme busy');}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function evaluate(expression){const r=await c.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
const out=path.join(ROOT,'test-results');await fs.mkdir(out,{recursive:true});
const initial=(await api('state')).settings;
const report={testedAt:new Date().toISOString(),version:'0.6.0',package:probe.package.version,modules:[]};
const measurement=`(()=>{
 const visible=e=>e.getBoundingClientRect().width>0;
 const rect=e=>{const r=e.getBoundingClientRect();return[r.x,r.y,r.width,r.height]};
 const nodes=[...document.querySelectorAll('[data-app-shell-frame],main[data-app-shell-main-surface],aside.app-shell-left-panel,[data-app-shell-titlebar],main h1,[data-composer-body]')].filter(visible);
 const style=document.querySelector('#ark-theme-lab-style');const themed=nodes.map(rect);style.disabled=true;const original=nodes.map(rect);style.disabled=false;
 const headings=[...document.querySelectorAll('main h1')].filter(visible);
 const pageHeads=[...document.querySelectorAll('main[data-app-shell-main-surface] [class*="_shell_"]:has(> [class*="_content_"] > [class*="_headerRow_"] h1)')].filter(visible);
 const side=[...document.querySelectorAll('aside.app-shell-left-panel,aside.app-shell-left-panel .sidebar-navigation')].filter(visible);
 const title=document.querySelector('#ark-theme-title-tint');const layer=document.querySelector('#ark-theme-lab-layer').getBoundingClientRect();
 return {geometryPreserved:JSON.stringify(themed)===JSON.stringify(original),headingRects:headings.map(rect),pageHeads:pageHeads.map(e=>({bg:getComputedStyle(e,'::before').backgroundColor,blur:getComputedStyle(e,'::before').backdropFilter})),sidebar:side.map(e=>({bg:getComputedStyle(e).backgroundColor,blur:getComputedStyle(e).backdropFilter})),titleTintHidden:getComputedStyle(title).display==='none',fullBleed:layer.top===0&&layer.left===0&&layer.bottom>=innerHeight&&layer.right>=innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,navIntegrated:!!document.querySelector('nav[data-app-navigation-rail] #ark-theme-nav-button')};
})()`;
let navigated=false;
async function back(){await evaluate(`document.querySelector('[class*="_ApplicationMenuTopBar_"] button[aria-label="返回"]').click()`);await wait(600);navigated=false;assert.equal(await evaluate('location.href===window.__ARK_STYLE_CHECK__.url'),true);}
try{
 assert.equal((await api('state')).serviceVersion,'0.6.0');
 await evaluate(`(()=>{window.__ARK_STYLE_CHECK__={url:location.href,player:window.__ARK_THEME_LAB_V1__.player,input:document.querySelector('[data-codex-composer][contenteditable]'),focus:document.activeElement};return true;})()`);
 assert.equal(initial.chromeBlur,0);assert.equal(initial.summaryBlur,0);
 report.chat=await evaluate(measurement);assert.equal(report.chat.geometryPreserved,true);assert.equal(report.chat.fullBleed,true);assert.equal(report.chat.overflow,false);
 assert.equal(report.chat.titleTintHidden,false);for(const s of report.chat.sidebar){assert.equal(s.bg,'rgba(0, 0, 0, 0)');assert.equal(s.blur,'none');}
 await evaluate(`(()=>{const sh=document.querySelector('#ark-theme-controls').shadowRoot;document.querySelector('#ark-theme-nav-button').shadowRoot.querySelector('button').click();sh.querySelector('details').open=true;for(const [id,value] of [['chromeBlur',9],['summaryBlur',11]]){const e=sh.getElementById(id);e.value=value;e.dispatchEvent(new Event('input'));}})()`);
 await wait(1300);
 const tuning=await evaluate(`(()=>{const q=s=>getComputedStyle(document.querySelector(s)).backdropFilter;return {menu:q('#ark-theme-menu-tint'),title:q('#ark-theme-title-tint'),card:q('[data-summary-panel-variant]'),strength:document.querySelector('#ark-theme-media').style.opacity,inputConnected:window.__ARK_STYLE_CHECK__.input?.isConnected??null};})()`);
 assert.equal(tuning.menu,'blur(9px)');assert.equal(tuning.title,'blur(9px)');assert.equal(tuning.card,'blur(11px)');assert.equal(tuning.strength,String(initial.strength));
 const persisted=(await api('state')).settings;assert.equal(persisted.chromeBlur,9);assert.equal(persisted.summaryBlur,11);
 report.tuning={...tuning,persists:true};
 await api('settings',initial);await evaluate(`document.querySelector('#ark-theme-controls').shadowRoot.querySelector('.close').click()`);
 for(const [destination,name] of [['images','图像'],['customize','插件'],['automations','定时任务'],['library','资料库'],['sites','站点'],['pull-requests','代码审查']]){
  await evaluate(`document.querySelector('[data-sidebar-destination="builtin:${destination}"]').click()`);navigated=true;await wait(1300);
  const result=await evaluate(measurement);
  assert.equal(result.geometryPreserved,true,`${name} geometry`);assert.equal(result.fullBleed,true);assert.equal(result.overflow,false);assert.equal(result.titleTintHidden,true,`${name} chat tint must hide`);assert.equal(result.navIntegrated,true);
  for(const h of result.pageHeads){assert.equal(h.bg,'rgba(0, 0, 0, 0)',`${name} page header`);assert.equal(h.blur,'none');}
  for(const s of result.sidebar){assert.equal(s.bg,'rgba(0, 0, 0, 0)');assert.equal(s.blur,'none');}
  if(['images','customize'].includes(destination)){
   const shot=await c.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(path.join(out,`native-v04-${destination}.png`),Buffer.from(shot.data,'base64'));
   const scroll=await evaluate(`(()=>{const h=[...document.querySelectorAll('main h1')].find(e=>e.getBoundingClientRect().width>0);let p=h?.parentElement;while(p&&p!==document.body){if(p.scrollHeight>p.clientHeight+100&&getComputedStyle(p).overflowY==='auto'){window.__ARK_STYLE_CHECK__.scroll={node:p,top:p.scrollTop};p.scrollTop=220;return true;}p=p.parentElement;}return false;})()`);
   if(scroll){await wait(500);const scrolled=await evaluate(measurement);assert.equal(scrolled.geometryPreserved,true);for(const h of scrolled.pageHeads)assert.equal(h.bg,'rgba(0, 0, 0, 0)');result.scrolledHeaderChecked=true;await evaluate(`(()=>{const s=window.__ARK_STYLE_CHECK__.scroll;s.node.scrollTop=s.top;delete window.__ARK_STYLE_CHECK__.scroll})()`);}
  }
  report.modules.push({name,...result});await back();
 }
 report.final=await evaluate(`({returnedToChat:location.href===window.__ARK_STYLE_CHECK__.url,playerPreserved:window.__ARK_THEME_LAB_V1__.player===window.__ARK_STYLE_CHECK__.player,inputPreserved:document.querySelector('[data-codex-composer][contenteditable]')===window.__ARK_STYLE_CHECK__.input,top:getComputedStyle(document.querySelector('#ark-theme-menu-tint')).backdropFilter,right:getComputedStyle(document.querySelector('[data-summary-panel-variant]')).backdropFilter})`);
 assert.equal(report.final.returnedToChat,true);assert.equal(report.final.playerPreserved,true);assert.equal(report.final.inputPreserved,true);assert.equal(report.final.top,'none');assert.equal(report.final.right,'none');
 assert.deepEqual((await api('state')).settings,initial);
 await fs.writeFile(path.join(out,'native-style-results.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}finally{
 await api('settings',initial).catch(()=>{});if(navigated)await back().catch(()=>{});
 await evaluate(`(()=>{const v=window.__ARK_STYLE_CHECK__;if(v?.focus?.isConnected)v.focus.focus({preventScroll:true});delete window.__ARK_STYLE_CHECK__})()`).catch(()=>{});c.close();
}
