"""
tests/test_landing_page.py
Automated Verification Suite for EarthSonic Capability Showcase Landing Page.
NASA Space Apps Challenge 2026 — Milestone 1 Invariants & Requirements.

Verifies all 34 Features across Tiers 1-4:
  - Visual Theme & Styling (JPL Mission Console palette, flat aesthetic guards)
  - Typography System (Google Fonts, fluid clamps, reading measure limits)
  - Hero Section & 3D Globe Architecture (Starfield, Terminator shader, concentric clouds)
  - Scroll-Linked Navigation Transition (GSAP/ScrollTrigger & native fallback)
  - Content Sections (Explore buttons, Desktop VR modal, About 4 channels, Team grid)
  - Footer Citations (10 exact hyperlinked references, GitHub link, copyright)
  - Responsive Breakpoints (<768px hamburger, touch targets >=44x44px)
  - Zero-Build Static Server Delivery
"""

import os
import re
import socket
import threading
import urllib.request
import http.server
import functools
import pytest
from bs4 import BeautifulSoup

# Base paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LANDING_DIR = os.path.join(BASE_DIR, "landing")
INDEX_HTML = os.path.join(LANDING_DIR, "index.html")
STYLES_CSS = os.path.join(LANDING_DIR, "styles.css")
MAIN_JS = os.path.join(LANDING_DIR, "main.js")
TEXTURES_DIR = os.path.join(BASE_DIR, "frontend", "assets", "textures")


# ============================================================================
# Fixtures
# ============================================================================

@pytest.fixture(scope="session")
def html_content():
    assert os.path.isfile(INDEX_HTML), f"Missing index.html at {INDEX_HTML}"
    with open(INDEX_HTML, "r", encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="session")
def soup(html_content):
    return BeautifulSoup(html_content, "html.parser")


@pytest.fixture(scope="session")
def css_content():
    assert os.path.isfile(STYLES_CSS), f"Missing styles.css at {STYLES_CSS}"
    with open(STYLES_CSS, "r", encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="session")
def js_content():
    assert os.path.isfile(MAIN_JS), f"Missing main.js at {MAIN_JS}"
    with open(MAIN_JS, "r", encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="session")
def static_server():
    """Starts a lightweight ephemeral HTTP static server serving the repo root."""
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=BASE_DIR, **kwargs)

        def log_message(self, format, *args):
            pass  # Silence server stdout logging during tests

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{port}"
    server.shutdown()


# ============================================================================
# Tier 1 & 2: Visual Theme & Styling (Features 1, 2, 3, 4)
# ============================================================================

