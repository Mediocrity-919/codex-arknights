"""Execute the existing NCNN model weights in CUDA; no alternate restoration model."""
import json,math,pathlib,struct,time
import numpy as np
import torch
from torch import nn
from torch.nn import functional as F

ROOT=pathlib.Path(__file__).resolve().parent

class SameAnimeModel(nn.Module):
    def __init__(self, model_dir):
        super().__init__()
        base=pathlib.Path(model_dir)/'realesr-animevideov3-x2'
        blob=base.with_suffix('.bin').read_bytes();position=0;layers=[];inc=3
        def floats(n,tagged=False):
            nonlocal position
            dtype='<f4'
            if tagged:
                tag=struct.unpack_from('<I',blob,position)[0];position+=4
                if tag==0x01306B47:dtype='<f2'
                elif tag!=0:raise ValueError(hex(tag))
            size=n*np.dtype(dtype).itemsize
            arr=np.frombuffer(blob,dtype=dtype,count=n,offset=position).astype(np.float32).copy()
            position+=(size+3)//4*4 if tagged else size
            return torch.from_numpy(arr)
        for line in base.with_suffix('.param').read_text().splitlines()[2:]:
            p=line.split();kind=p[0]
            options={int(a.split('=')[0]):a.split('=')[1] for a in p if '=' in a}
            if kind=='Convolution':
                outc=int(options[0]);k=int(options[1]);n=int(options[6])
                conv=nn.Conv2d(inc,outc,k,padding=int(options.get(4,0)),bias=True)
                with torch.no_grad():
                    conv.weight.copy_(floats(n,True).reshape(outc,inc,k,k));conv.bias.copy_(floats(outc))
                layers.append(conv);inc=outc
            elif kind=='PReLU':
                n=int(options[0]);act=nn.PReLU(n)
                with torch.no_grad():act.weight.copy_(floats(n))
                layers.append(act)
        if position!=len(blob):raise ValueError(f'Unconsumed model data {position}/{len(blob)}')
        self.body=nn.Sequential(*layers)
    def forward(self,x):
        y=F.pixel_shuffle(self.body(x),4)+F.interpolate(x,scale_factor=4,mode='nearest')
        return F.interpolate(y,scale_factor=.5,mode='bicubic',align_corners=False)

def create(model_dir):
    torch.set_num_threads(4)
    torch.backends.cudnn.benchmark=False
    m=SameAnimeModel(model_dir).eval().to(device='cuda',dtype=torch.float16,memory_format=torch.channels_last)
    return m

@torch.inference_mode()
def predict(m,arr):
    x=torch.from_numpy(arr.copy()).permute(2,0,1).unsqueeze(0).to(device='cuda',dtype=torch.float16,memory_format=torch.channels_last).div_(255)
    y=m(x).clamp_(0,1).mul_(255).round_().to(torch.uint8)
    return y[0].permute(1,2,0).contiguous().cpu().numpy()

