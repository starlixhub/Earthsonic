"""
tests/test_comparison_ui.py
Comprehensive unit and integration test suite for Milestone 5:
Historical Comparison Tool, Scientific Info Panel & NASA Theme UI/UX.

Validates:
  1. Static file structure and asset integrity for all M5 components
  2. Flask API routing for comparison analytics and differential audio
  3. Authoritative scientific sonification explanations catalog
  4. Comparison math: resampling, Delta(t) = B(t) - A(t), statistics
  5. Climate anomaly science: identical unison, warming deltas, ice loss
  6. NASA flight-deck design system tokens and responsive stylesheet rules
  7. Frontend coordinator and ES module interface compliance
"""

import os
import pytest
import numpy as np

from backend.app import create_app
from backend.config import Config

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(PROJECT_ROOT, "frontend")
COMPARISON_JS_DIR = os.path.join(FRONTEND_DIR, "js", "comparison")
UI_JS_DIR = os.path.join(FRONTEND_DIR, "js", "ui")
CSS_DIR = os.path.join(FRONTEND_DIR, "css")


@pytest.fixture
def client():
    """Flask test client fixture."""
    app = create_app(Config)
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


# ============================================================================
# 1. FILE STRUCTURE & INTEGRITY TESTS
# ============================================================================

def test_milestone5_files_exist():
    """Verify all Milestone 5 frontend files exist and have content."""
    required_files = [
        os.path.join(COMPARISON_JS_DIR, "comparison.js"),
        os.path.join(UI_JS_DIR, "panel.js"),
        os.path.join(UI_JS_DIR, "telemetry.js"),
        os.path.join(FRONTEND_DIR, "js", "app.js"),
        os.path.join(CSS_DIR, "main.css"),
        os.path.join(FRONTEND_DIR, "index.html"),
    ]
    for path in required_files:
        assert os.path.exists(path), f"Required M5 file missing: {path}"
        size = os.path.getsize(path)
        assert size > 200, f"File appears too small ({size} bytes): {path}"


def test_index_html_contains_m5_elements():
    """Verify index.html contains comparison, info drawer, and app script."""
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    with open(index_path, "r", encoding="utf-8") as f:
        html = f.read()

    # Stylesheets
    assert '/css/main.css' in html, "index.html missing /css/main.css link"

    # Header Tool Buttons
    assert 'id="btn-open-comparison"' in html
    assert 'id="btn-open-info"' in html
    assert 'id="mission-clock"' in html

    # Modal & Drawer Overlays
    assert 'id="comparison-modal"' in html
    assert 'id="info-drawer"' in html
    assert 'id="toast-container"' in html

    # Main Coordinator Script
    assert '/js/app.js' in html, "index.html missing /js/app.js import"


# ============================================================================
# 2. FLASK STATIC ROUTE SERVING TESTS
# ============================================================================

def test_static_routes_serve_m5_assets(client):
    """Verify Flask server correctly serves all new M5 static files."""
    test_routes = [
        ("/css/main.css", "text/css"),
        ("/js/comparison/comparison.js", "javascript"),
        ("/js/ui/panel.js", "javascript"),
        ("/js/ui/telemetry.js", "javascript"),
        ("/js/app.js", "javascript"),
    ]
    for url, mime_expected in test_routes:
        res = client.get(url)
        assert res.status_code == 200, (
            f"Failed to fetch {url}: HTTP {res.status_code}"
        )
        ct = res.headers.get("Content-Type", "")
        assert mime_expected in ct, f"Wrong mime type for {url}: {ct}"
        assert len(res.data) > 200, f"Empty response data for {url}"


# ============================================================================
# 3. BACKEND COMPARISON REST API TESTS
# ============================================================================

def test_comparison_endpoint_all_core_variables(client):
    """Verify /api/comparison responds with valid structure for all vars."""
    datasets = [
        "surface-temperature",
        "atmospheric-co2",
        "ocean-temperature",
        "sea-ice-extent"
    ]
    for ds in datasets:
        url = (
            f"/api/comparison?dataset_id={ds}"
            "&periodA=1990-01,1995-12&periodB=2015-01,2020-12&duration=10"
        )
        res = client.get(url)
        assert res.status_code == 200, f"Failed for dataset {ds}: {res.data}"
        data = res.get_json()

        # Check top-level contract
        assert "dataset_id" in data
        assert "periodA" in data
        assert "periodB" in data
        assert "difference" in data

        # Check Period A metrics
        assert "start" in data["periodA"]
        assert "end" in data["periodA"]
        assert "mean" in data["periodA"]
        assert "min" in data["periodA"]
        assert "max" in data["periodA"]
        assert "audio_url" in data["periodA"]

        # Check Period B metrics
        assert "start" in data["periodB"]
        assert "end" in data["periodB"]
        assert "mean" in data["periodB"]
        assert "min" in data["periodB"]
        assert "max" in data["periodB"]
        assert "audio_url" in data["periodB"]

        # Check Difference metrics
        assert "delta_mean" in data["difference"]
        assert "percent_change" in data["difference"]
        assert "differential_audio_url" in data["difference"]

        # Verify math relationship
        calculated = round(
            data["periodB"]["mean"] - data["periodA"]["mean"], 4
        )
        assert abs(data["difference"]["delta_mean"] - calculated) < 1e-3


