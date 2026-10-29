import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {officialEntry,artEntry,createCatalogUpdater,knownFromScenes,OFFICIAL_API,PRTS_API} from '../src/catalog-update.mjs';
import {scenes,sceneById,extendCatalog,resourceCatalog,clipIdFor} from '../src/catalog.mjs';
import {createResourceManager} from '../src/resource-manager.mjs';
import {startServer} from '../src/server.mjs';

const tmp=prefix=>fs.mkdtemp(path.join(os.tmpdir(),prefix));
const action=(name,i,host='web.hycdn.cn')=>({name,resource:{url:`https://${host}/upload/video/20261101/${i}.mp4`,size:1000+i,width:1920,height:1080,duration:10+i}});
const official=(cid,char,suit,actions,type=1)=>({cid,name:`${char}-${suit}`,content:{type,charName:char,suitName:suit,actions,illustSrc:{url:`https://web.hycdn.cn/upload/image/${cid}.png`},displayTime:'2026-11-01T00:00:00Z'}});
const meta={name:'测试干员',profession:'术师',rarity:6,skins:{'1':'星夜'}};
const wikitext='{{干员信息\n|职业=术师\n|稀有度=4\n|时装1名称=星夜\n}}';

function fakeSources({officialPages,images=[],pages={},fail=false}){
  const calls=[];
  const fetcher=async url=>{calls.push(url);if(fail)throw new TypeError('fetch failed');const u=new URL(url);
    let body;
    if(url.startsWith(OFFICIAL_API)){const page=Number(u.searchParams.get('page'));body={code:0,data:{list:officialPages[page-1]??[],end:page>=officialPages.length,total:0}};}
    else if(url.startsWith(PRTS_API)&&u.searchParams.get('list')==='allimages')body={query:{allimages:images}};
    else if(url.startsWith(PRTS_API)){const titles=u.searchParams.get('titles').split('|');body={query:{pages:Object.fromEntries(titles.map((t,i)=>[i,pages[t]?{title:t,revisions:[{slots:{main:{'*':pages[t]}}}]}:{title:t,missing:''}]))}};}
    else throw Error('unexpected '+url);
    return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});};
  return{fetcher,calls};
}

test('official entries map to the existing folder layout and reject unsafe or incomplete data',()=>{
  const e=officialEntry(official('900001','测试干员','星夜',[action('入场',1),action('形态一',2)]),meta,'2026-11-01T00:00:00.000Z');
  assert.equal(e.rows.length,2);
  assert.equal(e.rows[0].original_path,'完整原片\\01_动态时装\\05_术师\\01_6星_测试干员\\星夜\\01_入场.mp4');
  const id=clipIdFor(e.rows[0]);assert.deepEqual(e.item.assetIds,[id,clipIdFor(e.rows[1])]);
  assert.equal(e.files[id].original.file,'明日方舟_官方动态皮肤全集/完整原片/01_动态时装/05_术师/01_6星_测试干员/星夜/01_入场.mp4');
  assert.equal(e.files[id]['4k'].file,'明日方舟_官方动态皮肤全集/4K超分/01_动态时装/05_术师/01_6星_测试干员/星夜/01_入场_4k.mp4');
  assert.equal(e.files[id].original.fpsEstimated,true);
  assert.equal(officialEntry(official('900002','测试干员','晋升',[action('标准',1)],0),meta,'x').rows[0].skin,'晋升动态立绘');
  assert.equal(officialEntry(official('900003','测试干员','星夜',[action('入场',1,'evil.example')]),meta,'x'),null,'unknown media host');
  assert.equal(officialEntry(official('900004','测试干员','星夜',[action('入场',1)]),{...meta,profession:'不存在'},'x'),null,'unknown profession');
  assert.equal(officialEntry(official('../1','测试干员','星夜',[action('入场',1)]),meta,'x'),null,'bad id');
  assert.equal(officialEntry(official('900005','测试/干员','星夜',[action('入',1)]),meta,'x')?.rows[0].original_path.includes('测试_干员'),true,'path characters are neutralised');
});

