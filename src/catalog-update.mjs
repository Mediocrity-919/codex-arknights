// Incremental catalog updates from the two public sources the snapshot was built from.
// Only metadata is fetched here; media still downloads on demand through the resource manager.
import fs from 'node:fs/promises';
import path from 'node:path';
import {validateSource} from './resource-manager.mjs';
import {configureDownloadNetwork} from './download-network.mjs';
import {professions,artIdFor,clipIdFor} from './catalog.mjs';

export const OFFICIAL_API='https://ak.hypergryph.com/api/archive/dynComp';
export const OFFICIAL_PAGE='https://ak.hypergryph.com/archive/dynamicCompile';
export const PRTS_API='https://prts.wiki/api.php';
export const INTERVALS={daily:864e5,weekly:6048e5,off:0};
const OFFICIAL_ROOT='明日方舟_官方动态皮肤全集',ART_ROOT='明日方舟_全干员与时装原图';
const LIMITS={officialPages:30,officialBundles:30,artPages:5,artImages:300,bytes:4*1024*1024,timeoutMs:30000};
const DEFAULT_CURSOR='2026-10-24T00:00:00Z';
const pad=n=>String(n).padStart(2,'0');
const safeName=value=>String(value).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').trim().replace(/^[. ]+|[. ]+$/g,'');
const text=(value,max)=>typeof value==='string'&&value.trim()&&value.length<=max&&!/[\x00-\x1f]/.test(value)?value.trim():null;
const int=(value,max)=>Number.isInteger(value)&&value>0&&value<=max?value:null;
const isoTime=value=>typeof value==='string'&&!Number.isNaN(Date.parse(value))?new Date(value).toISOString():null;
const field=(wikitext,key)=>new RegExp(`^\\|\\s*${key}\\s*=\\s*([^\\r\\n]*)`,'m').exec(wikitext)?.[1].trim()??'';

function emptyState(){return{schemaVersion:1,interval:'daily',lastCheck:null,lastSuccess:null,lastResult:null,artCursor:DEFAULT_CURSOR,officialRecords:[],artRecords:[],files:{},items:{}};}

// Parse one official archive entry into catalog rows. Anything unexpected drops the entry.
export function officialEntry(raw,meta,addedAt){
  const cid=/^\d{1,9}$/.test(String(raw?.cid))?String(raw.cid):null,c=raw?.content;
  if(!cid||!c||![0,1].includes(c.type)||!Array.isArray(c.actions)||!c.actions.length||c.actions.length>8)return null;
  const char=text(c.charName,40),skin=c.type===1?text(c.suitName,60):'晋升动态立绘';
  if(!char||!skin||!meta||!professions.includes(meta.profession)||!int(meta.rarity,6))return null;
  const folder=['完整原片',c.type===1?'01_动态时装':'02_晋升动态立绘',`${pad(professions.indexOf(meta.profession)+1)}_${meta.profession}`,`${pad(7-meta.rarity)}_${meta.rarity}星_${safeName(char)}`,safeName(skin)];
  const rows=[],files={};
  for(const [index,action] of c.actions.entries()){
    const name=text(action?.name,30),r=action?.resource;if(!name||!r)return null;
    let url;try{url=validateSource(r.url).href;}catch{return null;}
    const hls=/\.m3u8$/i.test(new URL(url).pathname);if(!hls&&!/\.mp4$/i.test(new URL(url).pathname))return null;
    const bytes=int(r.size,2*1024**3),width=int(r.width,8192),height=int(r.height,8192),duration=typeof r.duration==='number'&&r.duration>0&&r.duration<=900?r.duration:null;
    if(!width||!height||!duration||!hls&&!bytes)return null;
    const original_path=[...folder,`${pad(index+1)}_${safeName(name)}.mp4`].join('\\');
    // The archive does not publish frame rates; 30 is replaced by the measured value after download.
    const row={cid,char,skin,type:c.type,action:name,original_path,width,height,fps:30,fpsEstimated:true,duration,bytes:bytes??0,profession:meta.profession,rarity:meta.rarity,addedAt};
    const rel=original_path.replaceAll('\\','/');
    files[clipIdFor(row)]={original:{file:`${OFFICIAL_ROOT}/${rel}`,url,...(bytes?{bytes}:{}),hls,width,height,fps:30,fpsEstimated:true,duration},
      '4k':{file:`${OFFICIAL_ROOT}/4K超分/${rel.replace(/^完整原片\//,'').replace(/\.mp4$/,'_4k.mp4')}`,generated:true,width:3840,height:2160,fps:30,duration}};
    rows.push(row);
  }
  let cover=null;for(const src of [c.illustSrc?.url,c.portraitSrc?.url]){try{if(src){cover=validateSource(src).href;break;}}catch{}}
  const item={assetIds:Object.keys(files),poster:`${OFFICIAL_ROOT}/资料与清单/预览/${cid}.jpg`,cover,source:`${OFFICIAL_PAGE}/${cid}`};
  return{cid,char,rows,files,item};
}

