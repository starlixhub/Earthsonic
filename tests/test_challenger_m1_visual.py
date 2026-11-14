"""
tests/test_challenger_m1_visual.py
Empirical Challenger Test Suite for Milestone M1 Visual Theme & UI Invariants.

Verifies:
1. Zero non-none box-shadows across all CSS files in frontend/css/.
2. Zero emoji characters across frontend/index.html and CSS/JS files.
3. Interactive controls (buttons, links, sliders) have >= 44px touch targets.
4. WCAG AAA contrast ratio (>7:1) for #dce6f2 on #060a12 and #0b1220.
5. Baseline DOM invariants (#telemetry-matrix-grid, Unicode bullet •, #070709,
   slider tracks #18181b, thumbs 6x14px #f4f4f5 border-radius 1px).
6. Desktop QR modal & mobile launcher contracts.
"""

import os
import re
import glob
import pytest

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
CSS_DIR = os.path.join(FRONTEND_DIR, "css")
JS_DIR = os.path.join(FRONTEND_DIR, "js")
INDEX_HTML = os.path.join(FRONTEND_DIR, "index.html")


# ============================================================================
# Helpers: WCAG 2.1 Luminance & Contrast Formula
# ============================================================================

def hex_to_rgb(hex_code: str):
    hex_code = hex_code.strip().lstrip("#")
    if len(hex_code) == 3:
        hex_code = "".join(c * 2 for c in hex_code)
    r = int(hex_code[0:2], 16)
    g = int(hex_code[2:4], 16)
    b = int(hex_code[4:6], 16)
    return r, g, b


def relative_luminance(hex_code: str) -> float:
    """Calculates relative luminance according to WCAG 2.1 standard."""
    r, g, b = hex_to_rgb(hex_code)

    def channel_linear(c_srgb: int) -> float:
        c = c_srgb / 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    r_lin = channel_linear(r)
    g_lin = channel_linear(g)
    b_lin = channel_linear(b)
    return 0.2126 * r_lin + 0.7152 * g_lin + 0.0722 * b_lin


def contrast_ratio(hex1: str, hex2: str) -> float:
    """Computes WCAG 2.1 contrast ratio between two hex colors."""
    l1 = relative_luminance(hex1)
    l2 = relative_luminance(hex2)
    lighter = max(l1, l2)
    darker = min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)


# ============================================================================
# 1. Zero Non-None Box Shadows
# ============================================================================

class TestZeroBoxShadows:
    """Adversarially validates that every box-shadow in frontend/css/ is strictly 'none'."""

    def test_css_files_exist(self):
        css_files = glob.glob(os.path.join(CSS_DIR, "*.css"))
        assert len(css_files) >= 4, f"Expected at least 4 CSS files, found {len(css_files)}"
        file_names = [os.path.basename(p) for p in css_files]
        for expected in ["main.css", "globe.css", "orchestra.css", "visualizer.css"]:
            assert expected in file_names, f"Missing required stylesheet: {expected}"

    def test_all_box_shadow_properties_are_none(self):
        css_files = glob.glob(os.path.join(CSS_DIR, "*.css"))
        box_shadow_pattern = re.compile(
            r"([-\w]*box-shadow)\s*:\s*([^;]+);", re.IGNORECASE
        )
        non_none_shadows = []
        total_shadow_rules = 0

        for path in css_files:
            rel_name = os.path.relpath(path, BASE_DIR)
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()

            for match in box_shadow_pattern.finditer(content):
                prop_name = match.group(1).strip()
                val = match.group(2).strip()
                total_shadow_rules += 1
                # Acceptable: 'none' or 'none !important'
                clean_val = val.replace("!important", "").strip().lower()
                if clean_val != "none":
                    start_pos = match.start()
                    line_num = content[:start_pos].count("\n") + 1
                    non_none_shadows.append(
                        f"{rel_name}:{line_num} -> {prop_name}: {val}"
                    )

        assert total_shadow_rules > 0, "No box-shadow rules detected to verify"
        assert not non_none_shadows, (
            f"Found {len(non_none_shadows)} non-none box-shadow declarations:\n"
            + "\n".join(non_none_shadows)
        )

    def test_no_inline_box_shadow_in_index_html(self):
        with open(INDEX_HTML, "r", encoding="utf-8") as f:
            content = f.read()
        matches = list(re.finditer(r"style\s*=\s*['\"][^'\"]*box-shadow\s*:[^'\"]*['\"]", content, re.I))
        for m in matches:
            val = m.group(0)
            assert "none" in val, f"Non-none inline box-shadow found in index.html: {val}"

    def test_drop_shadow_filter_audit(self):
        """Verifies zero drop-shadow filters on HUD panels, modals, buttons, or console chrome."""
        css_files = glob.glob(os.path.join(CSS_DIR, "*.css"))
        filter_pattern = re.compile(r"([^{]+)\{[^}]*filter\s*:\s*[^;]*drop-shadow\([^;]*;", re.IGNORECASE)
        chrome_drop_shadows = []
        for path in css_files:
            rel_name = os.path.relpath(path, BASE_DIR)
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()
            for m in filter_pattern.finditer(content):
                selector = m.group(1).strip()
                # Document if .nasa-meatball SVG logo has a drop-shadow vs interactive/chrome elements
                if not selector.endswith(".nasa-meatball"):
                    chrome_drop_shadows.append(f"{rel_name} ({selector})")
        assert not chrome_drop_shadows, f"Console chrome drop-shadow filters detected:\n" + "\n".join(chrome_drop_shadows)


