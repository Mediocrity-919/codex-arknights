"""Fetch pinned WebView2 SDK and the original preview's Latin fonts.
Only the named SDK binaries are extracted. Chinese text uses system fonts.
"""
from pathlib import Path
import hashlib, json, urllib.request, zipfile

ROOT = Path(__file__).resolve().parent.parent
VERSION = '1.0.3650.58'
cache = ROOT / '.local' / 'sdk'
cache.mkdir(parents=True, exist_ok=True)
dist = ROOT / 'dist'
dist.mkdir(exist_ok=True)
fonts = ROOT / 'launcher' / 'ui' / 'fonts'
fonts.mkdir(parents=True, exist_ok=True)
records = []

def download(url, destination):
    if not destination.exists():
        with urllib.request.urlopen(url, timeout=45) as response:
            data = response.read()
        destination.write_bytes(data)
    data = destination.read_bytes()
    records.append({'url': url, 'file': str(destination.relative_to(ROOT)), 'sha256': hashlib.sha256(data).hexdigest(), 'bytes':len(data)})
    return data

sdk = cache / ('microsoft.web.webview2.' + VERSION + '.nupkg')
download('https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/'+VERSION+'/microsoft.web.webview2.'+VERSION+'.nupkg', sdk)
with zipfile.ZipFile(sdk) as package:
    for member, name in [
        ('lib/net462/Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.Core.dll'),
        ('lib/net462/Microsoft.Web.WebView2.Wpf.dll','Microsoft.Web.WebView2.Wpf.dll'),
        ('lib/net462/Microsoft.Web.WebView2.Wpf.xml','Microsoft.Web.WebView2.Wpf.xml'),
        ('runtimes/win-x64/native/WebView2Loader.dll','WebView2Loader.dll'),
        ('LICENSE.txt','WebView2-LICENSE.txt')]:
        (dist / name).write_bytes(package.read(member))

for url,name in [
    ('https://raw.githubusercontent.com/google/fonts/main/ofl/oxanium/Oxanium%5Bwght%5D.ttf','Oxanium.ttf'),
    ('https://raw.githubusercontent.com/google/fonts/main/ofl/oxanium/OFL.txt','Oxanium-OFL.txt'),
    ('https://raw.githubusercontent.com/google/fonts/main/ofl/sharetechmono/ShareTechMono-Regular.ttf','ShareTechMono.ttf'),
    ('https://raw.githubusercontent.com/google/fonts/main/ofl/sharetechmono/OFL.txt','ShareTechMono-OFL.txt')]:
    download(url,fonts/name)
(ROOT / 'launcher' / 'dependencies.json').write_text(json.dumps({'webview2Sdk':VERSION,'resources':records},ensure_ascii=False,indent=2),encoding='utf-8')
print('WebView2 SDK and offline fonts prepared')
