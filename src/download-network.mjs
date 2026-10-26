import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
let pending=null,checkedAt=0,signature=null,restore=null;

export function downloadProxyEnvironment(env,windows={}) {
  let httpProxy=env.http_proxy||env.HTTP_PROXY,httpsProxy=env.https_proxy||env.HTTPS_PROXY;
  if(!httpProxy&&!httpsProxy&&windows.enabled&&windows.server){
    const map={};for(const entry of windows.server.split(';')){const i=entry.indexOf('=');if(i<0){map.http=map.https=entry.trim();}else map[entry.slice(0,i).trim().toLowerCase()]=entry.slice(i+1).trim();}
    const url=value=>value?(/^[a-z]+:\/\//i.test(value)?value:'http://'+value):undefined;
    httpProxy=url(map.http);httpsProxy=url(map.https||map.http);
  }
  const bypass=[env.no_proxy||env.NO_PROXY||'',...(windows.bypass??'').split(';').filter(x=>x&&x!=='<local>'),'localhost','127.0.0.1','::1','[::1]'].filter(Boolean).join(',');
  return {HTTP_PROXY:httpProxy||'',HTTPS_PROXY:httpsProxy||'',NO_PROXY:bypass};
}
export async function configureDownloadNetwork(){
  if(pending)return pending;if(Date.now()-checkedAt<30000)return;
  pending=(async()=>{
    let windows={};
    if(process.platform==='win32'&&!process.env.HTTP_PROXY&&!process.env.HTTPS_PROXY&&!process.env.http_proxy&&!process.env.https_proxy){
      try{
        const {stdout}=await exec('powershell.exe',['-NoProfile','-Command',"$p=Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' -ErrorAction SilentlyContinue;@{enabled=($p.ProxyEnable -eq 1);server=$p.ProxyServer;bypass=$p.ProxyOverride}|ConvertTo-Json -Compress"],{windowsHide:true,timeout:4000,maxBuffer:16384,encoding:'utf8'});
        windows=JSON.parse(stdout.replace(/^\uFEFF/,'').trim());
      }catch{}
    }
    const proxy=downloadProxyEnvironment(process.env,windows),next=JSON.stringify(proxy);
    if(next!==signature){
      if((proxy.HTTP_PROXY||proxy.HTTPS_PROXY)&&typeof http.setGlobalProxyFromEnv!=='function')throw Error('系统代理需要新版运行环境，请使用最新 Windows 完整包');
      restore?.();restore=null;
      if(proxy.HTTP_PROXY||proxy.HTTPS_PROXY)restore=http.setGlobalProxyFromEnv(proxy);
      signature=next;
    }
    checkedAt=Date.now();
  })().finally(()=>{pending=null;});return pending;
}