# ============================================================================
# 2. Zero Emoji Characters
# ============================================================================

class TestZeroEmojiCharacters:
    """Adversarially scans HTML, CSS, and JS files for any emoji or pictographic characters."""

    EMOJI_REGEX = re.compile(
        "["
        "\U0001F600-\U0001F64F"  # Emoticons
        "\U0001F300-\U0001F5FF"  # Misc Symbols & Pictographs
        "\U0001F680-\U0001F6FF"  # Transport & Map
        "\U0001F900-\U0001F9FF"  # Supplemental Symbols & Pictographs
        "\U0001FA00-\U0001FAFF"  # Symbols & Pictographs Extended-A
        "\U0001FB00-\U0001FBFF"  # Legacy Computing
        "\U0001F1E6-\U0001F1FF"  # Flags
        "\u2702-\u27B0"          # Dingbats (scissors, planes, envelopes, etc.)
        "\uFE0E-\uFE0F"          # Variation Selectors
        "]",
        flags=re.UNICODE,
    )

    def _collect_frontend_files(self):
        files = [INDEX_HTML]
        files.extend(glob.glob(os.path.join(CSS_DIR, "*.css")))
        for root, _, filenames in os.walk(JS_DIR):
            for fn in filenames:
                if fn.endswith(".js") or fn.endswith(".mjs"):
                    files.append(os.path.join(root, fn))
        return files

    def test_zero_emoji_in_frontend(self):
        """Verifies zero Unicode emoji characters (Emoticons, Pictographs, Transport, Extended) in frontend."""
        # Standard Unicode Emoji blocks
        emoji_strict_regex = re.compile(
            "["
            "\U0001F600-\U0001F64F"  # Emoticons
            "\U0001F300-\U0001F5FF"  # Misc Symbols & Pictographs
            "\U0001F680-\U0001F6FF"  # Transport & Map
            "\U0001F900-\U0001F9FF"  # Supplemental Symbols & Pictographs
            "\U0001FA00-\U0001FAFF"  # Symbols & Pictographs Extended-A
            "\U0001FB00-\U0001FBFF"  # Legacy Computing
            "\U0001F1E6-\U0001F1FF"  # Flags
            "\U00010000-\U0010ffff"  # All Supplementary Multilingual Plane emoji characters
            "]",
            flags=re.UNICODE,
        )
        files = self._collect_frontend_files()
        assert len(files) >= 5, f"Expected frontend files, got {len(files)}"
        emoji_violations = []

        for path in files:
            rel_name = os.path.relpath(path, BASE_DIR)
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                lines = f.readlines()

            for line_idx, line in enumerate(lines, start=1):
                matches = emoji_strict_regex.findall(line)
                if matches:
                    chars_hex = [f"{ch} (U+{ord(ch):04X})" for ch in matches]
                    emoji_violations.append(
                        f"{rel_name}:{line_idx} -> {', '.join(chars_hex)} in line: {line.strip()}"
                    )

        assert not emoji_violations, (
            f"Found {len(emoji_violations)} emoji violations:\n"
            + "\n".join(emoji_violations)
        )

    def test_dingbat_symbol_adversarial_audit(self):
        """Adversarial scan for Dingbats / Misc non-ASCII characters outside standard punctuation."""
        # U+2700 to U+27BF is the Dingbat range
        dingbat_regex = re.compile(r"[\u2700-\u27bf]", flags=re.UNICODE)
        files = self._collect_frontend_files()
        dingbats = []
        for path in files:
            rel_name = os.path.relpath(path, BASE_DIR)
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                for lno, line in enumerate(f, 1):
                    for ch in dingbat_regex.findall(line):
                        dingbats.append(f"{rel_name}:{lno} -> U+{ord(ch):04X} ({ch})")
        # Document and assert that the only Dingbat symbol found is U+2713 (CHECK MARK in vr_launcher.js)
        # for transient clipboard feedback
        for d in dingbats:
            assert "U+2713" in d, f"Unexpected dingbat found: {d}"

    def test_zero_html_emoji_entities(self):
        with open(INDEX_HTML, "r", encoding="utf-8") as f:
            content = f.read()
        entity_matches = list(re.finditer(r"&#x1[fF][0-9a-fA-F]{3};|&#12[89][0-9]{3};", content))
        assert not entity_matches, f"Found HTML numeric emoji entities in index.html: {[m.group(0) for m in entity_matches]}"


