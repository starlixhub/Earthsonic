"""
tests/test_ui_refinements.py
Comprehensive pytest verification for EARTHSONIC UI Consolidation & Sonic Presets Refinement.
"""

import os
import re
import pytest

FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
CSS_DIR = os.path.join(FRONTEND_DIR, "css")
JS_DIR = os.path.join(FRONTEND_DIR, "js")


def test_full_bleed_cockpit_viewport():
    """Verify Three.js globe container is configured for full-bleed 100vw x 100vh with #070709 background."""
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    with open(index_path, "r", encoding="utf-8") as f:
        html = f.read()

    assert 'id="globe-viewport-container"' in html
    assert "100vw" in html
    assert "100vh" in html
    assert "#070709" in html

    globe_css_path = os.path.join(CSS_DIR, "globe.css")
    with open(globe_css_path, "r", encoding="utf-8") as f:
        globe_css = f.read()
    assert ".globe-viewport" in globe_css
    assert "#070709" in globe_css


def test_mid_deck_visualizer_removed_and_unified_bottom_dock():
    """Verify standalone mid-deck row is removed and FFT + oscilloscope + RMS are in bottom console."""
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    with open(index_path, "r", encoding="utf-8") as f:
        html = f.read()

    # Standalone visualizer row is removed from layout
    assert '<section class="visualizer-hud">' not in html

    # Spectrum canvas is inside the timeline scrubber wrapper
    assert 'class="scrubber-spectrum-container"' in html
    assert 'id="spectrum-canvas"' in html
    assert 'id="orchestra-seek-slider"' in html

    # Master bus module on the right of bottom dock contains oscilloscope and RMS dBFS readout
    assert 'class="transport-master-module"' in html
    assert 'id="waveform-canvas"' in html
    assert 'id="rms-db-text"' in html


def test_mixer_pan_sliders_removed_and_live_equation_badges():
    """Verify manual pan sliders are removed and live equation badges exist on all 4 channel strips."""
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    with open(index_path, "r", encoding="utf-8") as f:
        html = f.read()

    # No manual pan sliders in HTML
    assert "strip-pan-slider" not in html
    assert "strip-pan-row" not in html

    # Live equation badges on all 4 channel strips
    channel_ids = [
        "surface_temperature",
        "atmospheric_co2",
        "ocean_temperature",
        "sea_ice_extent"
    ]
    for cid in channel_ids:
        assert f'id="eq-badge-{cid}"' in html, f"Missing equation badge for {cid}"
        assert f'id="eq-text-{cid}"' in html, f"Missing equation text for {cid}"


def test_balanced_stereo_stage_in_mixer_code():
    """Verify mixer.js hard-codes the balanced stereo stage."""
    mixer_js_path = os.path.join(JS_DIR, "audio", "mixer.js")
    with open(mixer_js_path, "r", encoding="utf-8") as f:
        code = f.read()

    assert "defaultPan: 0.0" in code
    assert "defaultPan: -0.15" in code
    assert "stereoWidened: true" in code


def test_mission_presets_in_header_and_app_code():
    """Verify the 4 Sonic Story presets are defined and selectable in header."""
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    with open(index_path, "r", encoding="utf-8") as f:
        html = f.read()

    assert 'id="mission-preset-select"' in html
    presets = [
        "PRESET_1988_CO2",
        "PRESET_1998_EL_NINO",
        "PRESET_2012_ARCTIC",
        "PRESET_DELTA_1980_2025"
    ]
    for p in presets:
        assert p in html, f"Missing {p} in header selector"

    app_js_path = os.path.join(JS_DIR, "app.js")
    with open(app_js_path, "r", encoding="utf-8") as f:
        app_code = f.read()

    assert "export const MISSION_PRESETS" in app_code
    assert "applyMissionPreset" in app_code
    for p in presets:
        assert p in app_code, f"Missing {p} in app.js"


def test_visual_acoustic_coupling():
    """Verify visual-acoustic coupling and shader overlay attenuation logic."""
    overlays_path = os.path.join(JS_DIR, "globe", "overlays.js")
    with open(overlays_path, "r", encoding="utf-8") as f:
        code = f.read()

    assert "highlightOverlay" in code
    assert "resetHighlight" in code
    # Check 25% attenuation factor
    assert "0.25" in code

    globe_path = os.path.join(JS_DIR, "globe", "globe.js")
    with open(globe_path, "r", encoding="utf-8") as f:
        g_code = f.read()
    assert "highlightOverlay" in g_code

    app_path = os.path.join(JS_DIR, "app.js")
    with open(app_path, "r", encoding="utf-8") as f:
        a_code = f.read()
    assert "updateVisualAcousticCoupling" in a_code
    assert "mouseenter" in a_code
    assert "mouseleave" in a_code