// Parse one PRTS "立绘_<operator>_<variant>.png" upload into an art record.
export function artEntry(image,meta,addedAt){
  const m=/^立绘_(.+)_(1|2|skin(\d+))\.png$/.exec(image?.name??'');if(!m||image.mime!=='image/png')return null;
  if(!meta||!professions.includes(meta.profession)||!int(meta.rarity,6))return null;
  let label;if(m[2]==='1')label='01_默认立绘';else if(m[2]==='2')label='02_精英二立绘';
  else{const skin=text(meta.skins?.[m[3]],60);if(!skin)return null;label=`03_时装${pad(Number(m[3]))}_${safeName(skin)}`;}
  let url;try{url=validateSource(image.url).href;}catch{return null;}
  const width=int(image.width,8192),height=int(image.height,8192),size=int(image.size,64*1024**2),sha1=/^[0-9a-f]{40}$/.test(image.sha1??'')?image.sha1:null;
  if(!width||!height||!size)return null;
  const operator=meta.name,record={path:`${pad(professions.indexOf(meta.profession)+1)}_${meta.profession}/${pad(7-meta.rarity)}_${meta.rarity}星_${safeName(operator)}/${safeName(label)}.png`,label,profession:meta.profession,operator,rarity:meta.rarity,variant:m[2],width,height,size,addedAt};
  const id=artIdFor(record.path),file=`${ART_ROOT}/${record.path}`;
  return{id,record,files:{[id]:{original:{file,url,bytes:size,...(sha1?{sha1}:{})}}},item:{assetIds:[id],poster:file,cover:url,source:'https://prts.wiki/'}};
}

// What the running catalog already has: scene ids plus operator profession/rarity.
export function knownFromScenes(scenes){
  const operators=new Map();
  for(const s of scenes)if(s.category==='operator'&&s.operator&&professions.includes(s.profession)&&s.rarity&&!operators.has(s.operator))operators.set(s.operator,{name:s.operator,profession:s.profession,rarity:s.rarity});
  return{ids:new Set(scenes.map(s=>s.id)),operators};
}

