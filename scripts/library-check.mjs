import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {ROOT,scenes,professions,mediaPath} from '../src/catalog.mjs';
import {startServer} from '../src/server.mjs';
const require=createRequire(path.join(process.env.ARK_TEST_MODULES,'package.json'));
const {chromium}=require('playwright');
const dir=await fs.mkdtemp(path.join(ROOT,'.local','library-test-'));
const lab=await startServer({stateDir:dir,probeHost:async()=>({debuggerVerified:false})});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[],results=[];
page.on('pageerror',e=>errors.push(e.message));
const headers={'X-Lab-Token':lab.token},state=async()=> (await (await fetch(lab.origin+'/api/state',{headers})).json()).settings;
try{
 const art=scenes.filter(s=>s.kind==='static');assert.equal(art.length,1489);assert.equal(new Set(art.map(s=>s.operator)).size,462);assert.equal(new Set(art.map(s=>s.profession)).size,8);assert.equal(new Set(scenes.map(s=>s.id)).size,scenes.length);
 for(const scene of art){assert.equal((await fs.stat(mediaPath(scene.id,'thumb'))).size>0,true);}
 results.push('1489 originals indexed, 462 operator groups, eight professions, unique stable IDs and all thumbnails present');
 await page.goto(lab.url);await page.locator('#theme-open').click();const lib=page.locator('#wallpaper-library');
 await lib.locator('[data-kind="static"]').click();await lib.locator('[data-category="operator"]').click();
 assert.match(await lib.locator('.total').textContent(),/462.*1489/);assert.equal(await lib.locator('.card').count(),36);
 await page.screenshot({path:path.join(ROOT,'test-results/library-static.png')});
 for(const profession of professions){await lib.locator(`[data-profession="${profession}"]`).click();assert.equal(await lib.locator('.card').count()>0,true);assert.equal(await lib.locator('.card .profession').evaluateAll(nodes=>new Set(nodes.map(n=>n.textContent)).size),1);}
 await lib.locator('[data-profession="先锋"]').click();await lib.locator('input[type=search]').fill('伊内丝');assert.equal(await lib.locator('.card').count(),1);await lib.locator('.card').click();
 const initial=await state();await lib.locator('.view').click();await lib.locator('.full img').evaluate(e=>e.decode());assert.equal((await state()).sceneId,initial.sceneId);await lib.locator('.zoom-toggle').click();assert.equal(await lib.locator('.viewer').evaluate(e=>e.classList.contains('zoom')),true);await page.keyboard.press('Escape');assert.equal(await lib.locator('.shell').isVisible(),true);
 const skin=art.find(s=>s.operator==='伊内丝'&&s.variantKey==='skin1');await lib.locator(`[data-variant="${skin.id}"]`).click();await lib.locator('.apply').click();await page.waitForFunction(()=>document.querySelector('#wallpaper-library').shadowRoot.querySelector('.status').textContent.includes('已应用'));
 assert.equal((await state()).sceneId,skin.id);await page.reload();await page.locator('#theme-open').click();assert.equal(await lib.locator('.apply').textContent(),'正在使用');
 results.push('profession filters, operator search, original preview/zoom without applying, variant application and reload persistence');
 await lib.locator('[data-kind="dynamic"]').click();await lib.locator('[data-profession="重装"]').click();assert.equal(await lib.locator('.card').count(),1);assert.match(await lib.locator('.total').textContent(),/1.*2/);await lib.locator('.card').click();await lib.locator('[data-variant="shu-2"]').click();await lib.locator('.play').click();await lib.locator('.preview video').evaluate(v=>new Promise((resolve,reject)=>{if(v.readyState>=2)return resolve();v.addEventListener('loadeddata',resolve,{once:true});v.addEventListener('error',reject,{once:true});}));assert.equal((await state()).sceneId,skin.id);
 await lib.locator('[data-profession="近卫"]').click();assert.equal(await lib.locator('.empty').isVisible(),true);assert.equal(await lib.locator('video').count(),0);
 await lib.locator('[data-category="background"]').click();assert.equal(await lib.locator('.card').count(),1);await lib.locator('.apply').click();await page.waitForFunction(()=>document.querySelector('#wallpaper-library').shadowRoot.querySelector('.status').textContent.includes('已应用'));assert.equal((await state()).sceneId,'yaoyue');
 await lib.locator('[data-kind="static"]').click();assert.equal(await lib.locator('.empty').isVisible(),true);await lib.locator('[data-category="operator"]').click();await lib.locator('.next').click();assert.equal(await lib.locator('.pager span').textContent(),'2 / 13');
 await page.setViewportSize({width:900,height:700});await page.screenshot({path:path.join(ROOT,'test-results/library-narrow.png')});assert.equal(await lib.locator('.shell').evaluate(e=>e.getBoundingClientRect().right<=innerWidth),true);
 results.push('dynamic class grouping, preview cleanup, explicit empty states, static-to-video, pagination and narrow layout');
 assert.deepEqual(errors,[]);await fs.writeFile(path.join(ROOT,'test-results/library-results.json'),JSON.stringify({results,errors},null,2));console.log(JSON.stringify({results,errors},null,2));
}finally{await browser.close();await lab.close();if(path.dirname(dir)!==path.join(ROOT,'.local'))throw Error('Unexpected test directory');await fs.rm(dir,{recursive:true,force:true});}
