"""构建：把 src/sim.js 和按需子集化的像素字体内联进 dist/index.html（单文件，可直接打开或发布）。

依赖：
  npm install            # 拿到 Fusion Pixel 字体（node_modules 里）
  pip install -r requirements.txt   # fonttools + brotli
"""
import base64, glob, io, os
from fontTools.ttLib import TTFont
from fontTools import subset

ROOT = os.path.dirname(os.path.abspath(__file__))
FONT_DIR = os.path.join(ROOT, 'node_modules', '@vp-tw', 'cjk-web-fonts-fusion-pixel-font',
                        'dist', '12px', 'proportional', 'zh_hans')
if not os.path.isdir(FONT_DIR):
    raise SystemExit('找不到字体目录，先运行 npm install')

src = open(os.path.join(ROOT, 'src', 'index.src.html'), encoding='utf-8').read()
sim = open(os.path.join(ROOT, 'src', 'sim.js'), encoding='utf-8').read()
chars = set(src + sim) | {chr(c) for c in range(0x20, 0x7f)} | set('，。、：；！？（）《》“”…—·＋－×÷％→←↑↓▶◀■□●○◆★☆')
codes = {ord(c) for c in chars if ord(c) >= 0x20}

faces, total = [], 0
for path in sorted(glob.glob(os.path.join(FONT_DIR, '*.woff2'))):
    f = TTFont(path)
    have = set(f.getBestCmap().keys()) & codes
    if not have:
        continue
    opts = subset.Options(); opts.flavor = 'woff2'; opts.layout_features = ['*']; opts.notdef_outline = True
    sub = subset.Subsetter(opts); sub.populate(unicodes=sorted(have)); sub.subset(f)
    buf = io.BytesIO(); f.flavor = 'woff2'; f.save(buf)
    data = buf.getvalue(); total += len(data)
    codes -= have
    rng = ','.join(f'U+{c:04X}' for c in sorted(have))
    faces.append("@font-face{font-family:'FusionPixel';src:url(data:font/woff2;base64,%s) format('woff2');unicode-range:%s;font-display:block}"
                 % (base64.b64encode(data).decode(), rng))

missing = ''.join(chr(c) for c in sorted(codes) if c > 0x7f)
out = src.replace('/*FONTFACE*/', '\n'.join(faces)).replace('/*SIM*/', sim)
os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
open(os.path.join(ROOT, 'dist', 'index.html'), 'w', encoding='utf-8').write(out)
print(f'字体子集 {len(faces)} 段，{total / 1024:.0f} KB；dist/index.html {len(out.encode()) / 1024:.0f} KB')
if missing:
    print(f'警告：像素字体里没有这些字，会回退成系统字体：{missing}')