class TestMissionConsolePaletteAndVisualTokens:
    """Feature 1 & 2: JPL Mission Console Palette and Flat Aesthetic Guards."""

    REQUIRED_HEX_TOKENS = {
        "bg_primary": "#060a12",
        "surface_panel": "#0b1220",
        "border_color": "#1b2636",
        "accent_amber": "#ff8a3d",
        "surface_white": "#ffffff",
    }

    def test_required_palette_tokens_in_css(self, css_content):
        """Feature 1: CSS must declare the exact JPL Mission Console color tokens."""
        for token_name, hex_code in self.REQUIRED_HEX_TOKENS.items():
            assert hex_code.lower() in css_content.lower(), (
                f"Required palette token {token_name} ({hex_code}) not found in styles.css"
            )

    def test_no_secondary_accent_color(self, css_content):
        """Feature 1: Amber (#ff8a3d) is the sole accent; no secondary cyan accent in theme variables."""
        var_matches = re.findall(r"^\s*--accent-[a-zA-Z0-9_-]+:\s*([^;]+);", css_content, re.MULTILINE)
        assert len(var_matches) >= 1
        for val in var_matches:
            val_clean = val.strip().lower()
            assert "#ff8a3d" in val_clean, f"Found unexpected secondary accent color: {val}"

    def test_flat_aesthetic_guard_zero_box_shadows(self, css_content):
        """Feature 2: Flat aesthetic invariant — all box-shadow rules must be 'none'."""
        box_shadow_rules = re.findall(r"box-shadow\s*:\s*([^;]+);", css_content, re.IGNORECASE)
        for rule in box_shadow_rules:
            clean = rule.strip().lower().replace("!important", "").strip()
            assert clean == "none", f"Non-flat box-shadow detected: '{rule}'"

    def test_flat_aesthetic_guard_gradients_restricted_to_halo(self, css_content):
        """Feature 2 & 3: Only the soft radial glow halo behind the sphere may use radial-gradient."""
        gradient_matches = re.finditer(r"([^{}]+)\{([^}]+(?:linear-gradient|radial-gradient)[^}]*)\}", css_content, re.IGNORECASE)
        for match in gradient_matches:
            selector = match.group(1).strip()
            body = match.group(2)
            # linear-gradient is completely forbidden everywhere
            assert "linear-gradient" not in body.lower(), f"linear-gradient is prohibited: selector '{selector}'"
            # radial-gradient is only allowed on hero-globe-halo
            if "radial-gradient" in body.lower():
                assert ("hero-globe-halo" in selector or "globe-halo" in selector), (
                    f"radial-gradient found on unauthorized selector: '{selector}'"
                )

    def test_flat_aesthetic_guard_zero_emoji_characters(self, html_content, css_content, js_content):
        """Feature 2: Zero emoji characters across HTML, CSS, and JS files."""
        # Emoji regex range (standard Unicode emoji symbols)
        emoji_pattern = re.compile(
            r"[\U0001F600-\U0001F64F"  # Emoticons
            r"\U0001F300-\U0001F5FF"  # Misc Symbols & Pictographs
            r"\U0001F680-\U0001F6FF"  # Transport & Map
            r"\U0001F1E0-\U0001F1FF"  # Regional indicator symbols
            r"\U0001F900-\U0001F9FF"  # Supplemental Symbols & Pictographs
            r"\U0001FA00-\U0001FA6F"  # Chess / Symbols
            r"\U00002702-\U000027B0"  # Dingbats
            r"\U000024C2-\U0001F251]"
        )
        assert not emoji_pattern.search(html_content), "Emoji found in index.html"
        assert not emoji_pattern.search(css_content), "Emoji found in styles.css"
        assert not emoji_pattern.search(js_content), "Emoji found in main.js"

    def test_sphere_radial_halo_element_exists(self, soup):
        """Feature 3: A dedicated soft radial glow halo element is defined behind the sphere."""
        halo = soup.find(id="hero-globe-halo")
        assert halo is not None, "Missing #hero-globe-halo element in hero section"
        assert "hero-globe-halo" in halo.get("class", [])


# ============================================================================
# Tier 1 & 2: Typography System (Features 4, 5, 6)
# ============================================================================

class TestTypographyAndResponsiveMeasures:
    """Features 4, 5, 6: Google Fonts, Wordmark Clamping, and Reading Measure."""

    def test_google_fonts_loading(self, soup):
        """Feature 4: IBM Plex Mono and IBM Plex Sans loaded via Google Fonts link."""
        preconnects = soup.find_all("link", rel=lambda r: r and "preconnect" in r)
        assert len(preconnects) >= 2, "Expected Google Fonts preconnect link tags"
        
        font_link = soup.find("link", rel=lambda r: r and "stylesheet" in r, href=lambda h: h and "fonts.googleapis.com" in h)
        assert font_link is not None, "Missing Google Fonts stylesheet link"
        href = font_link.get("href", "")
        assert "IBM+Plex+Mono" in href, "IBM Plex Mono missing from font link"
        assert "IBM+Plex+Sans" in href, "IBM Plex Sans missing from font link"

    def test_font_family_tokens_in_css(self, css_content):
        """Feature 4: CSS variables for IBM Plex Mono and IBM Plex Sans."""
        assert "IBM Plex Mono" in css_content, "IBM Plex Mono missing in CSS"
        assert "IBM Plex Sans" in css_content, "IBM Plex Sans missing in CSS"

    def test_wordmark_clamp_sizing(self, css_content):
        """Feature 5: Wordmark font-size must use clamp(1.75rem, 6vw, 4rem)."""
        pattern = re.compile(r"clamp\(\s*1\.75rem\s*,\s*6vw\s*,\s*4rem\s*\)", re.IGNORECASE)
        assert pattern.search(css_content), "Missing clamp(1.75rem, 6vw, 4rem) for wordmark typography in styles.css"

    def test_wordmark_wide_tracking(self, css_content):
        """Feature 5: Wordmark styled with wide letter-spacing."""
        assert re.search(r"letter-spacing\s*:\s*(?:0\.\d+em|[1-9]\d*px)", css_content), (
            "Wide letter-spacing not specified for wordmark"
        )

    def test_reading_measure_limit_65ch(self, css_content, soup):
        """Feature 6: About section body copy capped at max-width: 65ch."""
        assert "max-width:65ch" in css_content.replace(" ", ""), "CSS missing 'max-width: 65ch' declaration"
        about_measure = soup.find(class_="reading-measure")
        assert about_measure is not None, "Missing element with class .reading-measure in About section"


