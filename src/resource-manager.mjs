import fs from 'node:fs/promises';
import {createReadStream,createWriteStream,existsSync} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {Transform,Readable} from 'node:stream';
import {spawn} from 'node:child_process';
import {configureDownloadNetwork} from './download-network.mjs';

const hosts=new Set(['media.prts.wiki','prts.wiki','web.hycdn.cn','ak.hycdn.cn','patchwiki.biligame.com','wiki.biligame.com','i.imgs.ovh']);
const terminal=new Set(['complete','failed','cancelled','interrupted']);
export function validateSource(value,{allowLocalTest=false}={}){
  const u=new URL(value);if(u.username||u.password||u.hash||(!allowLocalTest&&(u.protocol!=='https:'||u.port&&!['443',''].includes(u.port)||!hosts.has(u.hostname)))||(allowLocalTest&&!(u.protocol==='http:'&&u.hostname==='127.0.0.1')&&!(u.protocol==='https:'&&hosts.has(u.hostname))))throw Error('素材来源未获允许');return u;
}
export async function createResourceManager({root,stateDir,catalog,scenes,fetcher,allowLocalTest=false,onRevision=()=>{}}){
  fetcher??=async(url,options)=>{await configureDownloadNetwork();return fetch(url,options);};
  root=path.resolve(root);await fs.mkdir(stateDir,{recursive:true});const realRoot=await fs.realpath(root);
  const welcome=path.join(root,'public/assets/welcome.svg'),byId=new Map(scenes.map(s=>[s.id,s]));
  const stateFile=path.join(stateDir,'resources.json');let data={preferences:{},receipts:{},jobs:[],quality:'auto',performance:'auto'},revision=0,writing=Promise.resolve(),timer,pumping=false,closed=false;
  const controllers=new Map(),coverWork=new Map(),coverControllers=new Set(),auxChildren=new Set(),degraded=new Set();
  const coverQueue=[],coverRetryAfter=new Map();let activeCovers=0;
  try{Object.assign(data,JSON.parse(await fs.readFile(stateFile,'utf8')));for(const j of data.jobs)if(!terminal.has(j.status)){j.status='interrupted';j.error='上次任务被中断，可点击重试继续';}}catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}
  let runtime={};try{runtime=JSON.parse(await fs.readFile(path.join(stateDir,'runtime.json'),'utf8'));}catch{}
  const resolveRuntime=p=>p?(path.isAbsolute(p)?p:path.resolve(root,p)):null;
  let python=resolveRuntime(process.env.ARK_PYTHON??runtime.python),ffmpeg=resolveRuntime(process.env.ARK_FFMPEG??runtime.ffmpeg),modelDir=resolveRuntime(process.env.ARK_MODEL_DIR??runtime.modelDir??'runtime/models');
  function capabilities(){return{hls:!!ffmpeg&&existsSync(ffmpeg),upscale:!!python&&existsSync(python)&&!!ffmpeg&&existsSync(ffmpeg)&&existsSync(path.join(modelDir,'realesr-animevideov3-x2.bin')),quality:data.quality,performance:data.performance};}
  async function save(){const snapshot=JSON.stringify(data,null,2);writing=writing.catch(()=>{}).then(async()=>{const temp=stateFile+'.tmp';await fs.writeFile(temp,snapshot);await fs.rename(temp,stateFile);});return writing;}
  function dirty(){if(closed)return;clearTimeout(timer);timer=setTimeout(()=>save().catch(()=>{}),300);timer.unref();}
  function bump(){revision++;onRevision(revision);dirty();}
  async function safe(relative,create=false){
    if(typeof relative!=='string'||!relative||relative.includes(':'))throw Error('素材路径无效');
    const target=path.resolve(root,relative);if(!target.startsWith(root+path.sep))throw Error('素材路径越界');
    let ancestor=path.dirname(target);while(!existsSync(ancestor)){const parent=path.dirname(ancestor);if(parent===ancestor)throw Error('素材父目录无效');ancestor=parent;}
    const real=await fs.realpath(ancestor);if(real!==realRoot&&!real.startsWith(realRoot+path.sep))throw Error('素材目录不能链接到项目以外');
    if(create)await fs.mkdir(path.dirname(target),{recursive:true});
    try{const s=await fs.lstat(target);if(s.isSymbolicLink())throw Error('素材文件不能是链接');}catch(e){if(e.code!=='ENOENT')throw e;}
    return target;
  }
  function assets(id){const item=catalog.items[id];if(!item)throw Error('此资源需自行导入，或为内置背景');return item.assetIds.map(assetId=>({id:assetId,variants:catalog.files[assetId]}));}
  function isPresent(id,quality){const v=catalog.files[id]?.[quality];if(!v)return false;const full=path.resolve(root,v.file);if(!full.startsWith(root+path.sep))return false;const receipt=data.receipts[`${id}:${quality}`];try{const stat=fsSyncStat(full);return stat.isFile()&&(!(receipt?.bytes??v.bytes)||stat.size===(receipt?.bytes??v.bytes));}catch{return false;}}
  // Sync metadata reads keep catalog construction inexpensive; never hash video on a heartbeat.
  function fsSyncStat(file){return statSync(file);}
  function chosenQuality(sceneId){return degraded.has(sceneId)||data.performance==='economy'||data.quality==='original'?'original':data.quality==='4k'?'4k':data.preferences[sceneId]??'auto';}
  function fileFor(assetId,sceneId=assetId,override){const variants=catalog.files[assetId];if(!variants)return null;const q=override??chosenQuality(sceneId);return q!=='original'&&isPresent(assetId,'4k')?path.join(root,variants['4k'].file):isPresent(assetId,'original')?path.join(root,variants.original.file):q==='original'?null:isPresent(assetId,'4k')?path.join(root,variants['4k'].file):null;}
  function status(id){const item=catalog.items[id];if(!item)return{original:true,upscaled:false,downloadable:false,bytes:0};const all=assets(id),original=all.every(a=>isPresent(a.id,'original')),upscaled=all.every(a=>isPresent(a.id,'4k'));return{original,upscaled,downloadable:all.every(a=>!!a.variants.original.url),canUpscale:all.every(a=>!!a.variants['4k']),bytes:all.reduce((n,a)=>n+(a.variants.original.bytes??0),0),selected:chosenQuality(id)};}
  function decorate(scene){const s=status(scene.id),file=scene.clips?.length?fileFor(scene.clips[0].id,scene.id):fileFor(scene.id),available=scene.id==='welcome'||!!file&&(scene.clips?.every(c=>fileFor(c.id,scene.id))??true);
    return{...scene,...(scene.clips?{clips:scene.clips.map(c=>({...c,file:fileFor(c.id,scene.id)}))}:{}),available,resource:{...s,degraded:degraded.has(scene.id)}};}
  function posterPath(id,thumb=false){const item=catalog.items[id],scene=byId.get(id);const cached=path.join(stateDir,'covers',id+'.img');
    if(thumb){const t=path.join(root,'.local',scene?.kind==='static'?'thumbnails':'posters',id+(scene?.kind==='static'?'.webp':'.jpg'));if(existsSync(t))return t;}
    if(scene?.kind==='static'){const p=fileFor(id);if(p)return p;}
    if(item?.poster){const p=path.join(root,item.poster);if(existsSync(p))return p;}
    if(existsSync(cached))return cached;return welcome;
  }
  async function request(url,signal,headers={}){for(let i=0;i<6;i++){validateSource(url,{allowLocalTest});const r=await fetcher(url,{headers:{'User-Agent':'ArkWorkspace/0.11 (on-demand media client)',...headers},redirect:'manual',signal:AbortSignal.any([signal,AbortSignal.timeout(90000)])});if([301,302,303,307,308].includes(r.status)){await r.body?.cancel();url=new URL(r.headers.get('location'),url).href;continue;}return r;}throw Error('素材重定向次数过多');}
  async function hash(file,algorithm){const h=crypto.createHash(algorithm);for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');}
  async function transfer(v,target,job,signal,{cover=false}={}){
    const part=target+'.part';let offset=await fs.stat(part).then(s=>s.size,()=>0);if(v.bytes&&offset>=v.bytes){await fs.unlink(part);offset=0;}
    const r=await request(v.url,signal,offset?{Range:`bytes=${offset}-`}:{});if(!r.ok)throw Error(`素材服务返回 ${r.status}，可稍后重试`);
    if(r.status===206){const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(r.headers.get('content-range')??'');if(!range||Number(range[1])!==offset){await r.body?.cancel();throw Error('服务器返回的续传范围不匹配');}}
    else offset=0;
    const expected=v.bytes||Number(r.headers.get('content-length'))+offset;let received=offset;job.currentBytes=received;job.currentTotal=Number.isFinite(expected)?expected:0;
    const meter=new Transform({transform(chunk,encoding,callback){received+=chunk.length;job.currentBytes=received;job.updatedAt=Date.now();if(received>(cover?20*1024*1024:Math.max(v.bytes??0,2*1024**3)))return callback(Error('素材超出允许大小'));dirty();callback(null,chunk);}});
    await pipeline(Readable.fromWeb(r.body),meter,createWriteStream(part,{flags:offset?'a':'w'}),{signal});
    if(expected&&received!==expected){throw Error('下载长度不匹配，请重试');}
    for(const algorithm of ['sha256','sha1'])if(v[algorithm]&&await hash(part,algorithm)!==v[algorithm]){await fs.unlink(part);throw Error('素材校验失败，已丢弃不完整文件，请重试');}
    // Existing verified originals are reused before reaching this point.
    await fs.rename(part,target);return{bytes:received,sha256:await hash(target,'sha256')};
  }
  async function run(exe,args,signal,onLine=()=>{}){return new Promise((resolve,reject)=>{const child=spawn(exe,args,{windowsHide:true,cwd:root,stdio:['ignore','pipe','pipe']});let buffer='',err='';const abort=()=>{if(process.platform==='win32'&&child.pid)spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else child.kill();};signal?.addEventListener('abort',abort,{once:true});child.stdout.on('data',b=>{buffer+=b;let i;while((i=buffer.indexOf('\n'))>=0){onLine(buffer.slice(0,i));buffer=buffer.slice(i+1);}});child.stderr.on('data',b=>err=(err+b).slice(-1500));child.on('error',reject);child.on('close',code=>{signal?.removeEventListener('abort',abort);if(signal?.aborted)return reject(new DOMException('已取消','AbortError'));code===0?resolve():reject(Error(err||`资源处理失败 (${code})`));});});}
  async function hls(v,target,job,signal){
    if(!capabilities().hls)throw Error('此视频需要 FFmpeg，请先安装可选视频处理环境');
    const response=await request(v.url,signal);if(!response.ok)throw Error('播放列表获取失败');const text=await response.text();if(text.length>1024*1024||!text.startsWith('#EXTM3U')||/#EXT-X-(STREAM-INF|BYTERANGE|MAP)/.test(text)||/#EXT-X-KEY:(?!METHOD=NONE)/.test(text))throw Error('此 HLS 格式暂不支持，请更新获取器');
    const directory=await safe(path.relative(root,path.join(stateDir,'hls',crypto.createHash('sha256').update(v.url).digest('hex')))+'/.keep',true).then(path.dirname);
    let count=0;const lines=[];for(const line of text.split(/\r?\n/)){if(!line.trim()||line.startsWith('#')){lines.push(line);continue;}const url=new URL(line.trim(),v.url).href;validateSource(url,{allowLocalTest});const name=String(count++).padStart(5,'0')+'.ts',segment=path.join(directory,name);if(!existsSync(segment))await transfer({url},segment,job,signal);lines.push(name);job.message=`下载分段 ${count}`;}
    if(!count)throw Error('HLS 没有视频分段');const local=path.join(directory,'index.m3u8');await fs.writeFile(local,lines.join('\n'));const temp=target+'.remux.mp4';
    await run(ffmpeg,['-v','error','-nostdin','-protocol_whitelist','file,crypto,data','-i',local,'-map','0:v:0','-map','0:a?','-c','copy','-movflags','+faststart','-y',temp],signal);
    if(v.sha256&&await hash(temp,'sha256')!==v.sha256){
      // Remux metadata can differ across FFmpeg versions; validate decoded streams below.
      await run(ffmpeg,['-v','error','-xerror','-i',temp,'-f','null','-'],signal);
    }
    const receipt={bytes:(await fs.stat(temp)).size,sha256:await hash(temp,'sha256'),remux:true};await fs.rename(temp,target);return receipt;
  }
  async function upscale(asset,target,job,signal){const v=asset.variants.original,source=await safe(v.file);job.stage='upscale';job.message='正在本机生成 4K，原片保持可用';dirty();
    await run(python,[path.join(root,'tools/resource-fetcher/upscale_one.py'),'--input',source,'--output',target,'--ffmpeg',ffmpeg,'--model-dir',modelDir,'--fps',String(v.fps),'--duration',String(v.duration)],signal,line=>{try{const p=JSON.parse(line);if(p.frame!==undefined){job.frame=p.frame;job.totalFrames=p.totalFrames;dirty();}}catch{}});
    return{bytes:(await fs.stat(target)).size,sha256:await hash(target,'sha256'),generated:true};
  }
  async function execute(job){const controller=new AbortController();controllers.set(job.id,controller);const {signal}=controller;job.status='running';job.error=null;job.completed=0;job.stage='download';dirty();
    try{const all=assets(job.sceneId);for(const asset of all){signal.throwIfAborted();job.assetId=asset.id;const v=asset.variants.original;job.message=`获取 ${job.completed+1}/${all.length}`;
        if(!isPresent(asset.id,'original')){if(!v.url)throw Error('这是用户自备素材，没有在线下载源');const target=await safe(v.file,true);data.receipts[`${asset.id}:original`]=v.hls?await hls(v,target,job,signal):await transfer(v,target,job,signal);bump();}
        if(job.quality==='4k'&&!isPresent(asset.id,'4k')){const target=await safe(asset.variants['4k'].file,true);data.receipts[`${asset.id}:4k`]=await upscale(asset,target,job,signal);bump();}
        job.completed++;dirty();}
      data.preferences[job.sceneId]=job.quality;job.status='complete';job.stage='complete';job.message='已完成，可应用壁纸';void ensurePoster(job.sceneId).catch(()=>{});bump();
    }catch(e){job.status=signal.aborted?'cancelled':'failed';job.error=signal.aborted?'任务已取消，可重试继续下载':e.name==='TimeoutError'?'素材下载超时，请检查网络或系统代理后重试':e.message==='fetch failed'?'无法连接素材服务，请检查网络或系统代理后重试':e.message;}
    finally{controllers.delete(job.id);job.updatedAt=Date.now();await save();}
  }
  async function pump(){if(pumping||closed)return;pumping=true;try{let job;while(!closed&&(job=data.jobs.find(j=>j.status==='queued')))await execute(job);}finally{pumping=false;}}
  function pumpCovers(){
    while(activeCovers<2&&coverQueue.length){const task=coverQueue.shift();activeCovers++;
      task.run().then(task.resolve,task.reject).finally(()=>{activeCovers--;pumpCovers();});}
  }
  async function ensurePoster(id){if(posterPath(id)!==welcome)return posterPath(id);if(coverWork.has(id))return coverWork.get(id);const url=catalog.items[id]?.cover;if(!url||closed||coverQueue.length>=48||Date.now()<(coverRetryAfter.get(id)??0))return welcome;
    const controller=new AbortController();coverControllers.add(controller);
    const work=new Promise((resolve,reject)=>{coverQueue.push({resolve,reject,run:async()=>{
      controller.signal.throwIfAborted();const target=await safe(path.relative(root,path.join(stateDir,'covers',id+'.img')),true);
      await transfer({url},target,{},controller.signal,{cover:true});coverRetryAfter.delete(id);bump();return target;
    }});}).catch(error=>{coverRetryAfter.set(id,Date.now()+30000);throw error;}).finally(()=>{coverWork.delete(id);coverControllers.delete(controller);});
    coverWork.set(id,work);pumpCovers();return work;
  }
  function publicState(){return{revision,capabilities:capabilities(),jobs:data.jobs.slice(-40).map(({assetId,...j})=>j)};}
  async function action(action,payload={},references=()=>({})){const {sceneId}=payload;
    if(action==='status')return publicState();
    if(action==='configure-tools'){if(process.platform!=='win32')throw Error('此配置窗口仅支持 Windows');if(auxChildren.size)return{launched:true};const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/Configure-Resource-Tools.ps1'),'-Interactive'],{windowsHide:true,stdio:'ignore'});auxChildren.add(child);child.on('error',()=>auxChildren.delete(child));child.once('exit',async()=>{auxChildren.delete(child);try{runtime=JSON.parse(await fs.readFile(path.join(stateDir,'runtime.json'),'utf8'));python=resolveRuntime(runtime.python);ffmpeg=resolveRuntime(runtime.ffmpeg);modelDir=resolveRuntime(runtime.modelDir??'runtime/models');bump();}catch{}});return{launched:true};}
    if(action==='preview'){void ensurePoster(sceneId).catch(()=>{});return{queued:true};}
    if(action==='degrade'){if(data.performance==='auto'&&status(sceneId).original&&!degraded.has(sceneId)){degraded.add(sceneId);bump();}return{degraded:degraded.has(sceneId)};}
    if(action==='preferences'){if(!['auto','original','4k'].includes(payload.quality)||!['auto','economy','quality'].includes(payload.performance))throw Error('播放偏好无效');data.quality=payload.quality;data.performance=payload.performance;degraded.clear();bump();await save();return publicState();}
    if(action==='download'){
      if(!['original','4k'].includes(payload.quality))throw Error('请选择原片或 4K');const s=status(sceneId),all=assets(sceneId);if(!s.downloadable&&!s.original)throw Error('此壁纸仅支持本地自备素材');
      if(payload.quality==='4k'&&(!s.canUpscale||!s.upscaled&&!capabilities().upscale))throw Error('4K 需要可选 AI 超分环境；请先下载原片或运行配置工具');
      if(all.some(a=>a.variants.original.hls&&!isPresent(a.id,'original'))&&!capabilities().hls)throw Error('此视频需要 FFmpeg，请先配置视频处理环境');
      const existing=data.jobs.find(j=>j.sceneId===sceneId&&!terminal.has(j.status));if(existing)return{id:existing.id};
      const job={id:crypto.randomUUID(),sceneId,name:byId.get(sceneId)?.name??sceneId,quality:payload.quality,status:'queued',completed:0,total:all.length,createdAt:Date.now()};data.jobs.push(job);data.jobs=data.jobs.filter(j=>!terminal.has(j.status)||data.jobs.indexOf(j)>=data.jobs.length-100);await save();void pump();return{id:job.id};
    }
    if(action==='cancel'){const job=data.jobs.find(j=>j.id===payload.id);if(!job)throw Error('任务不存在');if(job.status==='queued'){job.status='cancelled';await save();}else controllers.get(job.id)?.abort();return{cancelled:true};}
    if(action==='retry'){const job=data.jobs.find(j=>j.id===payload.id);if(!job||!terminal.has(job.status))throw Error('此任务不能重试');return actionHandlerDownload(job);}
    if(action==='delete-plan'||action==='delete'){
      if(!['original','4k','all'].includes(payload.quality))throw Error('删除范围无效');const all=assets(sceneId),usage=references(sceneId),files=[];
      if(data.jobs.some(j=>j.sceneId===sceneId&&!terminal.has(j.status)))throw Error('请先取消下载任务');
      for(const a of all)for(const q of payload.quality==='all'?['original','4k']:[payload.quality])if(a.variants[q]&&isPresent(a.id,q))files.push({id:a.id,quality:q,file:await safe(a.variants[q].file),bytes:(await fs.stat(await safe(a.variants[q].file))).size});
      if(action==='delete-plan')return{count:files.length,bytes:files.reduce((n,f)=>n+f.bytes,0),references:usage};
      if(payload.confirm!==true)throw Error('请先确认删除素材');if(usage.current)throw Error('此素材正在播放，请先切换壁纸或停止当前队列');
      let count=0;try{for(const f of files){await fs.unlink(f.file);delete data.receipts[`${f.id}:${f.quality}`];count++;}}finally{bump();await save();}return{deleted:count};
    }
    throw Error('未知资源操作');
  }
  const actionHandlerDownload=job=>action('download',{sceneId:job.sceneId,quality:job.quality});
  return{action,status,decorate,fileFor,posterPath,ensurePoster,publicState,get revision(){return revision;},async close(){closed=true;clearTimeout(timer);for(const c of [...controllers.values(),...coverControllers])c.abort();for(const child of auxChildren)if(child.pid)spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});while(pumping)await new Promise(r=>setTimeout(r,30));await Promise.allSettled(coverWork.values());await save();}};
}
import {statSync} from 'node:fs';
