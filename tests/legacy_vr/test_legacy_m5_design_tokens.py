"""
tests/legacy_vr/test_legacy_m5_design_tokens.py
ARCHIVED / OBSOLETE TEST SUITE: Milestone 5 Flight-Deck Design System Tokens.

These tests validated an earlier visual theme that used neon cyan (#00f0ff),
magenta (#ec4899), Space Grotesk, JetBrains Mono, and CSS glassmorphism
backdrop-filter. That earlier design system was explicitly superseded by the
authentic NASA Jet Propulsion Laboratory (JPL) Mission Console theme:
  - Surface palette: #060a12, #0b1220, #1b2636
  - Telemetry palette: amber #ff8a3d (signal) / cryogenic cyan #6fe3ff
  - Typography: IBM Plex Mono + IBM Plex Sans only
  - Zero neon glow, zero glassmorphism backdrop-filter, zero box shadows

These tests are preserved here in tests/legacy_vr/ for historical lineage and
whitebox regression traceability, marked as obsolete.
"""

import os
import pytest

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CSS_DIR = os.path.join(PROJECT_ROOT, "frontend", "css")


@pytest.mark.skip(
    reason="Obsolete design system: Milestone 5 neon tokens (#00f0ff, #ec4899, Space Grotesk, backdrop-filter) "
           "were superseded by the user-approved JPL Mission Console theme (#ff8a3d, #6fe3ff, IBM Plex)."
)
def test_main_css_design_tokens_and_colors():
    """Verify main.css adheres to legacy Milestone 5 flight-deck color palette."""
    css_path = os.path.join(CSS_DIR, "main.css")
    with open(css_path, "r", encoding="utf-8") as f:
        css = f.read()

    assert "#05070e" in css.lower(), "Missing void black #05070e token"
    assert "#0b132b" in css.lower(), "Missing deep navy #0b132b token"
    assert "#00f0ff" in css.lower(), "Missing electric cyan #00f0ff token"
    assert "#38bdf8" in css.lower(), "Missing aerospace blue #38bdf8 token"
    assert "#ec4899" in css.lower(), "Missing magenta #ec4899 token"
    assert "Space Grotesk" in css, "Missing Space Grotesk font declaration"
    assert "JetBrains Mono" in css, "Missing JetBrains Mono font declaration"
    assert "backdrop-filter" in css, "Missing glassmorphism backdrop-filter"


@pytest.mark.skip(
    reason="Obsolete design system: Milestone 4/5 sheet-scoped variables (--orchestra-cyan, --vis-cyan) "
           "were unified into tokens.css under the JPL Mission Console design system."
)
def test_css_stylesheets_valid_rules():
    """Verify legacy CSS files contain old flight deck styling tokens and proper classes."""
    orch_css_path = os.path.join(CSS_DIR, "orchestra.css")
    vis_css_path = os.path.join(CSS_DIR, "visualizer.css")

    with open(orch_css_path, "r", encoding="utf-8") as f:
        orch_css = f.read()
    assert ".orchestra-dock" in orch_css
    assert ".channel-strip" in orch_css
    assert ".btn-mute" in orch_css
    assert ".btn-solo" in orch_css
    assert "--orchestra-cyan" in orch_css

    with open(vis_css_path, "r", encoding="utf-8") as f:
        vis_css = f.read()
    assert ".visualizer-hud" in vis_css
    assert ".visualizer-canvas-grid" in vis_css
    assert ".vu-meter-bar" in vis_css
    assert "--vis-cyan" in vis_css
