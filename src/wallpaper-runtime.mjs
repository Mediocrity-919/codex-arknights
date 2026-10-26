export function createWallpaperPlayer(container,{catalog,onState=()=>{},transitionMs=280}={},createMediaDeck){
  const byId=new Map(catalog.map(s=>[s.id,s]));let key=null,last=null;const deck=createMediaDeck(container,{onState,transitionMs}),transform=t=>t??{scale:1,x:50,y:50};
  function resolve(config,queue){
    const scene=byId.get(config.sceneId);if(!scene)throw Error('壁纸素材不存在');const composite=scene.kind==='static'&&scene.category==='operator',backgroundId=composite?(queue?.backgroundId??config.backgroundId):null,bg=backgroundId?byId.get(backgroundId):null;
    const source={...scene,fit:config.fit??scene.fit,view:config.view??scene.defaultView,clips:scene.clips,cycles:config.cycles??queue?.cycles??2,durationSeconds:config.duration??queue?.duration??60};
    if(!source.view){source.focusX=last?.focusX??scene.focusX;source.focusY=last?.focusY??scene.focusY;}
    if(scene.kind==='static'){source.video=null;source.layers=[];if(bg)source.layers.push({src:bg.poster,width:bg.width,height:bg.height,fit:'cover',transform:transform(queue?.background??config.background)});source.layers.push({src:scene.poster,width:scene.width,height:scene.height,bounds:composite&&config.subject?scene.bounds:null,fit:composite?'contain':source.fit??'cover',transform:transform(composite?config.subject:config.view)});}return source;
  }
  let activeQueueId=null;
  async function update(settings,{force=false}={}){
    last=settings;deck.setPresentation(settings);deck.setEnabled(settings.motion!==false&&!settings.playbackPaused&&settings.quality!=='still'&&settings.mode!=='focus');
    const queue=settings.playlists?.find(q=>q.id===settings.activePlaylistId),config=settings.wallpaper??{sceneId:settings.sceneId};
    const entries=queue?.items.map(item=>({...resolve({...item.wallpaper,duration:item.duration,cycles:item.cycles},queue),entryId:item.id}));
    // Names, save timestamps, other queues and persisted progress are not media changes.
    const nextKey=JSON.stringify(queue?{id:queue.id,loop:queue.loop!==false,entries}:{config,source:resolve(config)});if(nextKey===key&&!force)return true;
    const before=key,previousQueueId=activeQueueId;key=nextKey;activeQueueId=queue?.id??null;
    const result=queue?await deck.setPlaylist(entries,settings.queueCursor??0,{force:force||!!previousQueueId&&previousQueueId!==queue.id,loop:queue.loop!==false}):await deck.setScene(resolve(config),{force});
    if(!result&&key===nextKey){key=before;activeQueueId=previousQueueId;}return result;
  }
  return{update,resolve,setCatalog(next){byId.clear();for(const s of next)byId.set(s.id,s);return last?update(last):true;},setEnabled:v=>deck.setEnabled(v),setPresentation:s=>deck.setPresentation(s),setScene:s=>deck.setScene(s),jump:d=>deck.jump(d),destroy:()=>deck.destroy(),diagnostics:()=>deck.diagnostics(),settings:()=>last};
}