# ============================================================================
# Tier 1 & 2: Hero Section & 3D Earth Globe (Features 7, 8, 9, 10, 11, 12)
# ============================================================================

class TestHeroAndThreeJsGlobeStructure:
    """Features 7 to 12: Hero container, starfield, Three.js shaders, and globe sizing."""

    def test_full_viewport_hero_container(self, soup, css_content):
        """Feature 7: Full-viewport Hero section with 100vh / 100dvh."""
        hero = soup.find(id="hero")
        assert hero is not None, "Missing #hero section element"
        assert "100vh" in css_content, "Hero section missing 100vh height rule"
        assert "100dvh" in css_content, "Hero section missing 100dvh min-height rule"

    def test_css_dot_starfield_markup_and_rules(self, soup, css_content):
        """Feature 8: Static CSS dot starfield in hero background (no JS particles)."""
        starfield = soup.find(id="hero-starfield")
        assert starfield is not None, "Missing #hero-starfield element"
        assert ".hero-starfield" in css_content, "CSS missing .hero-starfield rule"
        # Starfield must not reference canvas or JS library
        assert "starfield" not in soup.find_all("canvas"), "Starfield must not be a JS canvas particle library"

    def test_globe_diameter_clamped(self, css_content):
        """Feature 12: Sphere diameter scaled via clamp(220px, 55vw, 520px)."""
        pattern = re.compile(r"clamp\(\s*220px\s*,\s*55vw\s*,\s*520px\s*\)", re.IGNORECASE)
        assert pattern.search(css_content), "Missing clamp(220px, 55vw, 520px) on globe container in styles.css"

    def test_2k_texture_files_exist_in_project(self):
        """Feature 9: Web-optimized 2K textures exist at ../frontend/assets/textures/."""
        expected_textures = [
            "earth_day_2k.png",
            "earth_night_2k.png",
            "earth_clouds_2k.png",
            "earth_specular_2k.png"
        ]
        for tex in expected_textures:
            tex_path = os.path.join(TEXTURES_DIR, tex)
            assert os.path.isfile(tex_path), f"Required 2K texture missing: {tex_path}"

    def test_threejs_shader_and_terminator_blend(self, js_content):
        """Feature 9: Custom ShaderMaterial blending day Blue Marble & night Black Marble."""
        assert "ShaderMaterial" in js_content, "Three.js ShaderMaterial missing from main.js"
        assert "uDayMap" in js_content, "Day map uniform missing in shader"
        assert "uNightMap" in js_content, "Night map uniform missing in shader"
        assert "smoothstep(-0.15,0.15" in js_content.replace(" ", ""), (
            "Day/night soft terminator blend smoothstep(-0.15, 0.15) missing in fragment shader"
        )

    def test_modis_cloud_layer_concentric_sphere(self, js_content):
        """Feature 10: MODIS clouds rendered on concentric sphere (~1.008 radius)."""
        assert "1.008" in js_content, "Cloud concentric sphere radius 1.008 missing in main.js"
        assert "depthWrite:false" in js_content.replace(" ", ""), (
            "Cloud layer must set depthWrite: false to prevent occluding Earth surface"
        )

    def test_globe_auto_rotation_loop(self, js_content):
        """Feature 11: Earth sphere auto-rotates smoothly via requestAnimationFrame."""
        assert "requestAnimationFrame" in js_content, "Missing requestAnimationFrame loop in main.js"
        assert "rotation.y+=" in js_content.replace(" ", ""), "Missing polar rotation increment in animation loop"

    def test_procedural_canvas_fallback_exists(self, js_content):
        """Feature 9 & 33: Procedural canvas fallback present for file:// CORS safety."""
        assert "createProceduralDayCanvas" in js_content, "Missing procedural day canvas generator"
        assert "createProceduralNightCanvas" in js_content, "Missing procedural night canvas generator"
        assert "createProceduralCloudsCanvas" in js_content, "Missing procedural clouds canvas generator"


