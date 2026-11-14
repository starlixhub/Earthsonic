#!/usr/bin/env python3
"""
scripts/build_gistemp_grid.py

Converts NASA GISS GISTEMP v4 gridded surface-temperature anomalies
(gistemp250_GHCNv4.nc, 90 x 180 global grid, monthly, degrees C anomaly vs the
1951-1980 baseline) into a compact per-year texture that the VR globe samples.

Output (frontend/assets/data/):
  gistemp_grid_annual.bin   int8, year-major, one 92 x 180 block per year
                            (row 0 = 1st pad, rows 1..90 = north..south, row 91 = pad)
  gistemp_grid_annual.json  {years, width, height, pad, rowsPerYear, scale, missing}

Encoding: int8 = round(anomaly_C * scale), missing = -128.
The texture upload shifts by +128 so an int8 fits an unsigned byte channel.

No synthetic values: every cell is the mean of the real monthly grid cells for
that year; cells with no observations stay missing and the shader falls back.
"""

import json
import os
import sys

import numpy as np
from scipy.io import netcdf_file

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# The 1200 km product is the global land+ocean field (ERSSTv5 fills the oceans);
# the 250 km file is land-only and leaves ocean cells empty.
SRC = os.path.join(ROOT, "data", "raw", "gistemp1200_GHCNv4_ERSSTv5.nc")
OUT_DIR = os.path.join(ROOT, "frontend", "assets", "data")
OUT_BIN = os.path.join(OUT_DIR, "gistemp_grid_annual.bin")
OUT_JSON = os.path.join(OUT_DIR, "gistemp_grid_annual.json")

SCALE = 40.0          # 0.025 C per step, +-3.1 C span inside int8
MISSING = -128
PAD = 1               # duplicate edge rows so bilinear sampling never blends years


def main():
    gz = SRC + ".gz"
    if not os.path.exists(SRC):
        if not os.path.exists(gz):
            sys.exit("missing %s (or .gz) — download it from data.giss.nasa.gov/pub/gistemp/" % SRC)
        # Read straight from the shipped .gz so the 57 MB NetCDF never has to
        # live in the repo unpacked.
        import gzip
        handle = gzip.open(gz, "rb")
    else:
        handle = SRC

    f = netcdf_file(handle, "r", mmap=False)
    lat = np.array(f.variables["lat"][:], dtype=np.float32)
    lon = np.array(f.variables["lon"][:], dtype=np.float32)
    time = np.array(f.variables["time"][:], dtype=np.int64)
    raw = f.variables["tempanomaly"]
    fill = float(getattr(raw, "_FillValue", 32767.0))
    # The grid stores anomalies as scaled int16 (scale_factor = 0.01 K). scipy
    # does NOT apply CF packing automatically, so doing it here is what keeps
    # the field in real degrees instead of 100x too hot.
    vscale = float(getattr(raw, "scale_factor", 1.0))
    voffset = float(getattr(raw, "add_offset", 0.0))
    data = np.array(raw[:], dtype=np.float32) * vscale + voffset  # (time, lat, lon)
    f.close()

    # time is "days since 1800-01-01"; one record per month from 1880-01.
    monthly = data.copy()
    monthly[monthly >= fill - 0.5] = np.nan

    n_time, n_lat, n_lon = monthly.shape
    n_years = n_time // 12
    years = list(range(1880, 1880 + n_years))

    # lat array runs south -> north; flip so row 0 is the north pole.
    flip = lat[0] < lat[-1]
    if flip:
        monthly = monthly[:, ::-1, :]

    # Per-year mean of the real monthly values (NaN where unobserved).
    with np.errstate(invalid="ignore"):
        annual = np.nanmean(monthly[: n_years * 12].reshape(n_years, 12, n_lat, n_lon), axis=1)

    rows = n_lat + 2 * PAD
    block = np.full((n_years, rows, n_lon), MISSING, dtype=np.int8)

    for yi in range(n_years):
        year_grid = annual[yi]
        valid = np.isfinite(year_grid)
        q = np.full((n_lat, n_lon), MISSING, dtype=np.int16)
        q[valid] = np.clip(np.round(year_grid[valid] * SCALE), -125, 125).astype(np.int16)
        block[yi, PAD:PAD + n_lat, :] = q.astype(np.int8)
        # edge pads repeat the nearest real row
        block[yi, PAD - 1, :] = block[yi, PAD, :]
        block[yi, PAD + n_lat, :] = block[yi, PAD + n_lat - 1, :]

    os.makedirs(OUT_DIR, exist_ok=True)
    block.tofile(OUT_BIN)
    meta = {
        "source": "NASA GISS GISTEMP v4 (gistemp1200_GHCNv4_ERSSTv5.nc), 1200 km smoothing, global land+ocean",
        "baseline": "1951-1980",
        "units": "degC anomaly",
        "width": int(n_lon),
        "height": int(n_lat),
        "pad": PAD,
        "rowsPerYear": int(rows),
        "scale": SCALE,
        "missing": MISSING,
        "years": years,
    }
    with open(OUT_JSON, "w", encoding="utf-8") as fh:
        json.dump(meta, fh)

    print("wrote %s (%.1f MB) and %s (%d years, %dx%d)"
          % (OUT_BIN, os.path.getsize(OUT_BIN) / 1e6, OUT_JSON, len(years), n_lon, n_lat))


if __name__ == "__main__":
    main()