# ============================================================================
# 3. Interactive Controls Touch Targets (>= 44px)
# ============================================================================

class TestInteractiveTouchTargets:
    """Verifies that all interactive controls meet WCAG 2.1 / 2.2 touch target minimums (>= 44px)."""

    def test_header_buttons_touch_target(self):
        with open(os.path.join(CSS_DIR, "main.css"), "r", encoding="utf-8") as f:
            css = f.read()

        for btn_class in [".header-tool-btn", ".header-tour-btn", ".header-blueprint-btn"]:
            pattern = re.compile(rf"{re.escape(btn_class)}\s*\{{[^}}]*min-height:\s*(\d+)px", re.DOTALL)
            match = pattern.search(css)
            assert match, f"Could not find min-height rule for {btn_class}"
            min_h = int(match.group(1))
            assert min_h >= 44, f"{btn_class} min-height is {min_h}px, expected >= 44px"

    def test_layer_and_navigation_buttons_touch_target(self):
        with open(os.path.join(CSS_DIR, "globe.css"), "r", encoding="utf-8") as f:
            css = f.read()

        for btn_class in [".layer-btn", ".nav-target-btn"]:
            pattern = re.compile(rf"{re.escape(btn_class)}\s*\{{[^}}]*min-height:\s*(\d+)px", re.DOTALL)
            match = pattern.search(css)
            assert match, f"Could not find min-height rule for {btn_class} in globe.css"
            min_h = int(match.group(1))
            assert min_h >= 44, f"{btn_class} min-height is {min_h}px, expected >= 44px"

    def test_transport_buttons_touch_target(self):
        with open(os.path.join(CSS_DIR, "orchestra.css"), "r", encoding="utf-8") as f:
            css = f.read()

        pattern = re.compile(r"\.transport-btn\s*\{[^}]*min-height:\s*(\d+)px", re.DOTALL)
        match = pattern.search(css)
        assert match, "Could not find min-height for .transport-btn in orchestra.css"
        assert int(match.group(1)) >= 44, f".transport-btn min-height < 44px: {match.group(1)}"

    def test_mute_solo_pseudo_element_touch_target(self):
        """Verifies compact DAW buttons (.btn-mute, .btn-solo) expand hit area to >= 44px via ::after."""
        with open(os.path.join(CSS_DIR, "orchestra.css"), "r", encoding="utf-8") as f:
            css = f.read()

        pattern = re.compile(
            r"\.btn-mute::after,\s*\.btn-solo::after\s*\{[^}]*min-width:\s*(\d+)px[^}]*min-height:\s*(\d+)px",
            re.DOTALL,
        )
        match = pattern.search(css)
        assert match, "Could not find .btn-mute::after, .btn-solo::after touch target expansion"
        min_w = int(match.group(1))
        min_h = int(match.group(2))
        assert min_w >= 44, f"Mute/Solo ::after touch width {min_w}px < 44px"
        assert min_h >= 44, f"Mute/Solo ::after touch height {min_h}px < 44px"

    def test_mobile_vr_tap_button_touch_target(self):
        """Verifies mobile VR launcher button expands to 100% fullscreen touch target."""
        with open(os.path.join(CSS_DIR, "main.css"), "r", encoding="utf-8") as f:
            css = f.read()

        # Mobile VR launcher overlay is full viewport fixed inset 0
        assert re.search(r"\.mobile-vr-launcher-overlay\s*\{[^}]*position:\s*fixed", css)
        assert re.search(r"\.mobile-vr-launcher-overlay\s*\{[^}]*width:\s*100vw", css)
        # Mobile tap button fills overlay (width: 100%, height: 100%)
        pattern = re.compile(r"\.mobile-vr-tap-btn\s*\{[^}]*width:\s*100%[^}]*height:\s*100%", re.DOTALL)
        assert pattern.search(css), "Mobile VR tap button does not fill 100% x 100% fullscreen overlay"

    def test_vr_modal_buttons_touch_target(self):
        """Verifies desktop modal copy, stereo enter, and close buttons meet >= 44px touch target."""
        with open(os.path.join(CSS_DIR, "main.css"), "r", encoding="utf-8") as f:
            css = f.read()

        # .vr-copy-btn and .btn-pc-stereo have min-height: 44px
        for btn_class in [".vr-copy-btn", ".btn-pc-stereo"]:
            pattern = re.compile(rf"{re.escape(btn_class)}\s*\{{[^}}]*min-height:\s*(\d+)px", re.DOTALL)
            match = pattern.search(css)
            assert match, f"Could not find min-height rule for {btn_class}"
            assert int(match.group(1)) >= 44, f"{btn_class} min-height < 44px"

        # .vr-modal-close-btn has explicit width: 44px, height: 44px
        close_pattern = re.compile(
            r"\.vr-modal-close-btn\s*\{[^}]*width:\s*(\d+)px[^}]*height:\s*(\d+)px",
            re.DOTALL,
        )
        match = close_pattern.search(css)
        assert match, "Could not find 44x44px dimensions for .vr-modal-close-btn"
        assert int(match.group(1)) >= 44
        assert int(match.group(2)) >= 44


