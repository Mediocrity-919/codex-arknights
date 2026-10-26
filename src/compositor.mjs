// Two video decoders and two image surfaces; only the immediate successor is prepared.
export function createMediaDeck(container,{onState=()=>{},transitionMs=280,loopBlendMs=140}={}){
  let alive=true,enabled=true,program=[],queued=false,cursor={entry:0,clip:0,cycle:0},active=null,scene=null;
  let generation=0,requested=null,prepared=null,preparing=null,blend=null,frame=0,lastTick=performance.now(),elapsed=0;
  let presentation={strength:1,blur:0},largestGap=0,presented=false,presentFrame=0,retireFrame=0,retiring=false,wakeMs=100,guardValid=false;
  let queueLoop=true,queueFinished=false;
  const events=[],samples=[],videos=[],images=[];
  // One viewport snapshot, capped at 1080p (~8 MiB RGBA), shared by both decoders.
  // It is refreshed only at an impending seam/stall, never read back every 4K frame.
  const guard=document.createElement('canvas');guard.dataset.arkGuard='';guard.width=1;guard.height=1;
  Object.assign(guard.style,{position:'absolute',inset:'0',width:'100%',height:'100%',opacity:'0',pointerEvents:'none',zIndex:'4'});container.append(guard);
  const guardContext=guard.getContext('2d',{alpha:false});
  function record(e){events.push(e);if(events.length>40)events.shift();}
  const logicalClip=()=>active?.data?.chapters?Math.max(0,active.data.chapters.findLastIndex(c=>c.start<=active.video.currentTime)):cursor.clip;
  function notify(extra={}){onState({media:active?.type==='video'?'video':'poster',sceneId:scene?.id??null,entryIndex:cursor.entry,clipIndex:logicalClip(),cycle:cursor.cycle,...extra});}
  function release(s){s.controller?.abort();s.controller=null;s.ready=false;s.source=null;s.video.pause();s.video.removeAttribute('src');s.video.load();}
  function paintBacking(slot){
    const v=slot.video;if(v.readyState<2||!v.videoWidth)return;
    const h=Math.round(480*v.videoHeight/v.videoWidth);if(slot.backing.height!==h)slot.backing.height=h;
    try{slot.context.drawImage(v,0,0,slot.backing.width,slot.backing.height);}catch{}
  }
  function opacity(slot,value){slot.el.style.opacity=String(value);if(slot.backing)slot.backing.style.opacity=String(value);}
  function level(slot,value){slot.el.style.zIndex=String(value);if(slot.backing)slot.backing.style.zIndex=String(value);}
  function captureGuard(slot=active,show=false){
    if(slot?.type!=='video'||slot.video.readyState<2||!slot.video.videoWidth)return false;
    const v=slot.video,W=Math.max(1,container.clientWidth),H=Math.max(1,container.clientHeight),ratio=Math.min(1,1920/W,1080/H),w=Math.round(W*ratio),h=Math.round(H*ratio);
    if(guard.width!==w||guard.height!==h){guard.width=w;guard.height=h;}const ctx=guardContext,s=slot.data,t=s.view??{scale:1,x:50,y:50};
    try{
      ctx.fillStyle='#181818';ctx.fillRect(0,0,w,h);
      const cover=Math.max(w/v.videoWidth,h/v.videoHeight),bw=v.videoWidth*cover,bh=v.videoHeight*cover;
      ctx.filter='blur(14px)';ctx.drawImage(v,(w-bw*1.1)/2,(h-bh*1.1)/2,bw*1.1,bh*1.1);ctx.filter='none';
      const base=s.fit==='contain'?Math.min(w/v.videoWidth,h/v.videoHeight):cover,iw=v.videoWidth*base,ih=v.videoHeight*base;
      const fx=(presentation.focusX??s.focusX??50)/100,fy=(presentation.focusY??s.focusY??50)/100;
      ctx.save();ctx.translate(w*((t.x??50)-50)/100+w/2,h*((t.y??50)-50)/100+h/2);ctx.scale(t.scale??1,t.scale??1);ctx.drawImage(v,-w/2+(w-iw)*fx,-h/2+(h-ih)*fy,iw,ih);ctx.restore();
      guardValid=true;if(show)guard.style.opacity='1';return true;
    }catch{return false;}
  }
  const hideGuard=()=>{guard.style.opacity='0';};
  for(let i=0;i<2;i++){
    // Reuse the same decoder for a lightweight full-bleed backing. Contain mode
    // keeps the complete frame while its edges still reach the transparent rail.
    const backing=document.createElement('canvas');backing.width=480;backing.height=270;backing.dataset.arkBacking=String(i);
    Object.assign(backing.style,{position:'absolute',inset:'0',width:'100%',height:'100%',objectFit:'cover',filter:'blur(14px)',transform:'scale(1.1)',opacity:'0',pointerEvents:'none'});container.append(backing);
    const video=document.createElement('video');video.muted=true;video.playsInline=true;video.loop=false;video.preload='auto';video.dataset.arkSlot=String(i);
    Object.assign(video.style,{position:'absolute',inset:'0',width:'100%',height:'100%',objectFit:'cover',opacity:'0',background:'transparent',pointerEvents:'none'});container.append(video);
    const slot={type:'video',el:video,video,backing,context:backing.getContext('2d',{alpha:false}),backingAt:0,source:null,ready:false,controller:null,frameId:null,lastFrame:0,stalls:0,chapter:-1};videos.push(slot);
    video.addEventListener('waiting',()=>{slot.stalls++;if(active===slot&&enabled&&!blend)captureGuard(slot,true);});
    const monitor=()=>{if(!alive)return;slot.frameId=video.requestVideoFrameCallback((now,metadata)=>{if(enabled&&(active===slot||blend?.next===slot)){
      if((slot.data?.fit==='contain'||slot.data?.view?.scale<1)&&now-slot.backingAt>100){paintBacking(slot);slot.backingAt=now;}
      if(slot.lastFrame){const gap=now-slot.lastFrame;if(gap<1000){largestGap=Math.max(largestGap,gap);samples.push({at:now,gap,slot:i});if(samples.length>240)samples.shift();}}slot.lastFrame=now;slot.mediaTime=metadata.mediaTime;
      if(active===slot&&!blend&&!slot.endHeld){hideGuard();const chapter=logicalClip();if(slot.data?.chapters&&chapter!==slot.chapter){slot.chapter=chapter;record({type:'chapter',sceneId:scene.id,clipIndex:chapter,cycle:cursor.cycle});notify({committed:true});}}
    }monitor();});};
    if(video.requestVideoFrameCallback)monitor();
    const el=document.createElement('div');el.dataset.arkImageSlot=String(i);Object.assign(el.style,{position:'absolute',inset:'0',overflow:'hidden',opacity:'0',background:'#181818',pointerEvents:'none'});container.append(el);images.push({type:'image',el,ready:false,data:null});
  }
  function layout(slot){
    if(slot.type==='video'&&slot.data){const s=slot.data,t=s.view;slot.video.style.objectFit=s.fit||'cover';slot.video.style.objectPosition=`${presentation.focusX??s.focusX??50}% ${presentation.focusY??s.focusY??50}%`;slot.video.style.transform=t?`translate(${t.x-50}%,${t.y-50}%) scale(${t.scale})`:'none';return;}
    if(!slot.data)return;
    for(let i=0;i<slot.el.children.length;i++){
      const image=slot.el.children[i],layer=slot.data.layers[i],W=container.clientWidth,H=container.clientHeight,iw=layer.width||image.naturalWidth,ih=layer.height||image.naturalHeight;if(!iw||!ih)continue;
      const t=layer.transform??{scale:1,x:50,y:50},b=layer.bounds??[0,0,iw,ih],scale=(layer.fit==='cover'?Math.max(W/iw,H/ih):Math.min(W/(b[2]-b[0]),H/(b[3]-b[1])))*(t.scale??1);
      const cx=layer.fit==='cover'?iw/2:(b[0]+b[2])/2,cy=layer.fit==='cover'?ih/2:(b[1]+b[3])/2;
      Object.assign(image.style,{position:'absolute',maxWidth:'none',width:`${iw*scale}px`,height:`${ih*scale}px`,left:`${W*(t.x??50)/100-cx*scale}px`,top:`${H*(t.y??50)/100-cy*scale}px`,objectFit:'fill'});
    }
  }
  const resize=new ResizeObserver(()=>{[...images,...videos].forEach(layout);if(guard.style.opacity==='1')captureGuard();});resize.observe(container);
  function sourceAt(at){const root=program[at.entry];if(!root)return null;const clips=root.clips?.length?root.clips:root.video?[{video:root.video}]:[],sequence=at.clip===0?root.sequence:null,clip=sequence??clips[at.clip];return{...root,video:clip?.video??null,clipId:sequence?root.id+'-sequence':clip?.id??root.id,clipCount:sequence?1:clips.length,logicalClipCount:clips.length,chapters:sequence?.chapters??null,cacheKey:sequence?.key??null,in:clip?.in??0,out:clip?.out??sequence?.duration??null,fps:clip?.fps??root.fps,layers:root.layers??[{src:root.poster,fit:root.fit??'cover',transform:root.view??{scale:1,x:root.focusX??50,y:root.focusY??50}}]};}
  function nextCursor(from=cursor){const s=from===cursor&&active?active.data:sourceAt(from);if(!s)return null;if(s.clipCount){if(from.clip+1<s.clipCount)return{...from,clip:from.clip+1};if(!queued||from.cycle+1<(s.cycles??2))return{...from,clip:0,cycle:from.cycle+1};}return queued&&(queueLoop||from.entry+1<program.length)?{entry:(from.entry+1)%program.length,clip:0,cycle:0}:null;}
  function firstFrame(slot,signal){return new Promise((resolve,reject)=>{
    const v=slot.video;let fid,timer,frames=0;
    const clean=()=>{clearTimeout(timer);v.removeEventListener('error',fail);v.removeEventListener('loadeddata',fallback);signal.removeEventListener('abort',abort);if(fid!=null)v.cancelVideoFrameCallback?.(fid);};
    const done=()=>{clean();resolve(performance.now());},fail=()=>{clean();reject(Error('视频无法解码'));},abort=()=>{clean();reject(new DOMException('Superseded','AbortError'));};
    const fallback=()=>{if(!v.requestVideoFrameCallback&&v.readyState>=2)done();};v.addEventListener('error',fail);v.addEventListener('loadeddata',fallback);signal.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>{clean();reject(Error('视频预载超时'));},12000);
    if(signal.aborted)return abort();if(v.requestVideoFrameCallback){const presented=(_now,m)=>{const start=slot.data?.in??0;if(v.seeking||v.readyState<2||m.mediaTime+1e-3<start){frames=0;fid=v.requestVideoFrameCallback(presented);return;}let ahead=0;for(let i=0;i<v.buffered.length;i++)if(v.buffered.start(i)<=v.currentTime&&v.buffered.end(i)>=v.currentTime)ahead=v.buffered.end(i)-v.currentTime;const need=Math.min(.35,Math.max(0,(slot.data?.out??v.duration)-v.currentTime-.04));if(++frames<2||ahead<need)fid=v.requestVideoFrameCallback(presented);else done();};fid=v.requestVideoFrameCallback(presented);}v.play().then(fallback).catch(e=>{clean();reject(e);});
  });}
  async function prepare(at,ticket){
    const source=sourceAt(at);if(!source)throw Error('壁纸不存在');
    if(source.video&&enabled){
      const slot=videos.find(s=>s!==active),reuse=slot.source===source.video&&slot.video.readyState>=1&&!slot.video.error;
      if(reuse){slot.controller?.abort();slot.video.pause();slot.ready=false;}else release(slot);
      slot.controller=new AbortController();slot.endHeld=false;slot.guardCaptured=false;slot.lastFrame=0;slot.chapter=-1;const signal=slot.controller.signal;slot.source=source.video;slot.data=source;opacity(slot,0);level(slot,1);layout(slot);
      if(reuse)slot.video.currentTime=source.in??0;else {slot.video.src=source.video;if(source.in)slot.video.currentTime=source.in;}
      await firstFrame(slot,signal);if(!alive||ticket!==generation||signal.aborted)throw new DOMException('Superseded','AbortError');paintBacking(slot);slot.video.pause();slot.ready=true;return{slot,source,at,ticket};
    }
    const slot=images.find(s=>s!==active);slot.ready=false;
    const decoded=await Promise.all(source.layers.map(async layer=>{const img=new Image();img.alt='';img.decoding='async';img.src=layer.src;let timer;try{await Promise.race([img.decode(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('图片预载超时')),12000);})]);}finally{clearTimeout(timer);}return img;}));
    if(!alive||ticket!==generation)throw new DOMException('Superseded','AbortError');slot.data=source;slot.el.replaceChildren(...decoded);slot.el.style.opacity='0';slot.el.style.zIndex='1';layout(slot);slot.ready=true;return{slot,source,at,ticket};
  }
  function cancelPreparation(){prepared=null;preparing=null;for(const s of videos)if(s!==active&&s!==blend?.next)s.controller?.abort();}
  function warm(){
    if(!alive||!active||!enabled||blend||retiring||requested||preparing||prepared)return;const at=nextCursor();if(!at)return;
    const job={ticket:generation,at};preparing=job;
    (async()=>{let candidate=at;const maximum=Math.min(30,program.reduce((n,s)=>n+(s.clips?.length||1),0));
      for(let attempt=0;attempt<maximum;attempt++){const began=performance.now();job.at=candidate;try{const result=await prepare(candidate,job.ticket);if(preparing!==job||job.ticket!==generation)return;result.source={...result.source,...sourceAt(result.at)};result.slot.data=result.source;layout(result.slot);prepared=result;record({type:'preload',sceneId:result.source.id,clipId:result.source.clipId,prepareMs:Math.round(performance.now()-began)});return;}catch(e){if(e.name==='AbortError'||!alive||preparing!==job)return;notify({warning:'下一段素材不可用，保留当前画面并尝试后续内容'});record({type:'skip-failed',sceneId:sourceAt(candidate)?.id});candidate=nextCursor(candidate);if(!candidate)break;}}
      if(preparing===job)notify({error:'后续素材暂时不可用，已保留当前画面'});
    })().finally(()=>{if(preparing===job)preparing=null;});
  }
  function finishBlend(){
    if(!blend)return;const job=blend;blend=null;cancelAnimationFrame(job.frame);const before=active;active=job.next;scene=job.source;cursor=job.at;active.data=scene;
    if(!before||job.manual||active.type==='image'||job.at.entry!==job.previousCursor.entry)elapsed=0;
    for(const s of [...videos,...images]){opacity(s,s===active?1:0);level(s,s===active?5:0);if(s!==active&&s.type==='video'){s.video.pause();s.ready=false;}}
    if(!enabled&&active.type==='video')active.video.pause();if(active.type==='image')videos.forEach(release);
    requested=null;prepared=null;lastTick=performance.now();
    // Report readiness only after a decoded surface has crossed a paint boundary.
    // Keep the previous visible frame valid during later blends.
    if(!presented){cancelAnimationFrame(presentFrame);presentFrame=requestAnimationFrame(()=>{presentFrame=requestAnimationFrame(()=>{if(alive&&active?.ready)presented=true;});});}
    record({type:job.type,sceneId:scene.id,clipId:scene.clipId,clipIndex:cursor.clip,cycle:cursor.cycle,entryIndex:cursor.entry,firstFrameWaitMs:Math.round(job.readyAt-job.started),blendMs:Math.round(performance.now()-job.fadeAt),maxVisibleFrameGapMs:Math.round(Math.max(0,...samples.filter(s=>s.at>=job.started).map(s=>s.gap)))});
    notify({transitioning:false,loading:false,error:null,committed:true});job.resolve(true);
    // Leave the committed texture in place across two paint boundaries before recycling.
    retiring=true;cancelAnimationFrame(retireFrame);retireFrame=requestAnimationFrame(()=>{retireFrame=requestAnimationFrame(()=>{retiring=false;if(!alive)return;hideGuard();if(active)level(active,3);warm();});});
  }
  async function show(candidate,manual=false){
    if(!alive||candidate.ticket!==generation)return false;const {slot,at}=candidate,source=candidate.source;slot.data=source;layout(slot);let resolve;const result=new Promise(r=>resolve=r);
    const type=manual?'scene':at.entry!==cursor.entry?'playlist':source.logicalClipCount>1?(at.clip===0?'cycle':'action'):'loop';
    const job={next:slot,source,at,previousCursor:{...cursor},manual,type,resolve,frame:0,started:performance.now(),readyAt:0,fadeAt:0};blend=job;level(slot,5);opacity(slot,0);captureGuard();notify({transitioning:true});
    try{
      // Paused/occluded surfaces can lose their compositor texture. Wait for an
      // actual presentation after resuming; the old surface stays fully visible.
      if(slot.type==='video'){
        await firstFrame(slot,slot.controller.signal);paintBacking(slot);
      }
      job.readyAt=performance.now();wakeMs=Math.min(900,Math.max(80,wakeMs*.7+(job.readyAt-job.started)*.3));if(!alive||blend!==job||candidate.ticket!==generation){resolve(false);return false;}job.fadeAt=performance.now();
      if(!active||!enabled||transitionMs===0){finishBlend();return result;}const duration=manual||at.entry!==cursor.entry?transitionMs:loopBlendMs;
      const draw=now=>{if(blend!==job||!alive)return;const p=Math.min(1,(now-job.fadeAt)/Math.max(1,duration));opacity(slot,p*p*(3-2*p));if(p>=1)finishBlend();else job.frame=requestAnimationFrame(draw);};job.frame=requestAnimationFrame(draw);
    }catch(e){if(blend===job){blend=null;opacity(slot,0);slot.video?.pause();requested=null;notify({error:e.message,transitioning:false});warm();}resolve(false);}return result;
  }
  function cancelBlend(){if(!blend)return;const job=blend;blend=null;cancelAnimationFrame(job.frame);opacity(job.next,0);job.next.video?.pause();job.next.controller?.abort();job.resolve(false);if(active){opacity(active,1);level(active,3);}}
  const identity=entries=>JSON.stringify(entries.map(s=>[s.entryId,s.id,s.video,s.clips?.map(c=>c.video),s.layers?.map(l=>l.src),s.poster]));
  const mediaKey=(at)=>at?JSON.stringify([program[at.entry]?.entryId??program[at.entry]?.id,at.clip,at.cycle,sourceAt(at)?.video,sourceAt(at)?.in,sourceAt(at)?.out,sourceAt(at)?.layers?.map(l=>l.src)]):null;
  function refreshActive(){
    const next=sourceAt(cursor),old=active.data;
    // Keep the currently decoded rendition until a natural action/cycle boundary.
    scene=active.type==='video'?{...next,...Object.fromEntries(['video','clipId','clipCount','logicalClipCount','chapters','cacheKey','in','out','fps'].map(k=>[k,old[k]]))}:next;
    active.data=scene;layout(active);if(guard.style.opacity==='1')captureGuard();
  }
  function preserve(entries,index,loop){
    const previousNext=nextCursor(),oldKey=mediaKey(previousNext);
    program=entries;queueLoop=loop;queueFinished=false;cursor={...cursor,entry:index};refreshActive();
    const after=nextCursor(),nextKey=mediaKey(after);
    if(oldKey!==nextKey){cancelBlend();cancelPreparation();}
    else if(after){
      if(preparing)Object.assign(preparing.at,after);
      if(prepared){prepared.at=after;prepared.source=sourceAt(after);prepared.slot.data=prepared.source;layout(prepared.slot);}
      if(blend){blend.at=after;blend.source={...sourceAt(after),...Object.fromEntries(['video','clipId','clipCount','logicalClipCount','chapters','cacheKey','in','out','fps'].map(k=>[k,blend.source[k]]))};blend.next.data=blend.source;layout(blend.next);}
    }
    notify({committed:true});warm();return true;
  }
  async function setProgram(entries,start=0,isQueue=false,{force=false,loop=true}={}){
    if(!entries.length)return false;
    // Stable entry IDs preserve the visible item through inserts, reorders and removals.
    // Only the successor is re-prepared; the current decoder, clock and action survive.
    if(!force&&isQueue&&queued&&active&&!requested&&program[cursor.entry]?.entryId){
      const old=program[cursor.entry],index=entries.findIndex(s=>s.entryId===old.entryId);
      if(index>=0&&entries[index].id===old.id&&(active.type==='video'||identity([entries[index]])===identity([old]))){
        return preserve(entries,index,loop);
      }
      if(index<0){const survivors=program.slice(cursor.entry+1).concat(program.slice(0,cursor.entry));const next=survivors.find(s=>entries.some(e=>e.entryId===s.entryId));if(next)start=entries.findIndex(s=>s.entryId===next.entryId);}
    }
    // Geometry, timing and appearance edits must not seek or recreate decoders.
    if(!force&&active&&!requested&&isQueue===queued&&(identity(entries)===identity(program)||!isQueue&&active.type==='video'&&entries[0].id===program[0].id)){
      return preserve(entries,cursor.entry,loop);
    }
    cancelBlend();const previous={program,queued,cursor,queueLoop},ticket=++generation;cancelPreparation();program=entries;queued=isQueue;queueLoop=loop;queueFinished=false;requested=entries[Math.min(start,entries.length-1)].id;
    const at={entry:Math.min(start,entries.length-1),clip:0,cycle:0},source=sourceAt(at);
    if(!force&&active?.type==='image'&&!source.video&&JSON.stringify(active.data.layers.map(l=>l.src))===JSON.stringify(source.layers.map(l=>l.src))){active.data=source;scene=source;cursor=at;layout(active);requested=null;elapsed=0;notify({committed:true,error:null});warm();return true;}
    if(!force&&enabled&&active?.type==='video'&&!isQueue&&!source.clips?.length&&active.source===source.video){active.data=source;scene=source;cursor=at;layout(active);requested=null;warm();return true;}
    notify({loading:true,error:null});try{const candidate=await prepare(at,ticket);if(ticket!==generation)return false;const ok=await show(candidate,true);if(!ok)throw Error('新壁纸未能显示');return true;}catch(e){if(ticket===generation&&alive){program=previous.program;queued=previous.queued;cursor=previous.cursor;queueLoop=previous.queueLoop;requested=null;notify({loading:false,error:e.name==='AbortError'?null:e.message});warm();}return false;}
  }
  function setEnabled(value){value=!!value;if(value===enabled)return;enabled=value;if(enabled&&queueFinished){queueFinished=false;elapsed=0;jump(-cursor.entry);return;}lastTick=performance.now();videos.forEach(s=>s.lastFrame=0);if(!enabled){if(blend){if(blend.readyAt)finishBlend();else{cancelBlend();requested=null;}}if(preparing)cancelPreparation();videos.forEach(s=>s.video.pause());}else if(active?.type==='video'){if(!active.endHeld)active.video.play().catch(()=>{});warm();}else if(active?.data.video){const at={...cursor},ticket=++generation;cancelPreparation();requested=scene.id;prepare(at,ticket).then(c=>show(c,true)).catch(()=>{requested=null;});}else warm();}
  function setPresentation(value){presentation={...presentation,...value};container.style.opacity=String(presentation.strength??1);container.style.filter=`blur(${presentation.blur??0}px)`;container.style.transform=presentation.blur?'scale(1.06)':'none';videos.forEach(layout);}
  function tick(now){
    if(!alive)return;const dt=Math.max(0,now-lastTick);lastTick=now;
    // Some supplied clips expose black terminal frames at playback end. Budget decoder wake-up
    // time before the fade, and hold a valid tail if the successor is delayed.
    if(enabled&&active?.type==='video'&&!active.endHeld){const v=active.video,end=active.data.out??v.duration,remaining=end-v.currentTime;
      if(Number.isFinite(remaining)&&remaining<=.45&&!active.guardCaptured){active.guardCaptured=captureGuard();}
      const holdAhead=active.data.out==null?Math.min(.12,v.duration*.1):Math.max(2/(active.data.fps||30),.045);
      if(Number.isFinite(remaining)&&remaining<=holdAhead){active.endHeld=true;v.pause();paintBacking(active);if(v.currentTime<end)captureGuard(active,true);else if(guardValid)guard.style.opacity='1';}}
    if(enabled&&active&&!blend&&!requested){elapsed+=dt;const due=active.type==='video'?(active.endHeld||active.video.ended||Number.isFinite(active.video.duration)&&(active.data.out??active.video.duration)-active.video.currentTime<=(loopBlendMs+wakeMs+80)/1000):(queued&&elapsed>=(scene.durationSeconds??60)*1000);if(due&&prepared){const candidate=prepared;prepared=null;show(candidate).catch(()=>{});}else if(due&&queued&&!queueLoop&&!nextCursor()&&!queueFinished&&(active.type!=='video'||active.endHeld||active.video.ended)){queueFinished=true;setEnabled(false);notify({queueEnded:true});}}frame=requestAnimationFrame(tick);
  }
  frame=requestAnimationFrame(tick);
  async function jump(delta){if(!queued||!program.length)return false;queueFinished=false;cancelBlend();const at={entry:(cursor.entry+delta+program.length)%program.length,clip:0,cycle:0},ticket=++generation;cancelPreparation();requested=program[at.entry].id;try{return await show(await prepare(at,ticket),true);}catch(e){requested=null;notify({error:e.message});warm();return false;}}
  function destroy(){alive=false;presented=false;generation++;cancelAnimationFrame(frame);cancelAnimationFrame(presentFrame);cancelAnimationFrame(retireFrame);resize.disconnect();cancelBlend();for(const s of videos){if(s.frameId!=null)s.video.cancelVideoFrameCallback?.(s.frameId);release(s);s.el.remove();s.backing.remove();}images.forEach(s=>s.el.remove());guard.width=guard.height=1;guard.remove();}
  return{setScene:(s,options)=>setProgram([s],0,false,options),setPlaylist:(entries,start=0,options)=>setProgram(entries,start,true,options),setEnabled,setPresentation,jump,destroy,diagnostics:()=>({firstFrameReady:alive&&presented&&!!active?.ready,sceneId:scene?.id??null,requested,enabled,transitioning:!!blend,videoCount:videos.length,guardBytes:guard.width*guard.height*4,guardVisible:guard.style.opacity==='1',activeSlot:active?.type==='video'?videos.indexOf(active):null,standbyReady:!!prepared,entryIndex:cursor.entry,clipIndex:logicalClip(),cycle:cursor.cycle,clipCount:scene?.logicalClipCount??scene?.clipCount??0,continuous:!!scene?.chapters,elapsedMs:Math.round(elapsed),events:[...events],largestFrameGapMs:Math.round(largestGap),recentSlowFrames:samples.filter(s=>performance.now()-s.at<4000&&s.gap>120&&s.gap<1000&&videos[s.slot]===active).length,slots:videos.map(s=>({source:s.source,cacheKey:s.source?s.data?.cacheKey??null:null,time:s.video.currentTime,duration:s.video.duration,width:s.video.videoWidth,height:s.video.videoHeight,paused:s.video.paused,ready:s.ready,stalls:s.stalls,dropped:s.video.getVideoPlaybackQuality?.().droppedVideoFrames??0,opacity:s.video.style.opacity,error:s.video.error?.code??null}))})};
}
