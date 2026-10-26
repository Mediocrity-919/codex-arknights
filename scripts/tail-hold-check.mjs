import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {ROOT} from '../src/catalog.mjs';import {createMediaDeck} from '../src/compositor.mjs';import {startServer} from '../src/server.mjs';
const require=createRequire(path.join(process.env.ARK_TEST_MODULES,'package.json')),{chromium}=require('playwright');
const dir=await fs.mkdtemp(path.join(ROOT,'.local','tail-hold-')),lab=await startServer({stateDir:dir,probeHost:async()=>({debuggerVerified:false})});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),page=await browser.newPage();let release;
const delayed=new Promise(r=>release=r);await page.route('**/delayed-video',async route=>{await delayed;await route.abort().catch(()=>{});});
try{
  await page.goto(lab.origin+'/test');await page.setContent('<div id="deck" style="position:absolute;inset:0"></div>');
  await page.evaluate(`window.deck=(${createMediaDeck.toString()})(document.querySelector('#deck'));window.source={id:'held-tail',clips:[{id:'first',video:${JSON.stringify(`${lab.origin}/media/eyja/video?key=${lab.token}`)}},{id:'delayed',video:location.origin+'/delayed-video'}]};`);
  await page.evaluate(()=>deck.setScene(source));await page.evaluate(()=>{const v=document.querySelectorAll('video')[deck.diagnostics().activeSlot];v.currentTime=v.duration-.6;});await page.waitForTimeout(1300);
  const before=await page.evaluate(()=>{const v=document.querySelectorAll('video')[deck.diagnostics().activeSlot];return{time:v.currentTime,duration:v.duration,paused:v.paused};});assert.equal(before.paused,true);assert.ok(before.duration-before.time>.05);
  await page.evaluate(()=>{deck.setEnabled(false);deck.setEnabled(true);});await page.waitForTimeout(700);
  const after=await page.evaluate(()=>{const v=document.querySelectorAll('video')[deck.diagnostics().activeSlot],c=document.createElement('canvas');c.width=32;c.height=18;const ctx=c.getContext('2d');ctx.drawImage(v,0,0,32,18);const a=ctx.getImageData(0,0,32,18).data;let n=0;for(let i=0;i<a.length;i+=4)n+=a[i]+a[i+1]+a[i+2];return{time:v.currentTime,paused:v.paused,mean:n/(32*18*3)};});assert.equal(after.time,before.time);assert.equal(after.paused,true);assert.ok(after.mean>50);
  const result={check:'delayed successor retains a valid tail through pause/resume',before,after};await fs.writeFile(path.join(ROOT,'test-results/v07-tail-hold.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{release();await browser.close();await lab.close();if(path.dirname(dir)!==path.join(ROOT,'.local'))throw Error('Unexpected test path');await fs.rm(dir,{recursive:true,force:true});}
