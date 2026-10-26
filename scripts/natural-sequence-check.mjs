import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {ROOT,scenes} from '../src/catalog.mjs';
import {createMediaDeck} from '../src/compositor.mjs';
import {createWallpaperPlayer} from '../src/wallpaper-runtime.mjs';
import {startServer} from '../src/server.mjs';
const require=createRequire(path.join(process.env.ARK_TEST_MODULES,'package.json')),{chromium}=require('playwright');
const dir=await fs.mkdtemp(path.join(ROOT,'.local','natural-v06-'));
const lab=await startServer({stateDir:dir,probeHost:async()=>({debuggerVerified:false})});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1280,height:720}});
try{
  await page.goto(lab.origin+'/test');await page.setContent('<style>body{margin:0}#deck{position:absolute;inset:0}</style><div id="deck"></div>');
  const catalog=[scenes.find(s=>s.id==='official-5616'),scenes.find(s=>s.role==='complete')].map(s=>({...s,poster:`${lab.origin}/media/${s.id}/poster?key=${lab.token}`,video:s.kind==='dynamic'?`${lab.origin}/media/${s.id}/video?key=${lab.token}`:null,clips:s.clips?.map(c=>({...c,video:`${lab.origin}/media/${c.id}/video?key=${lab.token}`}))}));
  await page.evaluate(`window.commits=[];window.player=(${createWallpaperPlayer.toString()})(document.querySelector('#deck'),{catalog:${JSON.stringify(catalog)},onState:c=>{if(c.committed)commits.push(c);}},${createMediaDeck.toString()});`);
  await page.evaluate(async ids=>{
    await player.update({sceneId:ids[0],motion:true,activePlaylistId:'q',playlists:[{id:'q',duration:60,cycles:2,items:ids.map((id,i)=>({id:String(i),wallpaper:{sceneId:id}}))}]});
    window.blankFrames=0;window.sample=()=>{const visible=[...document.querySelector('#deck').children].some(e=>Number(e.style.opacity)>=.99&&(e.tagName==='VIDEO'?e.readyState>=2:e.children.length&&[...e.children].every(i=>i.complete&&i.naturalWidth)));if(!visible)blankFrames++;window.sampleId=requestAnimationFrame(sample);};sample();
  },catalog.map(s=>s.id));
  console.log('自然播放中：3 段官方动作，完整两遍，不主动跳转时间。');
  await page.waitForFunction(()=>commits.length>=7,null,{timeout:155000});
  const report=await page.evaluate(()=>({commits,blankFrames,playback:player.diagnostics()}));
  assert.deepEqual(report.commits.slice(0,6).map(c=>[c.clipIndex,c.cycle]),[[0,0],[1,0],[2,0],[0,1],[1,1],[2,1]]);assert.equal(report.commits[6].sceneId,catalog[1].id);assert.equal(report.blankFrames,0);
  await fs.writeFile(path.join(ROOT,'test-results/natural-sequence-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,blankFrames:report.blankFrames,sequence:report.commits.map(c=>[c.sceneId,c.clipIndex,c.cycle]),transitionFrameGapsMs:report.playback.events.filter(e=>['action','cycle','playlist'].includes(e.type)).map(e=>e.maxVisibleFrameGapMs)}));
}finally{await browser.close();await lab.close();if(path.dirname(dir)!==path.join(ROOT,'.local'))throw Error('Unexpected test directory');await fs.rm(dir,{recursive:true,force:true});}
