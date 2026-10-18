#!/usr/bin/env python3
"""
Builds the offline base map for LSC Studio's iPad preview (IpadMap.tsx).

Source: Natural Earth (https://www.naturalearthdata.com), public domain. Layers used, all from
https://naturalearth.s3.amazonaws.com/<scale>_<theme>/<name>.zip:
  50m_physical/ne_50m_land, ne_50m_lakes, ne_50m_rivers_lake_centerlines
  50m_cultural/ne_50m_admin_0_boundary_lines_land, ne_50m_admin_1_states_provinces_lines
  10m_cultural/ne_10m_populated_places_simple
  10m_raster/NE1_LR_LC (Natural Earth I with land cover; only used to tint the land)

Usage: python3 scripts/build-ipad-map-data.py <dir with the unzipped layers, one folder per layer name>
Writes src-renderer/components/studio/assets/ipad-map-data.json and ipad-map-tint.png.
The tint ramp (arid yellow to forest green) was fitted to the Apple Maps colours seen on the iPad (Home Up Next map).
"""

import json
import math
import os
import struct
import sys

SRC = sys.argv[1]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src-renderer", "components", "studio", "assets")
UNIT = 100  # coordinates are stored in 1/100 degree


def read_dbf(path):
    with open(path, "rb") as f:
        data = f.read()
    n, hlen, rlen = struct.unpack("<IHH", data[4:12])
    fields, pos = [], 32
    while data[pos] != 0x0D:
        name = data[pos:pos + 11].split(b"\0")[0].decode("latin1")
        fields.append((name.lower(), data[pos + 16]))
        pos += 32
    rows = []
    for i in range(n):
        rec = data[hlen + i * rlen: hlen + (i + 1) * rlen]
        off, row = 1, {}
        for name, ln in fields:
            row[name] = rec[off:off + ln].decode("utf-8", "replace").strip()
            off += ln
        rows.append(row)
    return rows


def read_shp(path):
    """Yields (type, parts) where parts = list of [(lon, lat)...]; points give one single-point part."""
    with open(path, "rb") as f:
        data = f.read()
    pos = 100
    while pos < len(data):
        _, clen = struct.unpack(">ii", data[pos:pos + 8])
        body = data[pos + 8: pos + 8 + clen * 2]
        pos += 8 + clen * 2
        t = struct.unpack("<i", body[:4])[0]
        if t == 0:
            yield 0, []
        elif t == 1:
            x, y = struct.unpack("<dd", body[4:20])
            yield 1, [[(x, y)]]
        elif t in (3, 5):
            nparts, npts = struct.unpack("<ii", body[36:44])
            parts = list(struct.unpack(f"<{nparts}i", body[44:44 + 4 * nparts])) + [npts]
            p0 = 44 + 4 * nparts
            pts = [struct.unpack("<dd", body[p0 + 16 * i: p0 + 16 * i + 16]) for i in range(npts)]
            yield t, [pts[parts[i]:parts[i + 1]] for i in range(nparts)]
        else:
            raise SystemExit(f"unsupported shape type {t}")


def dp(pts, tol):
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = pts[a], pts[b]
        dx, dy = bx - ax, by - ay
        den = math.hypot(dx, dy) or 1e-12
        best, idx = 0.0, -1
        for i in range(a + 1, b):
            d = abs(dy * (pts[i][0] - ax) - dx * (pts[i][1] - ay)) / den
            if d > best:
                best, idx = d, i
        if best > tol:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(pts, keep) if k]


