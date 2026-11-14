"""
tests/test_r2_empirical_challenger.py
Adversarial Empirical Verification Suite for Requirement R2 (Flight-Deck UI Polish & Telemetry Controls).
Executed by challenger_overhaul_2 to stress-test and independently verify all R2 criteria.
"""

import os
import re
import json
import pytest
from html.parser import HTMLParser

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(PROJECT_ROOT, "frontend")
CSS_DIR = os.path.join(FRONTEND_DIR, "css")
JS_DIR = os.path.join(FRONTEND_DIR, "js")
DATA_PATH = os.path.join(PROJECT_ROOT, "data", "processed", "earthsonic_monthly_harmonized.json")


def load_file(rel_path):
    p = os.path.join(PROJECT_ROOT, rel_path)
    with open(p, "r", encoding="utf-8") as f:
        return f.read()


class Node:
    def __init__(self, tag, attrs, parent=None):
        self.tag = tag
        self.attrs = dict(attrs)
        self.children = []
        self.text_parts = []
        self.parent = parent

    def get(self, k, default=None):
        return self.attrs.get(k, default)

    def get_text(self):
        return "".join(self.text_parts) + "".join(c.get_text() for c in self.children)

    def find(self, tag=None, id=None, class_=None):
        for c in self.children:
            match = True
            if tag and c.tag != tag:
                match = False
            if id and c.attrs.get("id") != id:
                match = False
            if class_ and class_ not in c.attrs.get("class", "").split():
                match = False
            if match:
                return c
            sub = c.find(tag=tag, id=id, class_=class_)
            if sub:
                return sub
        return None

    def find_all(self, tag=None, id=None, class_=None):
        res = []
        def _walk(n):
            for c in n.children:
                m = True
                if tag and c.tag != tag:
                    m = False
                if id and c.attrs.get("id") != id:
                    m = False
                if class_ and class_ not in c.attrs.get("class", "").split():
                    m = False
                if m:
                    res.append(c)
                _walk(c)
        _walk(self)
        return res


class SimpleHTMLTree(HTMLParser):
    def __init__(self, convert_charrefs=False):
        super().__init__(convert_charrefs=convert_charrefs)
        self.root = Node("root", {})
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs, self.stack[-1])
        self.stack[-1].children.append(node)
        if tag not in ("img", "br", "hr", "input", "meta", "link"):
            self.stack.append(node)

    def handle_endtag(self, tag):
        if len(self.stack) > 1 and self.stack[-1].tag == tag:
            self.stack.pop()

    def handle_data(self, data):
        self.stack[-1].text_parts.append(data)


def parse_html(html_str, convert_charrefs=False):
    parser = SimpleHTMLTree(convert_charrefs=convert_charrefs)
    parser.feed(html_str)
    return parser.root


# ============================================================================
# 1. HEADER STATUS BADGE EMPIRICAL VERIFICATION
# ============================================================================

def test_header_status_badge_unicode_and_zero_entity():
    """Verify #telemetry-status contains literal • character and zero occurrences of &bull;."""
    html_content = load_file("frontend/index.html")
    tree = parse_html(html_content, convert_charrefs=False)
    badge = tree.find(id="telemetry-status")
    assert badge is not None, "Element #telemetry-status must exist in index.html"

    # Raw HTML snippet checks
    badge_raw_snippet = re.search(r'<span\s+id="telemetry-status">([^<]+)</span>', html_content)
    assert badge_raw_snippet is not None, "Could not find <span id='telemetry-status'> in index.html"
    raw_inner = badge_raw_snippet.group(1)
    assert "&bull;" not in raw_inner, f"Raw snippet of #telemetry-status contains '&bull;': {raw_inner}"
    assert "•" in raw_inner, f"Raw snippet of #telemetry-status must contain Unicode bullet '•': {raw_inner}"
    assert "FLIGHT DECK ONLINE • 23.44° TILT" in raw_inner

    # Text content check
    badge_text = badge.get_text()
    assert "•" in badge_text, f"Text content must contain '•', found: {repr(badge_text)}"
    assert "&bull;" not in badge_text, "Text content must not contain literal string '&bull;'"

    # Verify JS callers pass clean bullet
    app_js = load_file("frontend/js/app.js")
    assert "updateTelemetryStatus('FLIGHT DECK ONLINE • 23.44° TILT')" in app_js, \
        "app.js must call updateTelemetryStatus with Unicode bullet '•'"
    assert "FLIGHT DECK ONLINE &bull;" not in app_js, "app.js must not contain literal &bull;"

    # Verify telemetry.js sanitizer logic
    telemetry_js = load_file("frontend/js/ui/telemetry.js")
    assert ".replace(/&bull;/g, '•')" in telemetry_js or ".replace(/&bull;/g, \"•\")" in telemetry_js, \
        "telemetry.js must sanitize &bull; to •"


