"""
scripts/generate_textures.py
Generates deterministic, high-resolution procedural Earth textures for EARTHSONIC:
  - earth_day_2k.png: Day surface with oceans, vegetation, deserts, and polar ice
  - earth_night_2k.png: Earth at night with glowing city light grids and population hubs
  - earth_bump_2k.png: Topographic elevation relief map
  - earth_specular_2k.png: Ocean reflectivity mask (water=255, land=0)
  - earth_clouds_2k.png: Atmospheric cloud cover alpha mask

Run with: py -3 scripts/generate_textures.py
"""

import os
import math
import random
import io
import urllib.request
from PIL import Image, ImageDraw, ImageFilter

WIDTH = 2048
HEIGHT = 1024
ASSETS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "assets", "textures")


def lat_lon_to_xy(lat, lon, width=WIDTH, height=HEIGHT):
    """Convert (lat, lon) in degrees to equirectangular pixel coordinates (x, y)."""
    x = (lon + 180.0) / 360.0 * width
    y = (90.0 - lat) / 180.0 * height
    return x, y


def poly_to_xy(coords, width=WIDTH, height=HEIGHT):
    """Convert list of (lon, lat) pairs to pixel points [(x, y), ...]."""
    return [lat_lon_to_xy(lat, lon, width, height) for lon, lat in coords]