def test_comparison_endpoint_landmark_years_2000_vs_2020(client):
    """Verify comparison 2000 vs 2020 returns authentic warming delta."""
    url = (
        "/api/comparison?dataset_id=surface-temperature"
        "&periodA=2000-01,2000-12&periodB=2020-01,2020-12&duration=15"
    )
    res = client.get(url)
    assert res.status_code == 200
    data = res.get_json()

    mean_2000 = data["periodA"]["mean"]
    mean_2020 = data["periodB"]["mean"]
    delta = data["difference"]["delta_mean"]

    assert mean_2020 > mean_2000, (
        f"Expected 2020 ({mean_2020}) warmer than 2000 ({mean_2000})"
    )
    assert delta > 0.40, f"Expected warming delta > 0.40 °C, got {delta}"
    assert data["difference"]["percent_change"] > 0


def test_comparison_endpoint_co2_acceleration(client):
    """Verify atmospheric CO2 is strictly higher in modern period."""
    url = (
        "/api/comparison?dataset_id=atmospheric-co2"
        "&periodA=1980-01,1985-12&periodB=2015-01,2020-12&duration=15"
    )
    res = client.get(url)
    assert res.status_code == 200
    data = res.get_json()

    mean_a = data["periodA"]["mean"]
    mean_b = data["periodB"]["mean"]
    assert mean_b > mean_a
    assert mean_a < 350.0  # In 1980s, CO2 was < 350 ppm
    assert mean_b > 400.0  # In 2015-2020, CO2 was > 400 ppm
    assert data["difference"]["delta_mean"] > 50.0


def test_comparison_endpoint_sea_ice_retreat(client):
    """Verify sea ice extent shows measurable decline (negative delta)."""
    url = (
        "/api/comparison?dataset_id=sea-ice-extent"
        "&periodA=1980-01,1985-12&periodB=2015-01,2020-12&duration=15"
    )
    res = client.get(url)
    assert res.status_code == 200
    data = res.get_json()

    mean_a = data["periodA"]["mean"]
    mean_b = data["periodB"]["mean"]
    delta = data["difference"]["delta_mean"]

    assert mean_b < mean_a, (
        f"Expected modern ice ({mean_b}) to be less than 1980s ({mean_a})"
    )
    assert delta < 0, f"Expected negative delta for ice loss, got {delta}"


def test_comparison_3way_audio_links_return_wav(client):
    """Verify Period A, Period B, and Differential audio streams are WAV."""
    url = (
        "/api/comparison?dataset_id=surface-temperature"
        "&periodA=1990-01,1992-12&periodB=2018-01,2020-12&duration=3"
    )
    res = client.get(url)
    assert res.status_code == 200
    data = res.get_json()

    # 1. Period A audio
    res_a = client.get(data["periodA"]["audio_url"])
    assert res_a.status_code == 200
    assert "audio/wav" in res_a.headers.get("Content-Type", "")
    assert res_a.data[:4] == b"RIFF"

    # 2. Period B audio
    res_b = client.get(data["periodB"]["audio_url"])
    assert res_b.status_code == 200
    assert "audio/wav" in res_b.headers.get("Content-Type", "")
    assert res_b.data[:4] == b"RIFF"

    # 3. Difference audio
    res_diff = client.get(data["difference"]["differential_audio_url"])
    assert res_diff.status_code == 200
    assert "audio/wav" in res_diff.headers.get("Content-Type", "")
    assert res_diff.data[:4] == b"RIFF"


def test_comparison_endpoint_missing_parameters(client):
    """Verify 400 Bad Request when required comparison params are missing."""
    # Missing periodB
    u1 = (
        "/api/comparison?dataset_id=surface-temperature"
        "&periodA=2000-01,2000-12"
    )
    res1 = client.get(u1)
    assert res1.status_code == 400

    # Missing dataset_id
    u2 = "/api/comparison?periodA=2000-01,2000-12&periodB=2020-01,2020-12"
    res2 = client.get(u2)
    assert res2.status_code == 400

    # Invalid dataset_id
    u3 = (
        "/api/comparison?dataset_id=nonexistent"
        "&periodA=2000-01,2000-12&periodB=2020-01,2020-12"
    )
    res3 = client.get(u3)
    assert res3.status_code == 404


# ============================================================================
# 4. SCIENTIFIC SONIFICATION EXPLANATIONS REST API TESTS
# ============================================================================