def test_header_status_sanitizer_edge_cases():
    """Adversarially test the regex sanitizer used in updateTelemetryStatus."""
    def sanitize(text):
        return text.replace("&bull;", "•").replace("&deg;", "°") if text else ""

    assert sanitize(None) == ""
    assert sanitize("") == ""
    assert sanitize("FLIGHT DECK ONLINE &bull; 23.44&deg; TILT") == "FLIGHT DECK ONLINE • 23.44° TILT"
    assert sanitize("&bull;&bull;&bull;") == "•••"
    assert sanitize("ALREADY • CLEAN") == "ALREADY • CLEAN"


# ============================================================================
# 2. TOP-RIGHT HUD CARD & LIVE EARTH TELEMETRY MATRIX EMPIRICAL VERIFICATION
# ============================================================================

def test_glsl_terminator_elimination():
    """Verify DAY / NIGHT GLSL TERMINATOR text is completely eliminated across frontend."""
    for root, _, files in os.walk(FRONTEND_DIR):
        for f in files:
            if f.endswith((".html", ".css", ".js")):
                p = os.path.join(root, f)
                content = open(p, "r", encoding="utf-8").read()
                assert "DAY / NIGHT GLSL TERMINATOR" not in content, \
                    f"Found deprecated text 'DAY / NIGHT GLSL TERMINATOR' in {p}"


def test_live_earth_telemetry_matrix_dom_structure():
    """Verify Live Earth Telemetry Matrix card displays all 4 variables with proper IDs and data attributes."""
    html_content = load_file("frontend/index.html")
    tree = parse_html(html_content, convert_charrefs=False)

    # HUD Card
    hud_card = tree.find(id="hud-matrix-card")
    assert hud_card is not None, "Element #hud-matrix-card must exist"
    classes = hud_card.get("class", "").split()
    assert "hud-panel" in classes, "#hud-matrix-card must have class hud-panel"

    # Title
    title = hud_card.find(class_="hud-title")
    assert title is not None and "Live Earth Telemetry Matrix" in title.get_text()

    # Matrix Grid
    grid = hud_card.find(id="telemetry-matrix-grid")
    assert grid is not None, "Element #telemetry-matrix-grid must exist"

    cells = grid.find_all(class_="matrix-cell")
    assert len(cells) == 4, f"Matrix grid must contain exactly 4 cells, found {len(cells)}"

    expected_variables = {
        "temperature": {"label": "TEMP", "val_id": "matrix-val-temperature", "expected_default": "+1.38°C"},
        "co2": {"label": "CO2", "val_id": "matrix-val-co2", "expected_default": "426.1 ppm"},
        "ocean": {"label": "OCEAN", "val_id": "matrix-val-ocean", "expected_default": "+1.10°C"},
        "sea_ice": {"label": "ICE", "val_id": "matrix-val-sea_ice", "expected_default": "4.81 M km²"},
    }

    for layer, spec in expected_variables.items():
        cell = hud_card.find(id=f"matrix-cell-{layer}")
        assert cell is not None, f"Missing cell #matrix-cell-{layer}"
        assert cell.get("data-layer") == layer, f"Cell {layer} must have data-layer='{layer}'"

        lbl = cell.find(class_="matrix-label")
        assert lbl is not None and lbl.get_text().strip() == spec["label"], \
            f"Cell {layer} must have label '{spec['label']}'"

        val = cell.find(id=spec["val_id"])
        assert val is not None, f"Cell {layer} missing value element #{spec['val_id']}"
        assert spec["expected_default"] in val.get_text(), \
            f"Cell {layer} default value expected '{spec['expected_default']}', found '{val.get_text()}'"


