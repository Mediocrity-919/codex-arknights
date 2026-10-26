import { installBoot } from './boot.js';
import { createMediaDeck } from './media-player.js';
import { createWallpaperPlayer } from './wallpaper-runtime.js';
import { createWallpaperLibrary } from './wallpaper-library.js';
const $ = (s) => document.querySelector(s);
const token = location.hash.slice(1) || sessionStorage.getItem('ark-lab-session');
if (token) sessionStorage.setItem('ark-lab-session', token);
history.replaceState(null, '', location.pathname);
let state, saveTimer, toastTimer, saving = Promise.resolve(), lastFrame = null, frameRequest = null, sceneSerial = 0;
let refreshTimer, library;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
$('#scene-video').remove();$('#scene-poster').remove();
const deckContainer=document.createElement('div');Object.assign(deckContainer.style,{position:'absolute',inset:'0'});$('#stage').prepend(deckContainer);
let video,deck;
const onMediaState=change=>{
  if(change.queueEnded&&state?.settings.activePlaylistId){state.settings.playbackPaused=true;library?.update(state.settings.sceneId,state.settings);queueSave();}
  const index=deck.diagnostics().activeSlot??0;
  const next=deckContainer.querySelectorAll('video')[index];
  if(video!==next){if(video)video.removeAttribute('id');video=next;video.id='scene-video';}
  $('#playback-status').textContent=change.error?'新场景未能加载，保留当前画面':change.loading?'正在预载新场景…':change.transitioning?'场景柔和过渡中':deck.diagnostics().enabled?'动态播放 · 循环缓冲已启用':'画面已暂停';
  if(change.committed&&state?.settings.activePlaylistId){state.settings.sceneId=change.sceneId;state.settings.queueCursor=change.entryIndex;library?.update(change.sceneId,state.settings);queueSave();}
};
const mediaUrl = (id, kind) => `/media/${id}/${kind}?key=${encodeURIComponent(token ?? '')}`;
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 6000); }
async function api(route, body) {
  const response = await fetch(`/api/${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-Lab-Token': token ?? '', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || '操作失败'); return result;
}
function showTab(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === name));
  document.querySelectorAll('[data-tab]').forEach(n => n.classList.toggle('active', n.dataset.tab === name));
  $('#page-name').textContent = { scenes: '场景实验室', startup: '唤醒动效', integration: '接入与恢复' }[name];
  syncMotion();
}
function queueSave() {
  clearTimeout(saveTimer); $('#save-state').textContent = '正在保存…';
  saveTimer = setTimeout(() => { persist().catch(error => toast(error.message)); }, 350);
}
function persist() {
  clearTimeout(saveTimer); const value = { ...state.settings };
  saving = saving.catch(() => {}).then(async () => { await api('settings', value); $('#save-state').textContent = '已保存在本机'; });
  return saving;
}
const scales = { strength: 100, shade: 100, panel: 100, composerOpacity: 100, composerBlur: 1, chromeBlur: 1, summaryBlur: 1, blur: 1, focusX: 1, focusY: 1 };
function renderSettings() {
  const s = state.settings, stage = $('#stage');
  for (const [key, factor] of Object.entries(scales)) { $(`#${key}`).value = Math.round((key === "panel" || key === "composerOpacity" ? 1 - s[key] : s[key]) * factor); $(`output[for=${key}]`).value = `${Math.round((key === "panel" || key === "composerOpacity" ? 1 - s[key] : s[key]) * factor)}${key === 'blur' || key.endsWith('Blur') ? ' px' : '%'}`; }
  stage.style.setProperty('--strength', s.strength); stage.style.setProperty('--blur', `${s.blur}px`); stage.style.setProperty('--shade', s.shade); stage.style.setProperty('--panel', s.panel); stage.style.setProperty('--composer', s.composerOpacity); stage.style.setProperty('--composer-blur', `${s.composerBlur}px`); stage.style.setProperty('--focus', `${s.focusX}% ${s.focusY}%`);
  deck.setPresentation(s);
  $('#quality').value = s.quality;
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('selected', b.dataset.mode === s.mode));
  $('#motion-toggle').textContent = s.motion ? '暂停动态 Ⅱ' : '播放动态 ▷';
  syncMotion();
}
function syncMotion() {
  if (!state) return;
  const s = state.settings;
  const enabled = s.motion && !s.playbackPaused && s.quality === 'original' && s.mode !== 'focus' && !document.hidden && $('#scenes').classList.contains('active') && !reduced.matches && !$('#boot-dialog').open;
  deck.setEnabled(enabled);
  if(!enabled)$('#playback-status').textContent=reduced.matches?'系统减少动态效果 · 静态画面':'画面已暂停';
}
function selectScene(id,options) {
  const scene = state.scenes.find(s => s.id === id); if (!scene) return;
  sceneSerial++; lastFrame = null;
  const loading=deck.update(state.settings,options).catch(error=>{toast(error.message);return false;});
  $('#scene-title').textContent = scene.name; $('#scene-subtitle').textContent = scene.subtitle??scene.variant??''; $('#scene-tag').textContent = scene.tag??'';
  $('#playback-status').textContent = '正在加载本地原片…';
  document.querySelectorAll('.scene-choice').forEach(button => {
    const active = button.dataset.id === id; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    button.querySelector('.chosen').hidden = !active;
  }); renderSettings();return loading;
}
function buildCatalog() {
  for (const scene of state.scenes.filter(s=>s.kind==='dynamic'&&!s.official)) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'scene-choice'; button.dataset.id = scene.id;
    button.setAttribute('aria-label', `选择${scene.name}`);
    const img = new Image(); img.src = mediaUrl(scene.id, 'poster'); img.alt = ''; img.loading = 'lazy';
    const title = document.createElement('strong'); title.textContent = scene.name;
    const info = document.createElement('small'); info.textContent = `${scene.fps} FPS · ${(scene.bytes/1000000).toFixed(0)} MB`;
    const check = document.createElement('span'); check.className = 'chosen'; check.textContent = '✓'; check.hidden = true;
    button.append(img, title, info, check); button.disabled = !scene.available;
    button.addEventListener('click', () => { Object.assign(state.settings, { sceneId: scene.id, wallpaper:null,activePlaylistId:null, focusX: scene.focusX, focusY: scene.focusY, shade: scene.shade }); selectScene(scene.id); queueSave(); });
    $('#scene-list').append(button);
  }
}
function renderHost(host, native = state.native) {
  $('#host-version').textContent = host.version || '未读取'; $('#host-reason').textContent = host.reason;
  $('#host-debug').textContent = host.debuggerVerified ? '已验证本机进程归属' : '尚未接入';
  $('#host-badge').textContent = host.debuggerVerified ? '可验证' : host.version ? '待重新启动' : '待检测';
  $('#native-state').textContent = native?.applied ? native.media === 'video' ? '视频播放中 · 待人工验收' : `静态探针${native.error ? ' · 视频回退' : ' · 待人工验收'}` : '未应用';
  $('#restore').disabled = !native?.applied;
}
async function probe() {
  const button = $('#probe'); button.disabled = true; button.textContent = '正在检测…';
  try {
    const result = await api('probe', {}); state.host = result.host; renderHost(state.host);
    $('#target').replaceChildren();
    for (const target of result.targets) { const option = new Option(target.label, target.id); $('#target').append(option); }
    if (!result.targets.length) $('#target').append(new Option('尚未发现已验证的主窗口', ''));
    $('#target').disabled = result.targets.length === 0;
    $('#apply-poster').disabled = $('#apply-video').disabled = result.targets.length === 0;
    toast(result.targets.length ? '发现可验证窗口，建议先应用静态探针' : result.host.reason);
  } finally { button.disabled = false; button.textContent = '检测 Codex ↻'; }
}
async function nativeAction(action, media) {
  await persist();
  const buttons = [$('#apply-poster'), $('#apply-video'), $('#restore')]; buttons.forEach(b => b.disabled = true);
  try {
    const result = await api('native', { action, media, targetId: $('#target').value });
    if (action === 'remove' && !result.restored) toast(result.reason);
    else toast(action === 'remove' ? '已确认本次视觉层移除' : '视觉层已建立。请在 Codex 中检查画面、输入与审阅，再测试恢复。');
  } finally {
    const current = await api('state'); state.native = current.native; renderHost(current.host, current.native);
    $('#apply-poster').disabled = $('#apply-video').disabled = !$('#target').value;
  }
}