export async function createCatalogUpdater({stateDir,fetcher,known,apply,onChange=()=>{},now=()=>Date.now(),startDelayMs=20000}){
  fetcher??=async(url,options)=>{await configureDownloadNetwork();return fetch(url,options);};
  const file=path.join(stateDir,'catalog-updates.json');let data=emptyState(),revision=0,running=null,timer=null,closed=false;
  try{const stored=JSON.parse(await fs.readFile(file,'utf8'));if(stored?.schemaVersion===1)data={...data,...stored,interval:INTERVALS[stored.interval]!==undefined?stored.interval:'daily'};}catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}
  let writes=Promise.resolve();
  async function save(){const snapshot=JSON.stringify(data);writes=writes.catch(()=>{}).then(async()=>{await fs.mkdir(stateDir,{recursive:true});await fs.writeFile(file+'.tmp',snapshot);await fs.rename(file+'.tmp',file);});return writes;}
  function changed(){revision++;onChange(revision);}
  async function getJson(url){
    const r=await fetcher(url,{headers:{'User-Agent':'ArkWorkspace/0.12 (catalog update check; low frequency)',Accept:'application/json'},redirect:'follow',signal:AbortSignal.timeout(LIMITS.timeoutMs)});
    if(!r.ok)throw Error(`来源返回 ${r.status}`);
    const length=Number(r.headers.get('content-length')??0);if(length>LIMITS.bytes){await r.body?.cancel();throw Error('来源响应过大');}
    const body=await r.text();if(body.length>LIMITS.bytes)throw Error('来源响应过大');return JSON.parse(body);
  }
  // Reads 职业/稀有度/时装名称 from operator pages; local values stay when a page is missing.
  async function operatorMeta(names,cache){
    const missing=[...new Set(names)].filter(n=>!cache.get(n)?.skins&&!tried.has(n));for(const n of missing)tried.add(n);
    for(let i=0;i<missing.length;i+=30){
      const batch=missing.slice(i,i+30),q=new URLSearchParams({action:'query',format:'json',prop:'revisions',rvprop:'content',rvslots:'main',redirects:'1',titles:batch.join('|')});
      const d=await getJson(`${PRTS_API}?${q}`),pages=Object.values(d?.query?.pages??{});
      const alias=new Map((d?.query?.redirects??[]).map(r=>[r.to,r.from]));
      for(const page of pages){
        const wikitext=page?.revisions?.[0]?.slots?.main?.['*']??'';if(!wikitext)continue;
        const rarity=field(wikitext,'稀有度'),title=alias.get(page.title)??page.title;
        const next={name:title,profession:field(wikitext,'职业'),rarity:/^\d$/.test(rarity)?Number(rarity)+1:null,skins:Object.fromEntries([...wikitext.matchAll(/^\|时装(\d+)名称\s*=\s*([^\r\n]*)/gm)].map(m=>[m[1],m[2].trim()]))};
        const prev=cache.get(title);cache.set(title,professions.includes(next.profession)&&next.rarity||!prev?next:{...prev,skins:next.skins});
      }
      for(const n of batch)if(!cache.has(n))cache.set(n,null);
    }
  }
  let tried=new Set();
  async function collect(){
    tried=new Set();const k=known(),stamp=new Date(now()).toISOString(),meta=new Map(),delta={officialRecords:[],artRecords:[],files:{},items:{}};let skipped=0;
    // Official archive: newest first, stop at the first page without anything new.
    const fresh=[];
    for(let page=1;page<=LIMITS.officialPages;page++){
      const d=await getJson(`${OFFICIAL_API}?type=&page=${page}`);if(d?.code!==0||!Array.isArray(d?.data?.list))throw Error('官方目录格式已变化');
      const list=d.data.list.filter(r=>!k.ids.has(`official-${r?.cid}`)&&!fresh.some(f=>String(f.cid)===String(r?.cid)));fresh.push(...list);
      if(d.data.end||!d.data.list.length||!list.length||fresh.length>=LIMITS.officialBundles)break;
    }
    for(const [name,value] of k.operators)meta.set(name,value);
    await operatorMeta(fresh.map(r=>text(r?.content?.charName,40)).filter(n=>n&&!meta.get(n)),meta);
    for(const raw of fresh.slice(0,LIMITS.officialBundles)){
      const entry=officialEntry(raw,meta.get(text(raw?.content?.charName,40)),stamp);if(!entry){skipped++;continue;}
      delta.officialRecords.push(...entry.rows);Object.assign(delta.files,entry.files);delta.items[`official-${entry.cid}`]=entry.item;
    }
    // PRTS uploads since the last successful check, oldest first.
    let images=[],cont={},cursor=data.artCursor||DEFAULT_CURSOR;
    for(let page=0;page<LIMITS.artPages;page++){
      const q=new URLSearchParams({action:'query',format:'json',list:'allimages',aisort:'timestamp',aidir:'newer',aistart:cursor,ailimit:'100',aiprop:'url|size|sha1|timestamp|mime',...cont});
      const d=await getJson(`${PRTS_API}?${q}`);if(!Array.isArray(d?.query?.allimages))throw Error('PRTS 目录格式已变化');
      images.push(...d.query.allimages);if(!d.continue||images.length>=LIMITS.artImages)break;cont=d.continue;
    }
    images=images.slice(0,LIMITS.artImages);
    const art=images.filter(i=>/^立绘_.+_(1|2|skin\d+)\.png$/.test(i?.name??''));
    const titleOf=i=>/^立绘_(.+)_(?:1|2|skin\d+)\.png$/.exec(i.name)[1].replaceAll('_',' ');
    // Skin names live on the operator page, so skins always need a page lookup.
    await operatorMeta(art.filter(i=>!meta.get(titleOf(i))?.skins&&(/_skin\d+\.png$/.test(i.name)||!meta.get(titleOf(i)))).map(titleOf),meta);
    for(const image of art){
      const entry=artEntry(image,meta.get(titleOf(image)),stamp);if(!entry){skipped++;continue;}
      if(k.ids.has(entry.id)||delta.artRecords.some(r=>r.path===entry.record.path))continue;
      delta.artRecords.push(entry.record);Object.assign(delta.files,entry.files);delta.items[entry.id]=entry.item;
    }
    const last=images.map(i=>isoTime(i?.timestamp)).filter(Boolean).sort().at(-1);
    return{delta,skipped,cursor:last&&last>cursor?last:cursor};
  }
  async function check(){
    if(running)return running;
    running=(async()=>{
      data.lastCheck=new Date(now()).toISOString();changed();
      try{
        const {delta,skipped,cursor}=await collect();
        const ids=delta.officialRecords.length||delta.artRecords.length?apply(delta):[];
        data.officialRecords.push(...delta.officialRecords);data.artRecords.push(...delta.artRecords);Object.assign(data.files,delta.files);Object.assign(data.items,delta.items);
        data.artCursor=cursor;data.lastSuccess=data.lastCheck;
        const dynamic=ids.filter(id=>id.startsWith('official-')).length,stills=ids.length-dynamic;
        data.lastResult={ok:true,added:ids,message:ids.length?`新增 ${dynamic?`${dynamic} 套动态皮肤`:''}${dynamic&&stills?'、':''}${stills?`${stills} 张立绘`:''}`:'已是最新',skipped};
      }catch(error){
        data.lastResult={ok:false,added:[],message:error.name==='TimeoutError'?'检查超时，稍后会自动重试':error.message==='fetch failed'?'无法连接来源网站，稍后会自动重试':`检查未完成：${error.message}`};
      }finally{await save();running=null;changed();}
      return publicState();
    })();
    return running;
  }
  function due(){const span=INTERVALS[data.interval];if(!span)return false;const last=Date.parse(data.lastSuccess??'');return !Number.isFinite(last)||now()-last>=span;}
  function schedule(delay=startDelayMs){clearTimeout(timer);if(closed)return;timer=setTimeout(async()=>{if(due())await check().catch(()=>{});schedule(36e5);},delay);timer.unref?.();}
  function publicState(){return{interval:data.interval,lastCheck:data.lastCheck,lastSuccess:data.lastSuccess,lastResult:data.lastResult,running:!!running,added:Object.keys(data.items).length};}
  async function action(name,payload={}){
    if(name==='updates-check'){void check();return publicState();}
    if(name==='updates-settings'){if(INTERVALS[payload.interval]===undefined)throw Error('检查频率无效');data.interval=payload.interval;await save();changed();schedule();return publicState();}
    throw Error('未知更新操作');
  }
  return{
    // Entries saved by earlier checks; applied before settings are validated.
    stored:()=>({officialRecords:data.officialRecords,artRecords:data.artRecords,files:data.files,items:data.items}),
    check,schedule,due,action,publicState,get revision(){return revision;},
    async close(){closed=true;clearTimeout(timer);await running?.catch(()=>{});await writes.catch(()=>{});}
  };
}
