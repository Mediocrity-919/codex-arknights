import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ROOT,resourceCatalog} from '../src/catalog.mjs';
import {createResourceManager,validateSource} from '../src/resource-manager.mjs';
const exec=promisify(execFile),root=await fs.mkdtemp(path.join(ROOT,'.local','fresh-download-')),stateDir=path.join(root,'.local'),results=[];
let runtime={ffmpeg:process.env.ARK_FFMPEG};try{runtime=JSON.parse(await fs.readFile(path.join(ROOT,'.local/runtime.json'),'utf8'));}catch{}
await fs.mkdir(stateDir);if(runtime.ffmpeg)await fs.writeFile(path.join(stateDir,'runtime.json'),JSON.stringify({ffmpeg:runtime.ffmpeg}));
const entries=Object.entries(resourceCatalog.files).filter(([,v])=>v.original?.url),selected=[];
for(const host of ['media.prts.wiki','patchwiki.biligame.com'])selected.push(entries.filter(([,v])=>new URL(v.original.url).hostname===host).sort((a,b)=>a[1].original.bytes-b[1].original.bytes)[0][0]);
selected.push('wall-8682c5fb01dfeeac','wall-e92c9bf26be48611');
selected.push(entries.filter(([,v])=>new URL(v.original.url).hostname==='web.hycdn.cn'&&!v.original.hls).sort((a,b)=>a[1].original.bytes-b[1].original.bytes)[0][0]);
if(runtime.ffmpeg)selected.push(entries.filter(([,v])=>v.original.hls).sort((a,b)=>a[1].original.bytes-b[1].original.bytes)[0][0]);
const catalog={items:{},files:{}},scenes=[];
for(const id of selected){const v=structuredClone(resourceCatalog.files[id]);v.original.file='media/'+id+(v.original.hls||/\.mp4$/i.test(v.original.file)?'.mp4':'.png');delete v['4k'];catalog.files[id]=v;const item=resourceCatalog.items[id]??Object.values(resourceCatalog.items).find(s=>s.assetIds.includes(id));catalog.items[id]={assetIds:[id],cover:item?.cover};scenes.push({id,name:id,kind:/\.mp4$/.test(v.original.file)?'dynamic':'static'});}
const manager=await createResourceManager({root,stateDir,catalog,scenes});
try{
 for(const id of selected){
  const begin=Date.now(),retryErrors=[];let initialCoverError=null;assert.equal(manager.status(id).original,false);
  try{
   // A transient cover failure must not prevent checking the user's Download
   // and Retry actions. Static originals can also become their own preview.
   try{await manager.ensurePoster(id);}catch(e){initialCoverError=e.cause?.code??e.message;}
   let {id:jobId}=await manager.action('download',{sceneId:id,quality:'original'});
   for(let attempt=0;attempt<3;attempt++){
    let job;while(true){job=manager.publicState().jobs.find(j=>j.id===jobId);if(['complete','failed','cancelled'].includes(job.status))break;if(Date.now()-begin>180000)throw Error('download test deadline');await new Promise(r=>setTimeout(r,100));}
    if(job.status==='complete')break;
    retryErrors.push(job.error);if(attempt===2||job.status==='cancelled')throw Error(job.error);
    await new Promise(r=>setTimeout(r,500));({id:jobId}=await manager.action('retry',{id:jobId}));
   }
   const cover=manager.posterPath(id);assert.notEqual(cover,path.join(root,'public/assets/welcome.svg'));assert.ok((await fs.stat(cover)).size>0);
   const scene=manager.decorate(scenes.find(s=>s.id===id));assert.equal(scene.available,true);assert.equal(scene.resource.original,true);
   const file=manager.fileFor(id);if(runtime.ffmpeg)await exec(runtime.ffmpeg,['-v','error','-xerror','-i',file,'-frames:v','1','-f','null','-'],{windowsHide:true,timeout:20000});
   results.push({id,host:new URL(catalog.files[id].original.url).hostname,passed:true,bytes:(await fs.stat(file)).size,seconds:Math.round((Date.now()-begin)/1000),initialCoverError,retries:retryErrors.length,retryErrors});
  }catch(e){results.push({id,passed:false,error:e.message,cause:e.cause?.code??e.cause?.message});
   const variants=catalog.files[id],source=variants?.original?.url;
   if(source){try{const response=await fetch(source,{method:'HEAD',signal:AbortSignal.timeout(12000)});results.at(-1).diagnosticHeadStatus=response.status;await response.body?.cancel();}catch(d){results.at(-1).diagnosticHeadError=d.cause?.code??d.cause?.message??d.message;}}
  }
  console.log(JSON.stringify(results.at(-1)));
 }
 const backgrounds=entries.filter(([,v])=>new URL(v.original.url).hostname==='i.imgs.ovh');
 for(let i=0;i<backgrounds.length;i+=3){await Promise.all(backgrounds.slice(i,i+3).map(async([id,v])=>{try{let url=v.original.url,response;for(let n=0;n<5;n++){validateSource(url);response=await fetch(url,{method:'HEAD',redirect:'manual',signal:AbortSignal.timeout(15000)});if([301,302,303,307,308].includes(response.status)){url=new URL(response.headers.get('location'),url).href;continue;}break;}results.push({check:'activity-background-url',id,status:response.status,passed:response.ok});}catch(e){results.push({check:'activity-background-url',id,passed:false,error:e.message});}}));}
 await fs.mkdir(path.join(ROOT,'test-results'),{recursive:true});await fs.writeFile(path.join(ROOT,'test-results/fresh-download.json'),JSON.stringify({root,results},null,2));
 console.log(JSON.stringify({downloads:results.filter(r=>!r.check).length,backgrounds:backgrounds.length,failed:results.filter(r=>!r.passed)}));
 if(results.some(r=>!r.passed))process.exitCode=1;
}finally{await manager.close();}