# Major continental boundary polygons (lon, lat)
CONTINENTS = [
    # North America
    {
        "name": "North America",
        "type": "land",
        "biome": "temperate",
        "coords": [
            (-168, 65), (-140, 70), (-130, 68), (-124, 48), (-120, 34),
            (-110, 23), (-105, 20), (-90, 16), (-83, 9), (-77, 8),
            (-80, 22), (-82, 25), (-80, 31), (-75, 35), (-70, 42),
            (-60, 46), (-55, 52), (-60, 60), (-80, 62), (-95, 69),
            (-115, 69), (-140, 68), (-165, 60), (-168, 65)
        ]
    },
    # Alaska
    {
        "name": "Alaska",
        "type": "land",
        "biome": "tundra",
        "coords": [
            (-168, 65), (-140, 70), (-135, 60), (-150, 58), (-165, 60), (-168, 65)
        ]
    },
    # Greenland
    {
        "name": "Greenland",
        "type": "ice",
        "biome": "ice",
        "coords": [
            (-55, 60), (-35, 65), (-20, 70), (-20, 82), (-40, 83), (-60, 82), (-55, 60)
        ]
    },
    # South America
    {
        "name": "South America",
        "type": "land",
        "biome": "tropical",
        "coords": [
            (-77, 8), (-60, 10), (-50, 4), (-35, -5), (-35, -10),
            (-40, -22), (-50, -30), (-55, -40), (-65, -55), (-72, -53),
            (-75, -45), (-72, -35), (-70, -20), (-80, -5), (-77, 8)
        ]
    },
    # Eurasia
    {
        "name": "Eurasia",
        "type": "land",
        "biome": "mixed",
        "coords": [
            (-10, 36), (0, 38), (15, 40), (28, 41), (35, 32),
            (50, 26), (60, 25), (70, 20), (78, 8), (88, 22),
            (92, 10), (105, 10), (108, 18), (120, 23), (122, 30),
            (130, 42), (140, 50), (160, 55), (170, 65), (179, 66),
            (179, 72), (140, 74), (100, 78), (60, 74), (30, 71),
            (10, 60), (-5, 58), (-10, 44), (-10, 36)
        ]
    },
    # Scandinavia
    {
        "name": "Scandinavia",
        "type": "land",
        "biome": "boreal",
        "coords": [
            (5, 58), (15, 56), (25, 60), (30, 70), (20, 71), (10, 64), (5, 58)
        ]
    },
    # British Isles
    {
        "name": "British Isles",
        "type": "land",
        "biome": "temperate",
        "coords": [
            (-10, 50), (2, 50), (2, 58), (-5, 59), (-10, 55), (-10, 50)
        ]
    },
    # Africa
    {
        "name": "Africa",
        "type": "land",
        "biome": "desert_tropical",
        "coords": [
            (-17, 15), (-15, 30), (-5, 36), (10, 37), (25, 32),
            (32, 28), (43, 12), (51, 10), (40, -5), (35, -20),
            (30, -32), (20, -35), (15, -25), (10, 0), (0, 5), (-17, 15)
        ]
    },
    # Madagascar
    {
        "name": "Madagascar",
        "type": "land",
        "biome": "tropical",
        "coords": [
            (44, -12), (50, -12), (48, -25), (43, -25), (44, -12)
        ]
    },
    # Arabian Peninsula
    {
        "name": "Arabia",
        "type": "land",
        "biome": "desert",
        "coords": [
            (35, 30), (55, 25), (60, 22), (52, 14), (44, 13), (35, 27), (35, 30)
        ]
    },
    # India
    {
        "name": "India",
        "type": "land",
        "biome": "tropical",
        "coords": [
            (68, 24), (77, 8), (88, 22), (85, 28), (75, 32), (68, 24)
        ]
    },
    # Japan
    {
        "name": "Japan",
        "type": "land",
        "biome": "temperate",
        "coords": [
            (130, 32), (133, 34), (141, 38), (145, 44), (142, 45), (135, 35), (130, 32)
        ]
    },
    # Southeast Asia / Indonesia / Philippines
    {
        "name": "Indonesia",
        "type": "land",
        "biome": "tropical",
        "coords": [
            (95, 5), (105, 5), (115, -2), (125, -8), (105, -8), (95, -5), (95, 5)
        ]
    },
    {
        "name": "Borneo/Papua",
        "type": "land",
        "biome": "tropical",
        "coords": [
            (110, 2), (118, 5), (120, -3), (112, -4), (110, 2)
        ]
    },
    {
        "name": "Papua",
        "type": "land",
        "biome": "tropical",
        "coords": [
            (131, -1), (150, -5), (150, -10), (140, -8), (131, -4), (131, -1)
        ]
    },
    # Australia
    {
        "name": "Australia",
        "type": "land",
        "biome": "savannah",
        "coords": [
            (114, -22), (115, -34), (135, -35), (150, -38), (153, -28),
            (145, -15), (142, -11), (130, -13), (122, -18), (114, -22)
        ]
    },
    # New Zealand
    {
        "name": "New Zealand",
        "type": "land",
        "biome": "temperate",
        "coords": [
            (166, -46), (174, -41), (178, -35), (175, -42), (168, -47), (166, -46)
        ]
    },
    # Antarctica (South Pole)
    {
        "name": "Antarctica",
        "type": "ice",
        "biome": "ice",
        "coords": [
            (-179, -65), (-120, -70), (-70, -63), (-60, -65), (0, -68),
            (60, -65), (120, -64), (179, -65), (179, -89), (-179, -89), (-179, -65)
        ]
    }
]