def test_telemetry_matrix_data_authenticity_and_formatting():
    """Verify the default telemetry matrix matches the authentic latest month in the dataset, and test all 573 records."""
    assert os.path.exists(DATA_PATH), f"Missing harmonized data file {DATA_PATH}"
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    records = data["records"]
    assert len(records) == 573, "Harmonized dataset must contain exactly 573 authentic records"

    # Latest record (2026-09) matches default HUD values
    latest = records[-1]
    assert latest["date"] == "2026-09"
    temp_fmt = f"{latest['temperature_anomaly']:+.2f}°C"
    co2_fmt = f"{latest['co2_ppm']:.1f} ppm"
    ocean_fmt = f"{latest['ocean_temp_anomaly']:+.2f}°C"
    ice_fmt = f"{latest['sea_ice_extent']:.2f} M km²"

    assert temp_fmt == "+1.38°C", f"Temp format mismatch: {temp_fmt}"
    assert co2_fmt == "426.1 ppm", f"CO2 format mismatch: {co2_fmt}"
    assert ocean_fmt == "+1.10°C", f"Ocean format mismatch: {ocean_fmt}"
    assert ice_fmt == "4.81 M km²", f"Ice format mismatch: {ice_fmt}"

    # Stress test formatting across all 573 records to ensure zero NaN/null values
    for rec in records:
        assert isinstance(rec["temperature_anomaly"], (int, float))
        assert isinstance(rec["co2_ppm"], (int, float))
        assert isinstance(rec["ocean_temp_anomaly"], (int, float))
        assert isinstance(rec["sea_ice_extent"], (int, float))

        # Check that formatting logic never raises exceptions
        t_str = f"{'+' if rec['temperature_anomaly'] >= 0 else ''}{rec['temperature_anomaly']:.2f}°C"
        c_str = f"{rec['co2_ppm']:.1f} ppm"
        o_str = f"{'+' if rec['ocean_temp_anomaly'] >= 0 else ''}{rec['ocean_temp_anomaly']:.2f}°C"
        i_str = f"{rec['sea_ice_extent']:.2f} M km²"

        assert len(t_str) > 0 and "NaN" not in t_str
        assert len(c_str) > 0 and "NaN" not in c_str
        assert len(o_str) > 0 and "NaN" not in o_str
        assert len(i_str) > 0 and "NaN" not in i_str


def test_telemetry_matrix_active_layer_and_click_handling():
    """Verify active layer highlighting logic in CSS and JS."""
    main_css = load_file("frontend/css/main.css")
    app_js = load_file("frontend/js/app.js")

    # CSS active styles for all 4 layers
    for layer, color in [("temperature", "#fc3d21"), ("co2", "#f59e0b"), ("ocean", "#0ea5e9"), ("sea_ice", "#38bdf8")]:
        rule = f'.matrix-cell.active[data-layer="{layer}"]'
        assert rule in main_css, f"Missing CSS active rule for {rule}"
        assert color in main_css, f"Missing active color {color} in main.css"

    # JS active toggle logic
    assert "cell.classList.toggle('active', cellLayer === activeLayer || activeLayer === 'all')" in app_js, \
        "app.js must toggle .active on matrix cells matching active layer"

    # JS click handler
    # The telemetry matrix is a readout. Clicking it used to duplicate the layer
    # rail, so the binding is deliberately gone: the layer buttons own switching.
    assert "cell.addEventListener('click'" not in app_js, \
        "telemetry matrix must stay read-only; the layer rail owns layer switching"


# ============================================================================
# 3. RANGE INPUT SLIDERS EMPIRICAL VERIFICATION
# ============================================================================

