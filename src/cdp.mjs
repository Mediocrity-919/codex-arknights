import { nativeLayer } from './native-layer.mjs';
import { createMediaDeck } from './media-player.mjs';
import { createWallpaperLibrary } from './wallpaper-library.mjs';
import { createWallpaperPlayer } from './wallpaper-runtime.mjs';

export function validateDebuggerUrl(value, port, id) {
  const u = new URL(value);
  if (u.protocol !== 'ws:' || u.hostname !== '127.0.0.1' || u.port !== String(port) || u.username || u.password || u.search || u.hash || !/^[a-zA-Z0-9_-]+$/.test(id) || u.pathname !== `/devtools/page/${id}`) throw new Error('拒绝非预期调试地址');
  return u.href;
}
export class CdpSession {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
  async connect() {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener('message', e => {
      let message; try { message = JSON.parse(e.data); } catch { return; }
      const pending = this.pending.get(message.id); if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`宿主调试命令失败: ${message.error.message}`)); else pending.resolve(message.result);
    });
    this.ws.addEventListener('close', () => this.rejectPending());
    this.ws.addEventListener('error', () => this.rejectPending());
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.close(); reject(new Error('连接宿主超时')); }, 4000);
      this.ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      this.ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('无法连接宿主')); }, { once: true });
    });
    return this;
  }
  rejectPending() { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('宿主连接已关闭')); } this.pending.clear(); }
  async call(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('宿主命令超时')); }, 6500);
      this.pending.set(id, { resolve, reject, timer });
      try { this.ws.send(JSON.stringify({ id, method, params })); } catch { clearTimeout(timer); this.pending.delete(id); reject(new Error('宿主连接不可用')); }
    });
  }
  async run(command, payload) {
    const factories=command==='apply'?`,${createMediaDeck.toString()},${createWallpaperLibrary.toString()},${createWallpaperPlayer.toString()}`:'';
    const expression = `(${nativeLayer.toString()})(${JSON.stringify(command)},${JSON.stringify(payload ?? {})}${factories})`;
    const result = await this.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error('宿主未通过结构检测或背景资源加载失败');
    return result.result?.value;
  }
  close() { this.rejectPending(); this.ws?.close(); }
}
export function verifiedDebuggerPort(probe) {
  const port=probe.debugPort;
  if(!probe.debuggerVerified||!Number.isInteger(port)||port<1||port>65535||probe.listener?.port!==port||probe.listener?.pid!==probe.mainPid) throw new Error('宿主调试端口未通过进程归属校验');
  return port;
}
export async function listVerifiedTargets(probe) {
  if (!probe.debuggerVerified) return [];
  const port=verifiedDebuggerPort(probe);
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2500), redirect: 'error' });
  if (!response.ok) throw new Error('读取宿主窗口失败');
  const targets = await response.json();
  if (!Array.isArray(targets) || targets.length > 100) throw new Error('宿主窗口列表无效');
  const eligible = [];
  for (const target of targets) {
    if (target.type !== 'page' || !target.url?.startsWith('app://')) continue;
    let session;
    try {
      const url = validateDebuggerUrl(target.webSocketDebuggerUrl, port, target.id);
      session = await new CdpSession(url).connect();
      const result = await session.run('inspect');
      if (result?.eligible) eligible.push({ id: target.id, url, result });
    } catch {} finally { session?.close(); }
  }
  return eligible;
}
