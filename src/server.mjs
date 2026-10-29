import http from 'node:http';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { ROOT, scenes, sceneById, assetById, defaults, validateSettings, mediaPath, nativeFileUrl,resourceCatalog,extendCatalog } from './catalog.mjs';
import {createCatalogUpdater,knownFromScenes} from './catalog-update.mjs';
import {createToolInstaller} from './tool-installer.mjs';
import {createResourceManager} from './resource-manager.mjs';
import {createPlaybackCache} from './playback-cache.mjs';
import { parseRange } from './range.mjs';
import { CdpSession, listVerifiedTargets } from './cdp.mjs';
const exec = promisify(execFile);
const local = path.join(ROOT, '.local');
const statics = new Map([['/', 'index.html'], ['/app.js', 'app.js'], ['/style.css', 'style.css'], ['/boot.js', 'boot.js']]);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.png':'image/png', '.webp':'image/webp', '.mp4': 'video/mp4','.svg':'image/svg+xml','.img':'image/png' };
const VERSION=JSON.parse(await fs.readFile(path.join(ROOT,'package.json'),'utf8')).version;

export async function startServer({ port = 0, stateDir = local, probeHost, updateFetcher, autoUpdate = false, toolOptions = {} } = {}) {
  await fs.mkdir(stateDir, { recursive: true });
  const token = crypto.randomBytes(32).toString('hex');
  let origin, settings = { ...defaults }, native = null, host = { reason: '尚未检查', debuggerVerified: false };
  let refreshing = null, busy = false;
  let saves = Promise.resolve();
  // Entries found by earlier update checks join the catalog before settings are validated.
  let resources,playbackCache;
  const updater=await createCatalogUpdater({stateDir,fetcher:updateFetcher,known:()=>knownFromScenes(scenes),apply:delta=>{
    const ids=extendCatalog(delta);if(ids.length&&resources){resources.refresh();playbackCache.refresh();for(const s of scenes)for(const c of s.clips??[])assetParent.set(c.id,s.id);}return ids;}});
  extendCatalog(updater.stored());
  resources=await createResourceManager({root:ROOT,stateDir,catalog:resourceCatalog,scenes});
  playbackCache=await createPlaybackCache({root:ROOT,stateDir,scenes,resources,mediaPath,catalog:resourceCatalog});
  const installer=await createToolInstaller({root:ROOT,stateDir,reloadRuntime:()=>resources.reloadRuntime(),isBusy:()=>resources.publicState().jobs.some(j=>['queued','running'].includes(j.status))||playbackCache.publicState().jobs.some(j=>['queued','running'].includes(j.status)),...toolOptions});
  const resourceRevision=()=>`${resources.revision}:${playbackCache.revision}:${updater.revision}:${installer.revision}`;
  const resourceState=()=>({...resources.publicState(),revision:resourceRevision(),cache:playbackCache.publicState(),updates:updater.publicState(),tools:installer.publicState()});
  async function resourceAction(action,payload){if(action.startsWith('updates-')){await updater.action(action,payload);return resourceState();}if(action.startsWith('tools-')){await installer.action(action,payload);return resourceState();}if(action.startsWith('cache-')){await playbackCache.action(action,payload);return resourceState();}const result=await resources.action(action,payload,references);return ['status','preferences'].includes(action)?resourceState():result;}
  const assetParent=new Map(scenes.flatMap(s=>(s.clips??[]).map(c=>[c.id,s.id])));
  function catalog(){return scenes.map(scene=>{const {file,legacyFile,clips,...rest}=resources.decorate(scene),cached=playbackCache.describe(scene.id);return{...rest,sequence:cached?.sequence??null,posterAvailable:!resources.posterPath(scene.id).endsWith('welcome.svg')||scene.id==='welcome',...(clips?{clips:clips.map(({file,...c})=>({...c,...cached?.clips.find(x=>x.id===c.id)}))}:{})};});}
  function nativeCatalog(){return catalog().map(scene=>({...scene,sequence:scene.sequence?{...scene.sequence,video:nativeFileUrl(playbackCache.fileFor(scene.sequence.key))}:null,video:scene.kind==='dynamic'?nativeFileUrl(resources.fileFor(scene.clips?.[0]?.id??scene.id,scene.id)??mediaPath(scene.id)):null,clips:scene.clips?.map(clip=>({...clip,video:nativeFileUrl(resources.fileFor(clip.id,scene.id)??mediaPath(clip.id))})),poster:nativeFileUrl(resources.posterPath(scene.id)),thumb:nativeFileUrl(resources.posterPath(scene.id,true))}));}
  try { settings = validateSettings(JSON.parse(await fs.readFile(path.join(stateDir, 'settings.json'), 'utf8'))); } catch {if(!resources.decorate(sceneById(settings.sceneId)).available)settings={...settings,sceneId:'welcome'};}
  playbackCache.observe(settings);
  function references(id){const uses=c=>c?.sceneId===id||c?.backgroundId===id;return{current:uses(settings.wallpaper??{sceneId:settings.sceneId})||settings.playlists.some(q=>q.id===settings.activePlaylistId&&(q.backgroundId===id||q.items.some(i=>uses(i.wallpaper)))),queues:settings.playlists.filter(q=>q.backgroundId===id||q.items.some(i=>uses(i.wallpaper))).map(q=>q.name),saved:settings.savedWallpapers.filter(s=>uses(s.wallpaper)).map(s=>s.name)};}
  async function refreshHost() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        if (probeHost) host = await probeHost();
        else {
          const { stdout } = await exec('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'scripts', 'Probe-Host.ps1')], { windowsHide: true, timeout: 15000, maxBuffer: 65536, encoding: 'utf8' });
          host = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
        }
        await fs.writeFile(path.join(stateDir, 'host-probe.json'), JSON.stringify(host, null, 2));
      } catch { host = { debuggerVerified: false, reason: '未能读取应用信息；请在 Windows 本地运行实验室后重试' }; }
      return host;
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  function publicHost() {
    return { version: host.package?.version ?? null, running: host.running ?? false, debuggerVerified: host.debuggerVerified, reason: host.reason, observedAt: host.observedAt ?? null, pets: '待实际界面验证' };
  }
  async function persistSettings(next) {
    const value = validateSettings(next);
    saves = saves.catch(() => {}).then(async () => {
      await fs.writeFile(path.join(stateDir, 'settings.json.tmp'), JSON.stringify(value, null, 2));
      await fs.rename(path.join(stateDir, 'settings.json.tmp'), path.join(stateDir, 'settings.json'));
      settings = value;
    });
    await saves;
  }
  async function mount(session, media, panelOpen) {
    const filename=resources.posterPath(settings.sceneId);
    // Native files are verified against our manifest; avoid embedding multi-MB PNGs in CDP.
    const poster=nativeFileUrl(filename);
    return session.run('apply', { settings, poster, allowMotion:media==='video', video:media==='video'&&sceneById(settings.sceneId).kind==='dynamic'?nativeFileUrl(mediaPath(settings.sceneId)):null,
      scenes:nativeCatalog(),resources:resourceState(),panelOpen });
  }
  async function attachNative(media = 'video', targetId) {
    await refreshHost();
    if (!host.debuggerVerified) throw new Error(host.reason);
    const targets = await listVerifiedTargets(host);
    const target = targetId ? targets.find(t => t.id === targetId) : targets.find(t=>t.result.focused)??targets[0];
    if (!target) throw new Error('请重新检测并选择一个已识别的 Codex 主窗口');
    if (native) { try { await removeNative(); } catch { native.session.close(); native=null; } }
    const session = await new CdpSession(target.url).connect();
    try {
      const result = await mount(session, media, false);
      if (!result?.applied) throw new Error('未能确认视觉层已建立');
      native = { session, hostPid:host.mainPid, media:result.media, requestedMedia:media, error:null };
      return result;
    } catch(error) { session.close(); throw error; }
  }
  async function removeNative() {
    if (!native) return { restored: false, reason: '本次管理器没有已应用的视觉层' };
    const current = native;
    const result = await current.session.run('remove');
    if (result?.restored !== true) throw new Error('未能确认恢复，请使用原生恢复快捷键或完全退出 Codex');
    current.session.close(); native = null; return result;
  }
  async function readBody(req) {
    let total = 0, parts = [];
    for await (const part of req) { total += part.length; if (total > 2*1024*1024) throw new Error('请求体过大'); parts.push(part); }
    return JSON.parse(Buffer.concat(parts).toString('utf8') || '{}');
  }
  function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
  async function sendFile(req, res, filename, contentType) {
    const stat = await fs.stat(filename);
    let range;
    try { range = parseRange(req.headers.range, stat.size); }
    catch { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); res.end(); return; }
    const start = range?.start ?? 0, end = range?.end ?? stat.size - 1;
    res.writeHead(range ? 206 : 200, { 'Content-Type': contentType, 'Content-Length': Math.max(0, end - start + 1), 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` } : {}) });
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = createReadStream(filename, { start, end });
    res.on('close', () => stream.destroy()); stream.on('error', () => res.destroy()); stream.pipe(res);
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    try {
      if (req.headers.host !== new URL(origin).host) return json(res, 403, { error: '主机名不匹配' });
      const url = new URL(req.url, origin);
      const isApi = url.pathname.startsWith('/api/'), isMedia = url.pathname.startsWith('/media/');
      if (isApi || isMedia) {
        const supplied = req.headers['x-lab-token'] || url.searchParams.get('key');
        if (typeof supplied !== 'string' || supplied.length !== token.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) return json(res, 401, { error: '会话已失效，请重新打开实验室入口' });
      }
      if (req.method === 'POST' && (req.headers.origin !== origin || req.headers['content-type'] !== 'application/json')) return json(res, 403, { error: '拒绝跨来源操作' });
      if ((req.method === 'GET' || req.method === 'HEAD') && statics.has(url.pathname)) {
        const filename = path.join(ROOT, 'public', statics.get(url.pathname));
        return await sendFile(req, res, filename, mime[path.extname(filename)]);
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/media-player.js') return await sendFile(req,res,path.join(ROOT,'src','compositor.mjs'),mime['.js']);
      if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/wallpaper-runtime.js') return await sendFile(req,res,path.join(ROOT,'src','wallpaper-runtime.mjs'),mime['.js']);
      if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/wallpaper-library.js') return await sendFile(req,res,path.join(ROOT,'src','wallpaper-library.mjs'),mime['.js']);
      if ((req.method === 'GET' || req.method === 'HEAD') && isMedia) {
        const cached=/^\/media\/cache\/([a-f0-9]{64})$/.exec(url.pathname);
        if(cached){const file=playbackCache.fileFor(cached[1],true);if(!file)return json(res,404,{error:'播放缓存已更新'});return await sendFile(req,res,file,'video/mp4');}
        const match = /^\/media\/([a-z0-9-]+)\/(video|poster|thumb)$/.exec(url.pathname);
        if (!match || !assetById(match[1]) || (match[2]==='video'&&sceneById(match[1])?.kind==='static') || (match[2]!=='video'&&!sceneById(match[1]))) return json(res, 404, { error: '未知媒体' });
        const variant=url.searchParams.get('variant');if(variant&&!['original','4k'].includes(variant))return json(res,400,{error:'画质参数无效'});
        const file=match[2]==='video'?(resources.fileFor(sceneById(match[1])?.clips?.[0]?.id??match[1],assetParent.get(match[1])??match[1],variant??undefined)??(variant?null:mediaPath(match[1]))):resources.posterPath(match[1],match[2]==='thumb');
        if(!file)return json(res,404,{error:'所选画质尚未下载'});
        return await sendFile(req,res,file,mime[path.extname(file).toLowerCase()]);
      }
      // Startup only needs already-observed readiness, never a catalog/filesystem scan.
      if (req.method === 'GET' && url.pathname === '/api/ready') {
        return json(res, 200, { serviceVersion: VERSION, native: native ? {
          applied:true,hostPid:native.hostPid,error:native.error??null,
          playback:{firstFrameReady:!!native.playback?.firstFrameReady}
        } : {applied:false} });
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        return json(res, 200, { serviceVersion: VERSION, settings, scenes: catalog(),resources:resourceState(), host: publicHost(), native: native ? { applied: true, hostPid:native.hostPid, media: native.media, error: native.error ?? null,playback:native.playback??null } : { applied: false } });
      }
      if(req.method==='POST'&&url.pathname==='/api/resources'){const body=await readBody(req);return json(res,200,await resourceAction(body.action,body.payload));}
      if(req.method==='POST'&&url.pathname==='/api/shutdown'){json(res,200,{stopping:true});setImmediate(()=>close());return;}
      if (req.method === 'POST' && url.pathname === '/api/settings') {
        if (busy) return json(res, 409, { error: '画面正在切换，请稍后重试' });
        busy = true;
        try {
          const next = validateSettings(await readBody(req));
          await persistSettings(next);
          playbackCache.observe(settings,native?.playback);
          if (native) {
            await native.session.run('update', { settings });
          }
          return json(res, 200, { settings });
        } finally { busy = false; }
      }
      if (req.method === 'POST' && url.pathname === '/api/probe') {
        await refreshHost();
        const targets = await listVerifiedTargets(host);
        return json(res, 200, { host: publicHost(), targets: targets.map((t, i) => ({ id: t.id, label: `Codex 主窗口 ${i + 1}`, markers: t.result.markers })) });
      }
      if (req.method === 'POST' && url.pathname === '/api/native') {
        if (busy) return json(res, 409, { error: '上一项宿主操作尚未完成' });
        busy = true;
        try {
          const body = await readBody(req);
          if (body.action === 'remove') return json(res, 200, await removeNative());
          if (body.action !== 'apply' || !['poster', 'video'].includes(body.media)) throw new Error('未知接入操作');
          return json(res, 200, await attachNative(body.media, body.targetId));
        } finally { busy = false; }
      }
      return json(res, 404, { error: '未找到入口' });
    } catch (error) {
      if (res.headersSent) res.destroy();
      else json(res, error.code === 'ENOENT' ? 404 : 400, { error: error.code === 'ENOENT' ? '资源不存在，请检查本地文件' : error.message });
    }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  const url = `${origin}/#${token}`;
  const resourceResults=new Map();
  const timer = setInterval(async () => {
    if (!native || busy) return;
    busy = true;
    const current = native;
    try {
      const state = await current.session.run('heartbeat');
      if (native !== current) return;
      if (!state?.applied) { current.session.close(); native = null; }
      else {
        current.media = state.media; current.error = state.error;current.playback=state.playback;
        const results=[];for(const request of state.resourceRequests??[]){if(!resourceResults.has(request.id)){try{resourceResults.set(request.id,{id:request.id,value:await resourceAction(request.action,request.payload)});}catch(e){resourceResults.set(request.id,{id:request.id,error:e.message});}if(resourceResults.size>100)resourceResults.delete(resourceResults.keys().next().value);}results.push(resourceResults.get(request.id));}
        if(state.playback?.enabled&&state.playback.recentSlowFrames>=8&&state.playback.slots?.[state.playback.activeSlot]?.width>=3840)await resources.action('degrade',{sceneId:state.playback.sceneId});
        playbackCache.observe(state.pending??settings,state.playback);
        if(results.length||state.resourceRevision!==resourceRevision()||playbackCache.publicState().jobs.some(j=>['queued','running'].includes(j.status))||resources.publicState().jobs.some(j=>!['complete','failed','cancelled','interrupted'].includes(j.status)))await current.session.run('resources',{results,info:resourceState(),...(state.resourceRevision!==resourceRevision()?{scenes:nativeCatalog()}:{} )});
        if (state.pending) {
          try {
            const next = validateSettings(state.pending);
            await persistSettings(next);
            await current.session.run('saved',{revision:state.pendingRevision});
          } catch(error) {
            await current.session.run('saved',{revision:state.pendingRevision,error:error.message});
            throw error;
          }
        }
      }
    } catch(error) { current.error = error.message; if(current.session.ws?.readyState !== 1) { current.session.close(); if(native===current)native=null; } }
    finally { busy = false; }
  }, 1000); timer.unref();
  if(autoUpdate)updater.schedule();
  async function close() {
    clearInterval(timer);
    await updater.close();
    await installer.close();
    await playbackCache.close();
    await resources.close();
    try { await removeNative(); } catch { native?.session.close(); native = null; }
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  return { server, url, token, origin, close, refreshHost, attachNative,resources,playbackCache,updater };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const lab = await startServer({autoUpdate:true});
  await fs.writeFile(path.join(local, 'session.json'), JSON.stringify({ url: lab.url, pid: process.pid, version:VERSION }, null, 2));
  console.log(`主题实验室已启动：${lab.url}\n关闭此进程会恢复本次应用的视觉层。`);
  if (process.argv.includes('--open')) {
    spawn('powershell.exe', ['-NoProfile', '-Command', 'Start-Process -FilePath $env:ARK_LAB_URL'], { windowsHide: true, stdio: 'ignore', env: { ...process.env, ARK_LAB_URL: lab.url } }).unref();
  }
  if (process.argv.includes('--auto-attach')) {
    (async () => {
      for (let attempt = 0; attempt < 15; attempt++) {
        try { await lab.attachNative(); console.log('桌面主题已接入'); return; }
        catch(error) {
          if (attempt === 14) { console.error(`自动接入未完成：${error.message}`); return; }
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
    })();
  }
  let closing = false;
  for (const event of ['SIGINT', 'SIGTERM']) process.on(event, async () => { if (closing) return; closing = true; await lab.close(); process.exit(0); });
}
