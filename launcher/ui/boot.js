(()=>{
const $=s=>document.querySelector(s),st=$('#stage'),clk=$('#clk'),cv=$('#fx'),cx=cv.getContext('2d'),core=$('.core'),ring=$('#ring'),pc=$('#pc');
const sT=$('#sT'),sv=$('#sv'),rows=[...document.querySelectorAll('#phases li')],L=[...document.querySelectorAll('.log p')];

let t0=0,raf=0,W=0,H=0,D=1,tg=0,P=[],S=null,R=[];
let running=false,completed=false,launchId=null,phase=0,canEnter=false,reduced=false,skipSent=false;
let frames=0,draws=0,started=0;
const pad=(n,l)=>String(n).padStart(l,'0');
const stages=[['正在启动 Codex','BOOT CODEX'],['正在连接主题','LINK THEME SERVICE'],['正在准备壁纸首帧','PREPARE WALLPAPER FRAME'],['壁纸已就绪 · 正在进入','HANDOFF / WORKSPACE']];

// Gem outline in SVG user units (viewBox centred on 0,0); prompt shards converge onto it.
const OUTLINE=[[0,-112],[62,-40],[62,44],[0,112],[-62,44],[-62,-40]];
const SHARD_START=1.1,SHARD_END=1.95;
function shards(){
  const r=core.getBoundingClientRect(),k=r.width/400*D,ox=(r.left+r.width/2)*D,oy=(r.top+r.height/2)*D;
  let seed=11;const rnd=()=>(seed=seed*16807%2147483647)/2147483647;
  return Array.from({length:90},(_,i)=>{
    const e=i%6,a=OUTLINE[e],b=OUTLINE[(e+1)%6],u=rnd(),ang=rnd()*Math.PI*2,burst=(70+rnd()*150)*k;
    return{sx:ox,sy:oy,mx:ox+Math.cos(ang)*burst,my:oy+Math.sin(ang)*burst,tx:ox+(a[0]+(b[0]-a[0])*u)*k,ty:oy+(a[1]+(b[1]-a[1])*u)*k,
      s:(2+rnd()*4.5)*D,rot:rnd()*6.28,spin:(rnd()-.5)*12,d:rnd()*.2,amber:rnd()<.6};
  });
}
function drawShards(t){
  if(!S)S=shards();
  for(const p of S){
    const q=Math.min(1,Math.max(0,(t-SHARD_START-p.d)/(SHARD_END-SHARD_START-.2)));if(q<=0)continue;
    const e=q<.5?2*q*q:1-Math.pow(-2*q+2,2)/2,iq=1-e;
    const x=iq*iq*p.sx+2*iq*e*p.mx+e*e*p.tx,y=iq*iq*p.sy+2*iq*e*p.my+e*e*p.ty,al=q<.8?1:(1-q)/.2;
    cx.save();cx.translate(x,y);cx.rotate(p.rot+p.spin*q);cx.globalAlpha=al;
    cx.fillStyle=p.amber?'#ffc21a':'#eef6ff';cx.shadowColor=p.amber?'rgba(255,194,26,.85)':'rgba(191,230,255,.85)';cx.shadowBlur=7*D;
    cx.beginPath();cx.moveTo(0,-p.s);cx.lineTo(p.s*.7,p.s*.6);cx.lineTo(-p.s*.5,p.s*.4);cx.closePath();cx.fill();cx.restore();
  }
}
// Faint code rain: a quiet nod to the terminal, kept well below the content.
const GLYPHS='01{}[]<>/=;:+-*#$ABCDEFXK',CH=14;
function drawRain(dt){
  cx.font=CH*D+'px "Share Tech Mono",monospace';cx.textBaseline='top';
  for(const d of R){
    d.y+=d.v*dt;if(d.y-d.n*CH*D>H){d.y=-Math.random()*H*.5;d.x=Math.floor(Math.random()*W/(CH*D*1.4))*CH*D*1.4;}
    if(Math.random()<.06)d.c[Math.random()*d.n|0]=GLYPHS[Math.random()*GLYPHS.length|0];
    for(let i=0;i<d.n;i++){const y=d.y-i*CH*D;if(y<-CH*D||y>H)continue;
      cx.fillStyle=i===0?'rgba(255,214,90,'+d.a*1.8+')':'rgba(190,215,235,'+d.a*(1-i/d.n)+')';cx.fillText(d.c[i],d.x,y);}
  }
}
function drawDust(){
  for(const p of P){p.y-=p.v;p.a+=.018;if(p.y<-4){p.y=H+4;p.x=Math.random()*W;}
    cx.fillStyle=p.amber?'rgba(255,194,26,'+(.12+.22*Math.abs(Math.sin(p.a)))+')':'rgba(210,230,245,'+(.08+.2*Math.abs(Math.sin(p.a)))+')';
    cx.fillRect(p.x,p.y,p.r,p.r);}
}
function rs(){
  D=Math.min(devicePixelRatio||1,2);W=cv.width=st.clientWidth*D;H=cv.height=st.clientHeight*D;S=null;
  P=Array.from({length:56},()=>({x:Math.random()*W,y:Math.random()*H,r:(Math.random()*1.5+.6)*D,v:(Math.random()*.22+.05)*D,a:Math.random()*6.28,amber:Math.random()<.3}));
  R=Array.from({length:Math.round(W/D/70)},()=>{const n=8+(Math.random()*12|0);return{x:Math.floor(Math.random()*W/(CH*D*1.4))*CH*D*1.4,y:Math.random()*H,v:(40+Math.random()*90)*D,n,a:.04+Math.random()*.06,c:Array.from({length:n},()=>GLYPHS[Math.random()*GLYPHS.length|0])};});
}

// Decode effect: text resolves left to right out of random glyphs.
const LATIN='ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&@',CJK='源石终端链接启动档案干员核心罗德岛博士方舟代码工作区壁纸主题';
const decoders=[
  {sel:'.name',at:2.42,dur:.8,pool:LATIN},{sel:'.fh b',at:2.3,dur:.45,pool:CJK},{sel:'.sub .zh',at:2.6,dur:.7,pool:CJK},
  {sel:'.attrs div:nth-child(1) dd',at:2.75,dur:.4,pool:CJK},{sel:'.attrs div:nth-child(2) dd',at:2.82,dur:.45,pool:CJK},
  {sel:'.welcome small',at:.72,dur:.5,pool:LATIN,go:true},{sel:'.welcome b',at:.75,dur:.6,pool:CJK,go:true}
].map(d=>({...d,el:$(d.sel),final:$(d.sel).textContent,done:false}));
function decode(t,g){
  for(const d of decoders){
    if(d.done)continue;const tt=d.go?g:t;if(tt<d.at||tt<0)continue;
    const q=Math.min(1,(tt-d.at)/d.dur),n=Math.floor(q*d.final.length);
    if(q>=1){d.el.textContent=d.final;d.done=true;continue;}
    if(frames%2)continue;
    d.el.textContent=[...d.final].map((c,i)=>i<n||c===' '||c==='·'||c==='，'?c:d.pool[Math.random()*d.pool.length|0]).join('');
  }
}
function finishText(){for(const d of decoders){d.el.textContent=d.final;d.done=true;}}

function post(type){window.chrome?.webview?.postMessage({type,launchId,metrics:{frames,draws,running,completed}});}
function render(){
  const all=canEnter&&phase===3,prog=all?1:Math.min(.97,(phase+.6)/4);
  sT.textContent=stages[phase][0];sv.textContent=all?'在线':'接入中';
  ring.style.strokeDashoffset=String(100-prog*100);pc.textContent=pad(Math.round(prog*100),3);
  rows.forEach((row,i)=>{const done=i<phase||all,act=!done&&i===phase;row.classList.toggle('done',done);row.classList.toggle('act',act);
    row.querySelector('.ok').textContent=done?'OK':act?'LINKING':'STANDBY';});
  L.forEach((el,i)=>{el.textContent=i<=phase?'> '+stages[i][1]+(i<phase||all?' ... OK':''):'';el.classList.toggle('on',i<=phase);el.classList.toggle('cur',i===phase&&!all);});
}
function status(data){
  if(!running||data.launchId!==launchId)return;
  if(Number.isInteger(data.phase)&&data.phase>=0&&data.phase<4)phase=Math.max(phase,data.phase);
  canEnter=data.ready===true||canEnter;
  render();if(data.message)sT.textContent=data.message;
}
function dispose(){running=false;cancelAnimationFrame(raf);raf=0;finishText();st.classList.add('stopped');}
let lt=0;
function tick(now){
  if(!running)return;frames++;
  const t=(now-t0)/1000,dt=Math.min(.05,(now-lt)/1000||0);lt=now;
  if(!document.hidden){
    clk.textContent='T+'+pad(Math.floor(t/60),2)+':'+pad(Math.floor(t)%60,2)+'.'+pad(Math.floor(t*1000)%1000,3);
    if(!reduced){
      decode(t,tg?(now-tg)/1000:-1);
      if(!tg){cx.clearRect(0,0,W,H);drawRain(dt);drawDust();if(t>=SHARD_START&&t<=SHARD_END+.1)drawShards(t);draws++;}
    }
  }
  if(canEnter&&!tg&&t>=(reduced?.35:4)){tg=now;if(!reduced)cx.clearRect(0,0,W,H);st.classList.add('go');post('handoff-start');}
  if(tg&&now-tg>(reduced?150:1750)){completed=true;dispose();post('handoff-ready');return;}
  raf=requestAnimationFrame(tick);
}
function start(data){
  if(started||!data?.launchId)return;started++;launchId=data.launchId;
  reduced=!!data.reduced||matchMedia('(prefers-reduced-motion: reduce)').matches;
  t0=lt=performance.now();running=true;st.classList.toggle('reduced',reduced);st.classList.add('play');
  rs();status({launchId,phase:0});raf=requestAnimationFrame(tick);
}
function skip(){if(!running||skipSent)return;skipSent=true;post('skip');}
window.arkBoot=Object.freeze({start,status,dispose,diagnostics:()=>({running,completed,phase,frames,draws,raf,skipSent,launchId})});
$('#skip').addEventListener('click',skip);
addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();skip();}});
addEventListener('resize',()=>{if(running)rs();});
addEventListener('pagehide',dispose,{once:true});
window.chrome?.webview?.addEventListener('message',event=>{const data=event.data;if(data.type==='start')start(data);else if(data.type==='status')status(data);else if(data.type==='dispose')dispose();});
post('ui-ready');
})();
