import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createPlaybackCache} from '../src/playback-cache.mjs';
import {inspectMp4,compatibleVideos} from '../src/mp4-metadata.mjs';
import {ROOT} from '../src/catalog.mjs';

let ffmpeg=process.env.ARK_FFMPEG;
try{ffmpeg??=JSON.parse(await fs.readFile(path.join(ROOT,'.local/runtime.json'),'utf8')).ffmpeg;}catch{}
const until=async fn=>{const started=Date.now();while(!fn()){assert.ok(Date.now()-started<30000,'cache task timed out');await new Promise(r=>setTimeout(r,50));}};

test('continuous cache is bounded, persists, preserves originals and protects in-use files',{skip:!ffmpeg},async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ark-playback-')),stateDir=path.join(root,'state');await fs.mkdir(stateDir);
  await fs.writeFile(path.join(stateDir,'runtime.json'),JSON.stringify({ffmpeg}));
  const clips=[],files={};
  for(let i=0;i<3;i++){
    const id='clip-'+i,file=path.join(root,id+'.mp4');
    execFileSync(ffmpeg,['-v','error','-f','lavfi','-i',`color=c=${['red','green','blue'][i]}:s=128x72:r=30:d=1`,'-vf',...(i===0?["drawbox=color=black:t=fill:enable='eq(n,0)'"]:['null']),'-an','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-y',file],{windowsHide:true});
    clips.push({id,name:id});files[id]={original:{file:path.basename(file)}};
  }
  const sources=await Promise.all(clips.map(c=>fs.readFile(path.join(root,c.id+'.mp4'))));
  const scene={id:'skin',name:'测试三动作',clips};
  const resources={fileFor:id=>path.join(root,id+'.mp4'),publicState:()=>({jobs:[]})};
  const options={root,stateDir,scenes:[scene],resources,mediaPath:id=>path.join(root,id+'.mp4'),catalog:{files}};
  let cache=await createPlaybackCache(options);
  try{
    const metas=await Promise.all(clips.map(c=>inspectMp4(resources.fileFor(c.id))));assert.ok(compatibleVideos(metas));assert.equal(metas[0].frames,30);
    cache.observe({sceneId:'skin'});await until(()=>cache.publicState().jobs.some(j=>['complete','failed','fallback'].includes(j.status)));
    assert.equal(cache.publicState().jobs[0].status,'complete',JSON.stringify(cache.publicState()));
    const sequence=cache.describe('skin').sequence;assert.equal(sequence.chapters.length,3);assert.equal(sequence.in,1/30);assert.equal(sequence.duration,3);const file=cache.fileFor(sequence.key);
    assert.equal((await inspectMp4(file)).frames,90);assert.ok(cache.publicState().bytes<cache.publicState().limitBytes);assert.equal(cache.publicState().workerCount,0);
    const jobs=cache.publicState().jobs.length;cache.observe({sceneId:'skin'});cache.observe({sceneId:'skin'});assert.equal(cache.publicState().jobs.length,jobs);
    await cache.action('cache-clear');assert.ok(cache.fileFor(sequence.key),'active cache must survive clear');
    // Rebuild publishes a new file, but a decoder using the old URL must retain it.
    await cache.action('cache-rebuild',{sceneId:'skin'});await until(()=>cache.publicState().jobs.at(-1)?.status==='complete');
    const rebuilt=cache.describe('skin').sequence;assert.notEqual(rebuilt.key,sequence.key);assert.ok(await fs.stat(file));
    cache.observe({sceneId:'unknown'},{slots:[{cacheKey:sequence.key}]});await cache.action('cache-clear');
    assert.ok(cache.fileFor(sequence.key),'rebuild must retain leased previous generation');assert.equal(cache.fileFor(rebuilt.key),null);
    // Returning after eviction regenerates a cache; a completed old job is not a permanent veto.
    cache.observe({sceneId:'skin'});await until(()=>cache.describe('skin').sequence);
    assert.equal(cache.describe('skin').sequence.key,sequence.key);
    assert.equal(cache.publicState().count,1,'identical retired file must be reused and counted once');
    await cache.close();cache=await createPlaybackCache(options);assert.equal(cache.describe('skin').sequence.key,sequence.key);
    // A native decoder lease protects an old rendition even after the next catalog changes.
    cache.observe({sceneId:'unknown'},{slots:[{cacheKey:sequence.key}]});await cache.action('cache-clear');assert.ok(cache.fileFor(sequence.key));
    cache.observe({sceneId:'unknown'},{slots:[]});await cache.action('cache-clear');assert.equal(cache.publicState().count,0);assert.equal(cache.fileFor(sequence.key),null);
    // Rapid navigation cancels stale work, but returning may enqueue it again.
    cache.observe({sceneId:'skin'});cache.observe({sceneId:'unknown'});
    assert.equal(cache.publicState().jobs.at(-1).cancelReason,'stale');
    cache.observe({sceneId:'skin'});assert.equal(cache.publicState().jobs.at(-1).status,'queued');
    const cancelledId=cache.publicState().jobs.at(-1).id;await cache.action('cache-cancel',{id:cancelledId});
    cache.observe({sceneId:'skin'});assert.equal(cache.publicState().jobs.at(-1).id,cancelledId);assert.equal(cache.publicState().jobs.at(-1).status,'cancelled','explicit cancellation must not auto-restart');
    await assert.rejects(cache.action('cache-settings',{enabled:true,limitGB:999}));
    await cache.action('cache-settings',{enabled:false,limitGB:.5});cache.observe({sceneId:'skin'});assert.equal(cache.describe('skin').sequence,null);
    for(let i=0;i<clips.length;i++)assert.deepEqual(await fs.readFile(resources.fileFor(clips[i].id)),sources[i]);
  }finally{await cache.close();await fs.rm(root,{recursive:true,force:true});}
});

