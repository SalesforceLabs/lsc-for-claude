"""The five Roz app icons users pick between in Settings (ids match ROZ_ICONS in
src-electron/app-icon.ts), plus sheet.svg to compare them. Usage: python3 roz.py OUTDIR"""
import sys, os, shutil, tempfile, importlib.util
OUT = sys.argv[1]
spec = importlib.util.spec_from_file_location("gen", os.path.join(os.path.dirname(__file__), "gen.py"))
g = importlib.util.module_from_spec(spec)
scratch = tempfile.mkdtemp()  # gen.py writes its own variants on import; Roz only reuses its shapes
sys.argv = [sys.argv[0], scratch]
spec.loader.exec_module(g)
shutil.rmtree(scratch)
squircle, pill, helix, helix_svg, mix = g.squircle, g.pill, g.helix, g.helix_svg, g.mix
BLUE, MAG, LAV = g.BLUE, g.MAG, g.LAV

BGS = {
 "midnight": ("#24319A", "#170F5A", "#33106E"),
 "brand":    ("#4655E8", "#7A2BEA", "#B000F2"),
 "light":    ("#FFFFFF", "#F2EEFF", "#DCD2FF"),
 "ink":      ("#0E1238", "#0A0B24", "#1A0C3A"),
}

def robot(p, bg="midnight", head=(640, 440, 620), n=3.2, visor=(500, 250), eye=(92, 134, 122),
          eyes="pill", smile=("arc", 150, 24), ears=(64, 170), ant=(146, 70, 46, 1.25), tilt=14,
          strands=(BLUE, MAG), rung=LAV, dimto="#161461", head_fill=("#FFFFFF", "#E6DFFF"),
          visor_fill=("#161D60", "#090C30"), halo=("#7A5CFF", .5), clip_head=False):
    hw, hh, hcy = head
    htop = hcy - hh / 2
    vw, vh = visor; vcy = hcy - hh * 0.06
    ew, eh, edx = eye
    top, amp, sw, turns = ant
    base = htop + 8
    b = BGS[bg]
    defs = f'''<defs>
 <linearGradient id="{p}bg" x1="0" y1="0" x2=".35" y2="1"><stop offset="0" stop-color="{b[0]}"/><stop offset=".55" stop-color="{b[1]}"/><stop offset="1" stop-color="{b[2]}"/></linearGradient>
 <radialGradient id="{p}halo" cx=".5" cy=".55" r=".55"><stop offset="0" stop-color="{halo[0]}" stop-opacity="{halo[1]}"/><stop offset="1" stop-color="{halo[0]}" stop-opacity="0"/></radialGradient>
 <linearGradient id="{p}head" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{head_fill[0]}"/><stop offset="1" stop-color="{head_fill[1]}"/></linearGradient>
 <linearGradient id="{p}rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".95"/><stop offset=".3" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>
 <linearGradient id="{p}visor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{visor_fill[0]}"/><stop offset="1" stop-color="{visor_fill[1]}"/></linearGradient>
 <linearGradient id="{p}glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".18"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>
 <linearGradient id="{p}eye" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#D45CFF"/><stop offset="1" stop-color="#5664FF"/></linearGradient>
 <linearGradient id="{p}collar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#C9BCF6"/></linearGradient>
 <radialGradient id="{p}bulb"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".45" stop-color="#F3E6FF"/><stop offset="1" stop-color="{LAV}"/></radialGradient>
 <filter id="{p}glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="16"/></filter>
 <filter id="{p}drop" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#06041A" flood-opacity=".40"/></filter>
 <filter id="{p}icon" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000" flood-opacity=".28"/></filter>
 <clipPath id="{p}clip"><path d="{squircle(512, 512, 824, 824, g.TILE_N)}"/></clipPath>
</defs>'''
    tile = f'''<g filter="url(#{p}icon)"><path d="{squircle(512, 512, 824, 824, g.TILE_N)}" fill="url(#{p}bg)"/></g>
<g clip-path="url(#{p}clip)"><rect width="1024" height="1024" fill="url(#{p}halo)"/></g>'''

    st, rg = helix(512, top + sw * 0.6, base - 20, amp, turns, sw)
    rg = [(a, c, y) for a, c, y in rg]
    hsvg = helix_svg(st, rg, strands, dimto, rung).replace('stroke-width="15"', f'stroke-width="{sw * 0.38:.1f}"')
    br = sw * 0.68
    cw = sw * 1.9
    antenna = f'''<g transform="rotate({tilt} 512 {base})">{hsvg}
<circle cx="512" cy="{top + sw * 0.35}" r="{br * 1.35}" fill="{LAV}" filter="url(#{p}glow)" opacity=".7"/>
<circle cx="512" cy="{top + sw * 0.35}" r="{br}" fill="url(#{p}bulb)"/></g>
<path d="M{512-cw},{base + 18} C{512-cw},{base - 22} {512-cw*.6},{base - cw*.45} 512,{base - cw*.45} C{512+cw*.6},{base - cw*.45} {512+cw},{base - 22} {512+cw},{base + 18}Z" fill="url(#{p}collar)"/>'''

    ear = ""
    if ears:
        ew_, eh_ = ears
        for s, col in ((-1, BLUE), (1, MAG)):
            ex = 512 + s * (hw / 2 + ew_ * 0.3)
            ear += f'<rect {pill(ex, hcy, ew_, eh_)} fill="{col}"/>'
            ear += f'<rect {pill(ex + s * ew_ * 0.16, hcy - eh_ * 0.18, ew_ * 0.22, eh_ * 0.32)} fill="#FFFFFF" opacity=".32"/>'
    hd = squircle(512, hcy, hw, hh, n)
    headsvg = f'''{ear}<path d="{hd}" fill="url(#{p}head)"/>
<path d="{squircle(512, hcy + 1, hw - 8, hh - 8, n)}" fill="none" stroke="url(#{p}rim)" stroke-width="6"/>'''

    gx0, gx1, gy = 512 - vw / 2 + vh * 0.24, 512 + vw / 2 - vh * 0.24, vcy - vh / 2 + vh * 0.17
    visorsvg = f'''<rect {pill(512, vcy, vw, vh)} fill="url(#{p}visor)"/>
<path d="M{gx0},{gy} C{512 - vw*.28},{gy - vh*.13} {512 + vw*.28},{gy - vh*.13} {gx1},{gy}" fill="none" stroke="url(#{p}glass)" stroke-width="{vh*.11:.1f}" stroke-linecap="round"/>'''

    if eyes == "pill":
        e = "".join(f'<rect {pill(512 + s * edx, vcy, ew, eh)} fill="url(#{p}eye)"/>' for s in (-1, 1))
        hl = "".join(f'<rect {pill(512 + s * edx - ew * .2, vcy - eh * .22, ew * .28, eh * .3)} fill="#FFFFFF" opacity=".92"/>' for s in (-1, 1))
    elif eyes == "round":
        e = "".join(f'<circle cx="{512 + s * edx}" cy="{vcy}" r="{ew / 2}" fill="url(#{p}eye)"/>' for s in (-1, 1))
        hl = "".join(f'<circle cx="{512 + s * edx - ew * .16}" cy="{vcy - ew * .16}" r="{ew * .14}" fill="#FFFFFF" opacity=".95"/>' for s in (-1, 1))
    else:  # happy ^ ^
        e = "".join(f'<path d="M{512 + s*edx - ew/2},{vcy + eh*.18} Q{512 + s*edx},{vcy - eh*.62} {512 + s*edx + ew/2},{vcy + eh*.18}" fill="none" stroke="url(#{p}eye)" stroke-width="{ew*.34:.1f}" stroke-linecap="round"/>' for s in (-1, 1))
        hl = ""
    eyesvg = f'<g filter="url(#{p}glow)" opacity=".9">{e}</g>{e}{hl}'

    kind, smw, sms = smile
    sy = vcy + vh / 2 + (hcy + hh / 2 - (vcy + vh / 2)) * 0.42
    if kind == "arc":
        smilesvg = f'<path d="M{512 - smw/2},{sy - smw*.06} C{512 - smw*.25},{sy + smw*.22} {512 + smw*.25},{sy + smw*.22} {512 + smw/2},{sy - smw*.06}" fill="none" stroke="#C78BFF" stroke-width="{sms}" stroke-linecap="round"/>'
    else:  # open D-shaped grin
        smilesvg = f'<path d="M{512 - smw/2},{sy - smw*.1} Q512,{sy - smw*.16} {512 + smw/2},{sy - smw*.1} C{512 + smw*.46},{sy + smw*.34} {512 - smw*.46},{sy + smw*.34} {512 - smw/2},{sy - smw*.1}Z" fill="#B67CFF"/>'

    body = f'{antenna}{headsvg}'
    face = f'{visorsvg}{eyesvg}{smilesvg}'
    if clip_head:
        return f'{defs}{tile}<g clip-path="url(#{p}clip)"><g filter="url(#{p}drop)">{body}</g>{face}</g>'
    return f'{defs}{tile}<g filter="url(#{p}drop)">{body}</g>{face}'

