import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {createResourceManager,validateSource} from '../src/resource-manager.mjs';
import {resourceCatalog} from '../src/catalog.mjs';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const until=async predicate=>{const start=Date.now();while(!predicate()){if(Date.now()-start>10000)throw Error('Task did not settle');await new Promise(r=>setTimeout(r,15));}};
test('resource sources reject arbitrary hosts, credentials, unsafe schemes and ports',()=>{
  assert.equal(validateSource('https://web.hycdn.cn/a.mp4').hostname,'web.hycdn.cn');
  assert.equal(validateSource('https://i.imgs.ovh/2026/image.png').hostname,'i.imgs.ovh');
  for(const u of ['file:///etc/passwd','https://127.0.0.1/private','http://prts.wiki/a','https://prts.wiki:9443/a','https://user:pass@prts.wiki/a','https://prts.wiki.evil.example/a','https://i.imgs.ovh.evil.example/a','https://i.imgs.ovh:8443/a','https://i.imgs.ovh/a#fragment'])assert.throws(()=>validateSource(u));
});

test('every published download and cover URL passes the production source policy',()=>{
  let checked=0;
  for(const variants of Object.values(resourceCatalog.files))for(const variant of Object.values(variants))if(variant?.url){validateSource(variant.url);checked++;}
  for(const item of Object.values(resourceCatalog.items))if(item.cover){validateSource(item.cover);checked++;}
  assert.ok(checked>3000,'The entire published catalog must be checked');
});

test('fresh cover cache fetches once per item, limits concurrency and rejects unsafe redirects',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ark-fresh-cover-')),items={},files={},scenes=[];
  for(let i=0;i<6;i++){const id='wall-'+i;items[id]={assetIds:[id],cover:`https://i.imgs.ovh/${id}.png`};files[id]={original:{url:items[id].cover,file:`media/${id}.png`}};scenes.push({id,kind:'static'});}
  let active=0,peak=0,calls=0;
  const fetcher=async(url,{signal})=>{calls++;active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,30));active--;signal.throwIfAborted();return new Response(Buffer.from('cover'),{headers:{'content-length':'5'}});};
  const manager=await createResourceManager({root,stateDir:path.join(root,'.local'),catalog:{items,files},scenes,fetcher});
  try{
    assert.match(manager.posterPath('wall-0'),/welcome.svg$/);
    const paths=await Promise.all([...scenes,scenes[0]].map(s=>manager.ensurePoster(s.id)));
    assert.equal(calls,6);assert.equal(peak,2);assert.equal(paths[0],paths[6]);
    assert.equal(await fs.readFile(manager.posterPath('wall-0'),'utf8'),'cover');
  }finally{await manager.close();await fs.rm(root,{recursive:true,force:true});}
  const root2=await fs.mkdtemp(path.join(os.tmpdir(),'ark-cover-redirect-'));let redirects=0;
  const blocked=await createResourceManager({root:root2,stateDir:path.join(root2,'.local'),catalog:{items,files},scenes,fetcher:async()=>{redirects++;return new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}});}});
  try{await assert.rejects(blocked.ensurePoster('wall-0'),/素材来源未获允许/);assert.equal(redirects,1);}finally{await blocked.close();await fs.rm(root2,{recursive:true,force:true});}
});
test('on-demand transfers resume, validate, persist, select quality, cancel and delete only confirmed unused files',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ark-resource-test-')),bytes=Buffer.alloc(512*1024,71);let failOnce=true,rangeSeen=false,slow=false;
  const server=http.createServer((req,res)=>{const offset=Number(/bytes=(\d+)-/.exec(req.headers.range??'')?.[1]??0);if(offset){rangeSeen=true;res.statusCode=206;res.setHeader('Content-Range',`bytes ${offset}-${bytes.length-1}/${bytes.length}`);}res.setHeader('Content-Length',bytes.length-offset);if(failOnce){failOnce=false;res.write(bytes.subarray(0,65536));setTimeout(()=>res.destroy(),50);}else if(slow){res.write(bytes.subarray(offset,offset+32768));const t=setTimeout(()=>res.end(bytes.subarray(offset+32768)),5000);res.on('close',()=>clearTimeout(t));}else res.end(bytes.subarray(offset));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/asset`,scene={id:'example',kind:'dynamic',name:'Fixture'},catalog={items:{example:{assetIds:['clip']}},files:{clip:{original:{file:'media/original.mp4',url,bytes:bytes.length,sha256:sha(bytes)},'4k':{file:'media/4k.mp4',bytes:8}}}};
  let manager=await createResourceManager({root,stateDir:path.join(root,'.local'),catalog,scenes:[scene],allowLocalTest:true});
  try{
    const first=await manager.action('download',{sceneId:'example',quality:'original'});await until(()=>manager.publicState().jobs.find(j=>j.id===first.id).status==='failed');
    assert.ok((await fs.stat(path.join(root,'media/original.mp4.part'))).size>0);
    const retry=await manager.action('retry',{id:first.id});await until(()=>manager.publicState().jobs.find(j=>j.id===retry.id).status==='complete');assert.equal(rangeSeen,true);assert.equal(sha(await fs.readFile(path.join(root,'media/original.mp4'))),sha(bytes));
    assert.equal(manager.status('example').original,true);await fs.writeFile(path.join(root,'media/4k.mp4'),Buffer.alloc(8));await manager.action('preferences',{quality:'4k',performance:'quality'});assert.match(manager.fileFor('clip','example'),/4k\.mp4$/);
    await manager.action('preferences',{quality:'original',performance:'quality'});assert.match(manager.fileFor('clip','example','4k'),/4k\.mp4$/);assert.match(manager.fileFor('clip','example','original'),/original\.mp4$/);
    await manager.action('preferences',{quality:'auto',performance:'auto'});await manager.action('degrade',{sceneId:'example'});assert.match(manager.fileFor('clip','example'),/original\.mp4$/);
    await manager.close();manager=await createResourceManager({root,stateDir:path.join(root,'.local'),catalog,scenes:[scene],allowLocalTest:true});assert.equal(manager.status('example').original,true);
    const plan=await manager.action('delete-plan',{sceneId:'example',quality:'original'},()=>({current:true,queues:['fixture queue']}));assert.equal(plan.count,1);assert.equal(plan.references.queues.length,1);
    await assert.rejects(manager.action('delete',{sceneId:'example',quality:'original',confirm:true},()=>({current:true})),/正在播放/);await assert.rejects(manager.action('delete',{sceneId:'example',quality:'original'}),/确认/);
    await manager.action('delete',{sceneId:'example',quality:'original',confirm:true});assert.equal(manager.status('example').original,false);assert.equal(manager.status('example').upscaled,true);
    slow=true;const cancelled=await manager.action('download',{sceneId:'example',quality:'original'});await until(()=>manager.publicState().jobs.find(j=>j.id===cancelled.id).currentBytes>0);await manager.action('cancel',{id:cancelled.id});await until(()=>manager.publicState().jobs.find(j=>j.id===cancelled.id).status==='cancelled');assert.equal(manager.status('example').original,false);
    catalog.files.clip.original.file='../outside.txt';assert.equal(manager.fileFor('clip','example'),null);await assert.rejects(manager.action('delete-plan',{sceneId:'../invalid',quality:'all'}));
  }finally{await manager.close();server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});}
});
