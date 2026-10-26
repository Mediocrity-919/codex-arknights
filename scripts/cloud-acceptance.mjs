import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(process.env.ARK_ACCEPTANCE_ROOT??path.join(import.meta.dirname,'..'));
if(!root.includes('acceptance-sandbox'))throw Error('Run only in an isolated acceptance-sandbox directory');
const output=path.resolve(process.env.ARK_ACCEPTANCE_OUTPUT??path.join(root,'test-results'));
await fs.mkdir(output,{recursive:true});await fs.mkdir(path.join(root,'.local'),{recursive:true});await fs.mkdir(path.join(root,'test-results'),{recursive:true});
const checks=[];
const clean=value=>value.replace(/(127\.0\.0\.1:\d+\/#|[?&]key=)[a-f0-9]{64}/g,'$1[redacted]').replace(/[a-f0-9]{64}/g,'[digest-redacted]');
async function run(name,exe,args,{timeout=180000,env={}}={}){
 const begin=Date.now();let logs='';
 const result=await new Promise(resolve=>{
  const child=spawn(exe,args,{cwd:root,env:{...process.env,...env},windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
  const timer=setTimeout(()=>{logs+='\nAcceptance step timed out';if(process.platform==='win32')spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else child.kill('SIGKILL');},timeout);
  child.on('error',e=>{logs+='\n'+e.message;clearTimeout(timer);resolve(-1)});child.on('close',code=>{clearTimeout(timer);resolve(code)});
 });
 await fs.writeFile(path.join(output,name+'.log'),clean(logs));
 const check={name,passed:result===0,exitCode:result,seconds:Math.round((Date.now()-begin)/1000)};checks.push(check);console.log(JSON.stringify(check));
 if(result!==0)console.log(clean(logs).slice(-3500));
 await fs.writeFile(path.join(output,'acceptance-summary.json'),JSON.stringify({version:JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version,checks,scope:'Released package in clean Windows; UI uses generated media. Live downloads have their own result. No signed-in Codex desktop is available in GitHub Actions.'},null,2));
}
const group=process.argv[2]??'ui';
if(group==='ui'){
 for(const script of ['fresh-library-check','controls-usability-check','compatibility-check','boot-ui-check'])await run(script,process.execPath,['scripts/'+script+'.mjs']);
 for(const script of ['beta-usability-check','queue-usability-check'])await run(script,process.execPath,['--import','./scripts/acceptance-fixtures.mjs','scripts/'+script+'.mjs'],{env:{ARK_ACCEPTANCE_SANDBOX:'1'}});
 for(const script of ['acceptance-operations'])await run(script,process.execPath,['--import','./scripts/acceptance-fixtures.mjs','scripts/'+script+'.mjs'],{env:{ARK_ACCEPTANCE_SANDBOX:'1'}});
}else if(group==='windows'){
 for(const script of ['tests/boot-readiness-check.ps1','tests/host-startup-check.ps1','scripts/shortcut-recovery-check.ps1','scripts/window-layer-check.ps1','scripts/launcher-lifecycle-check.ps1'])await run(path.basename(script,'.ps1'),'powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script],{timeout:260000});
}else if(group==='downloads')await run('fresh-download-check',process.execPath,['scripts/fresh-download-check.mjs'],{timeout:600000});
else throw Error('Unknown acceptance group');
for(const entry of await fs.readdir(path.join(root,'test-results'))){if(/\.(json|png)$/.test(entry)&&entry!=='fresh-download.json'&&entry!=='acceptance-summary.json')await fs.copyFile(path.join(root,'test-results',entry),path.join(output,entry));}
if(checks.some(c=>!c.passed))process.exitCode=1;
