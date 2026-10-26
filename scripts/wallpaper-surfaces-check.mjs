// Isolated structural/interaction regression for the desktop page and floating panel.
// The native host is verified separately; this fixture never opens or edits a chat.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {ROOT,defaults,scenes} from '../src/catalog.mjs';
import {nativeLayer} from '../src/native-layer.mjs';
import {createMediaDeck} from '../src/compositor.mjs';
import {createWallpaperPlayer} from '../src/wallpaper-runtime.mjs';
import {createWallpaperLibrary} from '../src/wallpaper-library.mjs';
import {startServer} from '../src/server.mjs';
const require=createRequire(path.join(process.env.ARK_TEST_MODULES,'package.json')),{chromium}=require('playwright');
const dir=await fs.mkdtemp(path.join(ROOT,'.local','surfaces-test-'));
const lab=await startServer({stateDir:dir,probeHost:async()=>({debuggerVerified:false})});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1480,height:960},bypassCSP:true}),errors=[],results=[];
page.on('pageerror',e=>errors.push(e.message));
const library=page.locator('#wallpaper-library'),shell=library.locator('.shell');
const input=async(selector,value)=>library.locator(selector).evaluate((e,value)=>{e.value=String(value);e.dispatchEvent(new Event('input',{bubbles:true}));},value);
const q='document.querySelector("#ark-theme-controls").shadowRoot.querySelector("#wallpaper-library").shadowRoot';
const report=file=>fs.writeFile(path.join(ROOT,'test-results',file),JSON.stringify({results,errors},null,2));
try{
  await page.goto(lab.origin+'/test');
  await page.setContent(`<style>body{margin:0;background:#181818;color:#eee;font:14px 'Segoe UI'}#root{position:fixed;inset:0}aside{position:fixed;left:52px;top:44px;bottom:0;width:188px}nav{position:fixed;left:0;top:44px;bottom:0;width:52px}nav>div{display:flex;align-items:center;flex-direction:column;gap:8px}main{position:fixed;left:240px;right:0;top:44px;bottom:0;background:rgb(24,24,24)}[data-app-shell-titlebar]{position:fixed;left:240px;right:0;top:44px;height:52px}#fixture-content{padding:130px 40px}button{cursor:pointer}#root button{color:#ddd;background:#333;border:0;padding:8px}textarea{display:block}</style><div id="root"><div data-app-shell-frame><div class="_ApplicationMenuTopBar_fixture" style="height:44px">菜单</div></div><aside class="app-shell-left-panel">原生侧栏<nav data-app-navigation-rail><div data-appearance="plain"><button data-sidebar-destination="images">图像</button></div></nav><button data-settings-panel-slug="appearance">外观</button></aside><main data-app-shell-main-surface aria-hidden="false"><div data-codex-history-swipe-page><div class="electron:bg-surface" style="position:absolute;inset:0"><div id="fixture-content">原生页面保持挂载<div data-composer-body><textarea aria-label="fixture input">fixture preserved</textarea></div></div></div></div></main><div data-app-shell-titlebar>原生标题栏</div></div>`);
  const source=scenes.filter(s=>s.kind==='static'&&s.operator==='Mon3tr').slice(0,3),bg=scenes.find(s=>s.role==='scene'),complete=scenes.find(s=>s.role==='complete');
  const selected=[...source,bg,complete],resources=Object.fromEntries(selected.map(s=>[`app://fs/@fs/D:/${s.id}.png`,`${lab.origin}/media/${s.id}/poster?key=${lab.token}`]));
  const catalog=selected.map(s=>({...s,poster:`app://fs/@fs/D:/${s.id}.png`,thumb:`app://fs/@fs/D:/${s.id}.png`}));
  const payload={settings:{...defaults,sceneId:source[0].id,motion:false},poster:catalog[0].poster,scenes:catalog};
  await page.evaluate(`(async()=>{const location={protocol:'app:',get href(){return window.location.href}},resources=${JSON.stringify(resources)};const Image=class extends window.Image{set src(v){super.src=resources[v]??v;}get src(){return super.src;}};window.fixtureComposer=document.querySelector('textarea');window.fixtureIds=${JSON.stringify({art:source[0].id,other:source[1].id,bg:bg.id,complete:complete.id})};return (${nativeLayer.toString()})('apply',${JSON.stringify(payload)},${createMediaDeck.toString()},${createWallpaperLibrary.toString()},${createWallpaperPlayer.toString()});})()`);
  const heartbeat=setInterval(()=>page.evaluate(()=>{const s=window.__ARK_THEME_LAB_V1__;if(s){s.heartbeat=Date.now();if(s.pending){window.fixtureSavedState=structuredClone(s.pending);s.confirmSave(s.pendingRevision);}}}).catch(()=>{}),2000);
  try{
    await page.waitForFunction(()=>window.__ARK_THEME_LAB_V1__.player.diagnostics().sceneId===fixtureIds.art);
    await page.locator('#ark-theme-nav-button button').click();await shell.waitFor({state:'visible'});
    assert.deepEqual(await shell.boundingBox(),await page.locator('main').boundingBox());
    assert.equal(await shell.evaluate(e=>getComputedStyle(e).borderRadius),'0px');
    assert.equal(await page.locator('main').evaluate(e=>e.inert),true);
    assert.equal(await page.locator('main').evaluate(e=>getComputedStyle(e).opacity),'0');
    assert.equal(await library.locator('.card').count(),source.length);
    await library.locator('.save-picker').click();await library.locator('.saved-menu').waitFor({state:'visible'});
    await page.keyboard.press('Escape');assert.equal(await library.locator('.saved-menu').isVisible(),false);assert.equal(await shell.isVisible(),true);
    await page.keyboard.press('Escape');assert.equal(await shell.isVisible(),false);assert.equal(await page.locator('main').evaluate(e=>e.inert),false);
    await page.locator('#ark-theme-nav-button button').click();await shell.waitFor({state:'visible'});
    results.push({check:'saved menu Escape closes only the popover; next Escape restores native input and page',passed:true});
    await library.locator('.view').click();await page.keyboard.press('Escape');
    assert.equal(await library.locator('.full').isVisible(),false);assert.equal(await shell.isVisible(),true);
    await page.screenshot({path:path.join(ROOT,'test-results/v08-page-fixture.png')});
    results.push({check:'page matches main surface exactly, native main/title covered without unmount, all operator versions remain selectable',passed:true});

    await library.locator('.adjust-current').click();await page.waitForFunction(`${q}.querySelector('.shell').classList.contains('adjust')`);
    assert.equal((await shell.boundingBox()).width,300);
    assert.equal(await page.locator('main').evaluate(e=>e.inert),false);
    assert.equal(await page.locator('main').getAttribute('aria-hidden'),'false');
    assert.equal(await library.locator('.preview video').count(),0);
    await input('.inline-scale',143);await input('.inline-x',62);
    // Switch immediately, before the 100 ms coalesced save. open() must await it.
    await library.locator('.browse-wallpapers').click();await page.waitForFunction(`${q}.querySelector('.shell').classList.contains('adjust')===false`);
    assert.equal(await library.locator('.inline-scale').inputValue(),'143');
    assert.equal(await library.locator('.inline-x').inputValue(),'62');
    assert.equal(await page.evaluate(()=>(window.__ARK_THEME_LAB_V1__.pending??window.fixtureSavedState).wallpaper.subject.scale),1.43);
    await input('.inline-scale',171);await library.locator('.adjust-current').click();
    await page.waitForFunction(`${q}.querySelector('.shell').classList.contains('adjust')`);
    assert.equal(await library.locator('.inline-scale').inputValue(),'171');
    const opacity=library.locator('.appearance input').first();await opacity.evaluate(e=>{e.value='84';e.dispatchEvent(new Event('input',{bubbles:true}));});
    await library.locator('.browse-wallpapers').click();await page.waitForFunction(`${q}.querySelector('.shell').classList.contains('adjust')===false`);
    assert.equal(await library.locator('.appearance input').first().inputValue(),'84');
    await library.locator('.adjust-current').click();await page.waitForFunction(`${q}.querySelector('.shell').classList.contains('adjust')`);
    results.push({check:'bidirectional subject transform and appearance sync, including immediate mode switches before deferred save',passed:true});

    await page.locator('textarea').click();assert.equal(await shell.isVisible(),true);
    await library.locator('.preview-only').click();assert.equal(await page.locator('#root').evaluate(e=>e.inert),true);
    assert.equal(await page.locator('#root').evaluate(e=>getComputedStyle(e).opacity),'0');
    await page.screenshot({path:path.join(ROOT,'test-results/v08-adjust-fixture.png')});
    const before=await shell.boundingBox(),heading=await library.locator('.heading h2').boundingBox();
    await page.mouse.move(heading.x+10,heading.y+8);await page.mouse.down();await page.mouse.move(heading.x-460,heading.y+160,{steps:8});await page.mouse.up();
    assert.ok((await shell.boundingBox()).x<before.x-400);
    await library.locator('.collapse-adjust').click();assert.ok((await shell.boundingBox()).height<125);
    await library.locator('.collapse-adjust').click();
    await page.setViewportSize({width:820,height:650});await page.waitForTimeout(150);
    const moved=await shell.boundingBox();assert.ok(moved.x>=10&&moved.x+moved.width<=810&&moved.y>=44&&moved.y+moved.height<=650,JSON.stringify(moved));
    // Match the real host's global keydown interception. Our keyup fallback
    // must still restore the workspace without touching that native listener.
    await page.evaluate(()=>window.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();}},{capture:true,once:true}));
    await page.keyboard.press('Escape');await shell.waitFor({state:'hidden'});
    assert.equal(await page.locator('#root').evaluate(e=>e.inert),false);
    assert.equal(await page.locator('[data-ark-wallpaper-peek]').count(),0);
    results.push({check:'outside click stays open; wallpaper-only preview, drag, collapse, resize and Escape restore original UI',passed:true});

    await page.setViewportSize({width:1480,height:960});
    await page.locator('#ark-wallpaper-settings-entry').click();await shell.waitFor({state:'visible'});
    assert.deepEqual(await shell.boundingBox(),await page.locator('[data-ark-settings-surface]').boundingBox());
    await page.locator('[data-sidebar-destination]').click();await shell.waitFor({state:'hidden'});
    assert.equal(await page.locator('[data-ark-wallpaper-covered]').count(),0);
    await page.locator('#ark-theme-nav-button button').click();await shell.waitFor({state:'visible'});
    await page.evaluate(()=>history.pushState({},'',location.pathname+'?native-navigation=1'));await page.evaluate(()=>document.querySelector('#fixture-content').append(document.createElement('span')));
    await shell.waitFor({state:'hidden'});
    await page.locator('#ark-wallpaper-adjust-button button').click();await shell.waitFor({state:'visible'});
    await page.evaluate(()=>{const state=window.__ARK_THEME_LAB_V1__;state.update({...window.fixtureSavedState,...state.pending,sceneId:fixtureIds.complete,wallpaper:null,motion:false});});
    await page.waitForFunction(`${q}.querySelector('.inline-adjust [data-inline-target="view"]')?.getAttribute('aria-pressed')==='true'`).catch(async()=>{assert.equal(await library.locator('.detail h3').textContent(),complete.name);});
    assert.equal(await library.locator('.detail h3').textContent(),complete.name);
    await library.locator('.preview-only').click();
    await page.evaluate(()=>window.__ARK_THEME_LAB_V1__.cleanup());
    assert.equal(await page.locator('[data-ark-wallpaper-covered],[data-ark-wallpaper-peek],#ark-wallpaper-adjust-button,#ark-theme-controls').count(),0);
    assert.equal(await page.evaluate(()=>fixtureComposer===document.querySelector('textarea')),true);
    assert.equal(await page.locator('textarea').inputValue(),'fixture preserved');
    assert.equal(await page.locator('main').getAttribute('aria-hidden'),'false');
    assert.deepEqual(errors,[]);
    results.push({check:'settings page, native navigation exit, current wallpaper follow, emergency cleanup and composer identity preserved',passed:true});
    await report('wallpaper-surfaces-results.json');console.log(JSON.stringify({results,errors},null,2));
  }finally{clearInterval(heartbeat);}
}catch(e){await page.screenshot({path:path.join(ROOT,'test-results/v08-surface-failure.png')}).catch(()=>{});await report('wallpaper-surfaces-failure.json');throw e;}
finally{await browser.close();await lab.close();if(path.dirname(dir)!==path.join(ROOT,'.local'))throw Error('Unexpected fixture directory');await fs.rm(dir,{recursive:true,force:true});}
