// One small public image plus synthetic HLS/AI clips. No collection batch jobs.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ROOT,resourceCatalog} from '../src/catalog.mjs';
import {createResourceManager} from '../src/resource-manager.mjs';
const exec=promisify(execFile),dir=await fs.mkdtemp(path.join(ROOT,'.local','resource-integration-')),stateDir=path.join(dir,'state'),checks=[];
const config=JSON.parse(await fs.readFile(path.join(ROOT,'.local/runtime.json'),'utf8'));await fs.mkdir(stateDir);await fs.writeFile(path.join(stateDir,'runtime.json'),JSON.stringify(config));
const ffmpeg=config.ffmpeg,source=path.join(dir,'input.mp4');
await exec(ffmpeg,['-v','error','-f','lavfi','-i','color=c=0x344552:s=1920x1080:r=30:d=0.1','-c:v','libx264','-pix_fmt','yuv420p','-y',source],{windowsHide:true});
await exec(ffmpeg,['-v','error','-i',source,'-c','copy','-hls_time','1','-hls_list_size','0','-hls_segment_filename',path.join(dir,'part%03d.ts'),'-y',path.join(dir,'index.m3u8')],{windowsHide:true});
const server=http.createServer(async(req,res)=>{try{const name=path.basename(new URL(req.url,'http://localhost').pathname),file=path.join(dir,name),bytes=await fs.readFile(file);res.setHeader('Content-Length',bytes.length);res.end(bytes);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`,relative=file=>path.relative(ROOT,path.join(dir,file));
const remote=Object.values(resourceCatalog.files).map(x=>x.original).filter(x=>x?.sha256&&!x.hls&&/\.png(?:\?|$)/i.test(x.url??'')).sort((a,b)=>a.bytes-b.bytes)[0];
const catalog={items:{image:{assetIds:['image']},ai:{assetIds:['ai']},hls:{assetIds:['hls']}},files:{image:{original:{...remote,file:relative('remote.png')}},ai:{original:{file:relative('downloaded.mp4'),url:origin+'/input.mp4',bytes:(await fs.stat(source)).size,fps:30,duration:.1},'4k':{file:relative('generated4k.mp4'),generated:true}},hls:{original:{file:relative('remuxed.mp4'),url:origin+'/index.m3u8',hls:true}}}};
const manager=await createResourceManager({root:ROOT,stateDir,catalog,scenes:['image','ai','hls'].map(id=>({id,name:id,kind:id==='image'?'static':'dynamic'})),allowLocalTest:true});
async function task(sceneId,quality){const {id}=await manager.action('download',{sceneId,quality});const started=Date.now();while(true){const j=manager.publicState().jobs.find(j=>j.id===id);if(j.status==='complete')return j;if(['failed','cancelled'].includes(j.status))throw Error(j.error);if(Date.now()-started>180000)throw Error('Integration timeout');await new Promise(r=>setTimeout(r,100));}}
try{
  const image=await task('image','original');assert.equal(manager.status('image').original,true);checks.push({check:'单张公开 PNG 真实下载与 SHA-256 校验',bytes:image.currentBytes});
  await task('hls','original');await exec(ffmpeg,['-v','error','-xerror','-i',path.join(dir,'remuxed.mp4'),'-f','null','-'],{windowsHide:true});checks.push({check:'合成 HLS 分段下载、无损合并和完整解码',passed:true});
  const ai=await task('ai','4k');const {stderr}=await exec(ffmpeg,['-hide_banner','-i',path.join(dir,'generated4k.mp4'),'-f','null','-'],{windowsHide:true});assert.match(stderr,/3840x2160/);assert.match(stderr,/frame=\s*3/);assert.equal(ai.completed,1);checks.push({check:'下载原片后通过 CUDA 生成并解码 3 帧 4K，保持 30fps',passed:true,frames:ai.totalFrames});
  await fs.writeFile(path.join(ROOT,'test-results/resource-integration.json'),JSON.stringify({checks},null,2));console.log(JSON.stringify({checks},null,2));
}finally{await manager.close();server.closeAllConnections();await new Promise(r=>server.close(r));if(path.dirname(dir)!==path.join(ROOT,'.local'))throw Error('Unexpected test directory');await fs.rm(dir,{recursive:true,force:true});}
