import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {ROOT,resourceCatalog,sceneById} from '../src/catalog.mjs';
import {startServer} from '../src/server.mjs';
if(!globalThis.ARK_ACCEPTANCE_FIXTURE_INFO)throw Error('Requires disposable acceptance fixtures');
const ids=['yaoyue','eyja','shu-1','shu-2'];
for(const id of ids){const file=path.resolve(ROOT,resourceCatalog.files[id].original.file);assert.ok(file.startsWith(path.join(ROOT,'.local','acceptance-media')+path.sep));await fs.unlink(file).catch(e=>{if(e.code!=='ENOENT')throw e;});}
const require=createRequire(path.join(process.env.ARK_TEST_MODULES,'package.json')),{chromium}=require('playwright'),dir=await fs.mkdtemp(path.join(ROOT,'.local','dynamic-download-ui-'));
const lab=await startServer({stateDir:dir,probeHost:async()=>({debuggerVerified:false})}),browser=await chromium.launch({headless:true,executablePath:process.env.ARK_CHROME??'C:/Program Files/Google/Chrome/Application/chrome.exe'}),page=await browser.newPage({viewport:{width:1366,height:768}}),checks=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(lab.url);await page.locator('#theme-open').click();const ui=page.locator('#wallpaper-library');
 for(const id of ids){
  const scene=sceneById(id);await ui.locator('[data-kind="dynamic"]').click();await ui.locator('[data-category="'+scene.category+'"]').click();await ui.locator('.search input').fill(scene.operator);
  if(scene.category==='operator')await ui.locator('.card').first().click();await ui.locator('[data-id="'+id+'"]').click();
  const button=ui.locator('.download-original');assert.equal(await button.textContent(),'下载原片');assert.equal(await button.isEnabled(),true);const box=await button.boundingBox();assert.ok(box.y>=0&&box.y+box.height<=768,'Download button is outside visible footer');assert.equal(await ui.locator('.generate-4k').isVisible(),false);assert.match(await ui.locator('.source-resolution').textContent(),/帧/);
  await button.click();await ui.locator('.resource-panel').waitFor();const begin=Date.now();while(!lab.resources.status(id).original){if(Date.now()-begin>10000)throw Error('Download did not complete: '+id);await new Promise(r=>setTimeout(r,100));}
  checks.push({id,directOriginalButton:true,noAIEnvironmentRequired:true,downloadComplete:true});await ui.locator('.resource-close').click();
 }
 await ui.locator('[data-category="operator"]').click();await ui.locator('.search input').fill('伊内丝');await ui.locator('.card').first().click();assert.equal(await ui.locator('.generate-4k').isVisible(),true);assert.equal(await ui.locator('.generate-4k').textContent(),'本机生成 4K');await ui.locator('.download-resource').click();assert.match(await ui.locator('.resource-ai-note').textContent(),/本机生成|本机.*4K/);assert.match(await ui.locator('.resource-4k').textContent(),/已有本地|配置|生成/);await ui.locator('.resource-close').click();
 await page.screenshot({path:path.join(ROOT,'test-results/dynamic-download-ui.png')});assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks,officialOriginalAndGenerateButtons:true,errors}));await fs.writeFile(path.join(ROOT,'test-results/dynamic-download-ui.json'),JSON.stringify({passed:true,checks,officialOriginalAndGenerateButtons:true,errors},null,2));
}finally{await browser.close();await lab.close();}
