import fs from 'node:fs/promises';
import {statSync,existsSync,createReadStream} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {inspectMp4,compatibleVideos} from './mp4-metadata.mjs';

const FORMAT=2,GiB=1024**3;
const terminal=new Set(['complete','failed','cancelled','fallback']);
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const abortError=()=>new DOMException('缓存任务已取消','AbortError');

// A serial, on-demand disk cache. No file-sized Buffers, Blob pool, or extra decoders.
export async function createPlaybackCache({root,stateDir,scenes,resources,mediaPath,catalog}) {
  // Windows 8.3 aliases can differ from realpath without being links. Inspect
  // ancestors for actual links, then use the canonical directory for cache I/O.
  await fs.mkdir(stateDir,{recursive:true});
  for(let current=path.resolve(stateDir);;current=path.dirname(current)){
    if((await fs.lstat(current)).isSymbolicLink())throw Error('播放缓存目录不能是链接');
    if(path.dirname(current)===current)break;
  }
  const directory=path.join(await fs.realpath(stateDir),'playback-cache-v2'),indexPath=path.join(directory,'index.json');
  await fs.mkdir(directory,{recursive:true});
  if((await fs.lstat(directory)).isSymbolicLink())throw Error('播放缓存目录不能是链接');
  let data={format:FORMAT,enabled:true,limitBytes:2*GiB,entries:{},edges:{},fingerprints:{}};
  try{const stored=JSON.parse(await fs.readFile(indexPath,'utf8'));if(stored.format===FORMAT)data={...data,...stored};}catch{}
  let revision=0,closed=false,pumping=false,activeJob=null,controller=null,writes=Promise.resolve(),saveTimer,wakeTimer;
  let wanted=[],protectedScenes=new Set(),leasedKeys=new Set(),slowUntil=0;
  let byId=new Map(scenes.map(s=>[s.id,s]));const jobs=[],descriptors=new Map();
  const cacheFile=(key,extension='.mp4')=>{if(!/^[a-f0-9]{64}$/.test(key))throw Error('缓存标识无效');return path.join(directory,key+extension);};
  async function safeUnlink(file){if(path.dirname(file)!==directory)throw Error('缓存清理越界');try{const stat=await fs.lstat(file);if(stat.isSymbolicLink())throw Error('缓存不能是链接');await fs.unlink(file);}catch(e){if(e.code!=='ENOENT')throw e;}}
  async function save(){clearTimeout(saveTimer);const text=JSON.stringify(data);writes=writes.catch(()=>{}).then(async()=>{await fs.writeFile(indexPath+'.tmp',text);await fs.rename(indexPath+'.tmp',indexPath);});await writes;}
  function changed(){revision++;clearTimeout(saveTimer);saveTimer=setTimeout(()=>save().catch(()=>{}),500);saveTimer.unref();}
  async function tool(){try{const r=JSON.parse(await fs.readFile(path.join(stateDir,'runtime.json'),'utf8'));const f=process.env.ARK_FFMPEG??r.ffmpeg;return f&&existsSync(path.resolve(root,f))?path.resolve(root,f):null;}catch{return null;}}
  function descriptor(id){
    const scene=byId.get(id);if(!scene?.clips?.length)return null;
    const clips=scene.clips.map(c=>{const file=resources.fileFor(c.id,id)??mediaPath(c.id);let stat;try{stat=statSync(file);if(!stat.isFile())return null;}catch{return null;}
      const variants=catalog.files[c.id],quality=variants?.['4k']&&path.resolve(root,variants['4k'].file)===file?'4k':'original';
      return {id:c.id,name:c.name,file,quality,bytes:stat.size,mtime:stat.mtimeMs,signature:digest([c.id,quality,stat.size,stat.mtimeMs])};});
    if(clips.some(c=>!c))return null;
    const signature=digest([FORMAT,...clips.map(c=>c.signature)]);let found=descriptors.get(signature);
    if(!found){found={id,signature,clips,name:scene.name,quality:clips.every(c=>c.quality==='4k')?'4k':'original'};descriptors.set(signature,found);if(descriptors.size>100)descriptors.delete(descriptors.keys().next().value);}
    return found;
  }
  function entryFor(desc){const entry=data.entries[desc?.signature];if(!entry||entry.status!=='ready')return null;try{if(statSync(cacheFile(entry.key)).size!==entry.bytes)return null;}catch{return null;}return entry;}
  function describe(id){const desc=descriptor(id);if(!desc)return null;const entry=data.enabled?entryFor(desc):null;
    return {clips:desc.clips.map(c=>({id:c.id,...data.edges[c.signature]?.range})),sequence:entry?{key:entry.key,quality:desc.quality,duration:entry.duration,in:entry.in??0,chapters:entry.chapters}:null};}
  function fileFor(key,touch=false){for(const entry of Object.values(data.entries))if(entry.key===key&&entry.status==='ready'){if(touch)entry.usedAt=Date.now();return cacheFile(key);}return null;}
  function publicState(){return {version:FORMAT,enabled:data.enabled,limitBytes:data.limitBytes,bytes:Object.values(data.entries).reduce((n,e)=>n+(e.bytes??0),0),
    count:Object.values(data.entries).filter(e=>e.status==='ready').length,workerCount:activeJob?1:0,jobs:jobs.slice(-12).map(({signature,...j})=>({...j})),
    entries:Object.values(data.entries).map(e=>({sceneId:e.sceneId,name:e.name,quality:e.quality,status:e.status,bytes:e.bytes??0,reason:e.reason??null})),
    message:slowUntil>Date.now()?'检测到播放变慢，暂缓后台缓存':'按需准备下一张，优先保障当前播放；缓存文件仅占磁盘空间'};}
  function protectedEntry(entry){return protectedScenes.has(entry.sceneId)||leasedKeys.has(entry.key);}
  async function evict(reserve=0,all=false){let total=Object.values(data.entries).reduce((n,e)=>n+(e.bytes??0),0),removed=0;
    for(const [sig,e] of Object.entries(data.entries).sort((a,b)=>(a[1].usedAt??0)-(b[1].usedAt??0))){if(!all&&total+reserve<=data.limitBytes)break;if(protectedEntry(e))continue;if(e.key)await safeUnlink(cacheFile(e.key));total-=e.bytes??0;delete data.entries[sig];removed++;}
    if(removed)changed();return{removed,room:total+reserve<=data.limitBytes};}
  async function run(exe,args,signal,{binary=false,onLine}={}){
    signal.throwIfAborted();return new Promise((resolve,reject)=>{
      const child=spawn(exe,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let stderr='',text='',parts=[],size=0,settled=false;
      child.once('spawn',()=>{try{os.setPriority(child.pid,os.constants.priority.PRIORITY_BELOW_NORMAL);}catch{}});
      const abort=()=>child.kill();signal.addEventListener('abort',abort,{once:true});
      child.stdout.on('data',b=>{size+=b.length;if(size>4*1024*1024){child.kill();return;}if(binary)parts.push(b);else {text+=b;let i;while((i=text.indexOf('\n'))>=0){onLine?.(text.slice(0,i));text=text.slice(i+1);}}});
      child.stderr.on('data',b=>{stderr=(stderr+b).slice(-2500);});
      const timer=setTimeout(()=>child.kill(),180000);timer.unref();
      const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);error?reject(error):resolve(result);};
      child.on('error',e=>finish(e));child.on('close',code=>finish(signal.aborted?abortError():size>4*1024*1024?Error('缓存分析超出内存预算'):code?Error(stderr||'缓存处理未完成'):null,binary?Buffer.concat(parts):stderr));
    });
  }
  async function fingerprint(c,signal){if(data.fingerprints[c.signature])return data.fingerprints[c.signature];
    const hash=crypto.createHash('sha256');let budget=0;for await(const b of createReadStream(c.file,{highWaterMark:256*1024,signal})){hash.update(b);budget+=b.length;if(budget>=4*1024*1024){budget=0;await new Promise(r=>setTimeout(r,25));}}
    return data.fingerprints[c.signature]=hash.digest('hex');}
  async function edge(exe,c,meta,signal){if(data.edges[c.signature])return data.edges[c.signature];
    // Only very short, nearly uniform boundary black is trimmed. Dark scenes are retained.
    const scan=async tail=>{const bytes=await run(exe,['-v','error','-threads','1',...(tail?['-sseof','-0.4']:[]),'-i',c.file,'-t','0.4','-an','-filter_threads','1','-vf','scale=96:54,format=gray','-f','rawvideo','pipe:1'],signal,{binary:true});
      const frames=[];for(let p=0;p+5184<=bytes.length;p+=5184){let sum=0,square=0,black=0;for(let i=p;i<p+5184;i++){const y=bytes[i];sum+=y;square+=y*y;if(y<12)black++;}const mean=sum/5184;frames.push({black:black/5184>.995&&mean<10&&square/5184-mean*mean<4,mean});}return frames;};
    const head=await scan(false),tail=await scan(true);let first=0,last=0;
    while(first<head.length&&head[first].black)first++;while(last<tail.length&&tail[tail.length-1-last].black)last++;
    const maxFrames=Math.max(1,Math.floor(meta.fps*.1));
    if(first>maxFrames||!head[first]||head[first].mean<25)first=0;
    if(last>maxFrames||!tail[tail.length-1-last]||tail[tail.length-1-last].mean<25)last=0;
    const range={in:first/meta.fps,out:meta.duration-last/meta.fps,fps:meta.fps};
    const result={range,firstBlackFrames:first,lastBlackFrames:last};data.edges[c.signature]=result;changed();return result;
  }
  async function build(job,signal){
    const desc=descriptor(job.sceneId);if(!desc||desc.signature!==job.signature)throw abortError();
    const exe=await tool();if(!exe)throw Error('配置可选 FFmpeg 后可生成连续缓存；目前使用分段播放');
    job.status='running';job.stage='检查动作边界';job.progress=0;
    const metas=[],edges=[],hashes=[];
    for(let i=0;i<desc.clips.length;i++){signal.throwIfAborted();const c=desc.clips[i];metas.push(await inspectMp4(c.file));edges.push(await edge(exe,c,metas[i],signal));hashes.push(await fingerprint(c,signal));job.progress=(i+1)/desc.clips.length*.4;}
    const key=digest([FORMAT,desc.id,desc.clips.map(c=>c.id),...hashes,edges.map(e=>e.range),job.rebuild?job.id:null]);
    const retirePrevious=()=>{const previous=data.entries[desc.signature];if(previous?.key&&previous.key!==key)data.entries['retired-'+previous.key]={...previous,retired:true};};
    const publish=entry=>{retirePrevious();for(const [signature,other] of Object.entries(data.entries))if(signature!==desc.signature&&other.key===key)delete data.entries[signature];data.entries[desc.signature]=entry;job.progress=1;job.status='complete';job.message='已就绪，将在下一遍或下次进入时使用';changed();};
    // An identical retired generation may still be leased by a decoder. Reuse it
    // without replacing its open file or counting the same bytes twice.
    const reusable=Object.values(data.entries).find(e=>e.key===key&&e.status==='ready');
    if(reusable){try{if((await fs.stat(cacheFile(key))).size===reusable.bytes){publish({...reusable,retired:false,usedAt:Date.now()});return;}}catch{}}
    const fallback=reason=>{retirePrevious();data.entries[desc.signature]={sceneId:desc.id,name:desc.name,quality:desc.quality,status:'fallback',reason,usedAt:Date.now()};job.status='fallback';job.message=reason;changed();};
    if(!compatibleVideos(metas))return fallback('编码参数不一致，保留安全分段播放，不自动重新编码');
    if(edges.some((e,i)=>e.lastBlackFrames||i>0&&e.firstBlackFrames))return fallback('内部接缝需要逐帧修剪，已启用边界保护；不自动重新编码');
    const reserve=metas.reduce((n,m)=>n+m.bytes,0)+1024*1024;
    if(!data.enabled||reserve>data.limitBytes||!(await evict(reserve)).room)return fallback('缓存空间不足，继续分段播放');
    const free=await fs.statfs(directory);if(Number(free.bavail)*Number(free.bsize)<reserve+128*1024*1024)return fallback('磁盘剩余空间不足，继续分段播放');
    const output=cacheFile(key),temp=cacheFile(key,'.building.mp4'),list=cacheFile(key,'.concat.txt');
    try {
      await fs.writeFile(list,'ffconcat version 1.0\n'+desc.clips.map((c,i)=>`file '${c.file.replaceAll('\\','/').replaceAll("'","'\\''")}'\nduration ${metas[i].duration}`).join('\n'));
      job.stage='无重编码合并';const duration=metas.reduce((n,m)=>n+m.duration,0);
      await run(exe,['-v','warning','-nostdin','-readrate','8','-f','concat','-safe','0','-i',list,'-map','0:v:0','-an','-c:v','copy','-movflags','+faststart','-progress','pipe:1','-y',temp],signal,{onLine:line=>{if(line.startsWith('out_time_us='))job.progress=.4+Math.min(1,Number(line.split('=')[1])/1e6/duration)*.45;}});
      const combined=await inspectMp4(temp);if(combined.frames!==metas.reduce((n,m)=>n+m.frames,0)||Math.abs(combined.duration-duration)>1/metas[0].fps)throw Error('连续缓存帧数或时间不匹配');
      let offset=0;const chapters=desc.clips.map((c,i)=>{const chapter={id:c.id,name:c.name,start:offset};offset+=metas[i].duration;return chapter;});
      job.stage='验证接缝';for(const c of chapters.slice(1)){await run(exe,['-v','error','-xerror','-threads','1','-ss',String(Math.max(0,c.start-.12)),'-i',temp,'-t','0.24','-an','-f','null','-'],signal);}
      signal.throwIfAborted();if(descriptor(desc.id)?.signature!==desc.signature)throw abortError();
      const bytes=(await fs.stat(temp)).size;if(bytes>reserve)throw Error('缓存超出预留容量');
      await fs.rename(temp,output);
      publish({key,sceneId:desc.id,name:desc.name,quality:desc.quality,status:'ready',bytes,duration:combined.duration,in:edges[0].range.in,chapters,usedAt:Date.now()});
    }finally{await safeUnlink(temp);await safeUnlink(list);}
  }
  function schedulePump(){if(!closed&&!wakeTimer){wakeTimer=setTimeout(()=>{wakeTimer=null;pump().catch(()=>{});},1000);wakeTimer.unref();}}
  async function pump(){if(closed||pumping)return;
    if(slowUntil>Date.now()||resources.publicState().jobs.some(j=>['queued','running'].includes(j.status))){schedulePump();return;}
    const job=jobs.find(j=>j.status==='queued');
    if(!job){if(Object.values(data.entries).reduce((n,e)=>n+(e.bytes??0),0)>data.limitBytes){pumping=true;try{await evict();await save();}finally{pumping=false;}}return;}
    pumping=true;activeJob=job;controller=new AbortController();
    try{await build(job,controller.signal);}catch(e){job.status=controller.signal.aborted?'cancelled':'failed';job.message=e.message;}
    finally{job.finishedAt=Date.now();controller=null;activeJob=null;pumping=false;await save();schedulePump();}
  }
  function enqueue(id,force=false,rebuild=false){const d=descriptor(id);if(!d||!data.enabled)return;
    if(jobs.some(j=>j.signature===d.signature&&!terminal.has(j.status)))return;
    if(!rebuild&&entryFor(d))return;
    const previousJob=jobs.findLast(j=>j.signature===d.signature);
    if(!force&&(data.entries[d.signature]||previousJob?.status==='failed'||previousJob?.status==='cancelled'&&!['stale','busy'].includes(previousJob.cancelReason)))return;
    jobs.push({id:crypto.randomUUID(),sceneId:id,name:d.name,signature:d.signature,quality:d.quality,status:'queued',progress:0,rebuild});while(jobs.length>30){const i=jobs.findIndex(j=>terminal.has(j.status));if(i<0)break;jobs.splice(i,1);}schedulePump();
  }
  function observe(settings,playback){
    const q=settings.playlists?.find(q=>q.id===settings.activePlaylistId),at=playback?.entryIndex??settings.queueCursor??0;
    wanted=q?.items.length?[q.items[at%q.items.length]?.wallpaper.sceneId,...(q.loop!==false||at+1<q.items.length?[q.items[(at+1)%q.items.length]?.wallpaper.sceneId]:[])]:[settings.wallpaper?.sceneId??settings.sceneId];
    protectedScenes=new Set(wanted);leasedKeys=new Set((playback?.slots??[]).map(s=>s.cacheKey).filter(Boolean));
    for(const id of wanted){const entry=entryFor(descriptor(id));if(entry)entry.usedAt=Date.now();}
    for(const j of jobs)if(j.status==='queued'&&!j.rebuild&&!wanted.includes(j.sceneId)){j.status='cancelled';j.cancelReason='stale';j.message='播放目标已变化，取消未使用的预载';}
    if(activeJob&&!activeJob.rebuild&&!wanted.includes(activeJob.sceneId)){activeJob.cancelReason='stale';controller?.abort();}
    if(playback?.recentSlowFrames>=4||resources.publicState().jobs.some(j=>['queued','running'].includes(j.status))){slowUntil=Date.now()+15000;if(controller&&!controller.signal.aborted){activeJob.cancelReason='busy';controller.abort();}}
    if(data.enabled)for(const id of wanted)enqueue(id);
    if(Object.values(data.entries).reduce((n,e)=>n+(e.bytes??0),0)>data.limitBytes)schedulePump();
  }
  async function action(name,payload={}){
    if(name==='cache-settings'){if(typeof payload.enabled!=='boolean'||![.5,1,2,4,8].includes(payload.limitGB))throw Error('缓存选项无效');data.enabled=payload.enabled;data.limitBytes=payload.limitGB*GiB;if(!data.enabled){controller?.abort();for(const j of jobs)if(j.status==='queued')j.status='cancelled';}await evict();changed();if(data.enabled)for(const id of wanted)enqueue(id,true);await save();}
    else if(name==='cache-rebuild'){const d=descriptor(payload.sceneId);if(!d)throw Error('这张壁纸没有分段动作');if(!data.enabled)throw Error('请先开启连续播放缓存');for(const c of d.clips){delete data.edges[c.signature];delete data.fingerprints[c.signature];}enqueue(d.id,true,true);}
    else if(name==='cache-clear'){await evict(0,true);await save();}
    else if(name==='cache-cancel'){const j=jobs.find(j=>j.id===payload.id);if(j){j.cancelReason='user';if(j.status==='queued')j.status='cancelled';else if(activeJob?.id===payload.id)controller?.abort();}}
    else if(name!=='cache-status')throw Error('未知播放缓存操作');return publicState();
  }
  // Only owned temporary files from interrupted jobs are removed at startup.
  const indexed=new Set(Object.values(data.entries).map(e=>e.key+'.mp4'));
  for(const name of await fs.readdir(directory))if(/^[a-f0-9]{64}\.(building\.mp4|concat\.txt)$/.test(name)||/^[a-f0-9]{64}\.mp4$/.test(name)&&!indexed.has(name))await safeUnlink(path.join(directory,name));
  return{refresh(){byId=new Map(scenes.map(s=>[s.id,s]));},describe,fileFor,observe,action,publicState,get revision(){return revision;},async close(){closed=true;clearTimeout(saveTimer);clearTimeout(wakeTimer);controller?.abort();while(pumping)await new Promise(r=>setTimeout(r,20));await save();}};
}