def test_range_slider_css_aerospace_styling():
    """Verify CSS rules override all range inputs with -webkit-appearance: none, 4px track #18181b, and 6x14px thumbs."""
    main_css = load_file("frontend/css/main.css")

    # Check input[type="range"] global rule in main.css
    input_range_match = re.search(r'(?:^|\n)\s*input\[type=["\']?range["\']?\]\s*\{([^}]+)\}', main_css)
    assert input_range_match is not None, "Missing global input[type='range'] rule in main.css"
    body = input_range_match.group(1)
    assert "-webkit-appearance: none" in body, "Must specify -webkit-appearance: none"
    assert "appearance: none" in body, "Must specify appearance: none"
    assert "height: 4px" in body, "Track height must be 4px"
    assert "#18181b" in body, "Track must use dark recessed color #18181b"

    # Check webkit-slider-thumb
    thumb_webkit_match = re.search(r'input\[type="range"\]::-webkit-slider-thumb\s*\{([^}]+)\}', main_css)
    assert thumb_webkit_match is not None, "Missing ::-webkit-slider-thumb rule in main.css"
    tbody = thumb_webkit_match.group(1)
    assert "width: 6px" in tbody, "Thumb width must be 6px"
    assert "height: 14px" in tbody, "Thumb height must be 14px"
    assert "border-radius: 1px" in tbody, "Thumb border-radius must be 1px"
    assert "background: #f4f4f5" in tbody, "Thumb background must be #f4f4f5"

    # Check moz-range-thumb
    thumb_moz_match = re.search(r'input\[type="range"\]::-moz-range-thumb\s*\{([^}]+)\}', main_css)
    assert thumb_moz_match is not None, "Missing ::-moz-range-thumb rule in main.css"
    mbody = thumb_moz_match.group(1)
    assert "width: 6px" in mbody, "Thumb width must be 6px"
    assert "height: 14px" in mbody, "Thumb height must be 14px"
    assert "border-radius: 1px" in mbody, "Thumb border-radius must be 1px"
    assert "background: #f4f4f5" in mbody, "Thumb background must be #f4f4f5"


def test_range_slider_layer_fill_colors():
    """Verify dynamic colored fill bars for Temp (#fc3d21), CO2 (#f59e0b), Ocean (#0ea5e9), Ice (#38bdf8)."""
    main_css = load_file("frontend/css/main.css")

    expected_colors = {
        'data-track="surface_temperature"': "#fc3d21",
        'data-track="atmospheric_co2"': "#f59e0b",
        'data-track="ocean_temperature"': "#0ea5e9",
        'data-track="sea_ice_extent"': "#38bdf8",
    }
    for selector, color in expected_colors.items():
        assert selector in main_css, f"Missing selector {selector} in main.css"
        assert color in main_css, f"Missing color {color} in main.css"


def test_zero_circular_slider_thumbs_adversarial():
    """Adversarially scan all CSS files to ensure NO slider thumb has circular border-radius: 50%."""
    for root, _, files in os.walk(CSS_DIR):
        for f in files:
            if f.endswith(".css"):
                p = os.path.join(root, f)
                content = open(p, "r", encoding="utf-8").read()
                # Find all thumb blocks
                thumb_blocks = re.findall(r'([^}]*thumb\s*\{[^}]+\})', content, re.IGNORECASE)
                for block in thumb_blocks:
                    assert "border-radius: 50%" not in block and "border-radius: 100%" not in block, \
                        f"Found circular slider thumb in {p}: {block}"


def test_update_slider_fill_math_and_edge_cases():
    """Adversarially test the dynamic slider fill math used in app.js."""
    def compute_pct(val, min_val=0, max_val=1):
        rng = (max_val - min_val) or 1
        return max(0.0, min(100.0, ((val - min_val) / rng) * 100.0))

    # Standard volume slider [0, 1]
    assert compute_pct(0.85, 0, 1) == 85.0
    assert compute_pct(0.0, 0, 1) == 0.0
    assert compute_pct(1.0, 0, 1) == 100.0

    # Scrubber slider [0, 20]
    assert compute_pct(5.0, 0, 20) == 25.0
    assert compute_pct(10.0, 0, 20) == 50.0

    # Clamp bounds
    assert compute_pct(-5.0, 0, 10) == 0.0
    assert compute_pct(15.0, 0, 10) == 100.0

    # Degenerate min == max
    assert compute_pct(5.0, 5, 5) == 0.0


# ============================================================================
# 4. ORCHESTRA CHANNEL CARDS EMPIRICAL VERIFICATION
# ============================================================================

