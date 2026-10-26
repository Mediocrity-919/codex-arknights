import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {ROOT,scenes,resourceCatalog,mediaPath} from '../src/catalog.mjs';
import {createResourceManager} from '../src/resource-manager.mjs';
import {createPlaybackCache} from '../src/playback-cache.mjs';

const stateDir=path.join(ROOT,'.local/seam-validation');await fs.mkdir(stateDir,{recursive:true});
await fs.copyFile(path.join(ROOT,'.local/runtime.json'),path.join(stateDir,'runtime.json'));
const resources=await createResourceManager({root:ROOT,stateDir,catalog:resourceCatalog,scenes});
const cache=await createPlaybackCache({root:ROOT,stateDir,scenes,resources,mediaPath,catalog:resourceCatalog});
const ids=['official-3801','official-8949','official-6054','official-202410440'];
const report={version:2,results:[]};
try{
  for(const quality of ['4k','original']){
    await resources.action('preferences',{quality,performance:'quality'});
    for(const id of ids){cache.observe({sceneId:id});const start=Date.now();
      while(!cache.describe(id)?.sequence){const job=cache.publicState().jobs.findLast(j=>j.sceneId===id&&j.quality===quality);if(job&&['fallback','failed'].includes(job.status))throw Error(JSON.stringify(job));assert.ok(Date.now()-start<180000,'build timed out');await new Promise(r=>setTimeout(r,300));}
      const value={id,quality,seconds:+((Date.now()-start)/1000).toFixed(1),...cache.describe(id).sequence};report.results.push(value);console.log(JSON.stringify({id,quality,seconds:value.seconds,chapters:value.chapters.length}));
    }
  }
  report.cache=cache.publicState();await fs.writeFile(path.join(ROOT,'test-results/playback-cache.json'),JSON.stringify(report,null,2));
}finally{await cache.close();await resources.close();}
