"""Build small card previews; never resize or overwrite the source collection."""
from pathlib import Path
from PIL import Image, ImageOps
from concurrent.futures import ThreadPoolExecutor
import json, hashlib

root=Path(__file__).resolve().parent.parent
source=root/'明日方舟_全干员与时装原图'
output=root/'.local'/'thumbnails'
output.mkdir(parents=True, exist_ok=True)
records=json.loads((source/'资料与清单'/'原图来源与尺寸.json').read_text(encoding='utf-8-sig'))['records']

def build(record):
    relative=record['path'].replace('\\','/')
    image_id='art-'+hashlib.sha256(relative.encode('utf-8')).hexdigest()[:16]
    destination=output/(image_id+'.webp')
    if destination.exists(): return
    original=(source/relative).resolve()
    if not original.is_relative_to(source.resolve()): raise ValueError('Invalid image path')
    with Image.open(original) as image:
        image=image.convert('RGBA')
        bounds=image.getchannel('A').getbbox()
        if bounds: image=image.crop(bounds)
        image.thumbnail((360,480),Image.Resampling.LANCZOS)
        image.save(destination,format='WEBP',quality=85,method=4)

with ThreadPoolExecutor(max_workers=4) as pool:
    for index,_ in enumerate(pool.map(build,records),1):
        if index%200==0: print(f'{index}/{len(records)} thumbnails',flush=True)
print(f'Complete: {len(records)} local previews',flush=True)
