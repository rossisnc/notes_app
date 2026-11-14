# Dev helper: finds small square/round outlines (tick boxes) on template PNGs, writes overlay previews + boxes.json.
# Usage: python3 scripts/find-checkboxes.py public/templates OUT_DIR name1 name2 ...
# Faint rings (like the lemon planner circles) may need a colour-targeted pass instead.
import sys, json
from collections import deque, Counter
from PIL import Image, ImageDraw
src, out = sys.argv[1], sys.argv[2]
names = sys.argv[3:]
result = {}
for name in names:
    im = Image.open(f'{src}/{name}.png').convert('RGB')
    S = 2
    small = im.resize((im.width // S, im.height // S), Image.BILINEAR)
    W, H = small.size
    px = small.load()
    bg = Counter(small.getdata()).most_common(1)[0][0]
    def far(c, ref, t):
        return abs(c[0]-ref[0]) + abs(c[1]-ref[1]) + abs(c[2]-ref[2]) > t
    seen = bytearray(W * H)
    comps = []
    for y in range(H):
        for x in range(W):
            i = y * W + x
            if seen[i]: continue
            c = px[x, y]
            if not far(c, bg, 40): seen[i] = 1; continue
            # flood-fill pixels "similar" to the seed (same region)
            q = deque([(x, y)]); seen[i] = 1
            minx = maxx = x; miny = maxy = y; n = 0
            while q:
                cx, cy = q.popleft(); n += 1
                minx = min(minx, cx); maxx = max(maxx, cx); miny = min(miny, cy); maxy = max(maxy, cy)
                for nx, ny in ((cx+1,cy),(cx-1,cy),(cx,cy+1),(cx,cy-1)):
                    if 0 <= nx < W and 0 <= ny < H:
                        j = ny * W + nx
                        if not seen[j] and far(px[nx, ny], bg, 40):
                            seen[j] = 1; q.append((nx, ny))
            comps.append((minx, miny, maxx, maxy, n))
    boxes = []
    for (x0, y0, x1, y1, n) in comps:
        w, h = x1 - x0 + 1, y1 - y0 + 1
        if 13 <= w <= 40 and 13 <= h <= 40 and 0.8 <= w / h <= 1.25:
            boxes.append([x0 * S, y0 * S, w * S, h * S, n])
    result[name] = boxes
    prev = im.copy(); d = ImageDraw.Draw(prev)
    for (x, y, w, h, n) in boxes: d.rectangle([x - 4, y - 4, x + w + 4, y + h + 4], outline=(255, 0, 0), width=5)
    prev.resize((410, 590)).save(f'{out}/{name}.png')
    print(name, len(boxes), 'bg', bg)
json.dump(result, open(f'{out}/boxes.json', 'w'))
