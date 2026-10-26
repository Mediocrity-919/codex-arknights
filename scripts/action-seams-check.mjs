import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {ROOT} from '../src/catalog.mjs';
import {parseRange} from '../src/range.mjs';
import {createMediaDeck} from '../src/compositor.mjs';
import {createWallpaperPlayer} from '../src/wallpaper-runtime.mjs';
const require=createRequire(path.join(process.env.ARK_TEST_MODULES,'package.json')),{chromium}=require('playwright'),{PNG}=require('pngjs');
const ffmpeg=JSON.parse(await fs.readFile(path.join(ROOT,'.local/runtime.json'),'utf8')).ffmpeg;
const dir=await fs.mkdtemp(path.join(ROOT,'.local/seam-fixture-')),files=new Map();
for(let i=0;i<4;i++){const file=path.join(dir,`${i}.mp4`);execFileSync(ffmpeg,['-v','error','-f','lavfi','-i',`color=c=${['red','green','blue','yellow'][i]}:s=320x180:r=30:d=1`,'-an','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-y',file],{windowsHide:true});files.set(`/${i}.mp4`,file);}
let slow=false;
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost'),file=files.get(url.pathname);if(!file){res.end('<style>body{margin:0;background:black}#deck{position:fixed;inset:0;overflow:hidden}</style><div id="deck"></div>');return;}
  if(slow&&url.searchParams.has('slow'))await new Promise(r=>setTimeout(r,1700));
  const stat=await fs.stat(file),r=parseRange(req.headers.range,stat.size),start=r?.start??0,end=r?.end??stat.size-1;
  res.writeHead(r?206:200,{'Content-Type':'video/mp4','Content-Length':end-start+1,'Accept-Ranges':'bytes','Cache-Control':'no-store',...(r?{'Content-Range':`bytes ${start}-${end}/${stat.size}`}:{})});const stream=createReadStream(file,{start,end});res.on('close',()=>stream.destroy());stream.pipe(res);
}catch{res.writeHead(500);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),page=await browser.newPage({viewport:{width:960,height:540}}),errors=[],report={checks:[],frames:0,blackFrames:0};let sampling=false;
page.on('pageerror',e=>errors.push(e.message));const cdp=await page.context().newCDPSession(page);
cdp.on('Page.screencastFrame',async frame=>{void cdp.send('Page.screencastFrameAck',{sessionId:frame.sessionId}).catch(()=>{});if(!sampling)return;const png=PNG.sync.read(Buffer.from(frame.data,'base64'));let sum=0;for(let i=0;i<png.data.length;i+=4)sum+=png.data[i]+png.data[i+1]+png.data[i+2];report.frames++;if(sum/(png.width*png.height*3)<5)report.blackFrames++;});
try{
  await page.goto(origin);await page.evaluate(({deck,runtime,origin})=>{
    window.events=[];window.handoffs=[];window.player=eval(`(${runtime})`)(document.querySelector('#deck'),{catalog:[{id:'three',kind:'dynamic',fps:30,video:origin+'/0.mp4',clips:[0,1,2].map(i=>({id:String(i),video:origin+`/${i}.mp4`,fps:30})),poster:''},{id:'four',kind:'dynamic',fps:30,video:origin+'/0.mp4',clips:[0,1,2,3].map(i=>({id:String(i),video:origin+`/${i}.mp4`,fps:30})),poster:''}],onState:s=>{if(s.committed){events.push(s);const e=window.player?.diagnostics().events.at(-1);if(e&&['action','cycle','playlist','loop','scene'].includes(e.type))handoffs.push(e);}}},eval(`(${deck})`));
    window.cfg={sceneId:'three',motion:true,activePlaylistId:'q',playlists:[{id:'q',cycles:2,loop:true,items:[{id:'a',wallpaper:{sceneId:'three'}},{id:'b',wallpaper:{sceneId:'four'}}]}]};return player.update(cfg);
  },{deck:createMediaDeck.toString(),runtime:createWallpaperPlayer.toString(),origin});
  await page.waitForFunction(()=>player.diagnostics().standbyReady);await page.waitForTimeout(50);
  const initial=await page.evaluate(()=>player.diagnostics());await page.evaluate(async()=>{for(let i=0;i<12;i++){cfg.playlists[0].items[0].wallpaper.view={scale:1+i/100,x:50,y:50};await player.update(cfg);}});
  const edited=await page.evaluate(()=>player.diagnostics());assert.equal(edited.activeSlot,initial.activeSlot);assert.equal(edited.standbyReady,true);assert.equal(edited.events.filter(e=>e.type==='preload').length,initial.events.filter(e=>e.type==='preload').length);report.checks.push('构图编辑保留当前时间和已预载的下一动作');
  await page.evaluate(()=>{events=[];handoffs=[];});await cdp.send('Page.startScreencast',{format:'png',maxWidth:240,maxHeight:135,everyNthFrame:1});sampling=true;
  await page.waitForFunction(()=>events.length>=110,null,{timeout:150000});sampling=false;await cdp.send('Page.stopScreencast');
  const natural=await page.evaluate(()=>({events,handoffs,diagnostics:player.diagnostics()}));assert.ok(report.frames>100);assert.equal(report.blackFrames,0);assert.equal(natural.diagnostics.videoCount,2);assert.ok(natural.diagnostics.guardBytes<=1920*1080*4);
  const waits=natural.handoffs.map(e=>e.firstFrameWaitMs).sort((a,b)=>a-b);report.handoffTiming={count:waits.length,p95ReadyMs:waits[Math.ceil(waits.length*.95)-1],maxReadyMs:Math.max(...waits),maxVisibleGapMs:Math.max(...natural.handoffs.map(e=>e.maxVisibleFrameGapMs))};assert.ok(report.handoffTiming.p95ReadyMs<=100,JSON.stringify(report.handoffTiming));
  const order=natural.events.filter((s,i,a)=>i===0||s.sceneId!==a[i-1].sceneId||s.clipIndex!==a[i-1].clipIndex||s.cycle!==a[i-1].cycle);assert.ok(order.length>=100);report.checks.push('三动作/四动作自然循环超过 100 次交接，合成输出采样无黑帧');report.naturalTransitions=order.length;
  // Force a cold, delayed successor: the retained frame must remain in the output.
  slow=true;await page.evaluate(async({factory,origin})=>{player.destroy();window.deck=eval(`(${factory})`)(document.querySelector('#deck'));await deck.setScene({id:'delayed',fps:30,video:origin+'/0.mp4',clips:[{id:'a',video:origin+'/0.mp4'},{id:'b',video:origin+'/1.mp4?slow=1'}]});},{factory:createMediaDeck.toString(),origin});
  await cdp.send('Page.startScreencast',{format:'png',maxWidth:240,maxHeight:135,everyNthFrame:1});sampling=true;
  await page.waitForFunction(()=>deck.diagnostics().guardVisible,null,{timeout:8000});await page.waitForFunction(()=>deck.diagnostics().clipIndex===1,null,{timeout:8000});sampling=false;await cdp.send('Page.stopScreencast');assert.equal(report.blackFrames,0);report.checks.push('下一动作延迟 1.7 秒时保持有效画面，随后正常交接');
  await page.evaluate(()=>deck.setEnabled(false));const paused=await page.evaluate(()=>deck.diagnostics());await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>deck.diagnostics().slots[deck.diagnostics().activeSlot].paused),true);await page.evaluate(()=>deck.setEnabled(true));await page.waitForTimeout(200);assert.equal(await page.locator('video').count(),2);report.checks.push('暂停恢复及清理不增加视频解码器');
  assert.deepEqual(errors,[]);report.errors=errors;await fs.writeFile(path.join(ROOT,'test-results/action-seams.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});}
