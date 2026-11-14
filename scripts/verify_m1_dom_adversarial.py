"""
scripts/verify_m1_dom_adversarial.py
Adversarial Empirical Challenger Verification Suite for Milestone M1 DOM Updates.

Executes:
1. Multi-parser DOM parsing stress testing (BeautifulSoup, html.parser, regex, raw stream).
2. DOM contract verification for all M1 modifications.
3. DOM well-formedness, tag balance, and element hierarchy validation.
4. Document-wide ID uniqueness audit.
5. Character encoding and entity sanitation validation.
6. Inline CSS style parser and property validation.
7. Flask static serving test client simulation.
"""

import sys
import os
import re
from html.parser import HTMLParser
from bs4 import BeautifulSoup

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)
INDEX_PATH = os.path.join(PROJECT_ROOT, "frontend", "index.html")

failures = []
warnings = []
passed_checks = 0

def check(condition, desc):
    global passed_checks
    if condition:
        passed_checks += 1
        print(f"  [PASS] {desc}")
    else:
        failures.append(desc)
        print(f"  [FAIL] {desc}")

def warn(condition, desc):
    if not condition:
        warnings.append(desc)
        print(f"  [WARN] {desc}")

print("=" * 80)
print("EARTHSONIC M1 EMPIRICAL CHALLENGER DOM VERIFICATION HARNESS")
print("=" * 80)

# Load raw HTML
with open(INDEX_PATH, "r", encoding="utf-8") as f:
    raw_html = f.read()

# ----------------------------------------------------------------------------
# Category 1: Exact M1 Contract Validations
# ----------------------------------------------------------------------------
print("\n>>> Category 1: Exact M1 Contract Validations")

# 1. Title verification
title_match = re.search(r"<title>(.*?)</title>", raw_html, re.DOTALL)
check(title_match is not None, "HTML contains <title> tag")
if title_match:
    title_text = title_match.group(1).strip()
    check(title_text == "EARTHSONIC // 3D EARTH GLOBE | NASA Earth Science · Space Apps Challenge 2026",
          f"Title text exact match: '{title_text}'")

# 2. Viewport container verification
viewport_match = re.search(r'<main\s+([^>]*id="globe-viewport-container"[^>]*)>', raw_html)
if not viewport_match:
    viewport_match = re.search(r'<main\s+([^>]*class="globe-viewport"[^>]*)>', raw_html)
check(viewport_match is not None, "<main id='globe-viewport-container'> element exists")
if viewport_match:
    attrs_str = viewport_match.group(1)
    check('id="globe-viewport-container"' in attrs_str, "Viewport has id='globe-viewport-container'")
    check('class="globe-viewport"' in attrs_str, "Viewport has class='globe-viewport'")
    check('tabindex="-1"' in attrs_str, "Viewport has tabindex='-1'")
    check("100vw" in attrs_str, "Viewport style has 100vw width")
    check("100vh" in attrs_str, "Viewport style has 100vh height")
    check("#070709" in attrs_str, "Viewport style has #070709 background")

# 3. Telemetry Matrix Card Header & Labels
matrix_header_match = re.search(r'<div class="hud-panel hud-matrix-panel" id="hud-matrix-card">.*?<div class="hud-title">(.*?)</div>', raw_html, re.DOTALL)
check(matrix_header_match is not None, "#hud-matrix-card header found")
if matrix_header_match:
    hud_title = matrix_header_match.group(1).strip()
    check(hud_title == "Live Earth Telemetry Matrix", f"Matrix HUD title exact match: '{hud_title}'")

# Check CO2 label in telemetry matrix
co2_label_match = re.search(r'<div\s+class="matrix-cell[^"]*"\s+data-layer="co2"[^>]*>.*?<span\s+class="matrix-label">(.*?)</span>', raw_html, re.DOTALL)
check(co2_label_match is not None, "CO2 matrix-cell with matrix-label found")
if co2_label_match:
    co2_label = co2_label_match.group(1).strip()
    check(co2_label == "CO2", f"CO2 matrix-label is 'CO2' (ASCII): '{co2_label}'")

# Check all 4 variables in matrix
for layer, label in [("temperature", "TEMP"), ("co2", "CO2"), ("ocean", "OCEAN"), ("sea_ice", "ICE")]:
    pattern = rf'data-layer="{layer}".*?<span class="matrix-label">{label}</span>'
    check(bool(re.search(pattern, raw_html, re.DOTALL)), f"Matrix grid contains layer '{layer}' with label '{label}'")

# 4. Visualizer frequency axis spans
axis_match = re.search(r'<div class="spectrum-freq-axis">(.*?)</div>', raw_html, re.DOTALL)
check(axis_match is not None, ".spectrum-freq-axis block found")
if axis_match:
    spans = re.findall(r'<span>(.*?)</span>', axis_match.group(1))
    expected_spans = ["60Hz", "250Hz", "1kHz", "4kHz", "16kHz"]
    check(spans == expected_spans, f"Frequency axis spans match exact list: {spans} == {expected_spans}")

