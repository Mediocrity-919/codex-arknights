import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateWallpaperState } from './wallpaper-state.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const resourceCatalog=JSON.parse(readFileSync(path.join(ROOT,'resources','catalog.json'),'utf8'));
export const professions = ['先锋','近卫','重装','狙击','术师','医疗','辅助','特种'];
export const ART_ROOT = path.join(ROOT, '明日方舟_全干员与时装原图');
const dynamic = [
  { id: 'yaoyue', name: '邀月', subtitle: '月色入庭 · 灯火未眠', tag: '环境场景', file: '背景-邀月.mp4', width: 3840, height: 2160, fps: 60, duration: 174.6, bytes: 744013566, focusX: 50, focusY: 50, shade: 0.35, accent: '#7dd9eb' },
  { id: 'eyja', name: '纯烬艾雅法拉', subtitle: '晴空来信 · 柔软的日常', tag: '干员壁纸', file: '纯烬艾雅法拉-1.mp4', width: 3054, height: 2160, fps: 120, duration: 29.02, bytes: 244912247, focusX: 52, focusY: 38, shade: 0.48, accent: '#a6e4dc' },
  { id: 'shu-1', name: '黍 · 岁时', subtitle: '纸上山河 · 万象生长', tag: '干员壁纸', file: '黍-1.mp4', width: 3054, height: 2160, fps: 120, duration: 22.62, bytes: 191958126, focusX: 50, focusY: 38, shade: 0.42, accent: '#d5dba7' },
  { id: 'shu-2', name: '黍 · 闲庭', subtitle: '一席暖光 · 暂歇片刻', tag: '干员壁纸', file: '黍-2.mp4', width: 3054, height: 2160, fps: 120, duration: 28.47, bytes: 244060926, focusX: 50, focusY: 42, shade: 0.4, accent: '#e8c78f' }
];
for (const scene of dynamic) {
  Object.assign(scene, { kind:'dynamic', category:scene.id==='yaoyue'?'background':'operator', operator:scene.id==='yaoyue'?'邀月':scene.id==='eyja'?'纯烬艾雅法拉':'黍', profession:scene.id==='yaoyue'?'':scene.id==='eyja'?'医疗':'重装', rarity:scene.id==='yaoyue'?0:6, variant:scene.name, fit:'cover', legacyFile:scene.file });
  scene.file = path.join('动态壁纸', scene.category==='background'?'背景':'干员', ...(scene.category==='background'?[]:[`${String(professions.indexOf(scene.profession)+1).padStart(2,'0')}_${scene.profession}`]),scene.operator,scene.file);
}
const hash=value=>createHash('sha256').update(value.replaceAll('\\','/')).digest('hex').slice(0,16);
export const artIdFor=record=>`art-${hash(record)}`;
export const clipIdFor=row=>`clip-${row.cid}-${hash(row.original_path)}`;
// Only paths in the supplied, local collection manifest are admitted.
let records=[];
try { records=JSON.parse(readFileSync(path.join(ART_ROOT,'资料与清单','原图来源与尺寸.json'),'utf8').replace(/^\uFEFF/,'')).records; }
catch(error) { if(error.code!=='ENOENT')throw error; records=resourceCatalog.artRecords; }
function artScene(record){
  const full=path.resolve(ART_ROOT,record.path);
  if (!full.startsWith(ART_ROOT+path.sep) || !professions.includes(record.profession) || path.extname(full).toLowerCase()!=='.png') throw new Error('立绘清单路径或职业无效');
  const variant=record.label.replace(/^\d+_/,'').replace(/^时装\d+_/,'').replace(/^立绘_.+_skin(\w+)$/,'时装补充立绘 $1');
  return {id:artIdFor(record.path),kind:'static',category:'operator',operator:record.operator,profession:record.profession,rarity:record.rarity,variant,name:`${record.operator} · ${variant}`,subtitle:variant,tag:'静态立绘',file:path.relative(ROOT,full),width:record.width,height:record.height,bytes:record.size,focusX:50,focusY:50,shade:.2,fit:'contain',source:'PRTS',variantKey:record.variant,...(record.addedAt?{addedAt:record.addedAt}:{})};
}
const art = records.map(artScene);
const readManifest=(folder,file)=>{try{return JSON.parse(readFileSync(path.join(ROOT,folder,'资料与清单',file),'utf8').replace(/^\uFEFF/,''));}catch(e){if(e.code==='ENOENT')return file==='4K视频处理结果.json'?resourceCatalog.upscaledRecords:file==='最终文件与校验.json'?resourceCatalog.officialRecords:folder==='明日方舟_首页背景与场景'?resourceCatalog.backgroundRecords:folder==='明日方舟_活动与启动器背景'?resourceCatalog.completeRecords:[];throw e;}};
const safeFile=(folder,relative)=>{const base=path.join(ROOT,folder),full=path.resolve(base,relative);if(!full.startsWith(base+path.sep))throw Error('素材路径越界');return path.relative(ROOT,full);};
let bounds=resourceCatalog.bounds??{};try{bounds=JSON.parse(readFileSync(path.join(ROOT,'.local','art-bounds.json'),'utf8'));}catch{}
for(const scene of art)scene.bounds=bounds[scene.id]??null;
const backgrounds=[];
for(const [folder,role,prefix] of [['明日方舟_首页背景与场景','scene','bg'],['明日方舟_活动与启动器背景','complete','wall']]){
  for(const row of readManifest(folder,'图片来源与校验.json'))backgrounds.push({id:`${prefix}-${hash(row.path)}`,name:row.label||row.name,operator:row.label||row.name,variant:role==='scene'?'首页场景':'活动与启动器',kind:'static',category:'background',role,file:safeFile(folder,row.path),width:row.width,height:row.height,bytes:row.bytes,fit:'cover',focusX:50,focusY:50,rarity:0,profession:'',source:'PRTS'});
}
const officialFolder='明日方舟_官方动态皮肤全集';
const upscaledRoot=path.join(ROOT,officialFolder,'4K超分');
const upscaledByOriginal=new Map(readManifest(officialFolder,'4K视频处理结果.json').map(row=>[row.original_path.replaceAll('\\','/'),row]));
function officialMedia(row){
  const original={file:safeFile(officialFolder,row.original_path),width:row.width,height:row.height,fps:row.fps,duration:row.duration,bytes:row.bytes,rendition:'original'};
  const processed=upscaledByOriginal.get(row.original_path.replaceAll('\\','/'));
  if(!processed||processed.status!=='ok'||String(processed.cid)!==String(row.cid))return original;
  const file=safeFile(officialFolder,processed.output_path),full=path.join(ROOT,file);
  if(!full.startsWith(upscaledRoot+path.sep)||path.extname(full).toLowerCase()!=='.mp4')throw Error('4K 素材路径无效');
  // Prefer completed local derivatives; missing/incomplete downloads retain
  // the original. IDs and action order always come from the source manifest.
  let stat;try{stat=statSync(full);}catch(error){if(error.code==='ENOENT')return original;throw error;}
  if(!stat.isFile()||stat.size!==processed.output_bytes||processed.output_width!==3840||processed.output_height!==2160)return original;
  return{file,width:processed.output_width,height:processed.output_height,fps:processed.output_fps,duration:processed.output_duration,bytes:processed.output_bytes,rendition:'4k-upscale'};
}
function buildOfficial(rows){
  const bundles=new Map(),clips=[];
  for(const row of rows){
    const id=clipIdFor(row),media=officialMedia(row);
    const clip={id,name:row.action,...media};clips.push(clip);
    if(!bundles.has(row.cid))bundles.set(row.cid,{id:`official-${row.cid}`,cid:row.cid,name:`${row.char} · ${row.skin}`,operator:row.char,variant:row.skin,collection:row.type===1?'时装':'晋升立绘',kind:'dynamic',category:'operator',official:true,profession:row.profession,rarity:row.rarity,fit:'contain',focusX:50,focusY:50,...media,clips:[],bytes:0,duration:0,...(row.addedAt?{addedAt:row.addedAt}:{})});
    const bundle=bundles.get(row.cid);bundle.clips.push({...clip,order:row.original_path.split(/[\\/]/).at(-1)});bundle.bytes+=clip.bytes;bundle.duration+=clip.duration;
  }
  for(const bundle of bundles.values()){
    // Only three-action official skins share this initial framing. Explicit
    // saved compositions still take precedence over these catalog defaults.
    if(bundle.clips.length===3){bundle.defaultView={scale:1.8,x:30,y:50};bundle.defaultShade=.2;}
    bundle.clips.sort((a,b)=>a.order.localeCompare(b.order,'zh-CN',{numeric:true}));bundle.file=bundle.clips[0].file;
    for(const key of ['width','height','fps'])bundle[key]=bundle.clips[0][key];
    bundle.rendition=bundle.clips.every(clip=>clip.rendition==='4k-upscale')?'4k-upscale':bundle.clips.every(clip=>clip.rendition==='original')?'original':'mixed';
    bundle.clips=bundle.clips.map(({file,order,...clip})=>clip);
  }
  return {bundles:[...bundles.values()],clips};
}
const {bundles:officialBundles,clips:officialAssets}=buildOfficial(readManifest(officialFolder,'最终文件与校验.json'));
const welcome={id:'welcome',name:'初始工作空间',operator:'初始工作空间',variant:'内置背景',kind:'static',category:'background',role:'builtin',file:'public/assets/welcome.svg',width:1920,height:1080,rarity:0,profession:'',fit:'cover',focusX:50,focusY:50};
export const scenes = [...dynamic,...art,...backgrounds,...officialBundles,welcome];
const byId=new Map(scenes.map(scene=>[scene.id,scene]));
const assets=new Map([...scenes,...officialAssets].map(scene=>[scene.id,scene]));
export const sceneById = (id) => byId.get(id);
export const assetById = id=>assets.get(id);
// Adds catalog entries discovered after this snapshot. Existing ids are never
// replaced, so a bad update can only add items, not alter downloaded media.
export function extendCatalog(delta={}){
  for(const [key,value] of Object.entries(delta.files??{}))resourceCatalog.files[key]??=value;
  for(const [key,value] of Object.entries(delta.items??{}))resourceCatalog.items[key]??=value;
  const added=[];
  for(const record of delta.artRecords??[]){if(byId.has(artIdFor(record.path)))continue;try{const scene=artScene(record);scene.bounds=null;added.push(scene);}catch{}}
  const {bundles,clips}=buildOfficial((delta.officialRecords??[]).filter(row=>!byId.has(`official-${row.cid}`)));
  added.push(...bundles);
  scenes.splice(scenes.indexOf(welcome),0,...added);
  for(const scene of added){byId.set(scene.id,scene);assets.set(scene.id,scene);}
  for(const clip of clips)assets.set(clip.id,clip);
  return added.map(scene=>scene.id);
}
export const mediaPath = (id, poster = false) => {
  const scene = assetById(id);
  if (!scene) throw new Error('未知场景');
  if(scene.id==='welcome')return path.join(ROOT,welcome.file);
  if(scene.official&&poster)return path.join(ROOT,officialFolder,'资料与清单','预览',`${scene.cid}.jpg`);
  if (poster==='thumb') return scene.kind==='static'?path.join(ROOT,'.local','thumbnails',`${id}.webp`):path.join(ROOT,'.local','posters',`${id}.jpg`);
  if (poster && scene.kind==='dynamic')return path.join(ROOT,'.local','posters',`${id}.jpg`);
  const filename=path.join(ROOT,scene.file);
  return scene.legacyFile&&!existsSync(filename)?path.join(ROOT,scene.legacyFile):filename;
};
export const defaults = Object.freeze({ schemaVersion: 1, sceneId: 'yaoyue', strength: 0.9, blur: 0, shade: 0.2, panel: 0.24, composerOpacity: 0.45, composerBlur: 0, chromeBlur: 0, summaryBlur: 0, focusX: 50, focusY: 50, motion: true, mode: 'balanced', quality: 'original', wallpaper:null, savedWallpapers:[], playlists:[], lastQueueId:null, activePlaylistId:null, queueCursor:0, playbackPaused:false });
export function validateSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('配置必须是对象');
  const allowed = new Set(Object.keys(defaults));
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`未知配置项: ${key}`);
  const value = { ...defaults, ...input };
  if (value.schemaVersion !== 1 || !sceneById(value.sceneId)) throw new Error('主题版本或场景无效');
  const ranges = { strength: [0, 1], blur: [0, 24], shade: [0, 0.85], panel: [0, 1], composerOpacity: [0, 1], composerBlur: [0, 24], chromeBlur: [0, 24], summaryBlur: [0, 24], focusX: [0, 100], focusY: [0, 100] };
  for (const [key, [min, max]] of Object.entries(ranges)) {
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < min || value[key] > max) throw new Error(`${key} 超出允许范围`);
  }
  if (typeof value.motion !== 'boolean' || !['focus', 'balanced', 'immersive'].includes(value.mode) || !['original', 'still'].includes(value.quality)) throw new Error('显示模式无效');
  return {...value,...validateWallpaperState(value,sceneById)};
}
export function nativeFileUrl(filename) {
  // Matches the app://fs/@fs convention observed in the installed client's static code.
  // Runtime video support remains a separate integration gate.
  const normalized = filename.replaceAll('\\', '/');
  if (!/^[A-Za-z]:\//.test(normalized)) throw new Error('宿主原型目前只支持 Windows 本地文件');
  return `app://fs/@fs/${encodeURI(normalized).replaceAll('#', '%23').replaceAll('?', '%3F')}`;
}