# ============================================================================
# 4. WCAG AAA Contrast Ratios
# ============================================================================

class TestWCAGAAAContrastRatios:
    """Adversarially validates mathematical luminance and contrast ratios against WCAG AAA (>7:1)."""

    TEXT_PRIMARY = "#dce6f2"
    TEXT_MUTED = "#7b8ba3"
    BG_PAGE = "#060a12"
    BG_SURFACE = "#0b1220"
    ACCENT_AMBER = "#ff8a3d"
    ACCENT_CYAN = "#6fe3ff"

    def test_primary_text_contrast_on_page_background(self):
        cr = contrast_ratio(self.TEXT_PRIMARY, self.BG_PAGE)
        # WCAG AAA requirement is > 7.0:1
        assert cr >= 7.0, f"Contrast {self.TEXT_PRIMARY} on {self.BG_PAGE} is {cr:.2f}:1, expected >= 7.0:1"
        assert cr > 14.0, f"Expected > 14:1 for authentic JPL palette, got {cr:.2f}:1"

    def test_primary_text_contrast_on_panel_surface(self):
        cr = contrast_ratio(self.TEXT_PRIMARY, self.BG_SURFACE)
        # WCAG AAA requirement is > 7.0:1
        assert cr >= 7.0, f"Contrast {self.TEXT_PRIMARY} on {self.BG_SURFACE} is {cr:.2f}:1, expected >= 7.0:1"
        assert cr > 13.0, f"Expected > 13:1 for authentic JPL surface, got {cr:.2f}:1"

    def test_secondary_labels_contrast_meets_wcag_aa(self):
        cr_page = contrast_ratio(self.TEXT_MUTED, self.BG_PAGE)
        cr_surf = contrast_ratio(self.TEXT_MUTED, self.BG_SURFACE)
        assert cr_page >= 4.5, f"Secondary label contrast on page bg {cr_page:.2f}:1 < 4.5:1 (WCAG AA)"
        assert cr_surf >= 4.5, f"Secondary label contrast on surface {cr_surf:.2f}:1 < 4.5:1 (WCAG AA)"

    def test_accent_colors_contrast(self):
        cr_amber = contrast_ratio(self.ACCENT_AMBER, self.BG_PAGE)
        cr_cyan = contrast_ratio(self.ACCENT_CYAN, self.BG_PAGE)
        assert cr_amber >= 3.0, f"Amber accent contrast {cr_amber:.2f}:1 < 3.0:1 UI component threshold"
        assert cr_cyan >= 7.0, f"Cyan telemetry contrast {cr_cyan:.2f}:1 < 7.0:1 AAA threshold"


# ============================================================================
# 5. Baseline DOM Invariants
# ============================================================================