# ----------------------------------------------------------------------------
# Category 2: Multi-Parser Stress Testing (BeautifulSoup)
# ----------------------------------------------------------------------------
print("\n>>> Category 2: Multi-Parser Stress Testing (BeautifulSoup)")

soup = BeautifulSoup(raw_html, "html.parser")

soup_title = soup.find("title")
check(soup_title is not None and soup_title.string == "EARTHSONIC // 3D EARTH GLOBE | NASA Earth Science · Space Apps Challenge 2026",
      "BS4 parsed title accurately")

soup_viewport = soup.find("main", id="globe-viewport-container")
check(soup_viewport is not None, "BS4 found <main id='globe-viewport-container'>")
if soup_viewport:
    style = soup_viewport.get("style", "")
    check("width: 100vw" in style or "width:100vw" in style, f"BS4 style contains width: 100vw ({style})")
    check("height: 100vh" in style or "height:100vh" in style, f"BS4 style contains height: 100vh ({style})")
    check("background: #070709" in style or "background:#070709" in style, f"BS4 style contains background: #070709 ({style})")

soup_matrix = soup.find(id="hud-matrix-card")
check(soup_matrix is not None, "BS4 found #hud-matrix-card")
if soup_matrix:
    title_div = soup_matrix.find(class_="hud-title")
    check(title_div is not None and title_div.get_text().strip() == "Live Earth Telemetry Matrix",
          f"BS4 verified HUD title: {title_div.get_text().strip() if title_div else 'None'}")
    
    co2_cell = soup_matrix.find("div", {"data-layer": "co2"})
    check(co2_cell is not None, "BS4 found data-layer='co2' cell")
    if co2_cell:
        co2_lbl = co2_cell.find(class_="matrix-label")
        check(co2_lbl is not None and co2_lbl.get_text().strip() == "CO2",
              f"BS4 verified CO2 label: {co2_lbl.get_text().strip() if co2_lbl else 'None'}")

soup_axis = soup.find("div", class_="spectrum-freq-axis")
check(soup_axis is not None, "BS4 found div.spectrum-freq-axis")
if soup_axis:
    bs4_spans = [s.get_text().strip() for s in soup_axis.find_all("span")]
    check(bs4_spans == ["60Hz", "250Hz", "1kHz", "4kHz", "16kHz"],
          f"BS4 verified frequency spans: {bs4_spans}")

# ----------------------------------------------------------------------------
# Category 3: Strict HTML5 Tag Balance & Well-Formedness
# ----------------------------------------------------------------------------
print("\n>>> Category 3: Strict HTML5 Tag Balance & Well-Formedness")

class StrictHTMLValidator(HTMLParser):
    VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input",
                 "link", "meta", "param", "source", "track", "wbr"}
    
    def __init__(self):
        super().__init__()
        self.stack = []
        self.errors = []
        self.all_ids = []
        self.tag_counts = {}

    def handle_starttag(self, tag, attrs):
        self.tag_counts[tag] = self.tag_counts.get(tag, 0) + 1
        attrs_dict = dict(attrs)
        if "id" in attrs_dict:
            self.all_ids.append(attrs_dict["id"])
        
        if tag.lower() not in self.VOID_TAGS:
            self.stack.append((tag.lower(), self.getpos()))

    def handle_endtag(self, tag):
        tag_lower = tag.lower()
        if tag_lower in self.VOID_TAGS:
            self.errors.append(f"Void tag <{tag_lower}> explicitly closed at line {self.getpos()[0]}")
            return
        
        if not self.stack:
            self.errors.append(f"Unexpected closing tag </{tag_lower}> with empty stack at line {self.getpos()[0]}")
            return
        
        expected_tag, pos = self.stack[-1]
        if expected_tag == tag_lower:
            self.stack.pop()
        else:
            # Check if tag is in stack
            stack_tags = [t for t, p in self.stack]
            if tag_lower in stack_tags:
                while self.stack and self.stack[-1][0] != tag_lower:
                    unclosed, unclosed_pos = self.stack.pop()
                    self.errors.append(f"Tag <{unclosed}> opened at line {unclosed_pos[0]} implicitly closed by </{tag_lower}> at line {self.getpos()[0]}")
                if self.stack:
                    self.stack.pop()
            else:
                self.errors.append(f"Mismatched closing tag </{tag_lower}> at line {self.getpos()[0]}, expected </{expected_tag}> from line {pos[0]}")

validator = StrictHTMLValidator()
validator.feed(raw_html)
validator.close()

check(len(validator.errors) == 0, f"HTML well-formedness: 0 tag nesting errors (found {len(validator.errors)}: {validator.errors[:3]})")
check(len(validator.stack) == 0, f"HTML tag stack completely closed: {len(validator.stack)} unclosed tags (unclosed: {validator.stack})")