V = {
  # 1. Same character, everything ~25% bigger and heavier
  "bold": robot("a"),
  # 2. Brand gradient tile, white/lavender helix for contrast — pops on a dark dock
  "brand": robot("b", bg="brand", strands=("#FFFFFF", "#E2CCFF"), rung="#F4EAFF", dimto="#6A3AE0",
                   halo=("#FFFFFF", .18)),
  # 3. Close-up: head runs off the bottom of the tile, giant eyes
  "closeup": robot("c", head=(780, 560, 730), n=3.0, visor=(620, 300), eye=(118, 168, 150),
                     smile=("arc", 170, 28), ears=(70, 200), ant=(140, 74, 46, 1.1), clip_head=True),
  # 4. Happy ^ ^ eyes and an open grin — readable as "friendly" even at 32 px
  "happy": robot("d", eyes="happy", eye=(124, 120, 124), smile=("grin", 150, 0)),
  # 5. Light tile with the bold face — maximum contrast on a dark dock
  "light": robot("e", bg="light", halo=("#FFFFFF", .9), dimto="#E3DCFF", eyes="round", eye=(116, 116, 122),
                   head_fill=("#FFFFFF", "#EEE9FF")),
}
wrap = lambda body, w=1024, h=1024: f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">{body}</svg>'
for k, body in V.items():
    open(f"{OUT}/{k}.svg", "w").write(wrap(body))
    # Just the tile, for logos inside the app
    open(f"{OUT}/tile-{k}.svg", "w").write(wrap(body).replace('viewBox="0 0 1024 1024"', 'viewBox="100 100 824 824"', 1))