try {
  state = await api('state');
  const makeCatalog=list=>list.map(s=>{const suffix=`&variant=${s.resource?.selected==='original'?'original':s.resource?.upscaled?'4k':'original'}`,posterVersion=`&ready=${s.posterAvailable?1:0}-${s.available?1:0}`;return{...s,sequence:s.sequence?{...s.sequence,video:`/media/cache/${s.sequence.key}?key=${encodeURIComponent(token)}`}:null,video:s.kind==='dynamic'?mediaUrl(s.id,'video')+suffix:null,poster:mediaUrl(s.id,'poster')+posterVersion,thumb:mediaUrl(s.id,'thumb')+posterVersion,clips:s.clips?.map(c=>({...c,video:mediaUrl(c.id,'video')+suffix}))};});
  const catalog=makeCatalog(state.scenes);
  deck=createWallpaperPlayer(deckContainer,{catalog,onState:onMediaState},createMediaDeck);
  video=deckContainer.querySelector('video');video.id='scene-video';
  buildCatalog();selectScene(state.settings.sceneId);renderHost(state.host);
  const libraryHost=document.createElement('div');libraryHost.id='wallpaper-library';document.body.append(libraryHost);
  async function applyChanges(patch,options){
    const previous=structuredClone(state.settings);Object.assign(state.settings,patch);
    try{if(!await selectScene(state.settings.sceneId,options))throw Error('加载失败，保留当前壁纸');await persist();library?.update(state.settings.sceneId,state.settings);return true;}
    catch(error){state.settings=previous;await selectScene(previous.sceneId);toast(error.message);return false;}
  }
  async function refreshResources(){const current=await api('state'),changed=current.resources.revision!==state.resources?.revision;state.resources=current.resources;state.scenes=current.scenes;const next=changed?makeCatalog(current.scenes):null;library?.resources(current.resources,next);if(next)await deck.setCatalog(next);return current;}
  library=createWallpaperLibrary(libraryHost,{scenes:catalog,resources:state.resources,onResource:async(action,payload)=>{const value=await api('resources',{action,payload});await refreshResources();return value;},selectedId:state.settings.sceneId,settings:state.settings,createMediaDeck,createWallpaperPlayer,onChange:applyChanges,onJump:d=>deck.jump(d),onPreviewOnly:enabled=>document.body.classList.toggle('preview-wallpaper-only',enabled),onApply:async(id,wallpaper)=>{const scene=state.scenes.find(s=>s.id===id);return applyChanges({sceneId:id,wallpaper:wallpaper??null,activePlaylistId:null,playbackPaused:false,focusX:scene.focusX,focusY:scene.focusY,...(scene.defaultShade!=null?{shade:scene.defaultShade}:{})});}});
  document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {library.hide();showTab(b.dataset.tab);}));
  $('#theme-open').textContent='◈ 壁纸库';$('#theme-open').onclick = () => {library.update(state.settings.sceneId,state.settings);const r=$('main').getBoundingClientRect();library.open({bounds:{x:r.x,y:0,width:r.width,height:innerHeight}});};
  $('#wallpaper-adjust').onclick=()=>{library.update(state.settings.sceneId,state.settings);library.open({mode:'adjust'});};
  window.addEventListener('resize',()=>{const r=$('main').getBoundingClientRect();if(library.isOpen())library.position({x:r.x,y:0,width:r.width,height:innerHeight});});
  $('#theme-close').onclick = () => $('#theme-dialog').close();
  $('#go-integration').addEventListener('click', () => { $('#theme-dialog').close(); showTab('integration'); });
  for (const [key, factor] of Object.entries(scales)) $(`#${key}`).addEventListener('input', e => { state.settings[key] = (key === "panel" || key === "composerOpacity" ? 100 - Number(e.target.value) : Number(e.target.value)) / factor; renderSettings(); queueSave(); });
  document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
    const mode = b.dataset.mode; Object.assign(state.settings, mode === 'focus' ? { mode, panel:.75, composerOpacity:.9 } : mode === 'immersive' ? { mode, panel:.08, composerOpacity:.25 } : { mode, panel:.24, composerOpacity:.45 }); renderSettings(); queueSave();
  }));
  $('#quality').addEventListener('change', e => { state.settings.quality = e.target.value; renderSettings(); queueSave(); });
  $('#motion-toggle').addEventListener('click', () => { state.settings.motion = !state.settings.motion; if (state.settings.motion) { state.settings.quality = 'original'; if (state.settings.mode === 'focus') state.settings.mode = 'balanced'; } renderSettings(); queueSave(); });
  $('#reset').addEventListener('click', () => { const scene = state.scenes.find(s => s.id === state.settings.sceneId); Object.assign(state.settings, { strength:.9, blur:0, shade:.2, panel:.24, composerOpacity:.45, composerBlur:0, chromeBlur:0, summaryBlur:0, focusX:scene.focusX, focusY:scene.focusY, mode:'balanced', motion:true, quality:'original' }); renderSettings(); queueSave(); });
  $('#probe').addEventListener('click', () => probe().catch(e => toast(e.message)));
  $('#apply-poster').addEventListener('click', () => nativeAction('apply','poster').catch(e => toast(e.message)));
  $('#apply-video').addEventListener('click', () => nativeAction('apply','video').catch(e => toast(e.message)));
  $('#restore').addEventListener('click', () => nativeAction('remove').catch(e => toast(e.message)));
  document.addEventListener('visibilitychange', syncMotion); reduced.addEventListener('change', syncMotion);
  installBoot(); $('#boot-play').addEventListener('click', syncMotion); $('#boot-dialog').addEventListener('close', syncMotion);
  let lastRefresh=0,refreshing=false;refreshTimer = setInterval(async () => {if(document.hidden||refreshing)return;const active=[...state.resources?.jobs??[],...state.resources?.cache?.jobs??[]].some(j=>['queued','running'].includes(j.status));if(!active&&Date.now()-lastRefresh<6000)return;refreshing=true;lastRefresh=Date.now();try {const current=await refreshResources();state.native=current.native;renderHost(current.host,current.native);}catch{}finally{refreshing=false;}},1000);
  window.addEventListener('pagehide', () => { clearInterval(refreshTimer); deck.destroy();library.destroy(); });
} catch (error) { toast(error.message); $('#playback-status').textContent = '请从项目的启动入口重新打开实验室'; }
