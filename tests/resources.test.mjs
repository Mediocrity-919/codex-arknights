import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {createResourceManager,validateSource} from '../src/resource-manager.mjs';
import {resourceCatalog,professions} from '../src/catalog.mjs';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const until=async predicate=>{const start=Date.now();while(!predicate()){if(Date.now()-start>10000)throw Error('Task did not settle');await new Promise(r=>setTimeout(r,15));}};
test('resource sources reject arbitrary hosts, credentials, unsafe schemes and ports',()=>{
  assert.equal(validateSource('https://web.hycdn.cn/a.mp4').hostname,'web.hycdn.cn');
  assert.equal(validateSource('https://i.imgs.ovh/2026/image.png').hostname,'i.imgs.ovh');
  assert.equal(validateSource('https://github.com/Mediocrity-919/codex-arknights/releases/download/wallpapers-v1/yaoyue-4k60.mp4').hostname,'github.com');
  assert.equal(validateSource('https://release-assets.githubusercontent.com/github-production-release-asset/1434136531/12345678-abcd-abcd-abcd-123456789abc?signature=test').hostname,'release-assets.githubusercontent.com');
  for(const url of ['https://github.com/other/repo/releases/download/wallpapers-v1/yaoyue-4k60.mp4','https://github.com/Mediocrity-919/codex-arknights/releases/download/wallpapers-v1/other.exe','https://release-assets.githubusercontent.com/github-production-release-asset/999999/12345678-abcd-abcd-abcd-123456789abc'])assert.throws(()=>validateSource(url));
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


test('active slow downloads outlive connection deadlines while stalled bodies time out',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ark-slow-body-')),bytes=Buffer.alloc(8*1024,42);
 const catalog={items:{sample:{assetIds:['sample']}},files:{sample:{original:{file:'media/sample.mp4',url:'https://web.hycdn.cn/sample.mp4',bytes:bytes.length,sha256:sha(bytes),width:3840,height:2160,fps:60}}}};
 let stall=false;
 const fetcher=async(url,{signal})=>{
  let timer,offset=0;
  return new Response(new ReadableStream({start(controller){const tick=()=>{if(signal.aborted){controller.error(signal.reason);return;}controller.enqueue(bytes.subarray(offset,offset+1024));offset+=1024;if(offset===bytes.length){controller.close();return;}if(!stall)timer=setTimeout(tick,20);};tick();},cancel(){clearTimeout(timer);}}),{headers:{'content-length':String(bytes.length)}});
 };
 const manager=await createResourceManager({root,stateDir:path.join(root,'.local'),catalog,scenes:[{id:'sample',kind:'dynamic'}],fetcher,timeouts:{connectMs:30,idleMs:75}});
 try{
  assert.equal(manager.status('sample').source4k,true);assert.equal(manager.status('sample').sourceFps,60);
  const {id}=await manager.action('download',{sceneId:'sample',quality:'original'});await until(()=>manager.publicState().jobs.find(j=>j.id===id).status==='complete');
  await manager.action('delete',{sceneId:'sample',quality:'original',confirm:true});stall=true;
  const second=await manager.action('download',{sceneId:'sample',quality:'original'});await until(()=>manager.publicState().jobs.find(j=>j.id===second.id).status==='failed');
  assert.match(manager.publicState().jobs.find(j=>j.id===second.id).error,/超时/);assert.equal(manager.status('sample').original,false);
 }finally{await manager.close();await fs.rm(root,{recursive:true,force:true});}
});


test('published snapshot retains profession and rarity for fresh official skin browsing',()=>{
 assert.ok(resourceCatalog.officialRecords.length>250);
 for(const row of resourceCatalog.officialRecords){assert.ok(professions.includes(row.profession),'Missing profession for '+row.cid);assert.ok(row.rarity>=1&&row.rarity<=6,'Missing rarity for '+row.cid);}
});


test('all four supplied video originals have independent public sources and covers',()=>{
 for(const id of ['yaoyue','eyja','shu-1','shu-2']){const original=resourceCatalog.files[id].original;assert.equal(original.localOnly,false);validateSource(original.url);validateSource(resourceCatalog.items[id].cover);assert.equal(original.sha256.length,64);assert.ok(original.width>=3000&&original.height===2160);assert.ok(original.fps>=60);}
});