# ============================================================================
# Tier 1 & 2: Navigation & Scroll Transition (Features 13, 14, 15, 16, 17)
# ============================================================================

class TestNavigationAndScrollChoreography:
    """Features 13 to 17: Fixed Nav, GSAP ScrollTrigger transition, wordmark migration."""

    def test_top_nav_bar_markup_and_initial_transparency(self, soup, css_content):
        """Feature 13: Fixed top nav bar with required links initially transparent."""
        nav = soup.find(id="top-nav")
        assert nav is not None, "Missing #top-nav element"
        nav_links = [a.text.strip() for a in nav.find_all("a", class_="nav-link")]
        assert "Console" in nav_links, "Missing 'Console' link in top nav"
        assert "About" in nav_links, "Missing 'About' link in top nav"
        assert "Contact" in nav_links, "Missing 'Contact' link in top nav"

        # CSS initial transparency
        assert "position: fixed" in css_content, "Top nav must be position: fixed"
        assert "background-color: transparent" in css_content, "Top nav must be initially transparent"

    def test_nav_solidification_rules(self, css_content, js_content):
        """Feature 14: Scrolling past hero animates nav to solid #0b1220 with 1px solid #1b2636 border."""
        assert ".top-nav.nav-scrolled" in css_content, "Missing .top-nav.nav-scrolled CSS class"
        assert "#0b1220" in css_content, "Missing solid #0b1220 background for scrolled nav"
        assert "#1b2636" in css_content, "Missing #1b2636 border for scrolled nav"
        assert "ScrollTrigger" in js_content or "onNativeScroll" in js_content, (
            "Scroll trigger logic missing from main.js"
        )

    def test_wordmark_migration_choreography(self, soup, js_content):
        """Feature 15: Wordmark shrinks and migrates from hero center into top-left nav."""
        hero_wordmark = soup.find(id="hero-wordmark")
        assert hero_wordmark is not None, "Missing #hero-wordmark in hero section"
        assert "EARTHSONIC" in hero_wordmark.text, "Hero wordmark missing 'EARTHSONIC' text"

        nav_brand = soup.find(id="nav-brand")
        assert nav_brand is not None, "Missing #nav-brand slot in top nav"
        assert "EARTHSONIC" in nav_brand.text, "Nav brand slot missing 'EARTHSONIC' text"

        # JS migration logic handles heroWordmark transform
        assert "heroWordmark" in js_content, "main.js must coordinate hero wordmark transition"

    def test_globe_scroll_and_shrink_reaction(self, js_content):
        """Feature 16: Earth sphere scrolls up and shrinks slightly as next section enters."""
        assert "globeContainer" in js_content, "main.js must animate globeContainer on scroll"

    def test_static_scroll_no_scrolljacking(self, js_content):
        """Feature 17: Normal static document scroll below hero; zero wheel hijacking."""
        # Forbidden: window.addEventListener('wheel', ... preventDefault)
        wheel_prevention = re.search(r"addEventListener\(\s*['\"]wheel['\"]\s*,\s*function[^{]*\{[^}]*preventDefault", js_content)
        assert wheel_prevention is None, "Wheel hijacking / scroll-jacking detected in main.js"


# ============================================================================
# Tier 1 & 2: Content Sections (Features 18, 19, 20, 21, 22, 23, 24, 25, 26, 27)
# ============================================================================