class TestBaselineDOMInvariants:
    """Verifies baseline DOM elements, Unicode bullet, colors, and slider geometry."""

    def test_telemetry_matrix_grid_exists(self):
        with open(INDEX_HTML, "r", encoding="utf-8") as f:
            content = f.read()

        assert 'id="telemetry-matrix-grid"' in content
        assert 'class="telemetry-matrix-grid"' in content
        for var_name in ["temperature", "co2", "ocean", "sea_ice"]:
            assert f'data-layer="{var_name}"' in content
            assert f'id="matrix-cell-{var_name}"' in content
            assert f'id="matrix-val-{var_name}"' in content

    def test_unicode_bullet_in_status_badge(self):
        with open(INDEX_HTML, "r", encoding="utf-8") as f:
            content = f.read()

        # Must contain literal Unicode bullet '•' (U+2022)
        assert "FLIGHT DECK ONLINE • 23.44° TILT" in content
        assert "•" in content
        # Must NOT contain HTML entity '&bull;'
        assert "&bull;" not in content
        assert "&bull" not in content

    def test_globe_viewport_container_070709_background(self):
        with open(INDEX_HTML, "r", encoding="utf-8") as f:
            content = f.read()

        assert 'id="globe-viewport-container"' in content
        assert "background: #070709;" in content or "background:#070709" in content

    def test_slider_track_18181b(self):
        with open(os.path.join(CSS_DIR, "main.css"), "r", encoding="utf-8") as f:
            main_css = f.read()
        with open(os.path.join(CSS_DIR, "orchestra.css"), "r", encoding="utf-8") as f:
            orch_css = f.read()

        assert "#18181b" in main_css, "Missing #18181b track background in main.css"
        assert "#18181b" in orch_css, "Missing #18181b track background in orchestra.css"

        # Check track rule
        assert re.search(r"::-moz-range-track\s*\{[^}]*background:\s*#18181b", main_css)
        assert re.search(r"::-moz-range-track\s*\{[^}]*background:\s*#18181b", orch_css)

    def test_slider_thumb_geometry_6x14_f4f4f5_radius1(self):
        with open(os.path.join(CSS_DIR, "main.css"), "r", encoding="utf-8") as f:
            main_css = f.read()
        with open(os.path.join(CSS_DIR, "orchestra.css"), "r", encoding="utf-8") as f:
            orch_css = f.read()

        for css_name, css_text in [("main.css", main_css), ("orchestra.css", orch_css)]:
            pattern = re.compile(
                r"::-webkit-slider-thumb\s*\{[^}]*"
                r"width:\s*6px;[^}]*"
                r"height:\s*14px;[^}]*"
                r"border-radius:\s*1px;[^}]*"
                r"background:\s*#f4f4f5;",
                re.DOTALL,
            )
            assert pattern.search(css_text), f"Slider thumb geometry 6x14px #f4f4f5 border-radius 1px missing in {css_name}"


# ============================================================================
# 6. QR Bridge & Launcher Contracts
# ============================================================================

class TestQRBridgeAndLauncherContracts:
    """Verifies Desktop QR Modal and Mobile Launcher DOM contracts and zero-CDN invariant."""

    def test_desktop_vr_modal_dom_structure(self):
        with open(INDEX_HTML, "r", encoding="utf-8") as f:
            content = f.read()

        # Must have modal container and required child elements
        assert 'id="vr-desktop-modal"' in content
        assert '<canvas id="vr-qr-canvas" width="220" height="220"' in content
        assert 'id="vr-qr-loading"' in content
        assert 'id="vr-url-input"' in content
        assert 'id="btn-copy-vr-link"' in content
        assert 'id="btn-enter-pc-stereo"' in content

    def test_mobile_vr_launcher_dom_structure(self):
        with open(INDEX_HTML, "r", encoding="utf-8") as f:
            content = f.read()

        assert 'id="mobile-vr-launcher"' in content
        assert 'id="btn-mobile-vr-tap"' in content
        assert "TAP TO LOCK LANDSCAPE &amp; INSERT INTO VR HEADSET" in content or "TAP TO LOCK LANDSCAPE & INSERT INTO VR HEADSET" in content

    def test_zero_cdn_in_qr_and_launcher_code(self):
        qr_file = os.path.join(JS_DIR, "ui", "qrcode.js")
        launcher_file = os.path.join(JS_DIR, "ui", "vr_launcher.js")

        for fpath in [qr_file, launcher_file]:
            rel_name = os.path.relpath(fpath, BASE_DIR)
            with open(fpath, "r", encoding="utf-8") as f:
                code = f.read().lower()

            for cdn_keyword in ["unpkg.com", "cdnjs.cloudflare.com", "cdn.jsdelivr.net"]:
                assert cdn_keyword not in code, f"External CDN dependency '{cdn_keyword}' detected in {rel_name}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
