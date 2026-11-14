r"""
tests/test_vr_launch_api.py
Tests for GET /api/vr-launch-info endpoint:
  - Verifies HTTP 200 status code
  - Verifies JSON structure contains valid 'vr_url'
  - Verifies URL matches regex ^http://.+:\d+/\?vr=1$
  - Verifies UDP discovery mock behavior
  - Verifies fallback to request.host when UDP discovery fails
  - Verifies fallback to loopback (127.0.0.1) when request.host is 0.0.0.0
  - Verifies CORS headers
  - Verifies /api catalog inclusion of /api/vr-launch-info
"""

import re
import pytest
from unittest.mock import patch
from backend.app import create_app
from backend.config import TestingConfig


@pytest.fixture(scope="module")
def client():
    app = create_app(TestingConfig)
    with app.test_client() as test_client:
        yield test_client


class TestVRLaunchInfoAPI:
    """Contract tests for GET /api/vr-launch-info."""

    def test_vr_launch_info_status_and_json(self, client):
        """Verify endpoint returns 200 and a valid vr_url matching the required regex."""
        res = client.get("/api/vr-launch-info")
        assert res.status_code == 200
        assert res.is_json
        data = res.get_json()
        assert "vr_url" in data
        assert isinstance(data["vr_url"], str)
        pattern = r"^http://.+:\d+/\?vr=1$"
        assert re.match(pattern, data["vr_url"]) is not None, f"URL {data['vr_url']} does not match pattern {pattern}"

    def test_vr_launch_info_udp_discovery_mocked(self, client):
        """Verify endpoint embeds discovered LAN IP in vr_url when UDP discovery succeeds."""
        with patch("backend.app.get_primary_lan_ip", return_value="192.168.1.142"):
            res = client.get("/api/vr-launch-info")
            assert res.status_code == 200
            data = res.get_json()
            assert "vr_url" in data
            assert data["vr_url"].startswith("http://192.168.1.142:")
            assert data["vr_url"].endswith("/?vr=1")
            pattern = r"^http://.+:\d+/\?vr=1$"
            assert re.match(pattern, data["vr_url"]) is not None

    def test_vr_launch_info_fallback_to_request_host(self, client):
        """Verify fallback to request.host when UDP discovery fails."""
        with patch("backend.app.get_primary_lan_ip", return_value=None):
            res = client.get("/api/vr-launch-info", headers={"Host": "192.168.10.50:8000"})
            assert res.status_code == 200
            data = res.get_json()
            assert data["vr_url"] == "http://192.168.10.50:8000/?vr=1"
            pattern = r"^http://.+:\d+/\?vr=1$"
            assert re.match(pattern, data["vr_url"]) is not None

    def test_vr_launch_info_fallback_loopback_on_unspecified_host(self, client):
        """Verify fallback to 127.0.0.1 loopback when UDP discovery fails and host is 0.0.0.0."""
        with patch("backend.app.get_primary_lan_ip", return_value=None):
            res = client.get("/api/vr-launch-info", headers={"Host": "0.0.0.0:5000"})
            assert res.status_code == 200
            data = res.get_json()
            assert data["vr_url"] == "http://127.0.0.1:5000/?vr=1"
            pattern = r"^http://.+:\d+/\?vr=1$"
            assert re.match(pattern, data["vr_url"]) is not None

    def test_vr_launch_info_cors_headers(self, client):
        """Verify CORS headers are returned on /api/vr-launch-info."""
        res = client.get("/api/vr-launch-info")
        assert res.status_code == 200
        assert res.headers.get("Access-Control-Allow-Origin") == "*"
        assert "GET" in res.headers.get("Access-Control-Allow-Methods", "")

    def test_api_catalog_includes_vr_launch_endpoint(self, client):
        """Verify /api catalog includes /api/vr-launch-info alongside all 11 existing endpoints."""
        res = client.get("/api")
        assert res.status_code == 200
        data = res.get_json()
        assert "endpoints" in data
        endpoints = data["endpoints"]
        assert "/api/vr-launch-info" in endpoints

        # Check all 11 original endpoints are preserved
        expected_endpoints = [
            "/api/health",
            "/api/datasets",
            "/api/datasets/<dataset_id>",
            "/api/timeseries/<dataset_id>",
            "/api/timeseries/harmonized",
            "/api/timeseries/zonal",
            "/api/sonify/<dataset_id>",
            "/api/sonify/orchestra",
            "/api/sonify/differential",
            "/api/comparison",
            "/api/sonification/explanations",
            "/api/vr-launch-info",
        ]
        for ep in expected_endpoints:
            assert ep in endpoints, f"Expected endpoint {ep} missing from /api catalog"
        assert len(endpoints) == 12
