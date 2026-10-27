import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ROOT,resourceCatalog,sceneById} from '../src/catalog.mjs';
import {createResourceManager} from '../src/resource-manager.mjs';
const ids=process.argv.includes('--all-originals')?['yaoyue','eyja','shu-1','shu-2']:['yaoyue'];
const root=await fs.mkdtemp(path.join(os.tmpdir(),'ark-originals-')),stateDir=path.join(root,'.local'),scenes=ids.map(sceneById),catalog={items:Object.fromEntries(ids.map(id=>[id,resourceCatalog.items[id]])),files:Object.fromEntries(ids.map(id=>[id,resourceCatalog.files[id]]))};
const manager=await createResourceManager({root,stateDir,catalog,scenes}),results=[];
let peak=process.memoryUsage().rss;const timer=setInterval(()=>peak=Math.max(peak,process.memoryUsage().rss),200);timer.unref();
try{
 for(const id of ids){
  const begin=Date.now();assert.equal(manager.status(id).original,false);assert.equal(manager.status(id).downloadable,true);
  const cover=await manager.ensurePoster(id);assert.ok((await fs.stat(cover)).size>0);const {id:jobId}=await manager.action('download',{sceneId:id,quality:'original'});let last=0;
  while(true){const job=manager.publicState().jobs.find(j=>j.id===jobId);if(job.status==='complete')break;if(['failed','cancelled'].includes(job.status))throw Error(job.error);if(Date.now()-begin>600000)throw Error('Full video transfer deadline');if(Date.now()-last>10000){last=Date.now();console.log(JSON.stringify({id,downloadedMiB:Math.round((job.currentBytes??0)/1024/1024)}));}await new Promise(r=>setTimeout(r,200));}
  const file=manager.fileFor(id),original=catalog.files[id].original;assert.equal((await fs.stat(file)).size,original.bytes);assert.equal(manager.status(id).original,true);
  let decoded=false;if(process.env.ARK_FFMPEG){await promisify(execFile)(process.env.ARK_FFMPEG,['-v','error','-xerror','-i',file,'-frames:v','1','-f','null','-'],{windowsHide:true,timeout:30000});decoded=true;}
  results.push({id,passed:true,source:'public GitHub Release',cleanDownload:true,bytes:original.bytes,fullSha256Verified:true,width:original.width,height:original.height,fps:original.fps,firstFrameDecoded:decoded,seconds:Math.round((Date.now()-begin)/1000)});console.log(JSON.stringify(results.at(-1)));
 }
 const report={passed:true,results,peakRssMiB:Math.round(peak/1024/1024)};await fs.mkdir(path.join(ROOT,'test-results'),{recursive:true});await fs.writeFile(path.join(ROOT,'test-results/original-video-downloads.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{clearInterval(timer);await manager.close();if(path.dirname(root)!==os.tmpdir()||!path.basename(root).startsWith('ark-originals-'))throw Error('Unexpected temporary test directory');await fs.rm(root,{recursive:true,force:true});}
