// Isolated browser fixture of serialized desktop code, not a real-host integration claim.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {ROOT,defaults} from '../src/catalog.mjs';
import {nativeLayer} from '../src/native-layer.mjs';
import {createMediaDeck} from '../src/compositor.mjs';
import {createWallpaperPlayer} from '../src/wallpaper-runtime.mjs';
import {createWallpaperLibrary} from '../src/wallpaper-library.mjs';
import {startServer} from '../src/server.mjs';
const require=createRequire(path.join(process.env.ARK_TEST_MODULES,'package.json')),{chromium}=require('playwright');
const dir=await fs.mkdtemp(path.join(ROOT,'.local','native-v06-fixture-'));
const lab=await startServer({stateDir:dir,probeHost:async()=>({debuggerVerified:false})});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto(lab.origin+'/test');await page.setContent('<div id="root"><aside class="app-shell-left-panel"><nav data-app-navigation-rail><div data-appearance="plain"></div></nav></aside><main data-app-shell-main-surface><div data-composer-body><textarea></textarea></div></main></div>');
  const poster=`data:image/jpeg;base64,${(await fs.readFile(path.join(ROOT,'.local/posters/yaoyue.jpg'))).toString('base64')}`;
  const base={kind:'static',width:3840,height:2160,rarity:6,profession:'近卫',poster:'app://fs/@fs/D:/fixture.png',thumb:'app://fs/@fs/D:/fixture.png'};
  const catalog=[{...base,id:'art',name:'测试干员',operator:'测试干员',category:'operator',fit:'contain'},{...base,id:'bg',name:'测试场景',category:'background',role:'scene',fit:'cover'}];
  const payload={settings:{...defaults,sceneId:'art',motion:false},poster:base.poster,scenes:catalog};
  // Replace only the fixture resource loader and protocol environment, retaining the native factory validation.
  await page.evaluate(`(async()=>{const location={protocol:'app:'};const Image=class extends window.Image{set src(v){super.src=v.startsWith('app://fs/')?${JSON.stringify(poster)}:v;}get src(){return super.src;}};return (${nativeLayer.toString()})('apply',${JSON.stringify(payload)},${createMediaDeck.toString()},${createWallpaperLibrary.toString()},${createWallpaperPlayer.toString()});})()`);
  await page.waitForFunction(()=>window.__ARK_THEME_LAB_V1__.player.diagnostics().sceneId==='art');
  await page.locator('#ark-theme-nav-button button').click();
  const library=page.locator('#wallpaper-library');await library.locator('.edit').click();await library.locator('.edit-x').fill('65');await library.locator('.editor-apply').click();
  await library.locator('.editor-message').filter({hasText:'已应用'}).waitFor();
  assert.equal(await page.evaluate(()=>window.__ARK_THEME_LAB_V1__.pending.wallpaper.subject.x),65);
  await library.locator('.editor-add').click();await library.locator('.queue-start').click();await library.locator('.queue-message').filter({hasText:'已开始'}).waitFor();
  const settings=await page.evaluate(()=>window.__ARK_THEME_LAB_V1__.pending);assert.equal(settings.playlists.length,1);assert.equal(settings.activePlaylistId,settings.playlists[0].id);assert.equal(settings.playlists[0].backgroundId,'bg');
  await library.locator('.queue-background').selectOption('');await library.locator('.queue-save').click();await library.locator('.queue-message').filter({hasText:'请选择'}).waitFor({timeout:1000}).catch(()=>{});
  assert.match(await library.locator('.queue-message').textContent(),/共用背景/);
  await library.locator('.queue-background').selectOption('bg');
  await page.evaluate(()=>window.__ARK_THEME_LAB_V1__.cleanup());
  assert.equal(await page.locator('#ark-theme-lab-layer').count(),0);assert.equal(await page.locator('textarea').count(),1);assert.deepEqual(errors,[]);
  const report={realHost:false,passed:true,checks:['serialized three-factory desktop adapter','composition applied and native pending settings updated','mixed queue configured through native shadow UI','invalid shared background rejected','cleanup preserves original input'],errors};
  await fs.writeFile(path.join(ROOT,'test-results/native-v06-fixture.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();await lab.close();if(path.dirname(dir)!==path.join(ROOT,'.local'))throw Error('Unexpected fixture directory');await fs.rm(dir,{recursive:true,force:true});}
