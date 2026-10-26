(()=>{
const $=s=>document.querySelector(s),st=$('#stage'),en=$('#en'),clk=$('#clk'),cv=$('#dust'),cx=cv.getContext('2d'),hw=$('#hexw'),hx=hw.getContext('2d'),ob=$('#orb3d'),ox=ob.getContext('2d');
const p1=$('#p1'),p2=$('#p2'),l1=$('.pl.l'),l2=$('.pl.r'),n1=$('.pn.l'),n2=$('.pn.r'),nn=$('#nn'),sT=$('#sT'),sS=$('#sS'),L=[...document.querySelectorAll('.log p')];

let t0=0,raf=0,P=[],W=0,H=0,tg=0,R=0,cells=[],ang=0,lt=0;
let running=false,completed=false,launchId=null,phase=0,canEnter=false,reduced=false,skipSent=false;
let frames=0,draws=0,started=0;
const pad=(n,l)=>String(n).padStart(l,'0');
const rnd=(()=>{let s=7;return()=>(s=s*16807%2147483647)/2147483647})();
const stages=[['正在启动 Codex','STARTING CODEX'],['正在连接主题','CONNECTING THEME'],['正在准备壁纸首帧','PREPARING WALLPAPER'],['壁纸已就绪 · 正在进入','WORKSPACE READY']];
function mk3(){
  const q=(1+Math.sqrt(5))/2;let V=[[-1,q,0],[1,q,0],[-1,-q,0],[1,-q,0],[0,-1,q],[0,1,q],[0,-1,-q],[0,1,-q],[q,0,-1],[q,0,1],[-q,0,-1],[-q,0,1]];
  const F=[[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
  const nz=v=>{const l=Math.hypot(v[0],v[1],v[2]);return v.map(x=>x/l)};V=V.map(nz);
  const M={},T=[];const mid=(a,b)=>{const k=a<b?a+'_'+b:b+'_'+a;if(!(k in M)){M[k]=V.length;V.push(nz(V[a].map((x,i)=>x+V[b][i])))}return M[k]};
  for(const [a,b,c] of F){const ab=mid(a,b),bc=mid(b,c),ca=mid(c,a);T.push([a,ab,ca],[b,bc,ab],[c,ca,bc],[ab,bc,ca])}
  V=V.map(v=>{const r=.88+rnd()*.24;return v.map(x=>x*r)});
  const E=new Set();for(const [a,b,c] of T)for(const [x,y] of [[a,b],[b,c],[c,a]])E.add(x<y?x+'_'+y:y+'_'+x);
  const e=[...E].map(k=>k.split('_').map(Number));
  for(let i=0;i<22;i++){const a=rnd()*V.length|0,b=rnd()*V.length|0;if(a!==b)e.push([a,b,1])}
  return{V,E:e}}
const S3=mk3();
function orb(now,dt,n){
  const c=ob.width,Rr=c*.42,h=c/2,o=tg?Math.min(1,(now-tg)/700):0,go=tg>0;
  ang+=dt*(.42*Math.min(1,Math.max(0,((now-t0)/1000-2.7)/1.2))+o*o*7);ox.clearRect(0,0,c,c);
  const ca=Math.cos(ang),sa=Math.sin(ang),tl=.4+.06*Math.sin(now/1700),ct=Math.cos(tl),sl=Math.sin(tl),lw=Math.max(1,c/300);
  const Q=S3.V.map(v=>{const x=v[0]*ca+v[2]*sa,z=-v[0]*sa+v[2]*ca,y=v[1]*ct-z*sl,z2=v[1]*sl+z*ct,k=1/(1-z2*.22);return[h+x*Rr*k,h+y*Rr*k,z2]});
  S3.E.forEach((e,i)=>{const a=Q[e[0]],b=Q[e[1]],z=(a[2]+b[2])/2,al=(.12+.5*(z+1.1)/2.2)*(e[2]?.6:1),sh=.5+.5*Math.sin(now/900+i*.7);
    ox.strokeStyle='rgba(255,214,40,'+Math.min(1,al*(1.1+.7*sh))+')';
    ox.lineWidth=lw*(1+.7*sh*sh);ox.beginPath();ox.moveTo(a[0],a[1]);ox.lineTo(b[0],b[1]);ox.stroke()});
  Q.forEach((q,i)=>{const on=true,r=(1.3+1.3*(q[2]+1.1)/2.2)*c/250;
    if(on){ox.fillStyle='rgba(255,194,26,.18)';ox.beginPath();ox.arc(q[0],q[1],r*3,0,6.283);ox.fill()}
    ox.fillStyle=on?'#ffd21e':'rgba(255,194,26,.35)';ox.beginPath();ox.arc(q[0],q[1],r,0,6.283);ox.fill()})}
function mk(){R=W/28;const dx=Math.sqrt(3)*R,dy=1.5*R,ox0=W/2,oy=H*.46;cells=[];
  for(let r=-1;r<H/dy+2;r++)for(let c=-1;c<W/dx+2;c++){const x=c*dx+(r&1?dx/2:0),y=r*dy;cells.push({x,y,d:Math.hypot(x-ox0,y-oy),j:Math.random(),t:Math.random()<.07})}}
function wave(now){hx.clearRect(0,0,W,H);if(!tg)return;const t=(now-tg)/1000-.55;if(t<0)return;const rf=t*W*.75;hx.lineWidth=Math.max(1,W/1300);
  for(const c of cells){const e=rf-(c.d+c.j*R*3);if(e<0)continue;const a=Math.max(0,1-e/(R*7));
    hx.beginPath();for(let k=0;k<6;k++){const g=Math.PI/180*(60*k-90);hx.lineTo(c.x+R*.94*Math.cos(g),c.y+R*.94*Math.sin(g))}hx.closePath();
    if(a>0){hx.fillStyle='rgba(215,238,250,'+a*.55+')';hx.fill()}
    hx.strokeStyle=a>.02?'rgba(255,255,255,'+(.2+a*.6)+')':'rgba(233,238,242,'+.12*Math.max(.15,1-c.d/(W*.62))+')';hx.stroke();
    if(c.t&&a<=.02){hx.fillStyle='rgba(159,220,255,'+(.04+.035*Math.sin(now/700+c.j*9))+')';hx.fill()}}}
function rs(){const d=Math.min(devicePixelRatio||1,2);W=cv.width=hw.width=st.clientWidth*d;H=cv.height=hw.height=st.clientHeight*d;ob.width=ob.height=Math.round(ob.clientWidth*d);mk();
  P=Array.from({length:70},()=>({x:Math.random()*W,y:Math.random()*H,r:(Math.random()*1.4+.5)*d,v:(Math.random()*.25+.05)*d,a:Math.random()*6.28}))}
function dust(){cx.clearRect(0,0,W,H);
  for(const p of P){p.y-=p.v;p.a+=.02;if(p.y<0)p.y=H;cx.fillStyle='rgba(200,225,240,'+(.15+.25*Math.abs(Math.sin(p.a)))+')';cx.fillRect(p.x,p.y,p.r,p.r)}
}
function post(type){window.chrome?.webview?.postMessage({type,launchId,metrics:{frames,draws,running,completed}});}
function status(data){
  if(!running||data.launchId!==launchId)return;
  if(Number.isInteger(data.phase)&&data.phase>=0&&data.phase<4){phase=Math.max(phase,data.phase);}
  const info=stages[phase];sT.textContent=data.message||info[0];sS.textContent=info[1];nn.textContent=pad(phase+1,2);
  L.forEach((el,i)=>{el.textContent=i<=phase?'> '+stages[i][1]+(i<phase?' / OK':''):'';el.classList.toggle('on',i<=phase);});
  canEnter=data.ready===true||canEnter;
}
function dispose(){running=false;cancelAnimationFrame(raf);raf=0;st.classList.add('stopped');}
function tick(now){
  if(!running)return;frames++;
  const t=(now-t0)/1000,dt=Math.min(.05,(now-lt)/1000||0);lt=now;
  if(!document.hidden){
    clk.textContent='T+'+pad(Math.floor(t/60),2)+':'+pad(Math.floor(t)%60,2);
    const progress=(phase+1)/4;
    l1.style.transform=l2.style.transform='scaleX('+progress+')';
    n1.style.transform='translateX(calc('+progress*44.5+'cqw - 50%))';n2.style.transform='translateX(calc('+(-progress*44.5)+'cqw + 50%))';
    p1.textContent=p2.textContent=pad(phase+1,2)+' / 04';
    if(!reduced){dust();draws++;if(t>2.6&&(!tg||now-tg<1500))orb(now,dt,0);if(tg)wave(now);}
  }
  if(canEnter&&!tg&&t>=(reduced?.35:4)){tg=now;st.classList.add('go');post('handoff-start');}
  if(tg&&now-tg>(reduced?150:1750)){completed=true;dispose();post('handoff-ready');return;}
  raf=requestAnimationFrame(tick);
}
function start(data){
  if(started||!data?.launchId)return;started++;launchId=data.launchId;
  reduced=!!data.reduced||matchMedia('(prefers-reduced-motion: reduce)').matches;
  t0=lt=performance.now();running=true;st.classList.add('play');st.classList.toggle('reduced',reduced);
  rs();status({launchId,phase:0});raf=requestAnimationFrame(tick);
}
function skip(){if(!running||skipSent)return;skipSent=true;post('skip');}
window.arkBoot=Object.freeze({start,status,dispose,diagnostics:()=>({running,completed,phase,frames,draws,raf,skipSent,launchId})});
document.querySelector('#skip').addEventListener('click',skip);
addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();skip();}});
addEventListener('resize',()=>{if(running)rs();});
addEventListener('pagehide',dispose,{once:true});
window.chrome?.webview?.addEventListener('message',event=>{const data=event.data;if(data.type==='start')start(data);else if(data.type==='status')status(data);else if(data.type==='dispose')dispose();});
post('ui-ready');

})();