def dp_ring(ring, tol):
    """dp() for a closed ring: split at the point farthest from the start so the chord isn't degenerate."""
    k = max(range(len(ring)), key=lambda i: (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2)
    return dp(ring[: k + 1], tol)[:-1] + dp(ring[k:], tol)


def encode(pts):
    """[x0, y0, dx, dy, ...] in 1/100 degree, consecutive duplicates dropped."""
    q = []
    for x, y in pts:
        p = (round(x * UNIT), round(y * UNIT))
        if not q or q[-1] != p:
            q.append(p)
    if len(q) < 2:
        return None
    out = [q[0][0], q[0][1]]
    for a, b in zip(q, q[1:]):
        out += [b[0] - a[0], b[1] - a[1]]
    return out


def layer(name):
    base = os.path.join(SRC, name, name)
    return read_shp(base + ".shp"), read_dbf(base + ".dbf")


def lines(name, tol, keep=lambda row: True, box=None):
    shapes, rows = layer(name)
    out = []
    for (_, parts), row in zip(shapes, rows):
        if not keep(row):
            continue
        for part in parts:
            if box and not any(box[0] <= x <= box[2] and box[1] <= y <= box[3] for x, y in part):
                continue
            e = encode(dp(part, tol))
            if e:
                out.append(e)
    return out


def polys(name, tol, box=None):
    shapes, _ = layer(name)
    out = []
    for _, parts in shapes:
        for ring in parts:
            if len(ring) < 4:
                continue
            xs = [p[0] for p in ring]
            ys = [p[1] for p in ring]
            if box and (max(xs) < box[0] or min(xs) > box[2] or max(ys) < box[1] or min(ys) > box[3]):
                continue
            e = encode(dp_ring(ring, tol))
            if e and len(e) >= 8:
                out.append(e)
    return out


NA = (-180, 0, -40, 85)


def build_data():
    data = {
        "unit": UNIT,
        "land": polys("ne_50m_land", 0.02),
        "lakes": polys("ne_50m_lakes", 0.02, NA),
        "rivers": lines("ne_50m_rivers_lake_centerlines", 0.03, lambda r: float(r.get("scalerank") or 9) <= 6, NA),
        "borders": lines("ne_50m_admin_0_boundary_lines_land", 0.02, box=NA),
        "states": lines("ne_50m_admin_1_states_provinces_lines", 0.02, lambda r: r.get("adm0_a3") in ("USA", "CAN", "MEX"), NA),
    }
    shapes, rows = layer("ne_10m_populated_places_simple")
    places = []
    for (_, parts), r in zip(shapes, rows):
        x, y = parts[0][0]
        if not (NA[0] <= x <= NA[2] and NA[1] <= y <= NA[3]):
            continue
        mz = float(r.get("min_zoom") or 99)
        if mz > 6.5:
            continue
        places.append([r["name"], round(y, 3), round(x, 3), mz, int(float(r.get("pop_max") or 0))])
    places.sort(key=lambda p: (p[3], -p[4]))
    data["places"] = places
    return data


# Tint: Natural Earth I colours mapped to Apple's land palette with a linear fit (RGB, rows = R,G,B in; columns = R,G,B out).
TINT_FIT = [
    [1.717, 0.454, 0.770],
    [-2.733, -0.506, -1.961],
    [0.334, -0.137, 0.946],
    [357.949, 267.426, 233.406],
]
TINT_BOX = (-180, 10, -50, 75)
TINT_PPD = 8  # pixels per degree


def build_tint():
    import numpy as np
    from PIL import Image

    Image.MAX_IMAGE_PIXELS = None
    im = Image.open(os.path.join(SRC, "NE1_LR_LC", "NE1_LR_LC.tif")).convert("RGB")
    w, h = im.size
    box = (int((TINT_BOX[0] + 180) / 360 * w), int((90 - TINT_BOX[3]) / 180 * h), int((TINT_BOX[2] + 180) / 360 * w), int((90 - TINT_BOX[1]) / 180 * h))
    ow, oh = (TINT_BOX[2] - TINT_BOX[0]) * TINT_PPD, (TINT_BOX[3] - TINT_BOX[1]) * TINT_PPD
    a = np.asarray(im.crop(box)).astype(float)
    land = ~((a > 250).all(axis=2))
    fx, fy = a.shape[1] // ow, a.shape[0] // oh
    a = a[: oh * fy, : ow * fx]
    land = land[: oh * fy, : ow * fx]
    wsum = land.reshape(oh, fy, ow, fx).sum(axis=(1, 3))
    csum = (a * land[..., None]).reshape(oh, fy, ow, fx, 3).sum(axis=(1, 3))
    have = wsum > 0
    col = np.where(have[..., None], csum / np.maximum(wsum, 1)[..., None], 0)
    # Grow the land colours out over the sea so the clipped coast has no halo.
    for _ in range(12):
        pad = np.pad(col, ((1, 1), (1, 1), (0, 0)))
        hv = np.pad(have, 1)
        s = np.zeros_like(col)
        n = np.zeros(have.shape)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                m = hv[1 + dy: 1 + dy + oh, 1 + dx: 1 + dx + ow]
                s += pad[1 + dy: 1 + dy + oh, 1 + dx: 1 + dx + ow] * m[..., None]
                n += m
        grow = ~have & (n > 0)
        col = np.where(grow[..., None], s / np.maximum(n, 1)[..., None], col)
        have = have | grow
    col[~have] = (187, 228, 135)
    # Resample the rows from latitude-linear to Web Mercator-linear (what the map draws in), nearest row.
    merc = lambda lat: math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
    m0, m1 = merc(TINT_BOX[1]), merc(TINT_BOX[3])
    rows = int(round((m1 - m0) * TINT_PPD * 180 / math.pi))
    src_rows = []
    for r in range(rows):
        lat = math.degrees(2 * math.atan(math.exp(m1 - (r + 0.5) / rows * (m1 - m0))) - math.pi / 2)
        src_rows.append(min(oh - 1, max(0, int((TINT_BOX[3] - lat) * TINT_PPD))))
    col = col[src_rows]
    oh = rows
    m = np.array(TINT_FIT)
    out = np.clip(np.einsum("ijk,kl->ijl", col, m[:3]) + m[3], (150, 205, 120), (235, 245, 180))
    out = out.astype("uint8")
    Image.fromarray(out).quantize(colors=96, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(os.path.join(OUT, "ipad-map-tint.png"), optimize=True)


if __name__ == "__main__":
    d = build_data()
    with open(os.path.join(OUT, "ipad-map-data.json"), "w") as f:
        json.dump(d, f, separators=(",", ":"))
    print({k: (len(v) if isinstance(v, list) else v) for k, v in d.items()})
    if "--no-tint" not in sys.argv:
        build_tint()
