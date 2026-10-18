"""App icon generator — the LSC helix as a robot's antenna. Usage: python3 gen.py OUTDIR

Writes one SVG per variant, tile-only crops (app-*.svg) for in-app use, and sheet.svg.
Run build/icon-src/export.sh to render them into build/icon.{icns,ico,png} and src-renderer/public."""
import math, sys
OUT = sys.argv[1]
BLUE, MAG, LAV = "#3D4BDB", "#B000F2", "#D08BFF"
TILE_N = 4.2                     # tile superellipse exponent (Apple-like continuous corners)

def hx(c): return tuple(int(c[i:i+2], 16) for i in (1, 3, 5))
def mix(a, b, t):
    a, b = hx(a), hx(b)
    return "#%02X%02X%02X" % tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))

def squircle(cx, cy, w, h, n, steps=720):
    pts = []
    for i in range(steps):
        a = 2 * math.pi * i / steps
        c, s = math.cos(a), math.sin(a)
        pts.append((cx + w / 2 * math.copysign(abs(c) ** (2 / n), c),
                    cy + h / 2 * math.copysign(abs(s) ** (2 / n), s)))
    return "M" + " L".join(f"{x:.2f},{y:.2f}" for x, y in pts) + "Z"

def pill(cx, cy, w, h):
    return f'x="{cx-w/2:.2f}" y="{cy-h/2:.2f}" width="{w:.2f}" height="{h:.2f}" rx="{min(w, h)/2:.2f}"'

