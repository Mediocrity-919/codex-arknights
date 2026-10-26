import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {ROOT} from '../src/catalog.mjs';
import {CdpSession,listVerifiedTargets} from '../src/cdp.mjs';
const probe=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-File','scripts/Probe-Host.ps1'],{windowsHide:true,encoding:'utf8'}).replace(/^\uFEFF/,''));
const targets=await listVerifiedTargets(probe);if(targets.length!==1)throw Error('Expected one verified window');
const c=await new CdpSession(targets[0].url).connect();
try{
  const r=await c.call('Runtime.evaluate',{returnByValue:true,expression:`(()=>{
    const describe=e=>{if(!e)return null;const s=getComputedStyle(e),r=e.getBoundingClientRect();return{tag:e.tagName,cls:e.className,rect:[r.x,r.y,r.width,r.height],bg:s.backgroundColor,image:s.backgroundImage,fit:s.objectFit,overflow:s.overflow};};
    const ancestors=[];for(let e=document.querySelector('nav[data-app-navigation-rail]');e;e=e.parentElement)ancestors.push(describe(e));
    const point=document.elementsFromPoint(30,450).map(describe);
    const lib=document.querySelector('#ark-theme-controls')?.shadowRoot.querySelector('#wallpaper-library')?.shadowRoot;
    return{viewport:[innerWidth,innerHeight,devicePixelRatio],rail:ancestors,point,media:[...document.querySelectorAll('#ark-theme-media video')].map(v=>({...describe(v),ready:v.readyState,time:v.currentTime,duration:v.duration,paused:v.paused,quality:v.getVideoPlaybackQuality?.()})),playback:window.__ARK_THEME_LAB_V1__?.player.diagnostics(),library:lib?{shell:describe(lib.querySelector('.shell')),detail:describe(lib.querySelector('.detail')),variants:[...lib.querySelectorAll('[data-variant]')].map(e=>({label:e.textContent,visible:e.checkVisibility(),...describe(e)}))}:null};
  })()`});
  await fs.writeFile(path.join(ROOT,'test-results/v06-native-inspection.json'),JSON.stringify(r.result.value,null,2));console.log(JSON.stringify(r.result.value,null,2));
}finally{c.close();}
