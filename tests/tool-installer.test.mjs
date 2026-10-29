import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createToolInstaller,loadToolManifest,chooseTorch} from '../src/tool-installer.mjs';

const root=path.resolve(import.meta.dirname,'..');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const blob=(name,size=4096)=>Buffer.alloc(size,name);
const until=async f=>{const t=Date.now();while(!f()){if(Date.now()-t>10000)throw Error('timeout');await new Promise(r=>setTimeout(r,10));}};

function fixture({badHash=false,slow=false}={}){
  const files={ffmpeg:blob('f'),python:blob('p'),pip:blob('i'),model:blob('m'),cu128:blob('t',8192),cu126:blob('u',8192)};
  const spec=(key,extra={})=>({bytes:files[key].length,sha256:badHash?'0'.repeat(64):sha(files[key]),urls:[`https://down.example/${key}`,`https://mirror.example/${key}`],...extra});
  const modelFile=Buffer.from('weights'),paramFile=Buffer.from('param');
  const manifest={ffmpeg:spec('ffmpeg',{members:['x/bin/ffmpeg.exe'],exe:'x/bin/ffmpeg.exe'}),python:spec('python',{pth:'python312._pth'}),pip:spec('pip',{file:'pip.whl'}),
    torch:{version:'2.11.0',variants:{cu128:spec('cu128',{minDriver:570,file:'torch128.whl'}),cu126:spec('cu126',{minDriver:528,file:'torch126.whl'})},requirements:['numpy==2.5.1'],indexes:['https://pypi.example/simple','https://mirror.example/simple']},
    model:spec('model',{files:{'models/realesr-animevideov3-x2.bin':sha(modelFile),'models/realesr-animevideov3-x2.param':sha(paramFile)}}),freeSpace:{ffmpeg:1000,full:100000}};
  const requests=[],calls=[];
  const fetcher=async(url,options)=>{requests.push({url,range:options.headers.Range});const key=url.split('/').pop();
    if(url.startsWith('https://down.example/'))return new Response('busy',{status:503});
    if(slow)await new Promise((r,j)=>{const t=setTimeout(r,2000);options.signal.addEventListener('abort',()=>{clearTimeout(t);j(options.signal.reason);});});
    const start=Number(/bytes=(\d+)-/.exec(options.headers.Range??'')?.[1]??0),body=files[key].subarray(start);
    return new Response(body,{status:start?206:200,headers:{'content-length':String(body.length)}});};
  let torchInstalled=false,pipReady=false;
  const runner=async(exe,args,{env}={})=>{calls.push({exe,args,env});
    if(args.includes('-encoders'))return' V..... libx264 H.264';
    if(args[1]==='pip'&&args[2]==='--version'){if(!pipReady)throw Error('No module named pip');return'pip 26';}
    if(args[1]==='pip'&&args[2]==='install'){if(args.includes('https://pypi.example/simple'))throw Error('index unreachable');torchInstalled=true;return'Successfully installed torch';}
    if(args[0]==='-c'&&args[1].startsWith('import numpy,torch')){if(!torchInstalled)throw Error('No module named torch');return'2.11.0+cu128';}
    if(args[0]==='-c')return'{"torch":"2.11.0+cu128","cuda":"12.8","device":"Test GPU"}';
    return'';};
  const extract=async(archive,dest,members)=>{const name=path.basename(archive);
    if(name==='ffmpeg.zip'){await fs.mkdir(path.join(dest,'x','bin'),{recursive:true});await fs.writeFile(path.join(dest,'x','bin','ffmpeg.exe'),'exe');}
    if(name==='pip.whl'){assert.match(dest,/Lib[\\/]site-packages$/);pipReady=true;}
    if(name==='python.zip'){await fs.writeFile(path.join(dest,'python.exe'),'exe');await fs.writeFile(path.join(dest,'python312._pth'),'python312.zip\r\n.\r\n\r\n# Uncomment to run site.main() automatically\r\n#import site\r\n');}
    if(name==='realesrgan.zip'){await fs.mkdir(path.join(dest,'models'),{recursive:true});await fs.writeFile(path.join(dest,'models','realesr-animevideov3-x2.bin'),modelFile);await fs.writeFile(path.join(dest,'models','realesr-animevideov3-x2.param'),paramFile);}};
  return{manifest,fetcher,runner,extract,requests,calls,files};
}
async function make(f,{gpu={name:'Test GPU',driver:'592.82'},free=1e12}={}){
  const stateDir=await fs.mkdtemp(path.join(os.tmpdir(),'ark-tools-'));let reloads=0;
  await fs.writeFile(path.join(stateDir,'runtime.json'),JSON.stringify({keep:'me'}));
  const installer=await createToolInstaller({root,stateDir,manifest:f.manifest,fetcher:f.fetcher,runner:f.runner,extract:f.extract,probeGpu:async()=>gpu,freeSpace:async()=>free,reloadRuntime:()=>{reloads++;}});
  const finish=async mode=>{await installer.action('tools-install',{mode});await until(()=>!installer.running);return installer.publicState();};
  return{stateDir,installer,finish,reloads:()=>reloads,runtime:async()=>JSON.parse(await fs.readFile(path.join(stateDir,'runtime.json'),'utf8'))};
}

