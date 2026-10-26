// Test-only preload. Never use against a user's installation or media library.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {ROOT, resourceCatalog, scenes} from '../src/catalog.mjs';
if(process.env.ARK_ACCEPTANCE_SANDBOX!=='1'||!ROOT.includes('acceptance-sandbox'))throw Error('Acceptance fixtures require a disposable acceptance-sandbox directory');
const folder=path.join(ROOT,'.local','acceptance-media');
await fs.mkdir(folder,{recursive:true});
const ffmpeg=process.env.ARK_FFMPEG;if(!ffmpeg)throw Error('Acceptance fixtures require FFmpeg');
const image=path.join(folder,'fixture.png'),videos=[];
execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','color=c=steelblue:s=480x320','-frames:v','1','-threads','1','-y',image],{windowsHide:true});
for(const color of ['red','green','blue']){
 const file=path.join(folder,color+'.mp4');
 execFileSync(ffmpeg,['-v','error','-f','lavfi','-i',`color=c=${color}:s=640x360:r=30:d=3`,'-an','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-movflags','+faststart','-y',file],{windowsHide:true});videos.push(file);
}
let index=0;const downloads=new Map();
for(const [id,variants] of Object.entries(resourceCatalog.files)){
 const video=/\.mp4$/i.test(variants.original.file)||variants.original.hls;
 for(const quality of Object.keys(variants)){
  const source=video?videos[index%videos.length]:image,target=path.join(folder,id+'-'+quality+(video?'.mp4':'.png'));
  await fs.copyFile(source,target);
  const bytes=await fs.readFile(target);if(quality==='original'&&variants[quality].url)downloads.set(variants[quality].url,bytes);
  variants[quality]={...variants[quality],file:path.relative(ROOT,target),bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),hls:false};
 }
 index++;
}
// Cover requests remain local deterministic fixtures, not network acceptance.
const realFetch=globalThis.fetch,png=await fs.readFile(image);
globalThis.ARK_ACCEPTANCE_FETCH_CONTROL={slow:false,failNext:false};
globalThis.fetch=async(url,options={})=>{
 if(!/^https:\/\//.test(String(url)))return realFetch(url,options);
 const control=globalThis.ARK_ACCEPTANCE_FETCH_CONTROL,bytes=downloads.get(String(url))??png;
 if(control.failNext){control.failNext=false;throw new TypeError('fetch failed',{cause:Object.assign(new Error('Simulated connection reset'),{code:'ECONNRESET'})});}
 const offset=Number(/bytes=(\d+)-/.exec(options.headers?.Range??'')?.[1]??0),body=bytes.subarray(offset),headers={'content-length':String(body.length)};
 if(offset)headers['content-range']=`bytes ${offset}-${bytes.length-1}/${bytes.length}`;
 if(!control.slow)return new Response(body,{status:offset?206:200,headers});
 let timer;const stream=new ReadableStream({start(controller){controller.enqueue(body.subarray(0,Math.min(1024,body.length)));timer=setTimeout(()=>{controller.enqueue(body.subarray(1024));controller.close();},2500);options.signal?.addEventListener('abort',()=>{clearTimeout(timer);try{controller.error(options.signal.reason)}catch{}},{once:true});},cancel(){clearTimeout(timer);}});
 return new Response(stream,{status:offset?206:200,headers});
};
await fs.writeFile(path.join(ROOT,'.local','runtime.json'),JSON.stringify({ffmpeg}));
globalThis.ARK_ACCEPTANCE_FIXTURE_INFO={simulatedMedia:true,source:'Generated color PNG/MP4; real network downloads run separately',scenes:scenes.length};