def ribbon(pts):
    """pts: (x, y, width) along a centre line -> filled outline."""
    L, R = [], []
    for i, (x, y, w) in enumerate(pts):
        a, b = pts[max(i - 1, 0)], pts[min(i + 1, len(pts) - 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]; d = math.hypot(dx, dy) or 1
        nx, ny = -dy / d * w / 2, dx / d * w / 2
        L.append((x + nx, y + ny)); R.append((x - nx, y - ny))
    return "M" + " L".join(f"{x:.2f},{y:.2f}" for x, y in L + R[::-1]) + "Z"

def runs(samples, keyfn):
    """Split samples into runs by key; neighbours overlap by one sample so seams close."""
    out, cur, key = [], [], None
    for i, q in enumerate(samples):
        k = keyfn(q)
        if key is not None and k != key:
            cur.append(q); out.append((key, cur)); cur = [samples[i - 1]]
        key = k; cur.append(q)
    out.append((key, cur))
    return out

def helix(cx, top, bot, amp, turns, base_w, phase0=0.6, N=700):
    strands = []
    for ph in (0, math.pi):
        s = []
        for i in range(N + 1):
            t = i / N
            env = math.sin(math.pi * t) ** 0.55          # strands meet at both ends
            a = phase0 + t * turns * 2 * math.pi + ph
            z = math.cos(a)
            w = base_w * (0.80 + 0.10 * (z + 1)) * (0.35 + 0.65 * env)
            s.append((cx + amp * env * math.sin(a), top + t * (bot - top), z, w))
        strands.append(s)
    rungs = []
    for k in range(8):
        i = round((k + 0.5) / 8 * N)
        lo, hi = sorted((strands[0][i][0], strands[1][i][0]))
        inset = base_w * 0.62
        if hi - lo > 2 * inset + 14:
            rungs.append((lo + inset, hi - inset, strands[0][i][1]))
    return strands, rungs

LEVELS = 10
def shade(col, dimto, dim, z):
    """Continuous depth tone: full colour in front (z=1), dimmed toward the background behind."""
    return mix(col, dimto, dim * (1 - (z + 1) / 2) ** 1.2)

def ribbon_runs(samples, front_of, col, dimto, dim, xyw):
    """Paths for one strand, grouped by (in front?, depth level) so tone changes smoothly."""
    out = {True: "", False: ""}
    for (f, lvl), r in runs(samples, lambda q: (front_of(q), round((xyw(q)[3] + 1) / 2 * LEVELS))):
        c = shade(col, dimto, dim, lvl / LEVELS * 2 - 1)
        out[f] += f'<path d="{ribbon([xyw(q)[:3] for q in r])}" fill="{c}" stroke="{c}" stroke-width=".8"/>'
    return out

def helix_svg(strands, rungs, cols, dimto, rung_col, dim=0.45):
    back, front = "", ""
    for s, col in zip(strands, cols):
        o = ribbon_runs(s, lambda q: q[2] > 0, col, dimto, dim, lambda q: (q[0], q[1], q[3], q[2]))
        back += o[False]; front += o[True]
    rg = "".join(f'<line x1="{a:.2f}" y1="{y:.2f}" x2="{b:.2f}" y2="{y:.2f}" stroke="{rung_col}" stroke-width="15" stroke-linecap="round"/>' for a, b, y in rungs)
    return back + rg + front

THEMES = {
 "midnight": dict(bg=("#1E2A86", "#150E52", "#2B0A62"), halo="#7A5CFF", halo_o=.50,
                  head=("#FFFFFF", "#E7E1FF"), rim="#FFFFFF", visor=("#151C5C", "#0A0D33"),
                  smile=LAV, collar=("#E9E3FF", "#C2B4F4"), back="#161461"),
 "daylight": dict(bg=("#FFFFFF", "#F3EFFF", "#DED4FF"), halo="#FFFFFF", halo_o=.9,
                  head=("#FFFFFF", "#ECE7FF"), rim="#FFFFFF", visor=("#1A2266", "#0B0F3A"),
                  smile="#B98BFF", collar=("#FFFFFF", "#D3C8F6"), back="#E8E2FF"),
 "noir":     dict(bg=("#12153A", "#0A0B1F", "#160B30"), halo="#5B3BFF", halo_o=.35,
                  head=("#2A2F70", "#14163D"), rim="#8A78FF", visor=("#07081C", "#04040F"),
                  smile=LAV, collar=("#454B9A", "#2A2F70"), back="#0C0E28"),
}

def defs(th, p):
    return f'''<defs>
 <linearGradient id="{p}bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{th['bg'][0]}"/><stop offset=".55" stop-color="{th['bg'][1]}"/><stop offset="1" stop-color="{th['bg'][2]}"/></linearGradient>
 <radialGradient id="{p}halo" cx=".5" cy=".6" r=".55"><stop offset="0" stop-color="{th['halo']}" stop-opacity="{th['halo_o']}"/><stop offset="1" stop-color="{th['halo']}" stop-opacity="0"/></radialGradient>
 <linearGradient id="{p}head" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{th['head'][0]}"/><stop offset="1" stop-color="{th['head'][1]}"/></linearGradient>
 <linearGradient id="{p}collar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{th['collar'][0]}"/><stop offset="1" stop-color="{th['collar'][1]}"/></linearGradient>
 <linearGradient id="{p}rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{th['rim']}" stop-opacity=".95"/><stop offset=".35" stop-color="{th['rim']}" stop-opacity="0"/></linearGradient>
 <linearGradient id="{p}visor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{th['visor'][0]}"/><stop offset="1" stop-color="{th['visor'][1]}"/></linearGradient>
 <linearGradient id="{p}glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".16"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>
 <linearGradient id="{p}eye" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C64DFF"/><stop offset="1" stop-color="#4F5BFF"/></linearGradient>
 <radialGradient id="{p}bulb"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".45" stop-color="#F3E6FF"/><stop offset="1" stop-color="{LAV}"/></radialGradient>
 <filter id="{p}glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="14"/></filter>
 <filter id="{p}drop" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="16" stdDeviation="20" flood-color="#06041A" flood-opacity=".38"/></filter>
 <filter id="{p}icon" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000" flood-opacity=".28"/></filter>
 <clipPath id="{p}clip"><path d="{squircle(512, 512, 824, 824, TILE_N)}"/></clipPath>
</defs>'''

def tile(p):
    return f'''<g filter="url(#{p}icon)"><path d="{squircle(512, 512, 824, 824, TILE_N)}" fill="url(#{p}bg)"/></g>
<g clip-path="url(#{p}clip)"><rect width="1024" height="1024" fill="url(#{p}halo)"/></g>'''

# geometry on the 1024 canvas / 824 body grid
HEAD = dict(cx=512, cy=630, w=532, h=388, n=3.4)
HEAD_TOP = HEAD["cy"] - HEAD["h"] / 2
VISOR = dict(cx=512, cy=610, w=400, h=196)
EYE_DX, EYE_W, EYE_H = 96, 72, 102
EAR_W, EAR_H, EAR_OUT = 56, 144, 18

def ears(cols, highlight=True):
    out = ""
    for s, col in zip((-1, 1), cols):
        ex = HEAD["cx"] + s * (HEAD["w"] / 2 + EAR_OUT)
        out += f'<rect {pill(ex, HEAD["cy"], EAR_W, EAR_H)} fill="{col}"/>'
        if highlight:
            out += f'<rect {pill(ex + s * 10, HEAD["cy"] - 28, 12, 44)} fill="#FFFFFF" opacity=".32"/>'
    return out

def collar_path(base):
    return (f'M{512-70},{base + 16} C{512-70},{base - 20} {512-42},{base - 30} 512,{base - 30} '
            f'C{512+42},{base - 30} {512+70},{base - 20} {512+70},{base + 16}Z')

def head(th, p):
    c, w, h, n = HEAD["cx"], HEAD["w"], HEAD["h"], HEAD["n"]
    return f'''{ears((BLUE, MAG))}<path d="{squircle(c, HEAD['cy'], w, h, n)}" fill="url(#{p}head)"/>
<path d="{squircle(c, HEAD['cy'] + 1, w - 6, h - 6, n)}" fill="none" stroke="url(#{p}rim)" stroke-width="5"/>'''

def smile_path(sy):
    return f"M{512 - 54},{sy} C{512 - 30},{sy + 22} {512 + 30},{sy + 22} {512 + 54},{sy}"

def face(th, p):
    vx, vy, vw, vh = VISOR["cx"], VISOR["cy"], VISOR["w"], VISOR["h"]
    eyes = "".join(f'<rect {pill(vx + s * EYE_DX, vy, EYE_W, EYE_H)} fill="url(#{p}eye)"/>' for s in (-1, 1))
    hl = "".join(f'<rect {pill(vx + s * EYE_DX - 14, vy - 22, 20, 30)} fill="#FFFFFF" opacity=".9"/>' for s in (-1, 1))
    gx0, gx1, gy = vx - vw / 2 + 44, vx + vw / 2 - 44, vy - vh / 2 + 32
    return f'''<rect {pill(vx, vy, vw, vh)} fill="url(#{p}visor)"/>
<path d="M{gx0},{gy} C{vx - 110},{gy - 26} {vx + 110},{gy - 26} {gx1},{gy}" fill="none" stroke="url(#{p}glass)" stroke-width="22" stroke-linecap="round"/>
<g filter="url(#{p}glow)" opacity=".85">{eyes}</g>{eyes}{hl}
<path d="{smile_path(vy + vh / 2 + 50)}" fill="none" stroke="{th['smile']}" stroke-width="18" stroke-linecap="round"/>'''

def antenna(th, p):
    base = HEAD_TOP + 6
    strands, rungs = helix(512, 194, base - 18, 66, 1.5, 40)
    return f'''<g transform="rotate(14 512 {base})">
{helix_svg(strands, rungs, (BLUE, MAG), th['back'], LAV)}
<circle cx="512" cy="186" r="34" fill="{LAV}" filter="url(#{p}glow)" opacity=".7"/>
<circle cx="512" cy="186" r="26" fill="url(#{p}bulb)"/>
</g>
<path d="{collar_path(base)}" fill="url(#{p}collar)"/>
<path d="M{512-50},{base - 12} C{512-34},{base - 24} {512+34},{base - 24} {512+50},{base - 12}" fill="none" stroke="#FFFFFF" stroke-opacity=".5" stroke-width="5" stroke-linecap="round"/>'''

def classic(name):
    th, p = THEMES[name], name[0]
    return f'''{defs(th, p)}{tile(p)}
<g filter="url(#{p}drop)">{antenna(th, p)}{head(th, p)}</g>{face(th, p)}'''

def halo():
    """The helix bent into a ring floating over the head."""
    th, p = THEMES["midnight"], "h"
    cx, cy, rx, ry, amp, twists, N = 512, 352, 214, 50, 15, 7, 2400
    layers = {k: "" for k in ((False, False), (False, True), (True, False), (True, True))}
    for ph, col in ((0, BLUE), (math.pi, MAG)):
        pts = []
        for i in range(N + 1):
            a = 2 * math.pi * i / N
            k = twists * a + ph
            z = math.cos(k)
            nx, ny = math.cos(a) / rx, math.sin(a) / ry
            nn = math.hypot(nx, ny); nx, ny = nx / nn, ny / nn
            off = amp * math.sin(k)
            ring_front = math.sin(a) > 0
            # depth tone combines the twist and which side of the ring we are on
            zz = max(-1, min(1, 0.65 * z + 0.35 * math.sin(a)))
            pts.append((cx + rx * math.cos(a) + nx * off, cy + ry * math.sin(a) + ny * off,
                        26 * (0.80 + 0.10 * (z + 1)), zz, ring_front, z > 0))
        for rf in (False, True):
            sub = [q if q[4] == rf else None for q in pts]
            seg = []
            for q in sub + [None]:
                if q is None:
                    if seg:
                        o = ribbon_runs(seg, lambda q: q[5], col, th["back"], 0.6, lambda q: (q[0], q[1], q[2], q[3]))
                        layers[(rf, False)] += o[False]; layers[(rf, True)] += o[True]
                    seg = []
                else:
                    seg.append(q)
    L = lambda k: layers[k]
    return f'''{defs(th, p)}{tile(p)}
{L((False, False))}{L((False, True))}
<g filter="url(#{p}drop)">{head(th, p)}</g>{face(th, p)}
{L((True, False))}{L((True, True))}'''

def glyph():
    """Flat two-tone mark for small sizes, menu bar and monochrome use."""
    base = HEAD_TOP + 6
    strands, rungs = helix(512, 194, base - 18, 66, 1.5, 40)
    vx, vy = VISOR["cx"], VISOR["cy"]
    holes = "".join(f'<rect {pill(vx + s * EYE_DX, vy, EYE_W, EYE_H)} fill="#000"/>' for s in (-1, 1))
    return f'''<defs>
 <linearGradient id="gbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{BLUE}"/><stop offset="1" stop-color="{MAG}"/></linearGradient>
 <filter id="gicon" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000" flood-opacity=".28"/></filter>
 <mask id="gm"><path d="{squircle(HEAD['cx'], HEAD['cy'], HEAD['w'], HEAD['h'], HEAD['n'])}" fill="#fff"/>{holes}
  <path d="{smile_path(vy + VISOR['h'] / 2 + 50)}" fill="none" stroke="#000" stroke-width="20" stroke-linecap="round"/></mask>
</defs>
<g filter="url(#gicon)"><path d="{squircle(512, 512, 824, 824, TILE_N)}" fill="url(#gbg)"/></g>
<g transform="rotate(14 512 {base})">{helix_svg(strands, rungs, ("#FFFFFF", "#FFFFFF"), "#7A4BE6", "#CDB8FF", dim=0.42)}<circle cx="512" cy="186" r="28" fill="#FFFFFF"/></g>
<path d="{collar_path(base)}" fill="#FFFFFF"/>{ears(("#FFFFFF", "#FFFFFF"), highlight=False)}
<rect width="1024" height="1024" fill="#FFFFFF" mask="url(#gm)"/>'''

V = {"1-midnight": classic("midnight"), "2-daylight": classic("daylight"), "3-noir": classic("noir"),
     "4-halo": halo(), "5-glyph": glyph()}
wrap = lambda body, w=1024, h=1024: f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">{body}</svg>'
for k, body in V.items():
    open(f"{OUT}/{k}.svg", "w").write(wrap(body))
    # tile only, without the canvas margin, for <img> use inside the app
    open(f"{OUT}/app-{k}.svg", "w").write(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="100 100 824 824" width="824" height="824">{body}</svg>')

# contact sheet: 3 x 2 grid with 128 / 64 / 32 px proofs (ids are per-variant, so nesting is safe)
cells = []
for i, (k, body) in enumerate(V.items()):
    x, y = 40 + (i % 3) * 600, 40 + (i // 3) * 900
    cells.append(f'<svg x="{x}" y="{y}" width="560" height="560" viewBox="0 0 1024 1024">{body}</svg>')
    for sz, dx in ((128, 40), (64, 208), (32, 302)):
        cells.append(f'<svg x="{x + dx}" y="{y + 600}" width="{sz}" height="{sz}" viewBox="0 0 1024 1024">{body}</svg>')
    cells.append(f'<text x="{x + 280}" y="{y + 810}" font-family="-apple-system, Helvetica" font-size="30" fill="#333" text-anchor="middle">{k}</text>')
open(f"{OUT}/sheet.svg", "w").write(wrap('<rect width="1840" height="1840" fill="#F4F4F7"/>' + "".join(cells), 1840, 1840))
