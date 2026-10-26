import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { defaults, validateSettings, mediaPath, nativeFileUrl } from '../src/catalog.mjs';
import { parseRange } from '../src/range.mjs';
import { validateDebuggerUrl, verifiedDebuggerPort, listVerifiedTargets } from '../src/cdp.mjs';
import { startServer } from '../src/server.mjs';

test('video byte ranges support browser seeking and reject invalid requests', () => {
  assert.deepEqual(parseRange('bytes=100-199', 1000), { start:100,end:199 });
  assert.deepEqual(parseRange('bytes=900-', 1000), { start:900,end:999 });
  assert.deepEqual(parseRange('bytes=-50', 1000), { start:950,end:999 });
  assert.deepEqual(parseRange('bytes=0-9999', 1000), { start:0,end:999 });
  for (const value of ['bytes=1000-','bytes=20-10','bytes=-0','bytes=0-1,3-4','bytes=-','bytes=999999999999999999999-']) assert.throws(() => parseRange(value,1000));
});
test('theme config does not admit scripts, non-finite values, paths or unknown scenes', () => {
  assert.deepEqual(validateSettings(defaults),defaults);
  for (const value of [{script:'alert(1)'},{sceneId:'../../secret'},{blur:Infinity},{panel:-.1},{composerOpacity:1.1},{motion:'true'},{schemaVersion:2},{quality:'pretend-4k60'}]) assert.throws(() => validateSettings({...defaults,...value}));
  const transparent = validateSettings({...defaults,panel:0,composerOpacity:0});
  assert.equal(transparent.strength, defaults.strength);
  assert.equal(validateSettings({schemaVersion:1,sceneId:'eyja'}).composerOpacity, defaults.composerOpacity);
  const legacy=validateSettings({schemaVersion:1,sceneId:'eyja',panel:0,strength:1,composerBlur:0});
  assert.equal(legacy.chromeBlur,0);assert.equal(legacy.summaryBlur,0);assert.equal(legacy.panel,0);assert.equal(legacy.strength,1);
  for(const key of ['chromeBlur','summaryBlur'])for(const value of [-1,25,NaN,'12'])assert.throws(()=>validateSettings({[key]:value}));
  assert.throws(() => mediaPath('../PLAN.md'));
  assert.match(nativeFileUrl('D:\\test #?\\邀月.mp4'), /^app:\/\/fs\/@fs\/D:\/test%20%23%3F\//);
});
test('CDP connection is pinned to a verified local target, not arbitrary URLs', () => {
  assert.equal(validateDebuggerUrl('ws://127.0.0.1:9376/devtools/page/ABC-1',9376,'ABC-1'),'ws://127.0.0.1:9376/devtools/page/ABC-1');
  for (const url of ['ws://example.com:9376/devtools/page/ABC-1','ws://127.0.0.1:9377/devtools/page/ABC-1','ws://user@127.0.0.1:9376/devtools/page/ABC-1','ws://127.0.0.1:9376/devtools/page/OTHER','ws://127.0.0.1:9376/devtools/page/ABC-1?x=1']) assert.throws(() => validateDebuggerUrl(url,9376,'ABC-1'));
});

test('CDP discovery uses the verified live port and rejects mismatched ownership', async () => {
  let hits=0;
  const server=http.createServer((req,res)=>{assert.equal(req.url,'/json/list');hits++;res.setHeader('Content-Type','application/json');res.end('[]');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port,probe={debuggerVerified:true,mainPid:process.pid,debugPort:port,listener:{pid:process.pid,port}};
  try {
    assert.equal(verifiedDebuggerPort(probe),port);
    assert.deepEqual(await listVerifiedTargets(probe),[]);assert.equal(hits,1);
    for(const invalid of [{...probe,debugPort:0},{...probe,debugPort:70000},{...probe,listener:{pid:process.pid+1,port}},{...probe,listener:{pid:process.pid,port:port+1}}]) {
      await assert.rejects(listVerifiedTargets(invalid));
    }
    assert.equal(hits,1);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('HTTP boundary, persistence, range serving and blocked native access', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'ark-lab-test-'));
  const lab = await startServer({stateDir:dir,probeHost:async()=>({debuggerVerified:false,reason:'debug-not-enabled',running:true,package:{version:'test'}})});
  const headers = {'X-Lab-Token':lab.token,'Content-Type':'application/json',Origin:lab.origin};
  try {
    assert.equal((await fetch(`${lab.origin}/api/state`)).status,401);
    assert.equal((await fetch(`${lab.origin}/media/yaoyue/video`)).status,401);
    assert.equal((await fetch(`${lab.origin}/api/settings`,{method:'POST',headers:{...headers,Origin:'https://untrusted.example'},body:'{}'})).status,403);
    assert.equal((await fetch(`${lab.origin}/api/settings`,{method:'POST',headers,body:JSON.stringify({...defaults,blur:99})})).status,400);
    const desired={...defaults,sceneId:'shu-2',blur:3,strength:.6};
    assert.equal((await fetch(`${lab.origin}/api/settings`,{method:'POST',headers,body:JSON.stringify(desired)})).status,200);
    const state=await (await fetch(`${lab.origin}/api/state`,{headers})).json();
    assert.deepEqual(state.settings,desired);assert.equal(state.native.applied,false);
    assert.equal(state.host.executable,undefined);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,'settings.json'),'utf8')),desired);
    const clip = await fetch(`${lab.origin}/media/welcome/poster?key=${lab.token}`,{headers:{Range:'bytes=0-31'}});
    assert.equal(clip.status,206);assert.equal((await clip.arrayBuffer()).byteLength,32);
    assert.equal(clip.headers.get('Content-Range'),`bytes 0-31/${(await fs.stat(mediaPath('welcome'))).size}`);
    assert.equal((await fetch(`${lab.origin}/media/PLAN/video?key=${lab.token}`)).status,404);
    const refused=await fetch(`${lab.origin}/api/native`,{method:'POST',headers,body:JSON.stringify({action:'apply',media:'poster'})});
    assert.equal(refused.status,400);assert.equal((await refused.json()).error,'debug-not-enabled');
    const restored=await (await fetch(`${lab.origin}/api/native`,{method:'POST',headers,body:'{"action":"remove"}'})).json();
    assert.equal(restored.restored,false);
  } finally {
    await lab.close();
    if (path.dirname(path.resolve(dir)) !== path.resolve(os.tmpdir()) || !path.basename(dir).startsWith('ark-lab-test-')) throw new Error('Unexpected temporary test directory');
    await fs.rm(dir,{recursive:true,force:true});
  }
});
