// Persistence boundary: accept resource identifiers and bounded numeric transforms only.
export function validateWallpaperState(value,lookup){
  const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
  const number=(x,min,max,name)=>{if(typeof x!=='number'||!Number.isFinite(x)||x<min||x>max)throw Error(`无效${name}`);return x;};
  const text=(x,name)=>{if(typeof x!=='string'||!x.trim()||x.length>100)throw Error(`无效${name}`);return x.trim();};
  const keys=(x,allowed)=>{if(!object(x)||Object.keys(x).some(k=>!allowed.includes(k)))throw Error('壁纸配置包含未知字段');};
  const transform=x=>{x=x??{scale:1,x:50,y:50};keys(x,['scale','x','y']);return{scale:number(x.scale,.1,5,'缩放'),x:number(x.x,-100,200,'水平位置'),y:number(x.y,-100,200,'垂直位置')};};
  const background=id=>{if(id!=null&&lookup(id)?.role!=='scene')throw Error('共用背景必须为首页场景');return id??null;};
  function config(x){keys(x,['sceneId','backgroundId','background','subject','view','fit']);const scene=lookup(x.sceneId);if(!scene)throw Error('壁纸素材不存在');if(x.fit!=null&&!['contain','cover'].includes(x.fit))throw Error('无效画幅模式');const backgroundId=background(x.backgroundId);if(backgroundId&&!(scene.kind==='static'&&scene.category==='operator'))throw Error('完整壁纸不能添加干员背景');return{sceneId:x.sceneId,backgroundId,background:transform(x.background),subject:transform(x.subject),view:transform(x.view??scene.defaultView),...(x.fit?{fit:x.fit}:{})};}
  const saved=value.savedWallpapers??[],lists=value.playlists??[];
  if(!Array.isArray(saved)||saved.length>500||!Array.isArray(lists)||lists.length>50)throw Error('壁纸或队列数量超出限制');
  const savedWallpapers=saved.map(x=>{keys(x,['id','name','wallpaper']);return{id:text(x.id,'组合编号'),name:text(x.name,'组合名称'),wallpaper:config(x.wallpaper)};});
  const playlists=lists.map(x=>{
    keys(x,['id','name','backgroundId','background','duration','cycles','items','loop','updatedAt','lastUsedAt']);
    if(!Array.isArray(x.items)||x.items.length>300)throw Error('队列最多300项');
    const items=x.items.map(item=>{keys(item,['id','wallpaper','duration','cycles']);const result={id:text(item.id,'条目编号'),wallpaper:config(item.wallpaper)};if(item.duration!=null)result.duration=number(item.duration,1,86400,'停留秒数');if(item.cycles!=null){result.cycles=number(item.cycles,1,100,'播放遍数');if(!Number.isInteger(result.cycles))throw Error('播放遍数必须为整数');}return result;});
    if(new Set(items.map(i=>i.id)).size!==items.length)throw Error('队列条目编号重复');
    const result={id:text(x.id,'队列编号'),name:text(x.name,'队列名称'),backgroundId:background(x.backgroundId),background:transform(x.background),duration:number(x.duration??60,1,86400,'默认秒数'),cycles:number(x.cycles??2,1,100,'默认遍数'),items};
    if(!Number.isInteger(result.cycles))throw Error('播放遍数必须为整数');
    if(typeof (x.loop??true)!=='boolean')throw Error('循环状态无效');
    result.loop=x.loop??true;
    result.updatedAt=number(x.updatedAt??0,0,Number.MAX_SAFE_INTEGER,'更新时间');
    result.lastUsedAt=number(x.lastUsedAt??0,0,Number.MAX_SAFE_INTEGER,'使用时间');
    if(value.activePlaylistId===result.id&&items.some(i=>lookup(i.wallpaper.sceneId)?.kind==='static'&&lookup(i.wallpaper.sceneId)?.category==='operator')&&!result.backgroundId)throw Error('播放干员组合队列前请选择共用背景');
    return result;
  });
  if(new Set(playlists.map(x=>x.id)).size!==playlists.length||new Set(savedWallpapers.map(x=>x.id)).size!==savedWallpapers.length)throw Error('重复的配置编号');
  const activePlaylistId=value.activePlaylistId??null;if(activePlaylistId&&!playlists.some(x=>x.id===activePlaylistId&&x.items.length))throw Error('活动队列不存在或为空');
  if(typeof (value.playbackPaused??false)!=='boolean')throw Error('暂停状态无效');
  const queueCursor=number(value.queueCursor??0,0,299,'队列位置');if(!Number.isInteger(queueCursor))throw Error('队列位置无效');
  const wallpaper=value.wallpaper==null?null:config(value.wallpaper);
  if(wallpaper&&!activePlaylistId&&wallpaper.sceneId!==value.sceneId)throw Error('当前壁纸与素材不匹配');
  const lastQueueId=value.lastQueueId??null;
  if(lastQueueId!==null&&typeof lastQueueId!=='string')throw Error('无效目标队列');
  return{wallpaper,savedWallpapers,playlists,activePlaylistId,queueCursor,playbackPaused:value.playbackPaused??false,lastQueueId:playlists.some(q=>q.id===lastQueueId)?lastQueueId:null};
}