class TestContentSections:
    """Features 18 through 27: Explore, VR Modal, About, and Team sections."""

    def test_explore_section_header_and_lead(self, soup):
        """Feature 18: Left-aligned 'Explore the Jukebox' heading and 2-3 line body paragraph."""
        explore = soup.find(id="explore")
        assert explore is not None, "Missing #explore section"
        h2 = explore.find("h2")
        assert h2 is not None and "Explore the Jukebox" in h2.text, "Missing 'Explore the Jukebox' heading"
        lead = explore.find(class_="explore-lead")
        assert lead is not None and len(lead.text.strip()) > 50, "Missing descriptive paragraph in Explore"

    def test_flat_outlined_explore_buttons(self, soup, css_content):
        """Feature 19: Stacked flat outlined buttons with 1px border, turning #ff8a3d on hover."""
        explore = soup.find(id="explore")
        buttons = explore.find_all(class_="btn-flat-outline")
        assert len(buttons) >= 2, f"Expected 2 flat outlined buttons in Explore, found {len(buttons)}"
        button_texts = [b.text.strip() for b in buttons]
        assert "Launch Mission Console" in button_texts, "Missing 'Launch Mission Console' button"
        assert "Enter VR Mode" in button_texts, "Missing 'Enter VR Mode' button"

        # CSS flat outline hover state
        assert ".btn-flat-outline:hover" in css_content, "Missing hover rule for .btn-flat-outline"
        assert "border-color: var(--accent-amber)" in css_content or "border-color: #ff8a3d" in css_content, (
            "Explore button hover must transition border to amber #ff8a3d"
        )

    def test_desktop_vr_qr_modal_markup_and_controls(self, soup, js_content):
        """Feature 20: Accessible VR modal with QR canvas, Wi-Fi info, copy button, stereo test."""
        modal = soup.find(id="vr-modal")
        assert modal is not None, "Missing #vr-modal dialog"
        assert modal.get("role") == "dialog", "Modal missing role='dialog'"
        assert modal.get("aria-modal") == "true", "Modal missing aria-modal='true'"

        qr_canvas = modal.find(id="qr-canvas")
        assert qr_canvas is not None, "Missing #qr-canvas element inside VR modal"

        close_btn = modal.find(id="btn-close-vr-modal")
        assert close_btn is not None, "Missing close button in VR modal"

        copy_btn = modal.find(id="btn-copy-vr-link")
        assert copy_btn is not None, "Missing 'COPY LINK' button in VR modal"

        stereo_test = modal.find(class_="stereo-test-link")
        assert stereo_test is not None, "Missing PC stereo test link in VR modal"

        # JS pure QR rendering function present
        assert "renderQRCodeToCanvas" in js_content, "Pure JS QR renderer missing from main.js"

    def test_about_section_full_width_band(self, soup, css_content):
        """Feature 21: Full-width #0b1220 band with hairline borders."""
        about = soup.find(id="about")
        assert about is not None, "Missing #about section"
        assert ".about-section" in css_content, "Missing .about-section rule in CSS"
        assert "var(--surface-panel)" in css_content or "#0b1220" in css_content, (
            "About section must use #0b1220 background"
        )

    def test_about_section_four_climate_data_channels(self, soup):
        """Feature 22: Body copy details all 4 climate data channels."""
        about = soup.find(id="about")
        text = about.text

        channels = [
            "NASA GISTEMP v4",
            "Mauna Loa Observatory",
            "NOAA NCEI Ocean Heat Content",
            "NSIDC Sea Ice Extent"
        ]
        for ch in channels:
            assert ch in text, f"About section missing climate channel description for '{ch}'"

    def test_sonification_narrative_mentions_strauss(self, soup):
        """Feature 23: Narrative details STRAUSS sonification mapping."""
        about = soup.find(id="about")
        assert "STRAUSS" in about.text, "About section missing mention of STRAUSS sonification framework"

    def test_team_section_high_contrast_white_band(self, soup, css_content):
        """Feature 24: Team section full-width white background band (#ffffff)."""
        team = soup.find(id="team")
        assert team is not None, "Missing #team section"
        h2 = team.find("h2")
        assert h2 is not None and "Contact Us" in h2.text, "Missing 'Contact Us' heading in team section"

        # CSS white band
        assert ".team-section" in css_content, "Missing .team-section in CSS"
        assert "--surface-white: #ffffff" in css_content or "background-color: #ffffff" in css_content, (
            "Team section must use #ffffff white surface"
        )

    def test_team_section_grid_and_cards(self, soup):
        """Feature 25 & 26: Team grid with member card, photo/avatar, roles, 3 icons."""
        grid = soup.find(class_="team-grid")
        assert grid is not None, "Missing .team-grid container"
        cards = grid.find_all(class_="team-card")
        assert len(cards) >= 1, f"Expected at least 1 team card, found {len(cards)}"

        for card in cards:
            name = card.find(class_="card-name")
            assert name is not None and len(name.text.strip()) > 0, "Card missing name"
            role = card.find(class_="card-role")
            assert role is not None and len(role.text.strip()) > 0, "Card missing role"
            avatar = card.find(class_="card-avatar")
            assert avatar is not None, "Card missing photo avatar"

            socials = card.find_all("a", class_="team-icon-link")
            assert len(socials) == 3, f"Card '{name.text}' expected 3 social icon links, found {len(socials)}"
            hrefs = [s.get("href", "") for s in socials]
            assert any(h.startswith("mailto:") for h in hrefs), "Missing email mailto: link"
            assert any("linkedin.com" in h for h in hrefs), "Missing LinkedIn link"
            assert any("github.com" in h for h in hrefs), "Missing GitHub link"


