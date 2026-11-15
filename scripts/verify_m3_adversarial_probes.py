"""
scripts/verify_m3_adversarial_probes.py
Adversarial Probes & Empirical Stress Harness for Milestone 3 (R3):
Sonification Mapping & Backend API Endpoints.

Tasks Covered:
1. Invalid layer ID: GET /api/layers/nonexistent_layer -> HTTP 404 with error JSON
2. Invalid durations: duration=0, duration=-5, duration=abc, duration=-0.001 -> HTTP 400
3. Duration clamping: duration=999, duration=10000 -> clamped to 60.0s max without error
4. Caching & Determinism: Repeated sonify queries return byte-identical cached responses
5. WAV Format Specification: RIFF header, WAVE tag, 44100 Hz, 2 channels (stereo), 16-bit PCM
6. Layer aliases resolution & endpoint stability
7. Health endpoint layers_ready verification
"""

import io
import os
import sys
import time
import wave
from typing import Any, Dict

# Ensure project root is in sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.app import create_app
from backend.config import TestingConfig

app = create_app(TestingConfig)
client = app.test_client()

PASS_COUNT = 0
FAIL_COUNT = 0


def record_result(probe_name: str, passed: bool, details: str = ""):
    global PASS_COUNT, FAIL_COUNT
    status = "PASS" if passed else "FAIL"
    if passed:
        PASS_COUNT += 1
    else:
        FAIL_COUNT += 1
    print(f"[{status}] {probe_name}{' - ' + details if details else ''}")


