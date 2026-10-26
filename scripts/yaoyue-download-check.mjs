import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ROOT,resourceCatalog,sceneById} from '../src/catalog.mjs';
import {createResourceManager} from '../src/resource-manager.mjs';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'ark-yaoyue-')),stateDir=path.join(root,'.local'),scene=sceneById('yaoyue');
const catalog={items:{yaoyue:resourceCatalog.items.yaoyue},files:{yaoyue:resourceCatalog.files.yaoyue}};
const manager=await createResourceManager({root,stateDir,catalog,scenes:[scene]});
let peak=process.memoryUsage().rss;const begin=Date.now(),timer=setInterval(()=>peak=Math.max(peak,process.memoryUsage().rss),200);timer.unref();
try{
 assert.equal(manager.status('yaoyue').original,false);assert.equal(manager.status('yaoyue').downloadable,true);assert.equal(manager.status('yaoyue').source4k,true);
 const cover=await manager.ensurePoster('yaoyue');assert.ok((await fs.stat(cover)).size>0);
 const {id}=await manager.action('download',{sceneId:'yaoyue',quality:'original'});let last=0;
 while(true){const job=manager.publicState().jobs.find(j=>j.id===id);if(job.status==='complete')break;if(['failed','cancelled'].includes(job.status))throw Error(job.error);if(Date.now()-begin>600000)throw Error('Full video transfer deadline');if(Date.now()-last>10000){last=Date.now();console.log(JSON.stringify({downloadedMiB:Math.round((job.currentBytes??0)/1024/1024)}));}await new Promise(r=>setTimeout(r,200));}
 const file=manager.fileFor('yaoyue');assert.equal((await fs.stat(file)).size,744013566);assert.equal(manager.status('yaoyue').original,true);
 let decoded=false;if(process.env.ARK_FFMPEG){await promisify(execFile)(process.env.ARK_FFMPEG,['-v','error','-xerror','-i',file,'-frames:v','1','-f','null','-'],{windowsHide:true,timeout:30000});decoded=true;}
 const report={passed:true,source:'public GitHub Release',cleanDownload:true,bytes:(await fs.stat(file)).size,sha256:catalog.files.yaoyue.original.sha256,source4k:true,fps:60,firstFrameDecoded:decoded,peakRssMiB:Math.round(peak/1024/1024),seconds:Math.round((Date.now()-begin)/1000)};
 await fs.mkdir(path.join(ROOT,'test-results'),{recursive:true});await fs.writeFile(path.join(ROOT,'test-results/yaoyue-download.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{clearInterval(timer);await manager.close();if(path.dirname(root)!==os.tmpdir()||!path.basename(root).startsWith('ark-yaoyue-'))throw Error('Unexpected temporary test directory');await fs.rm(root,{recursive:true,force:true});}
