"""
tests/test_layers_api.py
Comprehensive contract tests for EARTHSONIC NASA SVS/EIC Layers API:
  - GET /api/health (with layers_ready: bool)
  - GET /api/layers (layer catalog & metadata)
  - GET /api/layers/<id> (layer JSON data with {meta, columns, events})
  - GET /api/layers/<id>/sonify?duration=20 (cached 44.1 kHz stereo WAV)
  - Schema validation across all 4 NASA layers
  - Strict 0..1 bounds verification on all column metrics
  - Checksum presence in data/checksums.sha256 and metadata in data/processed/metadata.json
  - Robustness & error handling (404, 400, boundary clamping)
  - Non-regression of existing climate endpoints
"""

import hashlib
import io
import json
import os
import wave
from pathlib import Path

import pytest
from backend.app import create_app
from backend.config import TestingConfig

# Progressive testability check: determine if layers blueprint is registered
try:
    import backend.routes.layers as layers_module
    LAYERS_ROUTE_AVAILABLE = True
except ImportError:
    LAYERS_ROUTE_AVAILABLE = False
    layers_module = None

pytestmark = pytest.mark.skipif(
    not LAYERS_ROUTE_AVAILABLE,
    reason="backend.routes.layers not yet implemented (Milestone 3)"
)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
PROCESSED_LAYERS_DIR = DATA_DIR / "processed" / "layers"
CHECKSUMS_FILE = DATA_DIR / "checksums.sha256"
METADATA_FILE = DATA_DIR / "processed" / "metadata.json"

REQUIRED_LAYER_IDS = [
    "night_lights",
    "lightning",
    "gedi_forest",
    "co2_dyamond"
]


@pytest.fixture(scope="module")
def client():
    """Create Flask test client configured for testing."""
    app = create_app(TestingConfig)
    with app.test_client() as test_client:
        yield test_client


class TestTier1FeatureCoverage:
    """Tier 1: Feature Coverage — Primary happy-path contracts for all layer endpoints."""

    def test_health_endpoint_includes_layers_ready(self, client):
        """GET /api/health returns HTTP 200 and includes layers_ready boolean."""
        res = client.get("/api/health")
        assert res.status_code == 200
        data = res.get_json()

        assert "status" in data
        assert "datasets_ready" in data
        assert "layers_ready" in data, "GET /api/health must include 'layers_ready' field"
        assert isinstance(data["layers_ready"], bool), "'layers_ready' must be a boolean"

    def test_list_layers_catalog(self, client):
        """GET /api/layers returns HTTP 200 and list of all 4 NASA SVS layers."""
        res = client.get("/api/layers")
        assert res.status_code == 200
        data = res.get_json()

        assert "layers" in data or "layers_list" in data, "Response must contain 'layers' catalog"
        layers = data.get("layers") or data.get("layers_list")
        assert isinstance(layers, (list, dict)), "'layers' must be list or dictionary"

        # Extract list of layer IDs
        if isinstance(layers, dict):
            layer_ids = list(layers.keys())
        else:
            layer_ids = [l["id"] for l in layers if "id" in l]

        for req_id in REQUIRED_LAYER_IDS:
            assert req_id in layer_ids, f"Required layer '{req_id}' missing from /api/layers catalog"

    def test_get_single_layer_json_schema(self, client):
        """GET /api/layers/<id> returns HTTP 200 with {meta, columns, events} schema."""
        for layer_id in REQUIRED_LAYER_IDS:
            res = client.get(f"/api/layers/{layer_id}")
            assert res.status_code == 200, f"GET /api/layers/{layer_id} failed with {res.status_code}"
            data = res.get_json()

            # Schema validation
            assert "meta" in data, f"Layer {layer_id} missing 'meta'"
            assert "columns" in data, f"Layer {layer_id} missing 'columns'"
            assert "events" in data, f"Layer {layer_id} missing 'events'"

            # Metadata validation
            meta = data["meta"]
            for field in ["id", "source_name", "agency", "bounds", "frame_count"]:
                assert field in meta, f"Layer {layer_id} meta missing required field '{field}'"
            assert meta["id"] == layer_id, f"Meta ID mismatch: expected {layer_id}, got {meta['id']}"

            # Columns count validation (720 equirectangular columns)
            cols = data["columns"]
            assert len(cols) == 720, f"Layer {layer_id} must have exactly 720 columns, got {len(cols)}"

    def test_layer_sonify_default_duration(self, client):
        """GET /api/layers/<id>/sonify?duration=20 returns HTTP 200 and valid WAV audio."""
        for layer_id in REQUIRED_LAYER_IDS:
            res = client.get(f"/api/layers/{layer_id}/sonify?duration=20")
            assert res.status_code == 200, f"Sonify failed for {layer_id} with {res.status_code}"
            assert "audio/wav" in res.headers.get("Content-Type", ""), (
                f"Expected Content-Type audio/wav, got {res.headers.get('Content-Type')}"
            )

            # Check RIFF/WAVE header
            wav_bytes = res.data
            assert wav_bytes.startswith(b"RIFF"), "Sonify stream must start with RIFF"
            assert b"WAVE" in wav_bytes[:16], "Sonify stream must contain WAVE format identifier"

            with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
                assert wf.getnchannels() == 2, f"Expected stereo (2 channels), got {wf.getnchannels()}"
                assert wf.getsampwidth() == 2, f"Expected 16-bit PCM (2 bytes/sample), got {wf.getsampwidth()}"
                assert wf.getframerate() == 44100, f"Expected 44.1 kHz sample rate, got {wf.getframerate()}"