test('published tool manifest is pinned to allowed HTTPS hosts and driver levels pick a CUDA build',()=>{
  const m=loadToolManifest(root);assert.equal(m.torch.variants.cu128.bytes,2753189216);
  assert.equal(chooseTorch(m,'592.82'),'cu128');assert.equal(chooseTorch(m,'546.01'),'cu126');assert.equal(chooseTorch(m,'472.1'),null);assert.equal(chooseTorch(m,undefined),null);
});

test('FFmpeg install falls back to a mirror, resumes partial downloads and keeps other settings',async()=>{
  const f=fixture(),t=await make(f);
  await fs.mkdir(path.join(t.stateDir,'tools','downloads'),{recursive:true});await fs.writeFile(path.join(t.stateDir,'tools','downloads','ffmpeg.zip.part'),f.files.ffmpeg.subarray(0,1000));
  const state=await t.finish('ffmpeg');
  assert.equal(state.job.status,'complete',state.job.error);assert.ok(f.requests.some(r=>r.url==='https://mirror.example/ffmpeg'&&r.range==='bytes=1000-'),'resumes from the partial file on the mirror');
  const runtime=await t.runtime();assert.equal(runtime.keep,'me');assert.equal(runtime.ffmpeg,path.join(t.stateDir,'tools','ffmpeg','x','bin','ffmpeg.exe'));assert.equal(runtime.python,undefined);
  assert.equal(t.reloads(),1);assert.equal(state.installed.ffmpeg,true);assert.equal(state.installed.managed,true);
});

test('full install sets up isolated Python, PyTorch, model and a GPU smoke test',async()=>{
  const f=fixture(),t=await make(f),state=await t.finish('full');
  assert.equal(state.job.status,'complete',state.job.error);assert.ok(state.job.steps.every(s=>s.status==='done'));assert.match(state.job.message,/Test GPU/);
  assert.ok(f.requests.some(r=>r.url.endsWith('/cu128')),'driver 592 uses the CUDA 12.8 build');
  const pth=await fs.readFile(path.join(t.stateDir,'tools','python','python312._pth'),'utf8');assert.match(pth,/^import site$/m);assert.match(pth,/^Lib\\site-packages$/m);
  const install=f.calls.filter(c=>c.args[1]==='pip'&&c.args[2]==='install');assert.equal(install.length,2,'second package index is tried');assert.ok(install[1].args.includes('numpy==2.5.1'));
  assert.equal(install[1].env.PYTHONNOUSERSITE,'1');
  const runtime=await t.runtime();assert.equal(runtime.python,path.join(t.stateDir,'tools','python','python.exe'));assert.equal(runtime.modelDir,path.join(t.stateDir,'tools','models'));
  assert.equal(await fs.readFile(path.join(runtime.modelDir,'realesr-animevideov3-x2.param'),'utf8'),'param');
  await assert.rejects(fs.access(path.join(t.stateDir,'tools','downloads','torch128.whl')),'large wheel is removed after install');
  // Removing deletes only managed files and keys.
  const removed=await t.installer.action('tools-remove',{});assert.deepEqual(await t.runtime(),{keep:'me'});assert.equal(removed.installed.managed,false);
  await assert.rejects(fs.access(path.join(t.stateDir,'tools','python')));
});

test('checksum failures, missing GPUs and low disk space stop before changing the configuration',async()=>{
  let t=await make(fixture({badHash:true}));let state=await t.finish('ffmpeg');
  assert.equal(state.job.status,'failed');assert.match(state.job.error,/校验/);assert.deepEqual(await t.runtime(),{keep:'me'});
  t=await make(fixture(),{gpu:null});state=await t.finish('full');assert.equal(state.job.status,'failed');assert.match(state.job.error,/NVIDIA/);assert.equal(state.job.steps[0].status,'failed');
  t=await make(fixture(),{gpu:{name:'Old GPU',driver:'472.12'}});state=await t.finish('full');assert.match(state.job.error,/驱动/);
  t=await make(fixture(),{free:10});state=await t.finish('ffmpeg');assert.match(state.job.error,/磁盘空间不足/);
  await assert.rejects(t.installer.action('tools-install',{mode:'everything'}),/类型/);
});

test('cancelling stops the download and keeps the partial file for a later retry',async()=>{
  const t=await make(fixture({slow:true}));await t.installer.action('tools-install',{mode:'ffmpeg'});
  await until(()=>t.installer.publicState().job.current==='ffmpeg');await t.installer.action('tools-cancel',{});await until(()=>!t.installer.running);
  const state=t.installer.publicState();assert.equal(state.job.status,'cancelled');assert.match(state.job.error,/保留/);assert.deepEqual(await t.runtime(),{keep:'me'});
});