test('MP4 inspection rejects malformed or oversized indexes without reading media payload',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ark-mp4-'));try{const file=path.join(dir,'invalid.mp4');await fs.writeFile(file,Buffer.from([0,0,0,100,109,111,111,118]));await assert.rejects(inspectMp4(file));}finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('cache budget evicts least-recent idle files and finishes deferred cleanup after leases end',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ark-cache-budget-')),stateDir=path.join(root,'state'),dir=path.join(stateDir,'playback-cache-v2');await fs.mkdir(dir,{recursive:true});
  const entries={};for(let i=0;i<3;i++){const key=String(i+1).repeat(64);await fs.writeFile(path.join(dir,key+'.mp4'),Buffer.alloc(100));entries['s'+i]={sceneId:'s'+i,key,bytes:100,status:'ready',usedAt:i};}
  const index={format:2,enabled:true,limitBytes:250,entries,edges:{},fingerprints:{}};await fs.writeFile(path.join(dir,'index.json'),JSON.stringify(index));
  const options={root,stateDir,scenes:[],resources:{publicState:()=>({jobs:[]})},catalog:{files:{}},mediaPath:()=>null};let cache=await createPlaybackCache(options);
  try{
    cache.observe({sceneId:'s0'});await until(()=>cache.publicState().bytes<=250);
    assert.ok(cache.fileFor(entries.s0.key));assert.equal(cache.fileFor(entries.s1.key),null);assert.ok(cache.fileFor(entries.s2.key));
    await cache.close();const saved=JSON.parse(await fs.readFile(path.join(dir,'index.json'),'utf8'));saved.limitBytes=50;await fs.writeFile(path.join(dir,'index.json'),JSON.stringify(saved));
    cache=await createPlaybackCache(options);cache.observe({sceneId:'none'},{slots:[{cacheKey:entries.s2.key}]});await until(()=>cache.publicState().bytes===100);
    assert.ok(cache.fileFor(entries.s2.key),'lowering a limit cannot remove an open decoder file');
    cache.observe({sceneId:'none'},{slots:[]});await until(()=>cache.publicState().bytes===0);
  }finally{await cache.close();await fs.rm(root,{recursive:true,force:true});}
});
