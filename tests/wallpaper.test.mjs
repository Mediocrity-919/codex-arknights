import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {ROOT,scenes,defaults,validateSettings,assetById,mediaPath} from '../src/catalog.mjs';
import {createWallpaperPlayer} from '../src/wallpaper-runtime.mjs';

const art=scenes.filter(s=>s.kind==='static'&&s.category==='operator');
const bg=scenes.find(s=>s.role==='scene');
const full=scenes.find(s=>s.role==='complete');
const dynamic=scenes.find(s=>s.official&&s.clips.length>=3);
const t={scale:1.25,x:40,y:60};
const config=scene=>({sceneId:scene.id});
const queue={id:'q1',name:'测试队列',backgroundId:bg.id,background:t,duration:60,cycles:2,items:[{id:'one',wallpaper:config(art[0])},{id:'two',wallpaper:config(art[1])},{id:'three',wallpaper:config(full)},{id:'four',wallpaper:config(dynamic)}]};

test('official dynamic catalog groups every action exactly once, preserving file order',()=>{
  const official=scenes.filter(s=>s.official);
  assert.equal(official.length,98);
  const clips=official.flatMap(s=>s.clips);assert.equal(clips.length,305);assert.equal(new Set(clips.map(c=>c.id)).size,305);
  for(const scene of official){
    const names=scene.clips.map(c=>assetById(c.id).file);
    assert.deepEqual(names,[...names].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})));
    for(const clip of scene.clips)assert.equal(mediaPath(clip.id),path.join(ROOT,assetById(clip.id).file));
  }
  assert.equal(scenes.filter(s=>s.role==='scene').length,35);assert.equal(scenes.filter(s=>s.role==='complete').length,14);
});

test('4K derivatives keep source clip IDs and every bundle resolves to the completed local files',{skip:!statSyncSafe(path.join(ROOT,'明日方舟_官方动态皮肤全集','资料与清单','4K视频处理结果.json'))},()=>{
  const folder=path.join(ROOT,'明日方舟_官方动态皮肤全集');
  const rows=JSON.parse(readFileSync(path.join(folder,'资料与清单','4K视频处理结果.json'),'utf8').replace(/^\uFEFF/,''));
  assert.equal(rows.length,305);
  for(const row of rows){
    const sourceHash=createHash('sha256').update(row.original_path.replaceAll('\\','/')).digest('hex').slice(0,16);
    const id=`clip-${row.cid}-${sourceHash}`,clip=assetById(id),filename=path.join(folder,row.output_path);
    assert.ok(clip,'existing source ID must continue to resolve');
    assert.equal(mediaPath(id),filename);assert.equal(clip.width,3840);assert.equal(clip.height,2160);
    assert.equal(clip.bytes,statSync(filename).size);assert.equal(clip.fps,row.output_fps);assert.equal(clip.duration,row.output_duration);
  }
  for(const scene of scenes.filter(s=>s.official)){
    assert.equal(scene.rendition,'4k-upscale');assert.equal(mediaPath(scene.id),mediaPath(scene.clips[0].id));
    assert.equal(scene.bytes,scene.clips.reduce((n,c)=>n+c.bytes,0));
  }
  assert.ok(!mediaPath('yaoyue').includes('4K超分'));assert.ok(!mediaPath('eyja').includes('4K超分'));
});
function statSyncSafe(file){try{return statSync(file).isFile();}catch{return false;}}

test('playlist and composition persistence rejects invalid references and unsafe transforms',()=>{
  const value=validateSettings({...defaults,playlists:[queue],activePlaylistId:queue.id});
  assert.equal(value.playlists[0].duration,60);assert.equal(value.playlists[0].cycles,2);
  for(const patch of [{backgroundId:full.id},{cycles:1.5},{duration:0}])assert.throws(()=>validateSettings({playlists:[{...queue,...patch}]}));
  assert.doesNotThrow(()=>validateSettings({playlists:[{...queue,backgroundId:null}]}));
  assert.throws(()=>validateSettings({playlists:[{...queue,backgroundId:null}],activePlaylistId:queue.id}));
  for(const patch of [{background:{...t,scale:NaN}},{background:{...t,path:'C:/secret'}},{items:[queue.items[0],queue.items[0]]}])assert.throws(()=>validateSettings({playlists:[{...queue,...patch}]}));
  assert.throws(()=>validateSettings({wallpaper:{sceneId:full.id,backgroundId:bg.id}}));
  assert.throws(()=>validateSettings({playlists:[],activePlaylistId:'missing'}));
  assert.throws(()=>validateSettings({playlists:[{...queue,items:[]}],activePlaylistId:queue.id}));
});