# ----------------------------------------------------------------------------
# Category 4: Document-Wide ID Uniqueness Audit
# ----------------------------------------------------------------------------
print("\n>>> Category 4: Document-Wide ID Uniqueness Audit")

seen_ids = set()
duplicate_ids = []
for el_id in validator.all_ids:
    if el_id in seen_ids:
        duplicate_ids.append(el_id)
    seen_ids.add(el_id)

check(len(duplicate_ids) == 0, f"Document-wide ID uniqueness: 0 duplicate IDs (found {len(duplicate_ids)}: {duplicate_ids})")
check(len(seen_ids) >= 30, f"Adequate element count with IDs: {len(seen_ids)} IDs checked")

# ----------------------------------------------------------------------------
# Category 5: Character Encoding & Entity Sanitization
# ----------------------------------------------------------------------------
print("\n>>> Category 5: Character Encoding & Entity Sanitization")

# UTF-8 decode sanity
try:
    with open(INDEX_PATH, "rb") as bf:
        raw_bytes = bf.read()
    decoded = raw_bytes.decode("utf-8")
    check(True, "File is valid, clean UTF-8 with zero decoding errors")
    check(not raw_bytes.startswith(b"\xef\xbb\xbf"), "No UTF-8 BOM artifact")
except Exception as e:
    check(False, f"UTF-8 verification failed: {e}")

# Check status badge contains Unicode bullet and zero literal &bull;
status_badge_match = re.search(r'id="telemetry-status">([^<]+)</span>', raw_html)
check(status_badge_match is not None, "#telemetry-status element found")
if status_badge_match:
    badge_content = status_badge_match.group(1)
    check("&bull;" not in badge_content, "Status badge does NOT contain literal &bull;")
    check("•" in badge_content, "Status badge contains Unicode bullet '•'")
    check("23.44°" in badge_content, "Status badge contains degree symbol '°'")

# ----------------------------------------------------------------------------
# Category 6: Inline CSS Style Parsing & Invariance
# ----------------------------------------------------------------------------
print("\n>>> Category 6: Inline CSS Style Parsing & Invariance")

all_styles = re.findall(r'style="([^"]*)"', raw_html)
style_parse_errors = []
for s in all_styles:
    declarations = [d.strip() for d in s.split(";") if d.strip()]
    for decl in declarations:
        if ":" not in decl:
            style_parse_errors.append(f"Invalid declaration '{decl}' in style='{s}'")

check(len(style_parse_errors) == 0, f"Inline CSS syntax validity: 0 errors (found {len(style_parse_errors)})")

# Check viewport specific style declarations
viewport_tag = soup.find(id="globe-viewport-container")
if viewport_tag and viewport_tag.has_attr("style"):
    vp_style = viewport_tag["style"]
    vp_decls = {k.strip(): v.strip() for k, v in [p.split(":", 1) for p in vp_style.split(";") if ":" in p]}
    check(vp_decls.get("width") == "100vw", f"Parsed style width: {vp_decls.get('width')}")
    check(vp_decls.get("height") == "100vh", f"Parsed style height: {vp_decls.get('height')}")
    check(vp_decls.get("background") == "#070709", f"Parsed style background: {vp_decls.get('background')}")

# ----------------------------------------------------------------------------
# Category 7: Flask Client Static Serving Simulation
# ----------------------------------------------------------------------------
print("\n>>> Category 7: Flask Client Static Serving Simulation")

from backend.app import create_app
from backend.config import TestingConfig

app = create_app(TestingConfig)
client = app.test_client()

resp = client.get("/")
check(resp.status_code == 200, f"GET / returns 200 OK (got {resp.status_code})")
check("text/html" in resp.content_type, f"Content-Type contains text/html ({resp.content_type})")
check(b"EARTHSONIC // 3D EARTH GLOBE" in resp.data, "Flask serves updated title in response body")
check(b"Live Earth Telemetry Matrix" in resp.data, "Flask serves Live Earth Telemetry Matrix")
check(b"width: 100vw; height: 100vh; background: #070709;" in resp.data, "Flask serves viewport inline style")
axis_spans_in_resp = all(f"<span>{freq}</span>".encode("utf-8") in resp.data for freq in ["60Hz", "250Hz", "1kHz", "4kHz", "16kHz"])
check(axis_spans_in_resp, "Flask serves compact frequency axis spans (60Hz, 250Hz, 1kHz, 4kHz, 16kHz)")
check(b"<span>60 Hz</span>" not in resp.data, "Flask does NOT serve old '60 Hz' span")

# ----------------------------------------------------------------------------
# Summary & Outcome
# ----------------------------------------------------------------------------
print("\n" + "=" * 80)
print(f"VERIFICATION SUMMARY: {passed_checks} checks PASSED, {len(failures)} checks FAILED, {len(warnings)} warnings")
print("=" * 80)

if failures:
    print("FAILED CHECKS:")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
else:
    print("ALL EMPIRICAL CHALLENGER DOM VERIFICATIONS PASSED CLEANLY.")
    sys.exit(0)