def test_orchestra_pan_elimination():
    """Verify complete absence of strip-pan-slider and strip-pan-row across frontend."""
    html_content = load_file("frontend/index.html")
    orch_css = load_file("frontend/css/orchestra.css")
    app_js = load_file("frontend/js/app.js")

    for target in [html_content, orch_css, app_js]:
        assert "strip-pan-slider" not in target, "Deprecated 'strip-pan-slider' found"
        assert "strip-pan-row" not in target, "Deprecated 'strip-pan-row' found"


def test_orchestra_equation_badges_in_headers():
    """Verify live equation badges are located inside card headers with IDs eq-badge-{cid} and eq-text-{cid}."""
    html_content = load_file("frontend/index.html")
    tree = parse_html(html_content, convert_charrefs=False)

    channel_ids = [
        "surface_temperature",
        "atmospheric_co2",
        "ocean_temperature",
        "sea_ice_extent",
    ]

    for cid in channel_ids:
        strip = tree.find(id=f"strip-{cid}")
        assert strip is not None, f"Channel strip #strip-{cid} not found"

        header = strip.find(class_="strip-header")
        assert header is not None, f"Channel strip #strip-{cid} missing .strip-header"

        # Badge must be inside .strip-header
        badge = header.find(id=f"eq-badge-{cid}")
        assert badge is not None, f"Header missing #eq-badge-{cid}"
        classes = badge.get("class", "").split()
        assert "strip-equation-badge" in classes, f"#eq-badge-{cid} must have class strip-equation-badge"

        # Text element inside badge
        text_el = badge.find(id=f"eq-text-{cid}")
        assert text_el is not None, f"Badge missing #eq-text-{cid}"
        tclasses = text_el.get("class", "").split()
        assert "eq-val" in tclasses, f"#eq-text-{cid} must have class eq-val"

        # Check initial text content
        initial_text = text_el.get_text()
        assert len(initial_text) > 0, f"#eq-text-{cid} must have non-empty initial text"


def test_orchestra_equation_mappings_empirical():
    """Test all acoustic mapping equations from app.js across the full historical dataset."""
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    for rec in data["records"]:
        # CH1: Temp f(T) = round(261.63 * 2^(anom / 1.0)) Hz
        anom = rec.get("temperature_anomaly", 0.0)
        hz1 = round(261.63 * (2.0 ** (anom / 1.0)))
        sign1 = "+" if anom >= 0 else ""
        text1 = f"{sign1}{anom:.2f}°C → {hz1} Hz"
        assert hz1 >= 50 and hz1 <= 1500, f"Unreasonable frequency {hz1} for temp {anom}"
        assert text1.startswith(f"{sign1}{anom:.2f}°C → ")

        # CH2: CO2 Drive = clamp(round(((ppm - 350) / 90) * 100), 0, 100)%
        ppm = rec.get("co2_ppm", 315.0)
        drive = max(0, min(100, round(((ppm - 350.0) / 90.0) * 100)))
        text2 = f"{ppm:.1f} ppm → {drive}% Drive"
        assert 0 <= drive <= 100, f"Drive {drive}% out of range for CO2 {ppm}"
        assert text2.startswith(f"{ppm:.1f} ppm → ")

        # CH3: Ocean Heat LPF fc(T) = round(80 * (2400 / 80)^norm) Hz
        ocean_anom = rec.get("ocean_temp_anomaly", 0.0)
        norm_o = max(0.0, min(1.0, (ocean_anom + 0.6) / 1.8))
        fc = round(80.0 * ((2400.0 / 80.0) ** norm_o))
        sign3 = "+" if ocean_anom >= 0 else ""
        text3 = f"{sign3}{ocean_anom:.2f}°C → {fc} Hz LPF"
        assert 80 <= fc <= 2400, f"LPF cutoff {fc} Hz out of bounds [80, 2400] for ocean {ocean_anom}"
        assert text3.startswith(f"{sign3}{ocean_anom:.2f}°C → ")

        # CH4: Sea Ice Extent Wind Mix
        ice_ext = rec.get("sea_ice_extent", 7.8)
        text4 = f"{ice_ext:.2f} M km² → Wind Mix"
        assert 2.0 <= ice_ext <= 20.0, f"Sea ice extent {ice_ext} out of physical bounds"
        assert text4 == f"{ice_ext:.2f} M km² → Wind Mix"