# sheet: big previews on top, then a dark and a light "dock" at real size (64 px tiles, 2x)
cells, W = [], 40 + 380 * len(V)
for i, (k, body) in enumerate(V.items()):
    x = 40 + i * 380
    cells.append(f'<svg x="{x}" y="30" width="340" height="340" viewBox="0 0 1024 1024">{body}</svg>')
    cells.append(f'<text x="{x + 170}" y="400" font-family="-apple-system, Helvetica" font-size="24" fill="#333" text-anchor="middle">{k}</text>')
dock = lambda y, fill: f'<rect x="40" y="{y}" width="{W - 80}" height="150" rx="36" fill="{fill}"/>'
cells.append(dock(440, "#2A2340")); cells.append(dock(620, "#E9E6EF"))
for i, (k, body) in enumerate(V.items()):
    x = 40 + i * 380 + 106
    for y in (451, 631):
        cells.append(f'<svg x="{x}" y="{y}" width="128" height="128" viewBox="0 0 1024 1024">{body}</svg>')
for i, (k, body) in enumerate(V.items()):
    x = 40 + i * 380 + 154
    cells.append(f'<svg x="{x}" y="820" width="32" height="32" viewBox="0 0 1024 1024">{body}</svg>')
    cells.append(f'<svg x="{x + 40}" y="828" width="16" height="16" viewBox="0 0 1024 1024">{body}</svg>')
H = 900
cells.insert(0, f'<rect y="{H}" width="{W}" height="{W - H}" fill="#F7F7FA"/>')
H = W
open(f"{OUT}/sheet.svg", "w").write(wrap(f'<rect width="{W}" height="{H}" fill="#F7F7FA"/>' + "".join(cells), W, H))
