#!/bin/sh
# Renders the Roz app icons with Electron's Chromium (transparent corners, each size drawn from the
# vector):
#   src-renderer/public/roz/<id>.png — the five icons users pick between in Settings (512 px, for the dock)
#   src-renderer/public/roz/tile-<id>.png — the same cropped to the tile (256 px, for logos in the app)
#   build/icon.icns, build/icon.ico, build/icon.png — the default ("bold"), packed for electron-builder
# macOS only (iconutil).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

python3 -I "$here/roz.py" "$work"
set_=$work/icon.iconset
mkdir "$set_"; mkdir -p "$root/src-renderer/public/roz"
jobs=""
for sz in 16 32 64 128 256 512 1024; do
  jobs="$jobs $work/bold.svg:$sz:$work/$sz.png"
done
for id in bold brand closeup happy light; do
  jobs="$jobs $work/$id.svg:512:$root/src-renderer/public/roz/$id.png"
  jobs="$jobs $work/tile-$id.svg:256:$root/src-renderer/public/roz/tile-$id.png"
done
# shellcheck disable=SC2086
(cd "$root" && npx --no-install electron "$here/render.cjs" $jobs)

cp "$work/16.png" "$set_/icon_16x16.png";      cp "$work/32.png" "$set_/icon_16x16@2x.png"
cp "$work/32.png" "$set_/icon_32x32.png";      cp "$work/64.png" "$set_/icon_32x32@2x.png"
cp "$work/128.png" "$set_/icon_128x128.png";   cp "$work/256.png" "$set_/icon_128x128@2x.png"
cp "$work/256.png" "$set_/icon_256x256.png";   cp "$work/512.png" "$set_/icon_256x256@2x.png"
cp "$work/512.png" "$set_/icon_512x512.png";   cp "$work/1024.png" "$set_/icon_512x512@2x.png"
iconutil -c icns "$set_" -o "$root/build/icon.icns"
cp "$work/1024.png" "$root/build/icon.png"

# .ico with PNG-compressed entries (supported since Windows Vista)
python3 -I - "$root/build/icon.ico" "$work/16.png" "$work/32.png" "$work/64.png" "$work/128.png" "$work/256.png" <<'PY'
import struct, sys
out, files = sys.argv[1], sys.argv[2:]
blobs = [open(f, "rb").read() for f in files]
sizes = [struct.unpack(">II", b[16:24])[0] for b in blobs]
head = struct.pack("<HHH", 0, 1, len(blobs))
off, dirs = 6 + 16 * len(blobs), b""
for b, s in zip(blobs, sizes):
    dirs += struct.pack("<BBBBHHII", s % 256, s % 256, 0, 0, 1, 32, len(b), off); off += len(b)
open(out, "wb").write(head + dirs + b"".join(blobs))
PY

echo "icons written"
