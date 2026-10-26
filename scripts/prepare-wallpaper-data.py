from pathlib import Path
from PIL import Image
from concurrent.futures import ThreadPoolExecutor
import json,hashlib
root=Path(__file__).resolve().parent.parent
out=root/'.local'/'thumbnails'
out.mkdir(parents=True,exist_ok=True)
def digest(s): return hashlib.sha256(s.replace('\\','/').encode()).hexdigest()[:16]
art=root/'明日方舟_全干员与时装原图'
records=json.loads((art/'资料与清单'/'原图来源与尺寸.json').read_text(encoding='utf-8-sig'))['records']
jobs=[('art-'+digest(r['path']),art/r['path'],True) for r in records]
for folder,prefix in [('明日方舟_首页背景与场景','bg'),('明日方舟_活动与启动器背景','wall')]:
    source=root/folder
    data=json.loads((source/'资料与清单'/'图片来源与校验.json').read_text(encoding='utf-8-sig'))
    jobs.extend((prefix+'-'+digest(r['path']),source/r['path'],False) for r in data)
def prepare(job):
    id,filename,character=job
    with Image.open(filename) as original:
        image=original.convert('RGBA')
        box=image.getchannel('A').getbbox() if character else None
        if box: image=image.crop(box)
        dest=out/(id+'.webp')
        if not dest.exists():
            image.thumbnail((480,480),Image.Resampling.LANCZOS)
            image.save(dest,'WEBP',quality=85,method=4)
        return id,list(box) if box else None
with ThreadPoolExecutor(max_workers=4) as pool:
    results={}
    for i,(id,bounds) in enumerate(pool.map(prepare,jobs),1):
        if bounds: results[id]=bounds
        if i%300==0: print(f'{i}/{len(jobs)}',flush=True)
(root/'.local'/'art-bounds.json').write_text(json.dumps(results),encoding='utf-8')
print(f'Prepared {len(jobs)} previews, {len(results)} alpha bounds',flush=True)