test('three-action presets apply initially and explicit saved or queue framing wins',()=>{
  const eligible=scenes.filter(s=>s.official&&s.clips.length===3),preset={scale:1.8,x:30,y:50};
  assert.equal(eligible.length,79);
  const runtime=createWallpaperPlayer({}, {catalog:scenes},()=>({}));
  for(const scene of eligible){
    assert.deepEqual(scene.defaultView,preset);assert.equal(scene.defaultShade,.2);
    const initial=validateSettings({sceneId:scene.id,wallpaper:config(scene)});
    assert.deepEqual(initial.wallpaper.view,preset);assert.equal(initial.shade,.2);
    assert.deepEqual(runtime.resolve(config(scene)).view,preset);
    assert.deepEqual(runtime.resolve({...config(scene),view:t}).view,t);
    const explicit=validateSettings({sceneId:scene.id,wallpaper:{...config(scene),view:t},shade:.37,
      savedWallpapers:[{id:'s',name:'手动构图',wallpaper:{...config(scene),view:t}}],
      playlists:[{id:'q',name:'队列',items:[{id:'a',wallpaper:config(scene)},{id:'b',wallpaper:{...config(scene),view:t}}]}]});
    assert.deepEqual(explicit.wallpaper.view,t);assert.equal(explicit.shade,.37);
    assert.deepEqual(explicit.savedWallpapers[0].wallpaper.view,t);
    assert.deepEqual(explicit.playlists[0].items[0].wallpaper.view,preset);
    assert.deepEqual(explicit.playlists[0].items[1].wallpaper.view,t);
  }
  const excluded=scenes.filter(s=>s.kind==='dynamic'&&!(s.official&&s.clips.length===3));
  assert.equal(excluded.length,23); // Four original videos, fifteen four-action and four two-action skins.
  for(const scene of excluded){
    assert.equal(scene.defaultView,undefined);assert.equal(scene.defaultShade,undefined);
    assert.deepEqual(validateSettings({sceneId:scene.id,wallpaper:config(scene)}).wallpaper.view,{scale:1,x:50,y:50});
  }
});

test('queue backgrounds override item backgrounds while subject and standalone art remain independent',async()=>{
  let calls=0,sources;
  const runtime=createWallpaperPlayer({}, {catalog:scenes.map(s=>({...s,poster:s.id}))},()=>({setPresentation(){},setEnabled(){},setPlaylist:async p=>{sources=p;calls++;return true;},setScene:async s=>{sources=[s];calls++;return true;}}));
  const state=validateSettings({playlists:[queue],activePlaylistId:queue.id});
  await runtime.update(state);
  assert.equal(sources.length,4);assert.equal(sources[0].layers[0].src,bg.id);assert.deepEqual(sources[0].layers[0],sources[1].layers[0]);
  assert.equal(sources[2].layers.length,1);assert.equal(sources[3].layers,undefined);assert.equal(sources[3].cycles,2);assert.equal(sources[0].durationSeconds,60);
  await runtime.update({...state,queueCursor:2});assert.equal(calls,1,'progress persistence must not restart the playlist');
  await runtime.update(state,{force:true});assert.equal(calls,2,'explicit start from beginning restarts the playlist');
  const individual=runtime.resolve({sceneId:art[0].id,backgroundId:bg.id,subject:t});assert.deepEqual(individual.layers[1].transform,t);
  const legacy=runtime.resolve({sceneId:art[0].id});assert.equal(legacy.layers[0].bounds,null,'legacy static art retains its existing framing');
});

test('old playlists migrate to loop playback and incomplete inactive queues persist independently',()=>{
  const state=validateSettings({playlists:[queue,{id:'empty',name:'待添加',items:[]},{...queue,id:'draft',backgroundId:null}],lastQueueId:'empty'});
  assert.equal(state.playlists.length,3);assert.equal(state.playlists[0].loop,true);assert.equal(state.lastQueueId,'empty');
  assert.equal(validateSettings({...state,lastQueueId:'removed'}).lastQueueId,null);
  assert.throws(()=>validateSettings({playlists:[{...queue,loop:'yes'}]}));
  assert.throws(()=>validateSettings({playlists:[{...queue,updatedAt:-1}]}));
});

test('renaming and saving inactive queues do not touch the active media program',async()=>{
  const calls=[];const runtime=createWallpaperPlayer({}, {catalog:scenes},()=>({setPresentation(){},setEnabled(){},setPlaylist:async(entries,start,options)=>{calls.push({entries,start,options});return true;}}));
  const state=validateSettings({playlists:[queue],activePlaylistId:queue.id});await runtime.update(state);
  state.playlists[0].name='改名';state.playlists[0].updatedAt=Date.now();state.playlists[0].lastUsedAt=Date.now();state.playlists.push({id:'empty',name:'其他队列',items:[]});await runtime.update(state);
  assert.equal(calls.length,1);
  state.playlists[0].loop=false;await runtime.update(state);assert.equal(calls.length,2);assert.equal(calls[1].options.loop,false);assert.equal(calls[1].entries[0].entryId,'one');
});