test('PRTS uploads become art records with the original naming rules',()=>{
  const image=(name,extra={})=>({name,mime:'image/png',url:'https://media.prts.wiki/a/b/x.png',width:2048,height:2048,size:12345,sha1:'a'.repeat(40),timestamp:'2026-11-01T00:00:00Z',...extra});
  assert.equal(artEntry(image('立绘_测试干员_1.png'),meta,'t').record.path,'05_术师/01_6星_测试干员/01_默认立绘.png');
  assert.equal(artEntry(image('立绘_测试干员_2.png'),meta,'t').record.label,'02_精英二立绘');
  assert.equal(artEntry(image('立绘_测试干员_skin1.png'),meta,'t').record.path,'05_术师/01_6星_测试干员/03_时装01_星夜.png');
  assert.equal(artEntry(image('立绘_测试干员_skin2.png'),meta,'t'),null,'skin without a name');
  assert.equal(artEntry(image('立绘_测试干员_1.png',{url:'https://evil.example/x.png'}),meta,'t'),null);
  assert.equal(artEntry(image('头像_测试干员.png'),meta,'t'),null);
});

test('update checks add only new entries, stop paging early and persist for the next start',async()=>{
  const dir=await tmp('ark-update-'),known=official('5600','黍','源远流长',[action('标准动作',9)]);
  const {fetcher,calls}=fakeSources({officialPages:[[official('900010','测试干员','星夜',[action('入场',1)]),known],[known],[official('1','不应读取','x',[action('a',1)])]],
    images:[{name:'立绘_测试干员_skin1.png',mime:'image/png',url:'https://media.prts.wiki/a/b/c.png',width:2048,height:2048,size:999,sha1:'b'.repeat(40),timestamp:'2026-11-02T03:04:05Z'}],pages:{'测试干员':wikitext}});
  let applied=null;
  const updater=await createCatalogUpdater({stateDir:dir,fetcher,known:()=>knownFromScenes(scenes),apply:d=>{applied=d;return Object.keys(d.items);},now:()=>Date.parse('2026-11-02T10:00:00Z')});
  const state=await updater.check();
  assert.equal(calls.filter(u=>u.startsWith(OFFICIAL_API)).length,2,'second page had nothing new, so paging stops');
  assert.equal(state.lastResult.ok,true);assert.match(state.lastResult.message,/1 套动态皮肤、1 张立绘/);
  assert.deepEqual(applied.officialRecords.map(r=>r.cid),['900010']);
  assert.equal(applied.officialRecords[0].rarity,5,'rarity comes from the operator page');
  assert.equal(applied.artRecords[0].label,'03_时装01_星夜');
  const saved=JSON.parse(await fs.readFile(path.join(dir,'catalog-updates.json'),'utf8'));
  assert.equal(saved.artCursor,'2026-11-02T03:04:05.000Z');assert.equal(saved.officialRecords.length,1);
  const again=await createCatalogUpdater({stateDir:dir,fetcher,known:()=>knownFromScenes(scenes),apply:()=>[],now:()=>Date.parse('2026-11-02T12:00:00Z')});
  assert.equal(again.stored().artRecords.length,1);assert.equal(again.due(),false,'daily check already done');
  await again.action('updates-settings',{interval:'off'});assert.equal(again.due(),false);
  await assert.rejects(again.action('updates-settings',{interval:'hourly'}),/频率/);
});

test('failed checks keep the catalog unchanged and stay due',async()=>{
  const dir=await tmp('ark-update-fail-'),{fetcher}=fakeSources({officialPages:[],fail:true});let applied=false;
  const updater=await createCatalogUpdater({stateDir:dir,fetcher,known:()=>knownFromScenes(scenes),apply:()=>{applied=true;return[];}});
  const state=await updater.check();
  assert.equal(state.lastResult.ok,false);assert.match(state.lastResult.message,/无法连接/);assert.equal(applied,false);assert.equal(updater.due(),true);
  const broken=fakeSources({officialPages:[[{cid:'1'}]]});broken.fetcher=async()=>new Response('{"code":1}',{status:200});
  const second=await createCatalogUpdater({stateDir:await tmp('ark-update-format-'),fetcher:broken.fetcher,known:()=>knownFromScenes(scenes),apply:()=>[]});
  assert.match((await second.check()).lastResult.message,/格式已变化/);
});

