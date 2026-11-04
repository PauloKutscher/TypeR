"""Read PSD composites for local smart-stroke validation; originals are read-only."""
from PIL import Image
from pathlib import Path
from io import BytesIO
import base64, json

root = Path(__file__).resolve().parents[1]
records = []
def record(path, im, rect, expected=None, variant='original'):
    w, h = im.size
    bounds = tuple(round(v * (w if i % 2 == 0 else h)) for i, v in enumerate(rect))
    crop = im.crop(bounds).resize((128, 128), Image.Resampling.LANCZOS)
    if variant == 'compressed':
        stream = BytesIO()
        crop.save(stream, format='JPEG', quality=30)
        crop = Image.open(BytesIO(stream.getvalue())).convert('RGB')
    if variant == 'faded':
        crop = crop.point(lambda v: round(24 + v * 208 / 255))
    records.append(dict(file=path.name, bounds=bounds, expected=expected, variant=variant,
                        rgb=base64.b64encode(crop.tobytes()).decode('ascii')))

for path in sorted((root / 'psd').glob('*.psd')):
    im = Image.open(path).convert('RGB')
    for y in [0.15, 0.5, 0.85]:
        for x in [0.15, 0.5, 0.85]:
            record(path, im, (x-.09, y-.09, x+.09, y+.09))
    if path.name == '13.psd':
        for expected, rect in [('light', (280/687, 70/1000, 415/687, 240/1000)),
                               ('dark', (80/687, 5/1000, 360/687, 20/1000)),
                               ('mixed', (460/687, 400/1000, 675/687, 650/1000))]:
            for variant in ['original', 'compressed', 'faded']:
                record(path, im, rect, expected, variant)
print(json.dumps(records))
