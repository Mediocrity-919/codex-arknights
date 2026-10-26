import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {ROOT,resourceCatalog,defaults} from '../src/catalog.mjs';
import {startServer} from '../src/server.mjs';
if(!globalThis.ARK_ACCEPTANCE_FIXTURE_INFO)throw Error('Requires disposable acceptance fixtures');
for(const id of ['yaoyue','eyja']){const file=path.resolve(ROOT,resourceCatalog.files[id].original.file);assert.ok(file.startsWith(path.join(ROOT,'.local','acceptance-media')+path.sep));await fs.unlink(file).catch(e=>{if(e.code!=='ENOENT')throw e;});}
const require=createRequire(path.join(process.env.ARK_TEST_MODULES,'package.json')),{chromium}=require('playwright'),dir=await fs.mkdtemp(path.join(ROOT,'.local','dynamic-download-ui-'));
const lab=await startServer({stateDir:dir,probeHost:async()=>({debuggerVerified:false})}),browser=await chromium.launch({headless:true,executablePath:process.env.ARK_CHROME??'C:/Program Files/Google/Chrome/Application/chrome.exe'}),page=await browser.newPage({viewport:{width:1366,height:768}}),checks=[];
try{
 await page.goto(lab.url);await page.locator('#theme-open').click();const ui=page.locator('#wallpaper-library');await ui.locator('[data-kind="dynamic"]').click();await ui.locator('[data-category="background"]').click();await ui.locator('[data-id="yaoyue"]').click();
 const button=ui.locator('.download-resource');assert.match(await button.textContent(),/下载 4K/);const box=await button.boundingBox();assert.ok(box.y>=0&&box.y+box.height<=768,'Download button is outside the visible footer');await button.click();
 assert.match(await ui.locator('.resource-original').textContent(),/下载 4K 原片/);assert.equal(await ui.locator('.resource-original').isEnabled(),true);assert.equal(await ui.locator('.resource-4k').isVisible(),false);assert.match(await ui.locator('.resource-ai-note').textContent(),/无需本机超分/);checks.push('Fresh Yaoyue offers a visible enabled 4K source download; no AI setup required');
 await ui.locator('.resource-original').click();await page.waitForFunction(()=>document.querySelector('#wallpaper-library').shadowRoot.querySelector('.resource-jobs').textContent.includes('已完成'));assert.equal(lab.resources.status('yaoyue').original,true);checks.push('Download button completes using the production resource action');
 await ui.locator('.resource-close').click();await ui.locator('[data-category="operator"]').click();await ui.locator('.search input').fill('纯烬艾雅法拉');await ui.locator('.card').first().click();await ui.locator('[data-id="eyja"]').click();await ui.locator('.download-resource').click();assert.match(await ui.locator('.resource-original').textContent(),/暂无在线下载源/);assert.equal(await ui.locator('.resource-original').isEnabled(),false);assert.match(await ui.locator('.resource-ai-note').textContent(),/没有在线下载源/);checks.push('Other local-only clips clearly identify the missing online source');
 await page.screenshot({path:path.join(ROOT,'test-results/dynamic-download-ui.png')});console.log(JSON.stringify({passed:true,checks}));await fs.writeFile(path.join(ROOT,'test-results/dynamic-download-ui.json'),JSON.stringify({passed:true,checks},null,2));
}finally{await browser.close();await lab.close();}
