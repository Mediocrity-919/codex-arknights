// Serialized into a verified desktop renderer. No chat content is read or replaced.
export async function nativeLayer(command, payload = {}, createMediaDeck, createWallpaperLibrary, createWallpaperPlayer) {
  const KEY = '__ARK_THEME_LAB_V1__', old = window[KEY];
  const markers = {
    root: !!document.getElementById('root'),
    sidebar: !!document.querySelector('aside.app-shell-left-panel'),
    rail: !!document.querySelector('nav[data-app-navigation-rail]'),
    composer: !!document.querySelector('[data-composer-body]'),
    main: !!document.querySelector('main[data-app-shell-main-surface]')
  };
  const eligible = location.protocol === 'app:' && markers.root && markers.sidebar && markers.main && markers.rail;
  if (command === 'inspect') return { eligible, markers,focused:document.hasFocus(), applied: !!old, media: old?.media ?? 'none' };
  if (command === 'remove') {
    old?.cleanup();
    return { restored: !window[KEY] && !document.getElementById('ark-theme-lab-layer') && !document.getElementById('ark-theme-lab-style') && !document.getElementById('ark-theme-controls') && !document.getElementById('ark-theme-nav-button') && !document.documentElement.hasAttribute('data-ark-theme-lab') };
  }
  if (command === 'heartbeat') {
    if (old) old.heartbeat = Date.now();
    const pending = old?.pending ?? null;
    return { applied: !!old, media: old?.media ?? 'none', error: old?.error ?? null, pending, pendingRevision:old?.pendingRevision??0, panelOpen: old?.panelOpen ?? false, playback:old?.player?.diagnostics() ?? null,resourceRequests:old?.resourceRequests??[],resourceRevision:old?.resourceRevision??-1 };
  }
  if(command==='saved'){old?.confirmSave?.(payload.revision,payload.error);return{applied:!!old};}
  if(command==='resources'){old?.receiveResources?.(payload);return{applied:!!old};}
  if (command === 'update') { if (!old) return { applied: false }; old.pending=null; old.update(payload.settings); return { applied: true }; }
  if (command !== 'apply' || !eligible) throw new Error('目标不是已识别的 Codex 主界面');
  const localResource=value=>/^app:\/\/fs\/@fs\/[A-Za-z]:\//.test(value??'');
  if (!payload.settings || !(localResource(payload.poster)||/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(payload.poster ?? ''))) throw new Error('无效的背景资源');
  if (payload.video && !/^app:\/\/fs\/@fs\/[A-Za-z]:\//.test(payload.video)) throw new Error('视频来源未通过校验');
  if(typeof createMediaDeck !== 'function')throw new Error('缺少媒体引擎');
  let s = { ...payload.settings };
  const catalog=payload.scenes ?? [];
  for(const scene of catalog)if((scene.video&&!localResource(scene.video))||!localResource(scene.poster)||(scene.thumb&&!localResource(scene.thumb)))throw new Error('无效场景来源');
  for(const scene of catalog)if(scene.sequence&&!localResource(scene.sequence.video))throw Error('无效连续缓存来源');
  for(const scene of catalog)for(const clip of scene.clips??[])if(!localResource(clip.video))throw Error('无效动作来源');
  const poster = new Image(); poster.src = payload.poster;
  await Promise.race([poster.decode(), new Promise((_, reject) => setTimeout(() => reject(new Error('封面加载超时')), 4000))]);
  const wasOpen = payload.panelOpen ?? old?.panelOpen ?? false, previousMode=old?.panelMode??'page';
  old?.cleanup();
  const root = document.documentElement, reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const nativeBackground = getComputedStyle(document.querySelector('main[data-app-shell-main-surface]')).backgroundColor;
  const channels = nativeBackground.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [24, 24, 24];
  const dark = channels.reduce((a, b) => a + b, 0) / 3 < 128;
  const rgb = dark ? '24,24,24' : '250,250,250', inputRgb = dark ? '54,54,54' : '255,255,255';
  const layer = document.createElement('div'); layer.id = 'ark-theme-lab-layer'; layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, { position:'fixed', inset:'0', pointerEvents:'none', zIndex:'0', overflow:'hidden', background: dark ? '#181818' : '#fafafa' });
  const mediaContainer=document.createElement('div');mediaContainer.id='ark-theme-media';
  Object.assign(mediaContainer.style,{position:'absolute',inset:'0'});layer.append(mediaContainer);
  const shade = document.createElement('div'); Object.assign(shade.style, { position:'absolute', inset:'0' });
  // One continuous page tint also covers the native window gutters. Separate
  // panel backgrounds leave visible strips at the bottom and sidebar corners.
  const pageTint=document.createElement('div');pageTint.id='ark-theme-page-tint';
  Object.assign(pageTint.style,{position:'absolute',inset:'0'});
  const chromeGlass=document.createElement('div');chromeGlass.id='ark-theme-chrome';
  Object.assign(chromeGlass.style,{position:'absolute',inset:'0',pointerEvents:'none'});
  const menuTint=document.createElement('div'),titleTint=document.createElement('div');
  menuTint.id='ark-theme-menu-tint';titleTint.id='ark-theme-title-tint';
  for(const tint of [menuTint,titleTint])Object.assign(tint.style,{position:'absolute',display:'none'});
  chromeGlass.append(menuTint,titleTint);
  const style = document.createElement('style'); style.id = 'ark-theme-lab-style';
  const controls = document.createElement('div'); controls.id = 'ark-theme-controls';
  Object.assign(controls.style, { position:'fixed', top:'76px', left:'64px', zIndex:'999', pointerEvents:'auto' });
  const shadow = controls.attachShadow({ mode:'open' });
  const navEntry=document.createElement('div');navEntry.id='ark-theme-nav-button';
  Object.assign(navEntry.style,{width:'36px',height:'36px',flexShrink:'0'});
  const navShadow=navEntry.attachShadow({mode:'open'});
  navShadow.innerHTML=`<style>:host{display:block}button{display:grid;place-items:center;width:36px;height:36px;border:1px solid transparent;border-radius:10px;color:var(--color-text-secondary,#bcbcbc);background:transparent;cursor:pointer;padding:0}button:hover,button[aria-expanded=true]{color:#f3f3f3;background:#ffffff18;border-color:#ffffff18}button:focus-visible{outline:2px solid #ddd;outline-offset:2px}svg{width:21px;height:21px}</style><button class="toggle" title="壁纸" aria-label="壁纸" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><path d="m4 16 5-5 4 4 3-3 4 4"/><circle cx="15.6" cy="8.2" r="1.4"/></svg></button>`;
  const toggle=navShadow.querySelector('button');
  const adjustEntry=document.createElement('div');adjustEntry.id='ark-wallpaper-adjust-button';adjustEntry.style.cssText=navEntry.style.cssText;
  const adjustShadow=adjustEntry.attachShadow({mode:'open'});adjustShadow.append(navShadow.querySelector('style').cloneNode(true));
  const adjustToggle=document.createElement('button');adjustToggle.title='调整当前壁纸';adjustToggle.setAttribute('aria-label','调整当前壁纸');adjustToggle.setAttribute('aria-expanded','false');
  adjustToggle.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55"><path d="M4 7h7m5 0h4M4 17h2m5 0h9"/><circle cx="13.5" cy="7" r="2.5"/><circle cx="8.5" cy="17" r="2.5"/></svg>';adjustShadow.append(adjustToggle);
  const settingsEntry=document.createElement('button');settingsEntry.id='ark-wallpaper-settings-entry';settingsEntry.type='button';settingsEntry.title='壁纸';settingsEntry.setAttribute('aria-label','壁纸');
  settingsEntry.innerHTML='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="m4 16 5-5 4 4 3-3 4 4"/><circle cx="16" cy="8" r="1.4"/></svg><span>壁纸</span>';
  let library=null, libraryEmbedded=false, settingsSurface=null,pageRoute=null;
  // The native tree stays mounted. These reversible visibility markers never
  // replace its content, change its geometry, or copy any chat text.
  const covered=new Map();let peekSnapshot=null;
  function restoreElement(e,snapshot,marker){e.removeAttribute(marker);e.inert=snapshot.inert;if(snapshot.aria===null)e.removeAttribute('aria-hidden');else e.setAttribute('aria-hidden',snapshot.aria);}
  function coverPage(elements=[]){
    const next=new Set(elements.filter(Boolean));
    for(const [e,snapshot] of covered)if(!next.has(e)){restoreElement(e,snapshot,'data-ark-wallpaper-covered');covered.delete(e);}
    for(const e of next)if(!covered.has(e)){covered.set(e,{inert:e.inert,aria:e.getAttribute('aria-hidden')});e.setAttribute('data-ark-wallpaper-covered','');e.inert=true;e.setAttribute('aria-hidden','true');}
  }
  function previewOnly(enabled){
    const app=document.getElementById('root');
    if(enabled&&app&&!peekSnapshot){peekSnapshot={element:app,inert:app.inert,aria:app.getAttribute('aria-hidden')};app.setAttribute('data-ark-wallpaper-peek','');app.inert=true;app.setAttribute('aria-hidden','true');}
    else if(!enabled&&peekSnapshot){restoreElement(peekSnapshot.element,peekSnapshot,'data-ark-wallpaper-peek');peekSnapshot=null;}
  }
  function mainSurface(){return [...document.querySelectorAll('main[data-app-shell-main-surface]')].find(visible);}
  function pageRect(){return (libraryEmbedded?settingsSurface:mainSurface())?.getBoundingClientRect();}
  function surfaceChanged(mode){
    state.panelOpen=!!mode;state.panelMode=mode??'page';pageRoute=mode==='page'?location.href:null;
    root.toggleAttribute('data-ark-wallpaper-settings-open',mode==='page'&&libraryEmbedded);
    toggle.setAttribute('aria-expanded',String(mode==='page'));adjustToggle.setAttribute('aria-expanded',String(mode==='adjust'));
    if(mode!=='page')coverPage();if(!mode)previewOnly(false);if(alive)placeControl();
  }
  settingsEntry.onclick=event=>{event.stopPropagation();libraryEmbedded=true;showPanel(true);};
  let layoutFrame=0;
  const observedGeometry=new Set();
  function visible(e){const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&e.checkVisibility();}
  function fitTint(tint,element){
    const r=element?.getBoundingClientRect();
    if(!r||r.width<=0||r.height<=0){tint.style.display='none';return;}
    Object.assign(tint.style,{display:'block',left:`${r.x}px`,top:`${r.y}px`,width:`${r.width}px`,height:`${r.height}px`});
  }
  function placeControl(){
    const rail=document.querySelector('nav[data-app-navigation-rail]');
    const list=rail?.querySelector(':scope > div[data-appearance]');if(list&&navEntry.parentNode!==list)list.append(navEntry);
    if(list&&adjustEntry.parentNode!==list)list.append(adjustEntry);
    if(pageRoute&&pageRoute!==location.href){showPanel(false);return;}
    const menu=[...document.querySelectorAll('[data-app-shell-frame] > [class*="_ApplicationMenuTopBar_"]')].find(visible);
    // Modules keep an empty titlebar above their own page heading. Never paint
    // a chat header there, or it can cut across the heading after navigation.
    const titles=[...document.querySelectorAll('[data-app-shell-titlebar][data-app-shell-header-layout="thread-edge-scroll"] [data-app-shell-main-titlebar]')];
    const title=titles.find(visible);fitTint(menuTint,menu);fitTint(titleTint,title);
    const main=mainSurface(),geometry=new Set([rail,menu,main,...titles].filter(Boolean));
    for(const e of observedGeometry)if(!geometry.has(e)){geometryObserver.unobserve(e);observedGeometry.delete(e);}
    for(const e of geometry)if(!observedGeometry.has(e)){geometryObserver.observe(e);observedGeometry.add(e);}
    const bottom=Math.max(36,menu?.getBoundingClientRect().bottom??0,title?.getBoundingClientRect().bottom??0);
    controls.style.left=`${Math.max(12,(rail?.getBoundingClientRect().right??52)+12)}px`;
    controls.style.top=`${bottom+12}px`;$('.panel').style.maxHeight=`calc(100vh - ${bottom+32}px)`;
    const appearance=[...document.querySelectorAll('aside.app-shell-left-panel [data-settings-panel-slug="appearance"]')].find(visible);
    const surface=appearance?[...document.querySelectorAll('main[data-app-shell-main-surface] [data-codex-history-swipe-page] > div')].find(e=>visible(e)&&e.classList.contains('electron:bg-surface')):null;
    if(settingsSurface!==surface){settingsSurface?.removeAttribute('data-ark-settings-surface');settingsSurface=surface;settingsSurface?.setAttribute('data-ark-settings-surface','');}
    if(appearance){if(settingsEntry.previousElementSibling!==appearance){settingsEntry.className=appearance.className;settingsEntry.style.cssText='display:flex;gap:8px;align-items:center;width:100%;text-align:left';appearance.after(settingsEntry);}}
    else {settingsEntry.remove();if(libraryEmbedded&&state.panelOpen)showPanel(false);}
    if(library?.isOpen()){
      library.position(pageRect());
      if(state.panelMode==='page')coverPage([libraryEmbedded?settingsSurface:main,...document.querySelectorAll('[data-app-shell-titlebar]')].filter(e=>e&&visible(e)));
    }
    settingsEntry.setAttribute('aria-pressed',String(state.panelOpen&&state.panelMode==='page'&&libraryEmbedded));
  }
  function scheduleLayout(){if(!layoutFrame)layoutFrame=requestAnimationFrame(()=>{layoutFrame=0;if(alive)placeControl();});}
  const geometryObserver=new ResizeObserver(scheduleLayout);
  const railObserver=new MutationObserver(scheduleLayout);
  // Only our isolated UI uses innerHTML. All external catalog labels use textContent.
  shadow.innerHTML = `<style>
    :host{font:13px/1.5 "Segoe UI","Microsoft YaHei",sans-serif;color:#edf2f5;color-scheme:dark}
    *{box-sizing:border-box}button,select,input{font:inherit}button{cursor:pointer;color:inherit;border:1px solid #ffffff26;background:#25313ae8;border-radius:10px;padding:8px 12px}button:hover{background:#34434d}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #a6dbe3;outline-offset:3px}
    .panel{width:min(316px,calc(100vw - 82px));max-height:calc(100vh - 104px);overflow:auto;padding:22px;background:linear-gradient(145deg,#223a49d9,#111e2be8);border:1px solid #b8e0ff26;box-shadow:0 18px 60px #0004,inset 0 1px #ecf8ff10;border-radius:20px;backdrop-filter:blur(28px) saturate(1.15);scrollbar-width:thin;scrollbar-color:#b5d5e533 transparent}.eyebrow{font-size:9px;letter-spacing:2px;color:#96c6d5;margin-bottom:7px}.status{font-size:11px;color:#b7dce7;min-height:18px}details{border-top:1px solid #ffffff15;margin-top:18px;padding-top:14px}summary{cursor:pointer;color:#a6c0ce;font-size:12px}[hidden]{display:none!important}
    header{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}h2{font-size:16px;margin:0}header button{padding:1px 7px;background:none;border:0;font-size:20px}label{display:block;margin:14px 0;color:#d8e0e5}output{float:right;font-variant-numeric:tabular-nums;color:#a6dbe3}input[type=range]{display:block;width:100%;margin:8px 0 0;accent-color:#a6dbe3}select{display:block;width:100%;padding:9px;border-radius:8px;background:#27343f;color:#edf2f5;border:1px solid #ffffff24;margin-top:8px}.hint{font-size:11px;color:#9caebc;margin:14px 0}.row{display:flex;gap:8px;flex-wrap:wrap}.row button{flex:1}hr{border:0;border-top:1px solid #ffffff18;margin:18px 0}
  </style>
  <section class="panel" aria-label="主题设置面板" hidden><div class="eyebrow">RHODES / VISUALS</div><header><h2>画面调校</h2><button class="close" aria-label="收起主题设置">×</button></header>
  <button id="browse" style="width:100%">选择壁纸 →</button><label hidden>当前场景<select id="scene"></select></label>
  <div id="sliders"></div><details><summary>界面磨砂与构图</summary><div id="advanced"></div></details><div class="status" role="status"></div><p class="hint">输入框透明度与磨砂同时调节上方项目栏。页面透明度联动主页与侧栏，顶部磨砂联动菜单栏与标题栏；0 表示关闭磨砂。</p>
  <div class="row"><button id="motion"></button><button id="reset">清透预设</button></div><hr>
  <div class="row"><button id="restore">恢复原界面</button></div><p class="hint">紧急恢复：Ctrl + Shift + Backspace<br>设置自动保存在本机</p></section>`;
  const $ = selector => shadow.querySelector(selector), sliders = new Map();
  let watchdog, alive = true, player, requestedSceneId=null, mediaPromise=Promise.resolve(true);
  const saveWaiters=[];
  const resourceWaiters=new Map();
  function requestResource(action,payload){return new Promise((resolve,reject)=>{const id=crypto.randomUUID();const timer=setTimeout(()=>{resourceWaiters.delete(id);state.resourceRequests=state.resourceRequests.filter(r=>r.id!==id);reject(Error('资源操作超时，请检查主题助手'));},15000);resourceWaiters.set(id,{resolve,reject,timer});state.resourceRequests.push({id,action,payload});});}
  function receiveResources(payload){for(const result of payload.results??[]){const waiter=resourceWaiters.get(result.id);if(waiter){clearTimeout(waiter.timer);resourceWaiters.delete(result.id);result.error?waiter.reject(Error(result.error)):waiter.resolve(result.value);}state.resourceRequests=state.resourceRequests.filter(r=>r.id!==result.id);}if(payload.scenes){for(const next of payload.scenes){if(!localResource(next.poster)||(next.video&&!localResource(next.video))||(next.sequence&&!localResource(next.sequence.video))||next.clips?.some(c=>!localResource(c.video)))throw Error('无效资源路径');const existing=catalog.find(s=>s.id===next.id);if(existing)Object.assign(existing,next);else catalog.splice(Math.max(0,catalog.findIndex(s=>s.id==='welcome')),0,next);}player?.setCatalog?.(catalog);}if(payload.info){state.resourceRevision=payload.info.revision;library?.resources?.(payload.info,payload.scenes);}}
  const state = { media:'poster', error:null, heartbeat:Date.now(), pending:null,pendingRevision:0,confirmSave,resourceRequests:[],resourceRevision:payload.resources?.revision??-1,receiveResources, panelOpen:wasOpen, panelMode:previousMode, cleanup, update, player:null };
  function markPending(){state.pending=structuredClone(s);return ++state.pendingRevision;}
  function confirmSave(revision,error){if(!error&&revision===state.pendingRevision)state.pending=null;for(let i=saveWaiters.length-1;i>=0;i--){const w=saveWaiters[i];if(w.revision<=revision){saveWaiters.splice(i,1);clearTimeout(w.timer);error?w.reject(Error(error)):w.resolve(true);}}}
  function waitSaved(revision){return new Promise((resolve,reject)=>{const w={revision,resolve,reject,timer:null};w.timer=setTimeout(()=>{const index=saveWaiters.indexOf(w);if(index>=0)saveWaiters.splice(index,1);reject(Error('本地保存未确认，请重试'));},8000);saveWaiters.push(w);});}
  function showPanel(open,mode='page') { $('.panel').hidden=true;if(open&&library)library.open({mode,trigger:mode==='adjust'?adjustToggle:libraryEmbedded?settingsEntry:toggle,bounds:pageRect()});else {library?.hide();surfaceChanged(null);} }
  toggle.onclick = () => {const open=!state.panelOpen||state.panelMode!=='page';libraryEmbedded=false;showPanel(open);};
  adjustToggle.onclick=()=>{libraryEmbedded=false;showPanel(!state.panelOpen||state.panelMode!=='adjust','adjust');};
  $('.close').onclick = () => showPanel(false);
  $('#browse').onclick=()=>showPanel(true);
  for (const scene of payload.scenes ?? []) { const option = document.createElement('option'); option.value = scene.id; option.textContent = scene.name; $('#scene').append(option); }
  function changed(options) { markPending(); update(s,options); }
  $('#scene').onchange = () => { const scene = catalog.find(x => x.id === $('#scene').value); if (scene) { Object.assign(s, { sceneId:scene.id, wallpaper:null,activePlaylistId:null,focusX:scene.focusX, focusY:scene.focusY }); changed(); } };
  const pixelKeys=new Set(['blur','composerBlur','chromeBlur','summaryBlur']);
  for (const [key, title, max, invert] of [['strength','壁纸强度',100,false], ['panel','页面透明度',100,true], ['composerOpacity','输入框透明度',100,true], ['chromeBlur','顶部磨砂',24,false], ['summaryBlur','右侧卡片磨砂',24,false], ['composerBlur','输入框磨砂',24,false], ['blur','背景模糊',24,false], ['shade','明暗遮罩',85,false], ['focusX','水平构图',100,false], ['focusY','垂直构图',100,false]]) {
    const label = document.createElement('label'), output = document.createElement('output'), input = document.createElement('input');
    label.append(document.createTextNode(title), output, input); input.type = 'range'; input.min = '0'; input.max = String(max); input.step = '1'; input.setAttribute('aria-label', title); input.id = key;
    input.oninput = () => { const value = Number(input.value); s[key] = pixelKeys.has(key) || key.startsWith('focus') ? value : (invert ? 100 - value : value) / 100; changed(); };
    ( ['strength','panel','composerOpacity'].includes(key)?$('#sliders'):$('#advanced')).append(label); sliders.set(key, { input, output, invert });
  }
  $('#motion').onclick = () => { s.motion = !s.motion; if(s.motion) { s.quality='original'; s.mode='balanced'; } changed(); };
  $('#reset').onclick = () => { Object.assign(s, { panel:.24, composerOpacity:.45, composerBlur:0, chromeBlur:0, summaryBlur:0, blur:0, shade:.2 }); changed(); };
  $('#restore').onclick = cleanup;
  function syncMotion() { player?.setEnabled(!document.hidden&&!reduced.matches&&s.motion&&!s.playbackPaused&&s.quality!=='still'&&s.mode!=='focus'); }
  function selectMedia(options) {
    if(player?.update){mediaPromise=player.update(s,options);return;}
    if(!player || requestedSceneId===s.sceneId)return;
    requestedSceneId=s.sceneId;
    const entry=catalog.find(x=>x.id===s.sceneId);
    const source={id:s.sceneId,focusX:s.focusX,focusY:s.focusY,fit:entry?.fit??'cover',poster:entry?.poster??payload.poster,video:(payload.allowMotion??!!payload.video)?entry?.video??null:null};
    mediaPromise=player.setScene(source).then(ok=>{if(!ok&&alive&&requestedSceneId===source.id){const previous=player.diagnostics().sceneId;if(previous&&previous!==source.id){s.sceneId=previous;requestedSceneId=previous;markPending();$('#scene').value=previous;library?.update(previous);}}return ok;});
  }
  function update(next,options) {
    s = { ...next };
    selectMedia(options);player?.setPresentation(s);
    shade.style.background = `rgba(${rgb},${s.shade})`;
    pageTint.style.background=`linear-gradient(90deg,rgba(${rgb},${s.panel*.45}) 8%,rgba(${rgb},${Math.min(.94,s.panel*1.35)}) 35%,rgba(${rgb},${Math.min(.94,s.panel*1.35)}) 65%,rgba(${rgb},${s.panel*.45}) 92%)`;
    const chromeFilter=s.chromeBlur>0?`blur(${s.chromeBlur}px)`:'none';
    for(const tint of [menuTint,titleTint])tint.style.backdropFilter=chromeFilter;
    // No global design token changes, layout overrides, text opacity, or DOM replacement.
    style.textContent = `html[data-ark-theme-lab] body{background:transparent!important}
      html[data-ark-theme-lab] #root{position:relative;z-index:1;background:transparent!important}
      html[data-ark-theme-lab] [data-ark-wallpaper-covered],html[data-ark-theme-lab] [data-ark-wallpaper-peek]{opacity:0!important;pointer-events:none!important}
      html[data-ark-theme-lab] main[data-app-shell-main-surface]{background:transparent!important;outline-color:transparent!important;border-color:transparent!important}
      html[data-ark-theme-lab] [data-app-shell-frame] [class*="_PageSurface_"]{box-shadow:none!important}
      html[data-ark-theme-lab] [data-ark-settings-surface]{background:transparent!important}
      html[data-ark-theme-lab] #ark-wallpaper-settings-entry[aria-pressed="true"]{background:#ffffff22!important;color:var(--color-text-primary)!important}
      html[data-ark-wallpaper-settings-open] aside.app-shell-left-panel [data-settings-panel-slug]{background:transparent!important}
      html[data-ark-theme-lab] aside.app-shell-left-panel,
      html[data-ark-theme-lab] aside.app-shell-left-panel .sidebar-navigation,
      html[data-ark-theme-lab] nav[data-app-navigation-rail]{background:transparent!important;backdrop-filter:none!important}
      html[data-ark-theme-lab] [data-app-shell-frame] > [class*="_ApplicationMenuTopBar_"]{background:transparent!important}
      html[data-ark-theme-lab] [data-app-shell-main-titlebar]{background:transparent!important;backdrop-filter:none!important;box-shadow:none!important}
      html[data-ark-theme-lab] main[data-app-shell-main-surface] [class*="_shell_"]:has(> [class*="_content_"] > [class*="_headerRow_"] h1)::before{background:transparent!important;backdrop-filter:${chromeFilter}!important}
      html[data-ark-theme-lab] [data-summary-panel-variant]{background:rgba(${rgb},${Math.min(.86,s.panel+.22)})!important;backdrop-filter:${s.summaryBlur>0?`blur(${s.summaryBlur}px)`:'none'}!important;box-shadow:inset 0 1px #e8f7ff12,0 8px 24px #0001!important}
      html[data-ark-theme-lab] [data-summary-panel-variant] header,html[data-ark-theme-lab] [data-summary-panel-variant] header::before{background:transparent!important}
      html[data-ark-theme-lab] [data-app-action-timeline-scroll]{text-shadow:0 1px 2px #0003}
      html[data-ark-theme-lab] [data-codex-composer-root] [data-composer-surface-variant]{background-color:transparent!important}
      html[data-ark-theme-lab] [data-thread-scroll-footer] > div[aria-hidden="true"].pointer-events-none,
      html[data-ark-theme-lab] [data-app-action-timeline-scroll] [aria-hidden="true"] > [aria-hidden="true"][class*="_fade_"],
      html[data-ark-theme-lab] [data-app-shell-main-content-top-fade] > div[aria-hidden="true"]{background:transparent!important}
      html[data-ark-theme-lab] [data-thread-scroll-footer] > div[aria-hidden="true"].pointer-events-none::before,
      html[data-ark-theme-lab] [data-thread-scroll-footer] > div[aria-hidden="true"].pointer-events-none::after{background:transparent!important;box-shadow:none!important}
      /* The attached project rail tucks empty padding behind the composer.
         Clip only that padding so translucent backgrounds do not paint twice. */
      html[data-ark-theme-lab] [data-codex-composer-root] [data-composer-rail] > [data-composer-utility-rail][data-composer-rail-placement="above"][data-composer-rail-contained]:last-child{clip-path:inset(0 0 var(--composer-rail-tuck,0px) 0)}
      html[data-ark-theme-lab] [data-codex-composer-root] [data-composer-utility-rail],
      html[data-ark-theme-lab] [data-composer-body]{background-color:rgba(${inputRgb},${s.composerOpacity})!important;backdrop-filter:${s.composerBlur>0?`blur(${s.composerBlur}px)`:'none'}}`;
    for (const [key, { input, output, invert }] of sliders) {
      const pixels = pixelKeys.has(key);
      const value = Math.round(pixels || key.startsWith('focus') ? s[key] : (invert ? 1 - s[key] : s[key]) * 100);
      input.value = String(value); output.value = `${value}${pixels ? ' px' : '%'}`;
    }
    $('#scene').value = s.sceneId; $('#motion').textContent = s.motion ? '暂停动态' : '播放动态';library?.update(s.sceneId,s);syncMotion();
  }
  function onKey(event) {
    if (event.ctrlKey && event.shiftKey && event.code === 'Backspace') { event.preventDefault(); cleanup(); }
    else if (event.code === 'Escape' && state.panelOpen && !event.composedPath().includes(controls)) { showPanel(false); event.stopPropagation(); }
  }
  function outside(event){
    if(!state.panelOpen||event.composedPath().some(e=>[controls,navEntry,adjustEntry,settingsEntry].includes(e)))return;
    // Native navigation remains available. Ordinary clicks keep the small
    // adjustment panel open, so the user can compare it with their workspace.
    if(event.composedPath().some(e=>e instanceof Element&&e.matches('[data-sidebar-destination],[data-settings-panel-slug],a[href],button[aria-label="返回"],button[aria-label="前进"]')))showPanel(false);
  }
  function onKeyUp(event){if(event.key==='Escape')library?.escapeKeyUp();}
  function cleanup() {
    confirmSave(Number.MAX_SAFE_INTEGER,'主题已关闭，保存未确认');
    for(const waiter of resourceWaiters.values()){clearTimeout(waiter.timer);waiter.reject(Error('主题已关闭'));}resourceWaiters.clear();
    alive=false; clearInterval(watchdog);
    document.removeEventListener('visibilitychange',syncMotion); document.removeEventListener('keydown',onKey,true); reduced.removeEventListener('change',syncMotion);
    document.removeEventListener('pointerdown',outside,true);
    window.removeEventListener('keyup',onKeyUp,true);
    player?.destroy();library?.destroy();coverPage();previewOnly(false);settingsEntry.remove();settingsSurface?.removeAttribute('data-ark-settings-surface');railObserver.disconnect();geometryObserver.disconnect();cancelAnimationFrame(layoutFrame);window.removeEventListener('resize',scheduleLayout);navEntry.remove();adjustEntry.remove();
    layer.remove(); style.remove(); controls.remove(); root.removeAttribute('data-ark-theme-lab');root.removeAttribute('data-ark-wallpaper-settings-open');
    if(window[KEY]===state) delete window[KEY];
  }
  const onMediaState=change=>{
    if(!alive)return;
    if(change.queueEnded&&s.activePlaylistId){s.playbackPaused=true;markPending();library?.update(s.sceneId,s);}
    state.media=change.media;if('error' in change)state.error=change.error;
    $('.status').textContent=change.error?'暂时无法加载，已保留上一场景':change.loading?'正在准备新场景…':change.transitioning?'':state.error?'场景未能加载':'';
    if(change.committed&&s.activePlaylistId&&change.sceneId&&(s.sceneId!==change.sceneId||s.queueCursor!==change.entryIndex)){s.sceneId=change.sceneId;s.queueCursor=change.entryIndex;markPending();library?.update(s.sceneId,s);}
  };
  const playableCatalog=catalog.map(entry=>(payload.allowMotion??!!payload.video)?entry:{...entry,video:null,clips:[]});
  player=typeof createWallpaperPlayer==='function'?createWallpaperPlayer(mediaContainer,{catalog:playableCatalog,onState:onMediaState},createMediaDeck):createMediaDeck(mediaContainer,{onState:onMediaState});state.player=player;
  let applyRevision=0;
  async function applyChanges(patch,options){
    const revision=++applyRevision,previous=structuredClone(s);
    update({...s,...patch},options);
    let ok=false;try{ok=await mediaPromise;}catch{}
    if(revision!==applyRevision)return false;
    if(!ok)update(previous);
    const saveRevision=markPending();library?.update(s.sceneId,s);if(ok)await waitSaved(saveRevision);return ok;
  }
  if(typeof createWallpaperLibrary==='function'){
    const mount=document.createElement('div');mount.id='wallpaper-library';shadow.append(mount);
    library=createWallpaperLibrary(mount,{scenes:catalog,resources:payload.resources,onResource:requestResource,selectedId:s.sceneId,settings:s,createMediaDeck,createWallpaperPlayer,onChange:applyChanges,onJump:delta=>player.jump(delta),onClose:()=>showPanel(false),onSurfaceChange:surfaceChanged,onPreviewOnly:previewOnly,onApply:async(id,wallpaper)=>{const scene=catalog.find(x=>x.id===id);if(!scene)return false;return applyChanges({sceneId:id,wallpaper:wallpaper??null,activePlaylistId:null,playbackPaused:false,focusX:scene.focusX,focusY:scene.focusY,...(scene.defaultShade!=null?{shade:scene.defaultShade}:{})});}});
  }
  layer.append(shade,pageTint,chromeGlass); document.body.prepend(layer); document.head.append(style); document.body.append(controls);
  placeControl();railObserver.observe(document.getElementById('root'),{childList:true,subtree:true,attributes:true,attributeFilter:['style','hidden','data-app-shell-header-layout']});window.addEventListener('resize',scheduleLayout);
  root.setAttribute('data-ark-theme-lab','v4'); window[KEY]=state; update(s); showPanel(wasOpen,previousMode);
  document.addEventListener('keydown',onKey,true); document.addEventListener('visibilitychange',syncMotion); reduced.addEventListener('change',syncMotion);
  document.addEventListener('pointerdown',outside,true);
  window.addEventListener('keyup',onKeyUp,true);
  watchdog=setInterval(()=>{if(Date.now()-state.heartbeat>18000||!document.querySelector('main[data-app-shell-main-surface]')||!document.querySelector('nav[data-app-navigation-rail]'))cleanup();},3000);
  return { applied:true, media:state.media, markers, watchdogSeconds:21 };
}
