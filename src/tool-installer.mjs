// One-click install of the optional video tools (FFmpeg, and for 4K an isolated
// Python + PyTorch CUDA + Real-ESRGAN weights). Everything lives under
// <stateDir>/tools and is recorded in runtime.json; nothing system-wide changes.
import fs from 'node:fs/promises';
import {createReadStream,createWriteStream,existsSync,readFileSync} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import {Readable,Transform} from 'node:stream';
import {configureDownloadNetwork} from './download-network.mjs';

const toolHosts=new Set(['www.gyan.dev','github.com','www.python.org','registry.npmmirror.com','files.pythonhosted.org','mirrors.aliyun.com','download.pytorch.org']);
export function loadToolManifest(root){
  const m=JSON.parse(readFileSync(path.join(root,'resources','video-tools.json'),'utf8'));
  const specs=[m.ffmpeg,m.python,m.pip,m.model,...Object.values(m.torch.variants)];
  for(const spec of specs){
    if(!/^[a-f0-9]{64}$/.test(spec.sha256)||!(spec.bytes>0)||!spec.urls?.length)throw Error('工具清单无效');
    for(const u of spec.urls){const url=new URL(u);if(url.protocol!=='https:'||!toolHosts.has(url.hostname))throw Error('工具下载地址未获允许');}
  }
  return m;
}
const sha256=async file=>{const h=crypto.createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');};
const exists=async file=>{try{await fs.access(file);return true;}catch{return false;}};
const GiB=1024**3;

export function chooseTorch(manifest,driver){
  const major=Number.parseInt(String(driver??''),10);if(!Number.isFinite(major))return null;
  return Object.entries(manifest.torch.variants).filter(([,v])=>major>=v.minDriver).sort((a,b)=>b[1].minDriver-a[1].minDriver)[0]?.[0]??null;
}

async function defaultProbeGpu(){
  return new Promise(resolve=>execFile('nvidia-smi',['--query-gpu=name,driver_version,memory.total','--format=csv,noheader,nounits'],{windowsHide:true,timeout:10000,encoding:'utf8'},(error,stdout)=>{
    if(error)return resolve(null);const [name,driver,memory]=stdout.trim().split(/\r?\n/)[0]?.split(',').map(s=>s.trim())??[];resolve(name?{name,driver,memoryMiB:Number(memory)||0}:null);}));
}
function defaultRunner(exe,args,{signal,env,cwd,onLine=()=>{}}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(exe,args,{windowsHide:true,cwd,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});let out='',err='',buffer='';
    const abort=()=>{if(process.platform==='win32'&&child.pid)spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else child.kill();};
    signal?.addEventListener('abort',abort,{once:true});
    child.stdout.on('data',b=>{out=(out+b).slice(-20000);buffer+=b;let i;while((i=buffer.indexOf('\n'))>=0){onLine(buffer.slice(0,i).trim());buffer=buffer.slice(i+1);}});
    child.stderr.on('data',b=>err=(err+b).slice(-4000));child.on('error',reject);
    child.on('close',code=>{signal?.removeEventListener('abort',abort);if(signal?.aborted)return reject(new DOMException('已取消','AbortError'));code===0?resolve(out):reject(Error((err||out).trim().split(/\r?\n/).slice(-3).join(' ')||`进程退出 ${code}`));});
  });
}
const tarExe=()=>path.join(process.env.SystemRoot||'C:\\Windows','System32','tar.exe');

