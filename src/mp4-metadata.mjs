// Read the small MP4 index, never the (potentially multi-GB) media payload.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';

function atoms(buffer, start=0, end=buffer.length) {
  const result=[];
  for(let p=start;p+8<=end;){
    let size=buffer.readUInt32BE(p),header=8;
    if(size===1){if(p+16>end)throw Error('MP4 扩展索引损坏');size=Number(buffer.readBigUInt64BE(p+8));header=16;}
    if(size===0)size=end-p;
    if(size<header||p+size>end)throw Error('MP4 索引越界');
    result.push({type:buffer.toString('ascii',p+4,p+8),start:p,data:p+header,end:p+size});p+=size;
  }
  return result;
}
const child=(buffer,parent,name)=>atoms(buffer,parent.data,parent.end).find(a=>a.type===name);
export async function inspectMp4(filename) {
  const file=await fs.open(filename,'r');
  try {
    const stat=await file.stat(),header=Buffer.alloc(16);let index;
    for(let p=0;p+8<=stat.size;){
      await file.read(header,0,16,p);let size=header.readUInt32BE(0),offset=8;
      if(size===1){size=Number(header.readBigUInt64BE(8));offset=16;}if(!size)size=stat.size-p;
      if(size<offset||p+size>stat.size)throw Error('MP4 文件结构无效');
      if(header.toString('ascii',4,8)==='moov'){
        if(size>16*1024*1024)throw Error('MP4 索引超出处理预算');
        index=Buffer.alloc(size-offset);await file.read(index,0,index.length,p+offset);break;
      }p+=size;
    }
    if(!index)throw Error('MP4 缺少索引');
    for(const track of atoms(index).filter(a=>a.type==='trak')){
      const mdia=child(index,track,'mdia'),handler=mdia&&child(index,mdia,'hdlr');
      if(!handler||index.toString('ascii',handler.data+8,handler.data+12)!=='vide')continue;
      const mdhd=child(index,mdia,'mdhd'),version=index[mdhd.data],timescale=index.readUInt32BE(mdhd.data+(version===1?20:12));
      const minf=child(index,mdia,'minf'),stbl=child(index,minf,'stbl'),stsd=child(index,stbl,'stsd'),stts=child(index,stbl,'stts');
      const entries=atoms(index,stsd.data+8,stsd.end);if(entries.length!==1)throw Error('多种编码轨道暂不合并');
      const sample=entries[0],width=index.readUInt16BE(sample.start+32),height=index.readUInt16BE(sample.start+34);
      if(!['avc1','avc3','hvc1','hev1'].includes(sample.type))throw Error('此编码使用安全分段播放');
      const config=atoms(index,sample.start+86,sample.end).find(a=>['avcC','hvcC'].includes(a.type));
      if(!config)throw Error('缺少视频编码参数');
      const count=index.readUInt32BE(stts.data+4);if(stts.data+8+count*8>stts.end)throw Error('MP4 帧时间表损坏');
      let frames=0,ticks=0,delta=null;
      for(let i=0;i<count;i++){const p=stts.data+8+i*8,n=index.readUInt32BE(p),d=index.readUInt32BE(p+4);frames+=n;ticks+=n*d;delta=delta===null?d:delta===d?delta:-1;}
      if(!frames||!timescale)throw Error('视频时间信息无效');
      return {width,height,codec:sample.type,timescale,frames,duration:ticks/timescale,fps:frames*timescale/ticks,constantRate:delta>0,
        codecHash:crypto.createHash('sha256').update(index.subarray(config.data,config.end)).digest('hex'),bytes:stat.size};
    }
    throw Error('MP4 没有视频轨道');
  } finally {await file.close();}
}

export function compatibleVideos(list) {
  const first=list[0];
  return !!first&&list.every(m=>m.constantRate&&m.width===first.width&&m.height===first.height&&m.codec===first.codec&&m.codecHash===first.codecHash&&m.timescale===first.timescale&&Math.abs(m.fps-first.fps)<.001);
}
