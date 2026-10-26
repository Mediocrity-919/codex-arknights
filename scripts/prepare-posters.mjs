import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, scenes } from '../src/catalog.mjs';
if (!process.env.ARK_TEST_MODULES) throw new Error('Set ARK_TEST_MODULES to a Playwright installation. This is a development-only media preparation tool.');
const require = createRequire(path.join(process.env.ARK_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright');
const { url } = JSON.parse(await fs.readFile(path.join(ROOT, '.local', 'session.json'), 'utf8'));
const token = new URL(url).hash.slice(1), origin = new URL(url).origin;
const directory = path.join(ROOT, '.local', 'posters');await fs.mkdir(directory,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.ARK_TEST_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try {
  const page=await browser.newPage();
  await page.goto(`${origin}/`);
  for(const scene of scenes.filter(scene=>scene.kind==='dynamic')) {
    const data=await page.evaluate(async({src})=>{
      const video=document.createElement('video');video.muted=true;video.preload='auto';
      const ready=new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(new Error('Video could not be decoded'));});
      video.src=src;await ready;
      const seek=new Promise((resolve,reject)=>{video.onseeked=resolve;video.onerror=()=>reject(new Error('Video seek failed'));});video.currentTime=Math.min(3,video.duration/3);await seek;
      const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
      canvas.getContext('2d').drawImage(video,0,0);
      const result={image:canvas.toDataURL('image/jpeg',.94).split(',')[1],width:canvas.width,height:canvas.height};
      video.pause();video.removeAttribute('src');video.load();return result;
    },{src:`${origin}/media/${scene.id}/video?key=${token}`});
    await fs.writeFile(path.join(directory,`${scene.id}.jpg`),Buffer.from(data.image,'base64'));
    console.log(`${scene.id}: ${data.width} × ${data.height}, original-resolution frame`);
  }
} finally {await browser.close();}