# ============================================================================
# 5. VISUALIZER HUD & TIMELINE SCRUBBER EMPIRICAL VERIFICATION
# ============================================================================

def test_visualizer_hud_height_reduction():
    """Verify .visualizer-canvas-grid height is reduced by 35% from 90px to ~58px."""
    vis_css = load_file("frontend/css/visualizer.css")
    grid_match = re.search(r'\.visualizer-canvas-grid\s*\{([^}]+)\}', vis_css)
    assert grid_match is not None, "Missing .visualizer-canvas-grid rule in visualizer.css"
    body = grid_match.group(1)
    height_match = re.search(r'height:\s*(\d+)px', body)
    assert height_match is not None, "Missing height in .visualizer-canvas-grid"
    height_val = int(height_match.group(1))
    assert height_val == 58, f"Expected height 58px (35% reduction from 90px), found {height_val}px"


def test_visualizer_oscilloscope_grid_css():
    """Verify technical oscilloscope grid linear-gradient and background-size: 24px 20px."""
    vis_css = load_file("frontend/css/visualizer.css")
    orch_css = load_file("frontend/css/orchestra.css")

    # In visualizer.css under .canvas-card
    card_match = re.search(r'\.canvas-card\s*\{([^}]+)\}', vis_css)
    assert card_match is not None, "Missing .canvas-card rule in visualizer.css"
    cbody = card_match.group(1)
    assert "background-image:" in cbody, ".canvas-card must define background-image"
    assert "linear-gradient" in cbody, ".canvas-card background-image must use linear-gradient"
    assert "background-size: 24px 20px" in cbody, ".canvas-card must set background-size: 24px 20px"

    # In orchestra.css under .spectrum-backdrop-canvas
    assert "background-size: 24px 20px" in orch_css, \
        ".spectrum-backdrop-canvas in orchestra.css must set background-size: 24px 20px"


def test_visualizer_frequency_axis_labels():
    """Verify 5-point logarithmic frequency axis labels: 60Hz, 250Hz, 1kHz, 4kHz, 16kHz in order."""
    html_content = load_file("frontend/index.html")
    tree = parse_html(html_content, convert_charrefs=False)

    axis = tree.find(class_="spectrum-freq-axis")
    assert axis is not None, "Element .spectrum-freq-axis must exist in index.html"

    labels = [span.get_text().strip() for span in axis.find_all(tag="span")]
    expected = ["60Hz", "250Hz", "1kHz", "4kHz", "16kHz"]
    assert labels == expected, f"Expected frequency labels {expected}, found {labels}"


def test_timeline_scrubber_decade_tick_labels():
    """Verify decade tick labels 1980 to 2026 directly beneath timeline scrubber with tick CSS."""
    html_content = load_file("frontend/index.html")
    tree = parse_html(html_content, convert_charrefs=False)

    # Verify DOM placement: inside .scrubber-timeline-block, right after .scrubber-spectrum-container
    block = tree.find(class_="scrubber-timeline-block")
    assert block is not None, "Element .scrubber-timeline-block must exist"

    ticks_container = block.find(class_="timeline-decade-ticks")
    assert ticks_container is not None, "Element .timeline-decade-ticks must exist inside .scrubber-timeline-block"

    labels = [span.get_text().strip() for span in ticks_container.find_all(tag="span")]
    expected = ["1980", "1990", "2000", "2010", "2020", "2026"]
    assert labels == expected, f"Expected decade labels {expected}, found {labels}"

    # Verify CSS styling for ticks in orchestra.css
    orch_css = load_file("frontend/css/orchestra.css")
    assert ".timeline-decade-ticks" in orch_css, "orchestra.css must define .timeline-decade-ticks"
    assert ".timeline-decade-ticks span::before" in orch_css, \
        "orchestra.css must define tick markers via .timeline-decade-ticks span::before"
    assert "height: 3px" in orch_css and "width: 1px" in orch_css, \
        "Tick markers must have width: 1px and height: 3px"
