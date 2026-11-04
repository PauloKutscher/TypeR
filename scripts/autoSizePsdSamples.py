"""Read-only typography/closed white balloon fixtures from the local PSD corpus."""
from pathlib import Path
import json, math, re, os
import cv2
import numpy as np
from PIL import Image
from psd_tools import PSDImage
from PIL import ImageFont

root = Path(__file__).resolve().parents[1]
samples = []
files = sorted((root / 'psd').glob('*.psd'))
for path in files:
    doc = PSDImage.open(path)
    image = Image.open(path).convert('L')
    image.thumbnail((1000, 1600))
    pixels = np.asarray(image)
    scale = image.width / doc.width
    count, labels, stats, _ = cv2.connectedComponentsWithStats((pixels >= 215).astype('uint8'), 8)
    for layer in doc.descendants():
        if layer.kind != 'type' or not layer.is_visible():
            continue
        text = re.sub(r'\s+', ' ', layer.text).strip()
        if not 8 <= len(text) <= 300:
            continue
        left, top, right, bottom = layer.bbox
        if right <= left or bottom <= top:
            continue
        try:
            data = layer.engine_dict['StyleRun']['RunArray'][0]['StyleSheet']['StyleSheetData']
            size = float(data['FontSize']) * math.hypot(layer.transform[2], layer.transform[3])
        except (KeyError, TypeError, ValueError, IndexError):
            continue
        if not size > 0:
            continue
        ids = set()
        for fy in np.linspace(0, 1, 7):
            for fx in np.linspace(0, 1, 7):
                x = int((left + (right-left)*fx)*scale)
                y = int((top + (bottom-top)*fy)*scale)
                if 0 <= x < image.width and 0 <= y < image.height:
                    ids.add(int(labels[y,x]))
        candidates = []
        for ident in ids - {0}:
            x, y, w, h, total = map(int, stats[ident])
            if total < (right-left)*(bottom-top)*scale*scale*0.4 or total > image.width*image.height*0.12:
                continue
            if x > left*scale+4 or x+w < right*scale-4 or y > top*scale+4 or y+h < bottom*scale-4:
                continue
            candidates.append((total, ident))
        if not candidates:
            continue
        _, ident = min(candidates)
        contours, _ = cv2.findContours((labels == ident).astype('uint8'), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        contour = cv2.approxPolyDP(max(contours, key=cv2.contourArea), 0.7, True)
        polygon = [[float(p[0][0])/scale, float(p[0][1])/scale] for p in contour]
        x, y, w, h, _ = map(int, stats[ident])
        # Text contents omit Photoshop's automatic line wraps: bbox/line length
        # would underestimate widths. Read installed font advances instead.
        advance = sum(0.25 if ch.isspace() else 0.6 for ch in text)
        font_index = int(data.get('Font', 0))
        font_name = str(layer.resource_dict['FontSet'][font_index]['Name'])
        if int(data.get('FontCaps', 0)) == 2:
            text = text.upper()
        samples.append(dict(file=path.name, text=text, size=size, polygon=polygon,
                            width=w/scale, height=h/scale, advance=advance, leading=1.2,
                            font=font_name, horizontalScale=float(data.get('HorizontalScale',1)),
                            metricsSource='fallback estimate'))
needed = set(sample['font'] for sample in samples)
font_paths = {}
normalize_font = lambda value: re.sub(r'[^a-z0-9]', '', value.lower())
for folder in [Path(os.environ.get('WINDIR','C:/Windows'))/'Fonts', Path(os.environ.get('LOCALAPPDATA',''))/'Microsoft/Windows/Fonts']:
    for path in folder.glob('*'):
        if path.suffix.lower() not in ['.ttf','.otf']:
            continue
        try:
            font = ImageFont.truetype(str(path), 64)
            family, style = font.getname()
            names = {normalize_font(family+style)}
            if style.lower() in ['regular', 'normal', 'roman']:
                names.add(normalize_font(family))
            for name in needed:
                if normalize_font(name) in names:
                    font_paths[name] = path
        except Exception:
            continue
    if len(font_paths) == len(needed):
        break
for sample in samples:
    if sample['font'] in font_paths:
        font = ImageFont.truetype(str(font_paths[sample['font']]), 64)
        sample['advance'] = font.getlength(sample['text']) / 64 * sample['horizontalScale']
        sample['metricsSource'] = 'installed font advance'
print(json.dumps(dict(files=len(files), samples=sorted(samples, key=lambda s: (s['file'], min(p[1] for p in s['polygon']))))))
