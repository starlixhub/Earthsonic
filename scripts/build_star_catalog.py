"""
scripts/build_star_catalog.py

Pack the Hipparcos naked-eye star catalogue (magnitude <= 6, 5,044 stars) into a
compact float32 block for the VR sky: ra (deg), dec (deg), V magnitude, B-V.

Source: d3-celestial `stars.6.json`, itself a Hipparcos (ESA) extract — the same
catalogue the previous skybox was painted from, but here the positions, magnitudes
and colours are used directly instead of being rasterised into a texture.

Output (frontend/assets/data/):
  stars_hip_mag6.bin   count * 16 bytes  (Float32LE x4 per star)
  stars_hip_mag6.json  metadata
"""
import json
import os
import struct

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data", "raw", "stars_hip_mag6.json")
OUT_DIR = os.path.join(ROOT, "frontend", "assets", "data")
BIN_NAME = "stars_hip_mag6.bin"
META_NAME = "stars_hip_mag6.json"


def build():
    with open(SRC, encoding="utf-8") as fh:
        data = json.load(fh)

    rows = []
    for feat in data["features"]:
        ra, dec = feat["geometry"]["coordinates"]
        props = feat["properties"]
        mag = float(props["mag"])
        bv_raw = props.get("bv")
        bv = float(bv_raw) if bv_raw not in (None, "") else 0.65
        ra = float(ra) % 360.0
        rows.append((ra, float(dec), mag, bv))

    # Brightest first so the point cloud draws the visually dominant stars early.
    rows.sort(key=lambda r: r[2])

    os.makedirs(OUT_DIR, exist_ok=True)
    buf = bytearray()
    for ra, dec, mag, bv in rows:
        buf += struct.pack("<ffff", ra, dec, mag, bv)

    bin_path = os.path.join(OUT_DIR, BIN_NAME)
    with open(bin_path, "wb") as fh:
        fh.write(buf)

    mags = [r[2] for r in rows]
    meta = {
        "source": "ESA Hipparcos catalogue, naked-eye subset (V <= 6.0)",
        "publisher": "European Space Agency / d3-celestial stars.6 extract",
        "count": len(rows),
        "stride_floats": 4,
        "fields": ["ra_deg", "dec_deg", "v_mag", "b_minus_v"],
        "minMag": round(min(mags), 2),
        "maxMag": round(max(mags), 2),
        "bytes": len(buf),
    }
    with open(os.path.join(OUT_DIR, META_NAME), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2)

    print(f"wrote {bin_path} ({len(buf)} bytes, {len(rows)} stars)")
    print(f"wrote {os.path.join(OUT_DIR, META_NAME)}")


if __name__ == "__main__":
    build()
