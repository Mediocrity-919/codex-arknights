"""Optional, one-resource AI worker. Preserve frame rate, duration and full frame.

Uses the same model adapter as the local collection. Model weights are user-
provided; Python/Torch/CUDA/FFmpeg are optional and never installed on startup.
"""
import argparse, json, os, pathlib, subprocess, sys, time

def main():
    p=argparse.ArgumentParser()
    for key in ['input','output','ffmpeg','model-dir','fps','duration']:p.add_argument('--'+key,required=True)
    a=p.parse_args()
    try:
        import numpy as np
        import torch
        from cuda_model import create, predict
    except ImportError as e:
        raise RuntimeError('AI 环境缺少依赖，请按 tools/resource-fetcher/README.md 配置 PyTorch 与 NumPy') from e
    if not torch.cuda.is_available():raise RuntimeError('此 AI 适配器需要 NVIDIA CUDA；可以继续使用原片')
    fps=float(a.fps);duration=float(a.duration)
    if not 1<=fps<=240 or not 0<duration<3600:raise ValueError('视频参数无效')
    source=pathlib.Path(a.input).resolve();target=pathlib.Path(a.output).resolve()
    if source==target:raise ValueError('AI 输出不能覆盖原片')
    target.parent.mkdir(parents=True,exist_ok=True);part=target.with_suffix('.part.mp4')
    # The official showcase sources are 1920x1080. Decode to that frame size
    # without cropping; the same x2 model produces exactly 3840x2160.
    decoder=subprocess.Popen([a.ffmpeg,'-v','error','-nostdin','-i',str(source),'-vf','scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
    encoder=subprocess.Popen([a.ffmpeg,'-v','error','-nostdin','-f','rawvideo','-pix_fmt','rgb24','-s','3840x2160','-r',str(fps),'-i','pipe:0','-i',str(source),'-map','0:v:0','-map','1:a?','-c:v','libx264','-crf','18','-preset','medium','-threads','4','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart','-y',str(part)],stdin=subprocess.PIPE,stderr=subprocess.DEVNULL)
    count=0;total=round(fps*duration);start=time.monotonic()
    try:
        model=create(a.model_dir)
        while True:
            raw=decoder.stdout.read(1920*1080*3)
            if not raw:break
            if len(raw)!=1920*1080*3:raise RuntimeError('解码得到不完整视频帧')
            frame=np.frombuffer(raw,dtype=np.uint8).reshape(1080,1920,3)
            output=predict(model,frame)
            encoder.stdin.write(memoryview(output).cast('B'));count+=1
            if count%5==0 or count==1:print(json.dumps(dict(frame=count,totalFrames=total,elapsed=time.monotonic()-start)),flush=True)
        decoder.stdout.close();encoder.stdin.close()
        if decoder.wait(timeout=60) or encoder.wait(timeout=180):raise RuntimeError('FFmpeg 解码或编码失败')
        if abs(count-total)>2:raise RuntimeError('输出帧数与原片不匹配')
        check=subprocess.run([a.ffmpeg,'-v','error','-xerror','-i',str(part),'-f','null','-'],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=max(60,duration*6))
        if check.returncode:raise RuntimeError('4K 输出解码校验失败')
        os.replace(part,target);print(json.dumps(dict(frame=count,totalFrames=count,complete=True)),flush=True)
    finally:
        for process in [decoder,encoder]:
            if process.poll() is None:process.kill()
            process.wait()
        if part.exists():part.unlink()

if __name__=='__main__':
    try:main()
    except Exception as e:print(str(e),file=sys.stderr);sys.exit(1)
