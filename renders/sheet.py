# 렌더 PNG들을 이름표와 함께 격자로 묶는다: sheet.py <dir> <out.png> <cols> <cell> file:label ...
import sys
from PIL import Image, ImageDraw, ImageFont
d, out, cols, cell = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
items = [a.split(':', 1) for a in sys.argv[5:]]
rows = (len(items) + cols - 1) // cols
lab = int(cell * 0.12)
sheet = Image.new('RGB', (cols * cell, rows * (cell + lab)), (22, 13, 8))
try: font = ImageFont.truetype('C:/Windows/Fonts/malgunbd.ttf', int(lab * 0.55))
except Exception: font = ImageFont.load_default()
dr = ImageDraw.Draw(sheet)
for k, (f, label) in enumerate(items):
    x, y = (k % cols) * cell, (k // cols) * (cell + lab)
    sheet.paste(Image.open(f'{d}/{f}').convert('RGB').resize((cell, cell), Image.LANCZOS), (x, y))
    dr.text((x + cell / 2, y + cell + lab / 2), label, fill=(240, 220, 190), font=font, anchor='mm')
sheet.save(out)