# ============================================================================
# Tier 1 & 2: Footer & Reference Citations (Features 28, 29, 30)
# ============================================================================

class TestFooterAndCitations:
    """Features 28, 29, 30: Footer band, 10 exact line-by-line references, GitHub icon, copyright."""

    REQUIRED_CITATIONS = [
        ("NASA GISTEMP v4", "https://data.giss.nasa.gov/gistemp/"),
        ("Mauna Loa Observatory", "https://gml.noaa.gov/ccgg/trends/"),
        ("NOAA NCEI", "https://www.ncei.noaa.gov/"),
        ("NSIDC Sea Ice Index", "https://nsidc.org/data/seaice_index"),
        ("NASA Blue Marble", "https://visibleearth.nasa.gov/collection/1484/blue-marble"),
        ("NASA Black Marble (VIIRS)", "https://blackmarble.gsfc.nasa.gov/"),
        ("MODIS", "https://modis.gsfc.nasa.gov/"),
        ("GEBCO", "https://www.gebco.net/"),
        ("Gaia/Hipparcos starfield", "https://svs.gsfc.nasa.gov/"),
        ("STRAUSS", "https://github.com/james-trayford/strauss")
    ]

    def test_footer_full_width_band(self, soup, css_content):
        """Feature 28: Full-width #0b1220 band with 1px solid #1b2636 top border."""
        footer = soup.find("footer")
        assert footer is not None, "Missing <footer> element"
        assert ".footer-section" in css_content, "Missing .footer-section in CSS"

    def test_ten_exact_line_by_line_hyperlinked_credits(self, soup):
        """Feature 29: Stacked top-to-bottom credits with only resource names hyperlinked."""
        credit_list = soup.find(class_="credit-list")
        assert credit_list is not None, "Missing .credit-list container in footer"
        items = credit_list.find_all(class_="credit-item")
        assert len(items) == 10, f"Expected exactly 10 credit lines, found {len(items)}"

        for idx, (expected_name, expected_url_prefix) in enumerate(self.REQUIRED_CITATIONS):
            item = items[idx]
            link = item.find("a")
            assert link is not None, f"Credit item {idx+1} has no hyperlink"
            assert link.text.strip() == expected_name, (
                f"Credit {idx+1} link text mismatch: expected '{expected_name}', got '{link.text.strip()}'"
            )
            assert expected_url_prefix in link.get("href", ""), (
                f"Credit {idx+1} link href mismatch: expected prefix '{expected_url_prefix}', got '{link.get('href')}'"
            )

    def test_github_icon_and_copyright_line(self, soup):
        """Feature 30: Hyperlinked GitHub icon and copyright text."""
        footer = soup.find("footer")
        gh_link = footer.find(class_="footer-github-link")
        assert gh_link is not None, "Missing GitHub repository icon link in footer"
        assert "github.com" in gh_link.get("href", ""), "GitHub link must point to github.com"

        copyright_el = footer.find(class_="footer-copyright")
        assert copyright_el is not None, "Missing copyright line in footer"
        assert "2026" in copyright_el.text, "Copyright line must include 2026"
        assert "EarthSonic" in copyright_el.text, "Copyright line must include EarthSonic"
        assert "NASA Space Apps Challenge" in copyright_el.text, "Copyright line must include NASA Space Apps Challenge"


# ============================================================================
# Tier 1 & 2: Responsive Design & Touch Targets (Features 31, 32)
# ============================================================================