def run_probes():
    print("=" * 80)
    print("EARTHSONIC MILESTONE 3 (R3) ADVERSARIAL CHALLENGER PROBE HARNESS")
    print("=" * 80)

    # ------------------------------------------------------------------------
    # Task 1: Invalid layer ID probes (404 and error JSON)
    # ------------------------------------------------------------------------
    print("\n--- Test Suite 1: Invalid Layer IDs ---")
    invalid_slugs = [
        "nonexistent_layer",
        "unknown_layer_404",
        "invalid_slug",
        "night_lights_fake",
        "12345",
        "random-string-xyz"
    ]
    for slug in invalid_slugs:
        # Test GET /api/layers/<slug>
        res = client.get(f"/api/layers/{slug}")
        is_404 = res.status_code == 404
        is_json = res.is_json
        data = res.get_json() if is_json else {}
        has_error = "error" in data
        record_result(
            f"GET /api/layers/{slug} returns 404 + error JSON",
            is_404 and is_json and has_error,
            f"code={res.status_code}, error={data.get('error', 'NONE')}"
        )

        # Test GET /api/layers/<slug>/sonify
        res_s = client.get(f"/api/layers/{slug}/sonify")
        is_s_404 = res_s.status_code == 404
        is_s_json = res_s.is_json
        data_s = res_s.get_json() if is_s_json else {}
        has_s_error = "error" in data_s
        record_result(
            f"GET /api/layers/{slug}/sonify returns 404 + error JSON",
            is_s_404 and is_s_json and has_s_error,
            f"code={res_s.status_code}, error={data_s.get('error', 'NONE')}"
        )

    # ------------------------------------------------------------------------
    # Task 2: Invalid durations (0, -5, abc, etc. -> HTTP 400)
    # ------------------------------------------------------------------------
    print("\n--- Test Suite 2: Invalid Durations ---")
    invalid_durations = [
        ("0", "zero duration"),
        ("-5", "negative integer duration"),
        ("-0.0001", "negative tiny float duration"),
        ("abc", "alphabetic string duration"),
        ("twenty", "word number duration"),
        ("0.0", "zero float duration"),
        ("undefined", "undefined string duration"),
        ("null", "null string duration")
    ]
    for val, desc in invalid_durations:
        for layer_id in ["night_lights", "lightning"]:
            res = client.get(f"/api/layers/{layer_id}/sonify?duration={val}")
            is_400 = res.status_code == 400
            is_json = res.is_json
            data = res.get_json() if is_json else {}
            has_error = "error" in data
            record_result(
                f"GET /api/layers/{layer_id}/sonify?duration={val} ({desc}) -> 400",
                is_400 and is_json and has_error,
                f"code={res.status_code}, error={data.get('error', 'NONE')}"
            )

    # ------------------------------------------------------------------------
    # Task 3: Duration clamping (duration=999 -> clamped to max 60s)
    # ------------------------------------------------------------------------
    print("\n--- Test Suite 3: Duration Clamping ---")
    clamped_tests = [
        ("60.0", 60.0),
        ("60.1", 60.0),
        ("999", 60.0),
        ("9999", 60.0),
        ("100000", 60.0),
    ]
    for req_dur, expected_dur in clamped_tests:
        res = client.get(f"/api/layers/gedi_forest/sonify?duration={req_dur}")
        is_200 = res.status_code == 200
        if is_200:
            with wave.open(io.BytesIO(res.data), "rb") as wf:
                actual_dur = wf.getnframes() / wf.getframerate()
                dur_match = abs(actual_dur - expected_dur) < 0.1
                record_result(
                    f"Clamping for duration={req_dur} -> clamped to {actual_dur:.1f}s (expected {expected_dur:.1f}s)",
                    dur_match,
                    f"nframes={wf.getnframes()}, rate={wf.getframerate()}, size={len(res.data)} bytes"
                )
        else:
            record_result(f"Clamping for duration={req_dur} returned 200", False, f"code={res.status_code}")

    # ------------------------------------------------------------------------
    # Task 4: Caching and Byte Identity
    # ------------------------------------------------------------------------
    print("\n--- Test Suite 4: Caching and Determinism ---")
    layers = ["night_lights", "lightning", "gedi_forest", "co2_dyamond"]
    for lid in layers:
        url = f"/api/layers/{lid}/sonify?duration=8"
        t0 = time.time()
        res1 = client.get(url)
        t1 = time.time()
        res2 = client.get(url)
        t2 = time.time()

        is_200 = res1.status_code == 200 and res2.status_code == 200
        is_byte_identical = res1.data == res2.data
        cache_header = res2.headers.get("Cache-Control", "")
        has_cache_control = "public" in cache_header and "max-age" in cache_header

        record_result(
            f"Caching byte-identity for {lid}",
            is_200 and is_byte_identical and has_cache_control,
            f"size={len(res1.data)} bytes, call1={((t1-t0)*1000):.1f}ms, call2={((t2-t1)*1000):.1f}ms, Cache-Control='{cache_header}'"
        )

    # ------------------------------------------------------------------------
    # Task 5: Audio WAV Format Specs (RIFF, 44100 Hz, stereo, 16-bit PCM)
    # ------------------------------------------------------------------------
    print("\n--- Test Suite 5: Audio WAV Specification across all 4 layers ---")
    for lid in layers:
        res = client.get(f"/api/layers/{lid}/sonify?duration=4")
        if res.status_code != 200:
            record_result(f"WAV synthesis for {lid}", False, f"status={res.status_code}")
            continue

        raw = res.data
        # RIFF header validation
        riff_tag = raw[0:4] == b"RIFF"
        wave_tag = raw[8:12] == b"WAVE"

        with wave.open(io.BytesIO(raw), "rb") as wf:
            channels = wf.getnchannels()
            sampwidth = wf.getsampwidth()
            framerate = wf.getframerate()
            nframes = wf.getnframes()

            is_stereo = channels == 2
            is_16bit = sampwidth == 2  # 2 bytes = 16 bits
            is_44100 = framerate == 44100
            expected_frames = 4 * 44100
            is_exact_frames = nframes == expected_frames

            all_ok = riff_tag and wave_tag and is_stereo and is_16bit and is_44100 and is_exact_frames
            record_result(
                f"WAV specification for {lid}",
                all_ok,
                f"RIFF={riff_tag}, WAVE={wave_tag}, Channels={channels}, Width={sampwidth*8}bit, Rate={framerate}Hz, Frames={nframes}"
            )

    # ------------------------------------------------------------------------
    # Task 6: Aliases & Edge Case Slug Resolution
    # ------------------------------------------------------------------------
    print("\n--- Test Suite 6: Layer Slug Aliases & Normalization ---")
    alias_map = [
        ("night-lights", "night_lights"),
        ("nightlights", "night_lights"),
        ("iss_lightning", "lightning"),
        ("iss-lightning", "lightning"),
        ("gedi-forest", "gedi_forest"),
        ("gedi", "gedi_forest"),
        ("co2-dyamond", "co2_dyamond"),
        ("dyamond", "co2_dyamond"),
    ]
    for alias, canonical in alias_map:
        res = client.get(f"/api/layers/{alias}")
        is_ok = res.status_code == 200
        data = res.get_json() if res.is_json else {}
        meta_id = data.get("meta", {}).get("id")
        record_result(
            f"Alias slug '{alias}' correctly maps to canonical '{canonical}'",
            is_ok and meta_id == canonical,
            f"HTTP {res.status_code}, meta.id={meta_id}"
        )

    # ------------------------------------------------------------------------
    # Task 7: Health Endpoint layers_ready verification
    # ------------------------------------------------------------------------
    print("\n--- Test Suite 7: GET /api/health Verification ---")
    res_h = client.get("/api/health")
    h_data = res_h.get_json()
    record_result(
        "GET /api/health returns HTTP 200 with layers_ready == True",
        res_h.status_code == 200 and h_data.get("layers_ready") is True,
        f"layers_ready={h_data.get('layers_ready')}, status={h_data.get('status')}"
    )

    # ------------------------------------------------------------------------
    # Task 8: Catalog Discovery & Mapping Rationales
    # ------------------------------------------------------------------------
    print("\n--- Test Suite 8: GET /api/layers Catalog & Mapping Rationales ---")
    res_cat = client.get("/api/layers")
    cat_data = res_cat.get_json()
    layers_list = cat_data.get("layers", [])
    has_4 = len(layers_list) == 4
    has_rationales = all(
        bool(l.get("sonification_mapping", {}).get("rationale"))
        for l in layers_list
    )
    record_result(
        "GET /api/layers contains all 4 layers with sonification mapping rationales",
        res_cat.status_code == 200 and has_4 and has_rationales,
        f"count={len(layers_list)}, has_rationales={has_rationales}"
    )

    print("\n" + "=" * 80)
    print(f"RESULTS SUMMARY: {PASS_COUNT} PASSED, {FAIL_COUNT} FAILED")
    print("=" * 80)
    if FAIL_COUNT > 0:
        sys.exit(1)


if __name__ == "__main__":
    run_probes()