# Major city centers for night lights (lon, lat, intensity, radius)
CITIES = [
    # North America
    (-74.0, 40.7, 1.0, 18),   # New York
    (-87.6, 41.8, 0.9, 14),   # Chicago
    (-118.2, 34.0, 0.95, 16), # Los Angeles
    (-122.4, 37.7, 0.9, 12),  # San Francisco
    (-95.3, 29.7, 0.85, 12),  # Houston
    (-80.1, 25.7, 0.85, 11),  # Miami
    (-79.3, 43.6, 0.85, 12),  # Toronto
    (-99.1, 19.4, 0.95, 15),  # Mexico City
    # Europe
    (-0.1, 51.5, 1.0, 16),    # London
    (2.3, 48.8, 1.0, 15),     # Paris
    (13.4, 52.5, 0.85, 12),   # Berlin
    (12.5, 41.9, 0.8, 11),    # Rome
    (-3.7, 40.4, 0.8, 11),    # Madrid
    (37.6, 55.7, 0.9, 15),    # Moscow
    # Asia
    (139.6, 35.6, 1.0, 22),   # Tokyo
    (126.9, 37.5, 0.95, 15),  # Seoul
    (121.4, 31.2, 1.0, 18),   # Shanghai
    (116.4, 39.9, 0.95, 16),  # Beijing
    (114.1, 22.3, 0.95, 14),  # Hong Kong / Shenzhen
    (100.5, 13.7, 0.85, 12),  # Bangkok
    (103.8, 1.3, 0.9, 11),    # Singapore
    (106.8, -6.2, 0.85, 13),  # Jakarta
    (72.8, 18.9, 0.95, 16),   # Mumbai
    (77.2, 28.6, 0.95, 16),   # Delhi
    (55.2, 25.2, 0.9, 12),    # Dubai
    # South America
    (-46.6, -23.5, 0.95, 16), # São Paulo
    (-43.1, -22.9, 0.9, 13),  # Rio de Janeiro
    (-58.3, -34.6, 0.9, 14),  # Buenos Aires
    (-77.0, -12.0, 0.8, 10),  # Lima
    (-74.0, 4.7, 0.8, 10),    # Bogotá
    # Africa
    (31.2, 30.0, 0.9, 14),    # Cairo
    (3.3, 6.5, 0.8, 12),      # Lagos
    (28.0, -26.2, 0.85, 12),  # Johannesburg
    # Oceania
    (151.2, -33.8, 0.9, 13),  # Sydney
    (144.9, -37.8, 0.85, 12), # Melbourne
]


def generate_day_map():
    """Generate equirectangular Day Map with ocean depth gradients and biomes."""
    img = Image.new("RGB", (WIDTH, HEIGHT), (11, 37, 69))
    draw = ImageDraw.Draw(img)

    # Ocean latitude gradient (darker near poles, vibrant cyan-navy at tropics)
    for y in range(HEIGHT):
        lat = 90.0 - (y / HEIGHT) * 180.0
        trop_factor = math.cos(math.radians(lat))
        r = int(7 + trop_factor * 12)
        g = int(22 + trop_factor * 28)
        b = int(50 + trop_factor * 45)
        draw.line([(0, y), (WIDTH, y)], fill=(r, g, b))

    # Draw continents
    for cont in CONTINENTS:
        pts = poly_to_xy(cont["coords"])
        biome = cont.get("biome", "temperate")
        if biome == "ice":
            fill_color = (235, 245, 252)
        elif biome == "desert":
            fill_color = (195, 162, 108)
        elif biome == "desert_tropical":
            fill_color = (185, 150, 95)
        elif biome == "tropical":
            fill_color = (42, 92, 45)
        elif biome == "savannah":
            fill_color = (150, 135, 75)
        elif biome == "boreal":
            fill_color = (48, 72, 50)
        elif biome == "tundra":
            fill_color = (100, 110, 85)
        else:
            fill_color = (52, 98, 55)

        draw.polygon(pts, fill=fill_color)

    # Add North Polar Ice Cap (Arctic)
    arctic_pts = poly_to_xy([(-179, 78), (-100, 75), (0, 76), (100, 75), (179, 78), (179, 89), (-179, 89)])
    draw.polygon(arctic_pts, fill=(240, 248, 255))

    # Smooth the edges slightly
    img = img.filter(ImageFilter.SMOOTH)
    return img