test('extended catalog entries are downloadable, idempotent and never replace existing items',async()=>{
  const e=officialEntry(official('900020','测试干员','星夜',[action('入场',1),action('形态一',2)]),meta,'2026-11-01T00:00:00.000Z');
  const before=scenes.length,existing=resourceCatalog.files[Object.keys(resourceCatalog.files)[0]];
  const ids=extendCatalog({officialRecords:e.rows,files:{...e.files,[Object.keys(resourceCatalog.files)[0]]:{original:{url:'https://web.hycdn.cn/replaced.mp4'}}},items:{'official-900020':e.item}});
  assert.deepEqual(ids,['official-900020']);assert.equal(scenes.length,before+1);assert.equal(scenes.at(-1).id,'welcome');
  assert.equal(resourceCatalog.files[Object.keys(resourceCatalog.files)[0]],existing,'existing files are untouched');
  assert.deepEqual(extendCatalog({officialRecords:e.rows,files:e.files,items:{'official-900020':e.item}}),[],'second apply adds nothing');
  const scene=sceneById('official-900020');assert.equal(scene.clips.length,2);assert.equal(scene.addedAt,'2026-11-01T00:00:00.000Z');assert.equal(scene.profession,'术师');
  const dir=await tmp('ark-update-res-'),clip=scene.clips[0].id;
  await fs.writeFile(path.join(dir,'resources.json'),JSON.stringify({receipts:{[`${clip}:original`]:{bytes:1,fps:25}}}));
  const resources=await createResourceManager({root:path.resolve(import.meta.dirname,'..'),stateDir:dir,catalog:resourceCatalog,scenes});
  const status=resources.status('official-900020');assert.equal(status.downloadable,true);assert.equal(status.canUpscale,true);
  assert.equal(resourceCatalog.files[clip].original.fps,25,'measured frame rate replaces the estimate');assert.equal(resourceCatalog.files[clip]['4k'].fps,25);
  await resources.close();
});

test('service applies stored updates at start and manual checks publish new scenes',async()=>{
  const dir=await tmp('ark-update-server-'),e=officialEntry(official('900030','测试干员','旧存',[action('入场',3)]),meta,'2026-10-30T00:00:00.000Z');
  await fs.writeFile(path.join(dir,'catalog-updates.json'),JSON.stringify({schemaVersion:1,interval:'weekly',officialRecords:e.rows,artRecords:[],files:e.files,items:{'official-900030':e.item}}));
  const {fetcher}=fakeSources({officialPages:[[official('900031','测试干员','新到',[action('入场',4)])]],pages:{'测试干员':wikitext}});
  const lab=await startServer({stateDir:dir,probeHost:async()=>({debuggerVerified:false}),updateFetcher:fetcher});
  try{
    const api=async(p,body)=>(await fetch(`${lab.origin}/api/${p}`,{method:body?'POST':'GET',headers:{'x-lab-token':lab.token,...(body?{'content-type':'application/json',origin:lab.origin}:{})},body:body&&JSON.stringify(body)})).json();
    let state=await api('state');assert.ok(state.scenes.some(s=>s.id==='official-900030'),'stored update is loaded');assert.equal(state.resources.updates.interval,'weekly');
    const revision=state.resources.revision;await api('resources',{action:'updates-check',payload:{}});
    const start=Date.now();while(!(state=await api('state')).scenes.some(s=>s.id==='official-900031')){if(Date.now()-start>5000)throw Error('update not applied');await new Promise(r=>setTimeout(r,30));}
    assert.notEqual(state.resources.revision,revision,'hosts see a new revision');assert.equal(state.resources.updates.lastResult.ok,true);
    assert.equal(state.scenes.find(s=>s.id==='official-900031').resource.downloadable,true);
  }finally{await lab.close();}
});