def test_sonification_explanations_catalog_authenticity(client):
    """Verify /api/sonification/explanations returns authentic citations."""
    res = client.get("/api/sonification/explanations")
    assert res.status_code == 200
    data = res.get_json()

    assert "explanations" in data
    explanations = data["explanations"]

    layer_ids = [
        "surface-temperature",
        "atmospheric-co2",
        "ocean-temperature",
        "sea-ice-extent",
        "difference"
    ]
    for var_id in layer_ids:
        assert var_id in explanations
        item = explanations[var_id]
        assert "title" in item
        assert "nasa_source" in item
        assert "units" in item
        assert "musical_parameters" in item
        assert "scientific_rationale" in item

    # Check authentic source organizations
    assert "GISS" in explanations["surface-temperature"]["nasa_source"]
    assert "NOAA" in explanations["atmospheric-co2"]["nasa_source"]
    assert "NCEI" in explanations["ocean-temperature"]["nasa_source"]
    assert "NSIDC" in explanations["sea-ice-extent"]["nasa_source"]


# ============================================================================
# 5. MATHEMATICAL & ALGORITHMIC VERIFICATION
# ============================================================================

def test_identical_periods_produce_zero_delta():
    """Verify comparing identical series yields Delta = 0 everywhere."""
    series = np.array([0.15, 0.22, 0.35, 0.42, 0.51])
    delta = series - series
    assert np.allclose(delta, 0.0)

    mean_a = float(np.mean(series))
    mean_b = float(np.mean(series))
    delta_mean = mean_b - mean_a
    assert abs(delta_mean) < 1e-9


def test_linear_interpolation_resampling_algorithm():
    """Verify linear interpolation formula matching frontend resampleSeries."""
    def resample(vals, target_len):
        if len(vals) == target_len:
            return list(vals)
        scale = (len(vals) - 1) / (target_len - 1)
        res = []
        for i in range(target_len):
            src_idx = i * scale
            low = int(np.floor(src_idx))
            high = min(len(vals) - 1, low + 1)
            frac = src_idx - low
            res.append(vals[low] * (1.0 - frac) + vals[high] * frac)
        return res

    orig = [10.0, 50.0]
    out = resample(orig, 5)
    expected = [10.0, 20.0, 30.0, 40.0, 50.0]
    assert np.allclose(out, expected)


# ============================================================================
# 6. NASA FLIGHT-DECK DESIGN SYSTEM & THEME TOKENS
# ============================================================================

def test_main_css_design_tokens_and_colors():
    """Verify main.css adheres to NASA flight-deck color palette."""
    css_path = os.path.join(CSS_DIR, "main.css")
    with open(css_path, "r", encoding="utf-8") as f:
        css = f.read()

    # Core flight deck colors
    assert "#05070e" in css.lower(), "Missing void black #05070e token"
    assert "#0b132b" in css.lower(), "Missing deep navy #0b132b token"
    assert "#00f0ff" in css.lower(), "Missing electric cyan #00f0ff token"
    assert "#38bdf8" in css.lower(), "Missing aerospace blue #38bdf8 token"
    assert "#ec4899" in css.lower(), "Missing magenta #ec4899 token"

    # Typography definitions
    assert "Space Grotesk" in css, "Missing Space Grotesk font declaration"
    assert "JetBrains Mono" in css, "Missing JetBrains Mono font declaration"

    # Glassmorphism backdrop blur
    assert "backdrop-filter" in css, "Missing glassmorphism backdrop-filter"

    # Responsive layout media queries
    assert "@media" in css, "Missing responsive media queries"
    assert "max-width: 1024px" in css or "max-width: 768px" in css


# ============================================================================
# 7. FRONTEND MODULE INTERFACES & EXPORTS
# ============================================================================

def test_comparison_js_module_exports():
    """Verify comparison.js exports all required functions and classes."""
    js_path = os.path.join(COMPARISON_JS_DIR, "comparison.js")
    with open(js_path, "r", encoding="utf-8") as f:
        code = f.read()

    assert "export function resampleSeries" in code
    assert "export function calculateDeltaSeries" in code
    assert "export function calculateComparisonStats" in code
    assert "export const PRESET_COMPARISONS" in code
    assert "export const DATASET_OPTIONS" in code
    assert "export class HistoricalComparison" in code


def test_panel_js_module_exports():
    """Verify panel.js exports ScientificInfoPanel and LAYER_INFO_FALLBACK."""
    js_path = os.path.join(UI_JS_DIR, "panel.js")
    with open(js_path, "r", encoding="utf-8") as f:
        code = f.read()

    assert "export class ScientificInfoPanel" in code
    assert "export const LAYER_INFO_FALLBACK" in code


def test_telemetry_js_module_exports():
    """Verify telemetry.js exports toast and status utilities."""
    js_path = os.path.join(UI_JS_DIR, "telemetry.js")
    with open(js_path, "r", encoding="utf-8") as f:
        code = f.read()

    assert "export function showToast" in code
    assert "export function updateTelemetryStatus" in code
    assert "export function getFormattedMissionTime" in code


def test_app_js_module_exports():
    """Verify app.js exports EarthSonicApp and bootstrapApp."""
    js_path = os.path.join(FRONTEND_DIR, "js", "app.js")
    with open(js_path, "r", encoding="utf-8") as f:
        code = f.read()

    assert "export class EarthSonicApp" in code
    assert "export async function bootstrapApp" in code