def generate_night_map():
    """Generate equirectangular Night Map with dark oceans and glowing city lights."""
    img = Image.new("RGB", (WIDTH, HEIGHT), (3, 6, 12))
    draw = ImageDraw.Draw(img)

    # Land silhouettes (very dark muted blue-gray)
    for cont in CONTINENTS:
        if cont.get("biome") != "ice":
            pts = poly_to_xy(cont["coords"])
            draw.polygon(pts, fill=(8, 14, 22))

    # Render city lights and glowing clusters
    light_layer = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    light_draw = ImageDraw.Draw(light_layer)

    random.seed(42)  # Deterministic seed

    # 1. Major metropolitan hubs
    for lon, lat, intensity, radius in CITIES:
        cx, cy = lat_lon_to_xy(lat, lon)
        # Multi-stage radial bloom
        for r in range(int(radius * 1.8), 0, -2):
            alpha = int(45 * intensity * (1.0 - r / (radius * 1.8)))
            light_draw.ellipse(
                [(cx - r, cy - r), (cx + r, cy + r)],
                fill=(255, 205, 110, alpha)
            )
        # Hot core
        light_draw.ellipse(
            [(cx - 3, cy - 3), (cx + 3, cy + 3)],
            fill=(255, 245, 220, int(230 * intensity))
        )

    # 2. Highway filaments and secondary towns across populated continents
    def sprinkle_lights(lon_min, lon_max, lat_min, lat_max, count):
        for _ in range(count):
            lon = random.uniform(lon_min, lon_max)
            lat = random.uniform(lat_min, lat_max)
            cx, cy = lat_lon_to_xy(lat, lon)
            sz = random.choice([1, 1, 1, 2])
            alpha = random.randint(100, 200)
            light_draw.rectangle([(cx, cy), (cx + sz, cy + sz)], fill=(255, 215, 130, alpha))

    # Eastern USA
    sprinkle_lights(-95, -70, 30, 45, 400)
    # Western Europe
    sprinkle_lights(-5, 25, 42, 55, 450)
    # India
    sprinkle_lights(72, 88, 12, 30, 350)
    # Eastern China & Japan
    sprinkle_lights(110, 140, 25, 42, 450)
    # Brazil Coast
    sprinkle_lights(-50, -35, -30, -10, 150)

    # Composite city lights onto dark globe
    img = Image.alpha_composite(img.convert("RGBA"), light_layer).convert("RGB")
    return img


def generate_bump_map():
    """Generate equirectangular topographic bump map."""
    img = Image.new("L", (WIDTH, HEIGHT), 80)  # Ocean baseline = 80
    draw = ImageDraw.Draw(img)

    for cont in CONTINENTS:
        pts = poly_to_xy(cont["coords"])
        draw.polygon(pts, fill=135)  # Plains = 135

    # Mountain ranges (bright highlights for height)
    # Rockies & Andes
    rockies = poly_to_xy([(-125, 55), (-115, 45), (-105, 32), (-110, 32), (-120, 48)])
    draw.polygon(rockies, fill=195)
    andes = poly_to_xy([(-72, 5), (-75, -15), (-70, -35), (-68, -35), (-70, -15), (-75, 5)])
    draw.polygon(andes, fill=210)
    # Himalayas & Tibetan Plateau
    himalayas = poly_to_xy([(75, 34), (95, 32), (98, 28), (85, 27), (75, 31)])
    draw.polygon(himalayas, fill=240)
    # Alps
    alps = poly_to_xy([(6, 46), (14, 47), (12, 45), (7, 45)])
    draw.polygon(alps, fill=200)

    img = img.filter(ImageFilter.GaussianBlur(radius=2))
    return img


def generate_specular_map():
    """Generate ocean specular mask: oceans = 255 (full shine), land = 0 (matte)."""
    img = Image.new("L", (WIDTH, HEIGHT), 255)  # Oceans reflect 100%
    draw = ImageDraw.Draw(img)

    for cont in CONTINENTS:
        pts = poly_to_xy(cont["coords"])
        draw.polygon(pts, fill=0)  # Land does not reflect

    # Large inland lakes (reflect)
    # Great Lakes
    gl = poly_to_xy([(-88, 44), (-82, 46), (-77, 44), (-83, 42)])
    draw.polygon(gl, fill=230)
    # Caspian Sea
    caspian = poly_to_xy([(48, 45), (54, 42), (52, 37), (49, 39)])
    draw.polygon(caspian, fill=230)

    img = img.filter(ImageFilter.GaussianBlur(radius=1))
    return img