export async function createToolInstaller({root,stateDir,manifest=loadToolManifest(root),fetcher,runner=defaultRunner,probeGpu=defaultProbeGpu,extract,freeSpace,reloadRuntime=()=>{},isBusy=()=>false,onChange=()=>{}}){
  fetcher??=async(url,options)=>{await configureDownloadNetwork();return fetch(url,options);};
  extract??=(archive,dest,members=[],signal)=>runner(tarExe(),['-xf',archive,'-C',dest,...members],{signal});
  freeSpace??=async dir=>{const s=await fs.statfs(dir);return s.bavail*s.bsize;};
  const tools=path.join(stateDir,'tools'),dirs={downloads:path.join(tools,'downloads'),ffmpeg:path.join(tools,'ffmpeg'),python:path.join(tools,'python'),models:path.join(tools,'models'),tmp:path.join(tools,'tmp')};
  const runtimeFile=path.join(stateDir,'runtime.json'),fetcherDir=path.join(root,'tools','resource-fetcher');
  const pythonExe=path.join(dirs.python,'python.exe'),ffmpegExe=path.join(dirs.ffmpeg,...manifest.ffmpeg.exe.split('/'));
  let revision=0,job=null,controller=null,gpu=null,gpuProbe=null,closed=false;
  const changed=()=>{revision++;onChange(revision);};
  const readRuntime=async()=>{try{return JSON.parse(await fs.readFile(runtimeFile,'utf8'));}catch{return{};}};
  const inside=p=>!!p&&path.resolve(p).toLowerCase().startsWith(tools.toLowerCase()+path.sep);

  async function detectGpu(){
    if(gpu)return gpu;gpuProbe??=(async()=>{const g=await probeGpu().catch(()=>null);const variant=g?chooseTorch(manifest,g.driver):null;
      gpu=g?{...g,variant,reason:variant?null:`显卡驱动版本 ${g.driver} 过旧，请先更新 NVIDIA 驱动（需要 528 或更高）`}:{name:null,variant:null,reason:'未检测到 NVIDIA 显卡驱动；4K 生成需要 NVIDIA 显卡，仍可只安装 FFmpeg'};
      changed();return gpu;})().finally(()=>{gpuProbe=null;});
    return gpuProbe;
  }
  function step(key){const s=job.steps.find(x=>x.key===key);for(const x of job.steps)if(x.status==='running')x.status='done';s.status='running';job.current=key;job.bytes=0;job.total=0;job.message=s.label;changed();return s;}

  async function download(spec,name,signal){
    await fs.mkdir(dirs.downloads,{recursive:true});const target=path.join(dirs.downloads,name),part=target+'.part';
    if(await exists(target)){if((await fs.stat(target)).size===spec.bytes&&await sha256(target)===spec.sha256)return target;await fs.unlink(target);}
    let last;
    for(const url of spec.urls){
      signal.throwIfAborted();
      try{
        let offset=await fs.stat(part).then(s=>s.size,()=>0);if(offset>=spec.bytes){await fs.unlink(part);offset=0;}
        const idle=new AbortController();let timer;const touch=()=>{clearTimeout(timer);timer=setTimeout(()=>idle.abort(new DOMException('下载长时间没有数据','TimeoutError')),60000);};touch();
        const r=await fetcher(url,{headers:{'User-Agent':'ArkWorkspace/0.12 (video tools installer)',...(offset?{Range:`bytes=${offset}-`}:{})},signal:AbortSignal.any([signal,idle.signal])});
        if(!r.ok){await r.body?.cancel();throw Error(`下载源返回 ${r.status}`);}
        if(offset&&r.status!==206)offset=0;
        job.bytes=offset;job.total=spec.bytes;changed();let lastTick=0;
        const meter=new Transform({transform(chunk,_,cb){touch();job.bytes+=chunk.length;if(job.bytes>spec.bytes)return cb(Error('下载大小超出清单'));const now=Date.now();if(now-lastTick>500){lastTick=now;changed();}cb(null,chunk);}});
        try{await pipeline(Readable.fromWeb(r.body),meter,createWriteStream(part,{flags:offset?'a':'w'}),{signal:AbortSignal.any([signal,idle.signal])});}finally{clearTimeout(timer);}
        if((await fs.stat(part)).size!==spec.bytes)throw Error('下载不完整');
        job.message='正在校验文件…';changed();
        if(await sha256(part)!==spec.sha256){await fs.unlink(part);throw Error('文件校验失败');}
        await fs.rename(part,target);return target;
      }catch(error){if(signal.aborted)throw error;last=error;}
    }
    throw last?.message==='fetch failed'?Error('无法连接下载源，请检查网络或系统代理'):last;
  }

  async function ffmpegReady(file){try{const out=await runner(file,['-hide_banner','-encoders'],{});return out.includes('libx264');}catch{return false;}}
  async function installFfmpeg(signal){
    if(await exists(ffmpegExe)&&await ffmpegReady(ffmpegExe))return ffmpegExe;
    const current=(await readRuntime()).ffmpeg;if(current&&!inside(current)&&await exists(current)&&await ffmpegReady(current))return current;
    const zip=await download(manifest.ffmpeg,'ffmpeg.zip',signal);job.message='正在解压 FFmpeg…';changed();
    await fs.rm(dirs.ffmpeg,{recursive:true,force:true});await fs.mkdir(dirs.ffmpeg,{recursive:true});await extract(zip,dirs.ffmpeg,manifest.ffmpeg.members,signal);
    if(!await ffmpegReady(ffmpegExe))throw Error('FFmpeg 无法运行或缺少 H.264 编码器');
    await fs.unlink(zip).catch(()=>{});return ffmpegExe;
  }
  async function installPython(signal){
    const env={PYTHONNOUSERSITE:'1',PYTHONUTF8:'1',PIP_CONFIG_FILE:'NUL',PIP_DISABLE_PIP_VERSION_CHECK:'1',TEMP:dirs.tmp,TMP:dirs.tmp};
    await fs.mkdir(dirs.tmp,{recursive:true});
    if(!await exists(pythonExe)){
      const zip=await download(manifest.python,'python.zip',signal);await fs.rm(dirs.python,{recursive:true,force:true});await fs.mkdir(dirs.python,{recursive:true});
      await extract(zip,dirs.python,[],signal);await fs.unlink(zip).catch(()=>{});
    }
    // The embeddable build ignores site-packages until site is enabled in its ._pth file.
    const pth=path.join(dirs.python,manifest.python.pth),lines=(await fs.readFile(pth,'utf8')).split(/\r?\n/).map(l=>l.trim()==='#import site'?'import site':l);
    if(!lines.includes('Lib\\site-packages'))lines.splice(lines.indexOf('import site'),0,'Lib\\site-packages');
    await fs.writeFile(pth,lines.join('\r\n'));
    try{await runner(pythonExe,['-m','pip','--version'],{env});}catch{
      // pip refuses to install itself from its own wheel; it is pure Python, so unpacking is enough.
      const wheel=await download(manifest.pip,manifest.pip.file,signal),site=path.join(dirs.python,'Lib','site-packages');
      await fs.mkdir(site,{recursive:true});await extract(wheel,site,[],signal);
      await runner(pythonExe,['-m','pip','--version'],{env});await fs.unlink(wheel).catch(()=>{});
    }
    return env;
  }
  async function torchReady(env){try{return (await runner(pythonExe,['-c','import numpy,torch;print(torch.__version__)'],{env})).trim().startsWith(manifest.torch.version);}catch{return false;}}
  async function installTorch(env,signal){
    if(await torchReady(env))return;
    const variant=manifest.torch.variants[gpu.variant],wheel=await download(variant,variant.file,signal);
    step('packages');let last;
    for(const index of manifest.torch.indexes){
      try{await runner(pythonExe,['-m','pip','install','--no-cache-dir','--no-warn-script-location','--progress-bar','off','--index-url',index,wheel,...manifest.torch.requirements],{env,signal,onLine:line=>{if(/^(Collecting|Installing|Successfully)/.test(line)){job.message=line.slice(0,90);changed();}}});last=null;break;}
      catch(error){if(signal.aborted)throw error;last=error;}
    }
    if(last)throw Error(`PyTorch 依赖安装失败：${last.message}`);
    await fs.unlink(wheel).catch(()=>{});
  }
  async function installModel(signal){
    const names=Object.entries(manifest.model.files),ready=async()=>{for(const [member,hash] of names){const f=path.join(dirs.models,path.basename(member));if(!await exists(f)||await sha256(f)!==hash)return false;}return true;};
    if(await ready())return;
    const zip=await download(manifest.model,'realesrgan.zip',signal),scratch=path.join(dirs.tmp,'model');await fs.rm(scratch,{recursive:true,force:true});await fs.mkdir(scratch,{recursive:true});
    await extract(zip,scratch,names.map(([m])=>m),signal);await fs.mkdir(dirs.models,{recursive:true});
    for(const [member,hash] of names){const from=path.join(scratch,...member.split('/'));if(await sha256(from)!==hash)throw Error('模型文件校验失败');await fs.copyFile(from,path.join(dirs.models,path.basename(member)));}
    await fs.rm(scratch,{recursive:true,force:true});await fs.unlink(zip).catch(()=>{});
    if(!await ready())throw Error('模型文件不完整');
  }
  async function verifyAi(env){
    const code='import sys,json;sys.path.insert(0,sys.argv[1]);import numpy as np,torch;from cuda_model import create,predict\nif not torch.cuda.is_available():raise SystemExit("CUDA 不可用，请更新 NVIDIA 驱动")\nm=create(sys.argv[2]);y=predict(m,np.zeros((64,64,3),np.uint8))\nassert y.shape==(128,128,3)\nprint(json.dumps({"torch":torch.__version__,"cuda":torch.version.cuda,"device":torch.cuda.get_device_name(0)}))';
    const out=await runner(pythonExe,['-c',code,fetcherDir,dirs.models],{env});return JSON.parse(out.trim().split(/\r?\n/).at(-1));
  }

  async function run(mode){
    const signal=controller.signal;
    try{
      if(mode==='full'){step('gpu');await detectGpu();if(!gpu.variant)throw Error(gpu.reason);}
      step('space');await fs.mkdir(tools,{recursive:true});const need=manifest.freeSpace[mode],free=await freeSpace(tools);
      if(free<need)throw Error(`磁盘空间不足：需要约 ${(need/GiB).toFixed(1)} GB，当前可用 ${(free/GiB).toFixed(1)} GB`);
      step('ffmpeg');const ffmpeg=await installFfmpeg(signal);
      const update={ffmpeg};
      if(mode==='full'){
        step('python');const env=await installPython(signal);
        step('torch');await installTorch(env,signal);
        step('model');await installModel(signal);
        step('verify');job.result=await verifyAi(env);
        Object.assign(update,{python:pythonExe,modelDir:dirs.models});
      }
      step('save');const runtime=await readRuntime();
      await fs.writeFile(runtimeFile+'.tmp',JSON.stringify({...runtime,...update},null,2));await fs.rename(runtimeFile+'.tmp',runtimeFile);
      await reloadRuntime();await refreshInstalled();
      for(const s of job.steps)s.status='done';job.status='complete';job.message=mode==='full'?`4K 组件已就绪${job.result?.device?` · ${job.result.device}`:''}`:'FFmpeg 已就绪';
    }catch(error){
      const s=job.steps.find(x=>x.status==='running');if(s)s.status='failed';
      job.status=signal.aborted?'cancelled':'failed';job.error=signal.aborted?'已取消，已下载的部分会保留，重试时继续':error.message;job.message='';
    }finally{controller=null;job.finishedAt=Date.now();await fs.rm(dirs.tmp,{recursive:true,force:true}).catch(()=>{});changed();}
  }
  const labels={gpu:'检测显卡',space:'检查磁盘空间',ffmpeg:'FFmpeg（约 110 MB）',python:'Python 运行环境（约 11 MB）',torch:'PyTorch CUDA（约 2.5 GB）',packages:'安装依赖',model:'超分模型（约 45 MB）',verify:'显卡试运行',save:'保存配置'};
  async function installed(){
    const r=await readRuntime(),has=async p=>!!p&&await exists(p);
    return{ffmpeg:await has(r.ffmpeg),ai:await has(r.python)&&await has(path.join(r.modelDir??'',Object.keys(manifest.model.files)[0].split('/').pop())),managed:inside(r.ffmpeg)||inside(r.python)};
  }
  let installedState={ffmpeg:false,ai:false,managed:false};
  const refreshInstalled=async()=>{installedState=await installed();};
  await refreshInstalled();
  function publicState(){return{gpu,job,installed:installedState,sizes:{ffmpeg:manifest.ffmpeg.bytes,full:manifest.ffmpeg.bytes+manifest.python.bytes+manifest.model.bytes+Math.max(...Object.values(manifest.torch.variants).map(v=>v.bytes))}};}
  async function action(name,payload={}){
    if(name==='tools-probe'){await detectGpu();return publicState();}
    if(name==='tools-install'){
      if(!['ffmpeg','full'].includes(payload.mode))throw Error('安装类型无效');if(controller)return publicState();if(closed)throw Error('服务正在关闭');
      const keys=payload.mode==='full'?['gpu','space','ffmpeg','python','torch','packages','model','verify','save']:['space','ffmpeg','save'];
      job={mode:payload.mode,status:'running',steps:keys.map(key=>({key,label:labels[key],status:'pending'})),current:null,bytes:0,total:0,message:'',error:null,startedAt:Date.now()};
      controller=new AbortController();void run(payload.mode);return publicState();
    }
    if(name==='tools-cancel'){controller?.abort();return publicState();}
    if(name==='tools-remove'){
      if(controller)throw Error('安装进行中，请先取消');if(isBusy())throw Error('有下载或 4K 生成任务正在进行，请完成或取消后再删除组件');
      const runtime=await readRuntime(),next={...runtime};for(const key of ['ffmpeg','python','modelDir'])if(inside(runtime[key]))delete next[key];
      await fs.writeFile(runtimeFile+'.tmp',JSON.stringify(next,null,2));await fs.rename(runtimeFile+'.tmp',runtimeFile);
      for(const dir of Object.values(dirs))await fs.rm(dir,{recursive:true,force:true});
      await reloadRuntime();await refreshInstalled();job=null;changed();return publicState();
    }
    throw Error('未知组件操作');
  }
  return{action,publicState,detectGpu,get revision(){return revision;},get running(){return !!controller;},async close(){closed=true;controller?.abort();while(controller)await new Promise(r=>setTimeout(r,20));}};
}