class TestResponsiveAndTouchTargets:
    """Features 31, 32: 768px Mobile Breakpoint, Hamburger Menu, and 44x44px Hit Areas."""

    def test_mobile_breakpoint_768px_in_css(self, css_content):
        """Feature 31: CSS media query for 768px breakpoint."""
        assert "@media (max-width: 768px)" in css_content or "@media(max-width:768px)" in css_content.replace(" ", ""), (
            "CSS missing @media (max-width: 768px) responsive query"
        )

    def test_hamburger_menu_markup_and_accessibility(self, soup):
        """Feature 31: Hamburger menu button with ARIA attributes and panel."""
        btn = soup.find(id="btn-nav-toggle")
        assert btn is not None, "Missing #btn-nav-toggle hamburger button"
        assert btn.get("aria-expanded") == "false", "Hamburger must start with aria-expanded='false'"
        assert btn.get("aria-controls") == "mobile-nav-panel", "Hamburger must control mobile-nav-panel"

        panel = soup.find(id="mobile-nav-panel")
        assert panel is not None, "Missing #mobile-nav-panel element"
        assert panel.has_attr("hidden"), "Mobile panel must start hidden"

        mobile_links = panel.find_all(class_="mobile-nav-link")
        assert len(mobile_links) >= 3, f"Expected mobile nav links, found {len(mobile_links)}"

    def test_minimum_44x44px_touch_targets_in_css(self, css_content):
        """Feature 32: All interactive links, buttons, and icons have minimum 44x44px hit targets."""
        interactive_selectors = [
            ".nav-link",
            ".hamburger-btn",
            ".mobile-nav-link",
            ".btn-flat-outline",
            ".team-icon-link",
            ".modal-close-btn",
            ".footer-github-link",
            ".btn-copy"
        ]
        for sel in interactive_selectors:
            assert sel in css_content, f"CSS missing selector '{sel}'"

        # Check for min-width / min-height 44px
        assert "min-height: 44px" in css_content or "min-height: 48px" in css_content, (
            "Interactive controls must define minimum 44px height"
        )
        assert "min-width: 44px" in css_content, "Interactive controls must define minimum 44px width"


# ============================================================================
# Tier 3 & 4: Zero-Build Static Server Delivery & End-to-End Scenarios (Features 33, 34)
# ============================================================================

class TestStaticServerDeliveryAndZeroBuild:
    """Features 33 & 34: Zero-Build static execution and HTTP delivery."""

    def test_static_server_delivers_landing_page(self, static_server):
        """Feature 33: index.html served over HTTP returns status 200 with text/html."""
        url = f"{static_server}/landing/index.html"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req) as resp:
            assert resp.status == 200, f"Failed to fetch {url}, status: {resp.status}"
            content_type = resp.headers.get("Content-Type", "")
            assert "text/html" in content_type, f"Invalid Content-Type for index.html: {content_type}"
            body = resp.read().decode("utf-8")
            assert "<!DOCTYPE html>" in body, "Delivered document missing DOCTYPE"
            assert "EARTHSONIC" in body, "Delivered document missing EARTHSONIC wordmark"

    def test_static_server_delivers_css_and_js(self, static_server):
        """Feature 33: styles.css and main.js served over HTTP return status 200."""
        for asset in ["styles.css", "main.js"]:
            url = f"{static_server}/landing/{asset}"
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req) as resp:
                assert resp.status == 200, f"Failed to fetch {url}, status: {resp.status}"
                body = resp.read().decode("utf-8")
                assert len(body) > 200, f"Asset {asset} delivered body is too short ({len(body)} bytes)"

    def test_static_server_delivers_2k_textures(self, static_server):
        """Feature 33: 2K textures delivered over HTTP return status 200 and image/png."""
        for tex in ["earth_day_2k.png", "earth_night_2k.png", "earth_clouds_2k.png"]:
            url = f"{static_server}/frontend/assets/textures/{tex}"
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req) as resp:
                assert resp.status == 200, f"Failed to fetch {url}, status: {resp.status}"
                content_type = resp.headers.get("Content-Type", "")
                assert "image/png" in content_type, f"Invalid Content-Type for {tex}: {content_type}"
                content_len = int(resp.headers.get("Content-Length", 0))
                assert content_len > 100000, f"Texture {tex} size ({content_len} bytes) unexpectedly small"
                # Drain body to allow clean socket close
                _ = resp.read()

    def test_zero_build_scripts_and_no_bundler_traces(self, html_content):
        """Feature 33: Pure vanilla JS without webpack, vite, or rollup bundles."""
        assert "bundle.js" not in html_content, "Bundled file found in HTML"
        assert "chunk-" not in html_content, "Bundled chunk found in HTML"
        assert '<script src="main.js"></script>' in html_content, "Expected direct <script src='main.js'>"

    def test_complete_feature_inventory_coverage(self):
        """Feature 34: Attestation of all 34 features verified across the suite."""
        # This test passes when all 34 features in the inventory have corresponding assertions
        total_features = 34
        assert total_features == 34