class TestTier2BoundaryAndCornerCases:
    """Tier 2: Boundary & Corner Conditions — Error handling, bounds, and extreme values."""

    def test_unknown_layer_returns_404(self, client):
        """Requesting non-existent layer ID returns HTTP 404."""
        res = client.get("/api/layers/unknown_layer_slug_xyz_999")
        assert res.status_code == 404
        data = res.get_json()
        assert "error" in data or "message" in data

        res_sonify = client.get("/api/layers/unknown_layer_slug_xyz_999/sonify")
        assert res_sonify.status_code == 404

    def test_sonify_duration_validation(self, client):
        """Duration parameter validation: zero and negative durations return HTTP 400."""
        # Duration 0
        res0 = client.get("/api/layers/night_lights/sonify?duration=0")
        assert res0.status_code in [400, 422], f"Duration 0 should return 400/422, got {res0.status_code}"

        # Negative duration
        res_neg = client.get("/api/layers/night_lights/sonify?duration=-10")
        assert res_neg.status_code in [400, 422], f"Negative duration should return 400/422, got {res_neg.status_code}"

        # Non-numeric duration
        res_str = client.get("/api/layers/night_lights/sonify?duration=invalid_number")
        assert res_str.status_code in [400, 422], f"Non-numeric duration should return 400/422, got {res_str.status_code}"

        # NaN and Inf durations (adversarial edge case)
        res_nan = client.get("/api/layers/night_lights/sonify?duration=NaN")
        assert res_nan.status_code in [400, 422], f"NaN duration should return 400/422, got {res_nan.status_code}"
        data_nan = res_nan.get_json()
        assert data_nan.get("status") == "error"

        res_inf = client.get("/api/layers/night_lights/sonify?duration=inf")
        assert res_inf.status_code in [400, 422], f"Inf duration should return 400/422, got {res_inf.status_code}"
        data_inf = res_inf.get_json()
        assert data_inf.get("status") == "error"

    def test_column_metrics_strict_0_to_1_bounds(self, client):
        """Every column metric across all 4 layers must strictly satisfy 0.0 <= x <= 1.0."""
        for layer_id in REQUIRED_LAYER_IDS:
            res = client.get(f"/api/layers/{layer_id}")
            assert res.status_code == 200
            data = res.get_json()
            cols = data["columns"]

            for i, col in enumerate(cols):
                assert col["col_index"] == i, f"Column index mismatch at position {i}"
                expected_lon = -180.0 + i * 0.5
                assert abs(col["lon"] - expected_lon) < 1e-3, f"Col {i} lon mismatch: {col['lon']} vs {expected_lon}"

                # Metric bounds check
                for metric in ["luminance", "hue", "density", "vertical_centroid"]:
                    val = col.get(metric)
                    assert val is not None, f"Col {i} of layer {layer_id} missing metric '{metric}'"
                    assert 0.0 <= val <= 1.0, (
                        f"Layer {layer_id} col {i} metric '{metric}' value {val} out of strict [0.0, 1.0] bounds"
                    )

    def test_events_bounds_and_structure(self, client):
        """Lightning layer discrete events must have valid coordinate and intensity bounds."""
        res = client.get("/api/layers/lightning")
        assert res.status_code == 200
        data = res.get_json()
        events = data.get("events", [])

        for idx, ev in enumerate(events):
            assert -180.0 <= ev["lon"] <= 180.0, f"Event {idx} lon {ev['lon']} out of [-180, 180]"
            assert -90.0 <= ev["lat"] <= 90.0, f"Event {idx} lat {ev['lat']} out of [-90, 90]"
            assert 0.0 <= ev["intensity"] <= 1.0, f"Event {idx} intensity {ev['intensity']} out of [0, 1]"