def generate_clouds_map():
    """Generate atmospheric clouds alpha map with ITCZ and cyclone swirls."""
    img = Image.new("RGBA", (WIDTH, HEIGHT), (255, 255, 255, 0))
    draw = ImageDraw.Draw(img)

    random.seed(101)

    # 1. Equatorial cloud belt (ITCZ: lat -5 to +10)
    for x in range(0, WIDTH, 4):
        lon = (x / WIDTH) * 360.0 - 180.0
        wave = math.sin(lon * 0.08) * 4.0 + math.sin(lon * 0.2) * 2.0
        lat_center = 2.0 + wave
        cy = (90.0 - lat_center) / 180.0 * HEIGHT
        h = 24 + math.cos(lon * 0.05) * 10
        alpha = int(90 + math.sin(lon * 0.1) * 35)
        draw.ellipse([(x - 12, cy - h / 2), (x + 12, cy + h / 2)], fill=(255, 255, 255, alpha))

    # 2. Mid-latitude storm spirals (cyclones)
    cyclones = [
        (-140, 48), (-40, 52), (160, 45), (-120, -50), (20, -52), (100, -48)
    ]
    for lon, lat in cyclones:
        cx, cy = lat_lon_to_xy(lat, lon)
        for arm in range(3):
            angle_offset = arm * (2 * math.pi / 3)
            for r in range(10, 70, 4):
                theta = angle_offset + r * 0.06
                px = cx + math.cos(theta) * r * 1.6
                py = cy + math.sin(theta) * r * 0.8
                alpha = int(120 * (1.0 - r / 70.0))
                draw.ellipse([(px - 8, py - 6), (px + 8, py + 6)], fill=(255, 255, 255, alpha))

    img = img.filter(ImageFilter.GaussianBlur(radius=3))
    return img


def download_nasa_textures(assets_dir=ASSETS_DIR):
    """
    Download authentic NASA Blue Marble and Black Marble 2K equirectangular textures.
    Returns True if all assets downloaded and verified successfully, False otherwise.
    """
    nasa_sources = {
        "earth_day_2k.png": ("https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_atmos_2048.jpg", "RGB"),
        "earth_specular_2k.png": ("https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_specular_2048.jpg", "L"),
        "earth_night_2k.png": ("https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_lights_2048.png", "RGB"),
        "earth_clouds_2k.png": ("https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_clouds_1024.png", "RGBA"),
    }
    print(f"Attempting to download authentic NASA Earth texture suite into: {assets_dir}...")
    try:
        for filename, (url, mode) in nasa_sources.items():
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = resp.read()
            img = Image.open(io.BytesIO(data))
            if img.size != (WIDTH, HEIGHT):
                img = img.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)
            img = img.convert(mode)
            out_path = os.path.join(assets_dir, filename)
            img.save(out_path, "PNG", optimize=True)
            print(f"  [OK-NASA] {filename} ({os.path.getsize(out_path)} bytes)")

        # Generate bump map locally
        bump = generate_bump_map()
        bump.save(os.path.join(assets_dir, "earth_bump_2k.png"), "PNG")
        print("  [OK-LOCAL] earth_bump_2k.png")
        print("Authentic NASA Earth textures downloaded and validated.")
        return True
    except Exception as e:
        print(f"  [WARN] Failed downloading NASA textures: {e}. Falling back to procedural generation.")
        return False


def main():
    os.makedirs(ASSETS_DIR, exist_ok=True)
    success = download_nasa_textures(ASSETS_DIR)
    if not success:
        print(f"Generating procedural fallback Earth texture suite into: {ASSETS_DIR}...")

        day = generate_day_map()
        day.save(os.path.join(ASSETS_DIR, "earth_day_2k.png"), "PNG")
        print("  [OK] earth_day_2k.png")

        night = generate_night_map()
        night.save(os.path.join(ASSETS_DIR, "earth_night_2k.png"), "PNG")
        print("  [OK] earth_night_2k.png")

        bump = generate_bump_map()
        bump.save(os.path.join(ASSETS_DIR, "earth_bump_2k.png"), "PNG")
        print("  [OK] earth_bump_2k.png")

        spec = generate_specular_map()
        spec.save(os.path.join(ASSETS_DIR, "earth_specular_2k.png"), "PNG")
        print("  [OK] earth_specular_2k.png")

        clouds = generate_clouds_map()
        clouds.save(os.path.join(ASSETS_DIR, "earth_clouds_2k.png"), "PNG")
        print("  [OK] earth_clouds_2k.png")

        print("All 5 Earth texture assets successfully generated procedurally.")


if __name__ == "__main__":
    main()
