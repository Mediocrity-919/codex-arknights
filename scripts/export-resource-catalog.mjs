// Export public metadata only. Never copy user settings, sessions or media bytes.
import fs from 'node:fs/promises';
import path from 'node:path';
import {ROOT,scenes,mediaPath,assetById,resourceCatalog} from '../src/catalog.mjs';
const read=async(folder,name)=>JSON.parse((await fs.readFile(path.join(ROOT,folder,'资料与清单',name),'utf8')).replace(/^\uFEFF/,''));
const art=(await read('明日方舟_全干员与时装原图','原图来源与尺寸.json')).records;
const backgrounds=await read('明日方舟_首页背景与场景','图片来源与校验.json');
const complete=await read('明日方舟_活动与启动器背景','图片来源与校验.json');
const official=await read('明日方舟_官方动态皮肤全集','最终文件与校验.json');
const upscaled=await read('明日方舟_官方动态皮肤全集','4K视频处理结果.json');
const originalCatalog=await read('明日方舟_官方动态皮肤全集','官方完整目录.json');
const pick=(row,keys)=>Object.fromEntries(keys.filter(k=>row[k]!==undefined).map(k=>[k,row[k]]));
const metadata={artRecords:art.map(r=>pick(r,['path','label','profession','operator','rarity','variant','width','height','size'])),backgroundRecords:backgrounds.map(r=>pick(r,['path','label','name','width','height','bytes'])),completeRecords:complete.map(r=>pick(r,['path','label','name','width','height','bytes'])),officialRecords:official.map(r=>pick(r,['cid','char','skin','type','action','original_path','width','height','fps','duration','bytes','profession','rarity'])),upscaledRecords:upscaled.map(r=>pick(r,['cid','original_path','output_path','status','output_width','output_height','output_fps','output_duration','output_bytes'])),bounds:Object.fromEntries(scenes.filter(s=>s.bounds).map(s=>[s.id,s.bounds]))};
const files={},items={};
const slash=s=>s.replaceAll('\\','/');
function add(id,variant,r){files[id]??={};files[id][variant]={...r,file:slash(r.file)};}
for(const scene of scenes){
  const file=slash(path.relative(ROOT,mediaPath(scene.id))),poster=slash(path.relative(ROOT,mediaPath(scene.id,true)));
  let cover=null;
  if(scene.id.startsWith('art-')){const r=art.find(r=>slash(file).endsWith('/'+slash(r.path)));if(r){cover=r.url;add(scene.id,'original',{file,url:r.url,bytes:r.size,...(/^[0-9a-f]{40}$/i.test(r.sha1??'')?{sha1:r.sha1}:{})});}}
  else if(scene.kind==='static'){const r=[...backgrounds,...complete].find(r=>file.endsWith('/'+slash(r.path)));if(r){cover=r.url;add(scene.id,'original',{file,url:r.url,bytes:r.bytes,sha256:r.sha256});}}
  else if(scene.official){cover=originalCatalog.find(r=>String(r.cid)===String(scene.cid))?.content.illustSrc?.url;
    for(const clip of scene.clips){const asset=assetById(clip.id),r=official.find(r=>clip.id.startsWith(`clip-${r.cid}-`)&&slash(asset.file).endsWith('/'+slash(r.original_path).replace(/\.mp4$/, '_4k.mp4').replace(/^完整原片\//,'4K超分/')))||official.find(r=>clip.id.startsWith(`clip-${r.cid}-`)&&r.action===clip.name);if(!r)throw Error('Missing source '+clip.id);
      add(clip.id,'original',{file:'明日方舟_官方动态皮肤全集/'+slash(r.original_path),url:r.url,bytes:r.bytes,sha256:r.sha256,hls:/\.m3u8(?:\?|$)/i.test(r.url),width:r.width,height:r.height,fps:r.fps,duration:r.duration});
      const up=upscaled.find(u=>slash(u.original_path)===slash(r.original_path));
      const output=up?.output_path??('4K超分/'+slash(r.original_path).replace(/^完整原片\//,'').replace(/\.mp4$/,'_4k.mp4'));
      add(clip.id,'4k',{file:'明日方舟_官方动态皮肤全集/'+slash(output),bytes:up?.output_bytes,sha256:up?.output_sha256,generated:true,width:3840,height:2160,fps:r.fps,duration:r.duration});
    }
  }else{const previous=resourceCatalog.files[scene.id]?.original;cover=resourceCatalog.items[scene.id]?.cover??null;add(scene.id,'original',{...previous,file,bytes:scene.bytes,localOnly:!previous?.url,width:scene.width,height:scene.height,fps:scene.fps,duration:scene.duration});}
  items[scene.id]={assetIds:scene.clips?.map(c=>c.id)??[scene.id],poster,cover,source:scene.official?'https://ak.hypergryph.com/archive/dynamicCompile/'+scene.cid:scene.source==='PRTS'?'https://prts.wiki/':null};
}
const result={schemaVersion:1,snapshot:'2026-10-24',description:'来源目录快照；不含素材文件或用户数据。4K 为可选本机派生版本。',...metadata,files,items};
await fs.mkdir(path.join(ROOT,'resources'),{recursive:true});
await fs.writeFile(path.join(ROOT,'resources/catalog.json'),JSON.stringify(result));
console.log(JSON.stringify({scenes:Object.keys(items).length,assets:Object.keys(files).length,bytes:JSON.stringify(result).length}));