class TestTier3CrossFeatureAndIntegrity:
    """Tier 3: Cross-Feature Combinations — Checksum audit & NASA data authenticity."""

    def test_checksum_presence_in_checksums_sha256(self):
        """Verifies that all processed layer files have recorded hashes in data/checksums.sha256."""
        assert CHECKSUMS_FILE.exists(), f"Missing checksums file: {CHECKSUMS_FILE}"
        checksum_text = CHECKSUMS_FILE.read_text(encoding="utf-8")

        for layer_id in REQUIRED_LAYER_IDS:
            layer_path = PROCESSED_LAYERS_DIR / f"{layer_id}.json"
            if not layer_path.exists():
                pytest.skip(f"Processed layer file {layer_path} not yet generated")

            # Calculate SHA-256 of file on disk
            content_bytes = layer_path.read_bytes()
            computed_sha256 = hashlib.sha256(content_bytes).hexdigest()

            # Assert computed hash is registered in data/checksums.sha256
            assert computed_sha256 in checksum_text, (
                f"Computed SHA-256 {computed_sha256} for {layer_id}.json not found in data/checksums.sha256"
            )

    def test_metadata_json_catalog_synchronization(self):
        """Verifies that data/processed/metadata.json catalogues all NASA layers."""
        if not METADATA_FILE.exists():
            pytest.skip("data/processed/metadata.json does not exist")

        with open(METADATA_FILE, "r", encoding="utf-8") as f:
            metadata = json.load(f)

        # Check if layers are integrated under datasets or layers key
        catalog = metadata.get("layers") or metadata.get("datasets") or metadata
        for layer_id in REQUIRED_LAYER_IDS:
            if isinstance(catalog, dict):
                assert layer_id in catalog or any(l.get("id") == layer_id for l in catalog.values() if isinstance(l, dict)), (
                    f"Layer {layer_id} missing from data/processed/metadata.json"
                )

    def test_sonify_caching_and_deterministic_response(self, client):
        """Repeated sonify calls for same layer & duration return identical deterministic audio."""
        res1 = client.get("/api/layers/night_lights/sonify?duration=5")
        assert res1.status_code == 200

        res2 = client.get("/api/layers/night_lights/sonify?duration=5")
        assert res2.status_code == 200

        assert res1.data == res2.data, "Audio sonification must be deterministic and cached"


class TestTier4RealWorldScenarios:
    """Tier 4: Real-World Application Scenarios — End-to-end workflows & non-regression."""

    def test_earth_jukebox_end_to_end_audition_flow(self, client):
        """E2E Workflow: Discover layers, inspect metadata, verify NASA credits, and stream audio."""
        # 1. Health check
        res_h = client.get("/api/health")
        assert res_h.status_code == 200
        assert res_h.get_json()["status"] == "healthy"

        # 2. Layer discovery
        res_l = client.get("/api/layers")
        assert res_l.status_code == 200
        layers_data = res_l.get_json()

        # 3. For each layer: verify detail and sonify stream
        for layer_id in REQUIRED_LAYER_IDS:
            res_detail = client.get(f"/api/layers/{layer_id}")
            assert res_detail.status_code == 200
            detail = res_detail.get_json()
            assert detail["meta"]["id"] == layer_id

            # Sonify short sample
            res_audio = client.get(f"/api/layers/{layer_id}/sonify?duration=3")
            assert res_audio.status_code == 200
            assert len(res_audio.data) > 1000

    def test_preservation_of_existing_climate_endpoints(self, client):
        """Guarantees non-regression: All 4 existing datasets continue returning HTTP 200."""
        # Datasets list
        res_d = client.get("/api/datasets")
        assert res_d.status_code == 200
        datasets = res_d.get_json()["datasets"]
        for existing_id in ["global_surface_temperature", "atmospheric_co2", "ocean_temperature", "sea_ice_extent"]:
            assert existing_id in datasets, f"Existing dataset {existing_id} was removed"

        # Timeseries endpoint
        res_ts = client.get("/api/timeseries/harmonized")
        assert res_ts.status_code == 200
        assert res_ts.get_json()["total_months"] == 573
