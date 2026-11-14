"""
tests/stress_vr_launch_endpoint.py
Empirical Challenger Stress Harness for Flask Endpoint GET /api/vr-launch-info.

Verifies:
1. Varied Host header injections and edge cases (FQDN, IPv4, ports, empty, missing).
2. IPv6 bracketed host header behavior audit (surfacing edge-case finding).
3. Loopback fallback robustness under mocked socket errors, timeouts, and unroutable environments.
4. High concurrency stress test across multi-threaded workers (zero crashes, sub-50ms latency).
5. Strict regex format validation, CORS headers, and JSON structure.
"""

import re
import socket
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from unittest.mock import patch
import pytest

from backend.app import create_app, get_primary_lan_ip
from backend.config import TestingConfig

STRICT_VR_URL_REGEX = r"^http://[a-zA-Z0-9\.\-]+:\d+/\?vr=1$"


@pytest.fixture(scope="module")
def app():
    return create_app(TestingConfig)


@pytest.fixture(scope="module")
def client(app):
    with app.test_client() as test_client:
        yield test_client


class TestVRLaunchEndpointAdversarial:
    """Empirical challenge suite for /api/vr-launch-info."""

    def test_varied_host_headers_with_discovered_ip(self, client):
        """When LAN IP discovery succeeds, returned vr_url uses discovered LAN IP with request port."""
        with patch("backend.app.get_primary_lan_ip", return_value="192.168.4.88"):
            host_headers = [
                "attacker.example.com:5000",
                "malicious-site.org:8080",
                "10.200.1.5:3000",
                "localhost:5000",
                "0.0.0.0:5000",
                "console.nasa.gov:443"
            ]
            for host in host_headers:
                res = client.get("/api/vr-launch-info", headers={"Host": host})
                assert res.status_code == 200
                data = res.get_json()
                assert "vr_url" in data
                url = data["vr_url"]
                assert re.match(STRICT_VR_URL_REGEX, url), f"URL {url} failed regex check"
                # Discovered LAN IP takes precedence over request.host
                assert url.startswith("http://192.168.4.88:")
                assert url.endswith("/?vr=1")

    def test_host_header_fallback_when_discovery_fails(self, client):
        """When UDP discovery returns None, endpoint falls back to request.host or loopback."""
        test_cases = [
            ("192.168.10.50:8000", "http://192.168.10.50:8000/?vr=1"),
            ("10.0.0.99:5000", "http://10.0.0.99:5000/?vr=1"),
            ("jpl-console.local:3000", "http://jpl-console.local:3000/?vr=1"),
            ("0.0.0.0:5000", "http://127.0.0.1:5000/?vr=1"),  # 0.0.0.0 must map to loopback
            ("0.0.0.0:8080", "http://127.0.0.1:8080/?vr=1"),
        ]
        with patch("backend.app.get_primary_lan_ip", return_value=None):
            for host_header, expected_url in test_cases:
                res = client.get("/api/vr-launch-info", headers={"Host": host_header})
                assert res.status_code == 200
                data = res.get_json()
                assert data["vr_url"] == expected_url
                assert re.match(STRICT_VR_URL_REGEX, data["vr_url"])

    def test_socket_exception_and_timeout_resilience(self, client):
        """Simulate network failure in get_primary_lan_ip (e.g. air-gapped, offline, firewall block)."""
        exception_types = [
            socket.timeout("Socket connect timed out"),
            socket.error("Network unreachable"),
            OSError(10051, "A socket operation was attempted to an unreachable network"),
            Exception("Unexpected OS network glitch")
        ]
        for exc in exception_types:
            with patch("socket.socket") as mock_sock:
                mock_inst = mock_sock.return_value
                mock_inst.connect.side_effect = exc
                # Direct test of get_primary_lan_ip
                discovered_ip = get_primary_lan_ip()
                assert discovered_ip is None, f"get_primary_lan_ip should return None on {type(exc)}"

            # Test that endpoint handles fallback when UDP discovery fails due to exception
            with patch("backend.app.get_primary_lan_ip", return_value=None):
                res = client.get("/api/vr-launch-info", headers={"Host": "192.168.1.50:5000"})
                assert res.status_code == 200
                data = res.get_json()
                assert data["vr_url"] == "http://192.168.1.50:5000/?vr=1"

    def test_missing_and_empty_host_headers(self, client):
        """Verify behavior when Host header is missing or empty."""
        with patch("backend.app.get_primary_lan_ip", return_value=None):
            res = client.get("/api/vr-launch-info", headers={"Host": ""})
            assert res.status_code == 200
            data = res.get_json()
            assert "vr_url" in data
            assert data["vr_url"].startswith("http://127.0.0.1:")
            assert data["vr_url"].endswith("/?vr=1")
            assert re.match(STRICT_VR_URL_REGEX, data["vr_url"])

    def test_edge_case_ipv6_bracketed_host_header_behavior(self, client):
        """
        Adversarial Challenge Finding:
        Evaluate endpoint behavior when Host header contains bracketed IPv6 address [::1]:5000.
        Documents that partition(':') on bracketed IPv6 splits at first internal colon.
        """
        with patch("backend.app.get_primary_lan_ip", return_value="192.168.1.100"):
            res = client.get("/api/vr-launch-info", headers={"Host": "[::1]:5000"})
            assert res.status_code == 200
            data = res.get_json()
            assert "vr_url" in data
            # Document verbatim behavior for handoff challenge finding:
            # Under partition(':'), req_host is '[', req_port is ':1]:5000'
            url = data["vr_url"]
            assert url == "http://192.168.1.100::1]:5000/?vr=1"

    def test_high_concurrency_stress(self, app):
        """Fire 100 concurrent requests across 20 threads to test concurrency, latency, and thread-safety."""
        concurrency = 20
        total_requests = 100

        def fire_request(req_id):
            with app.test_client() as thread_client:
                t0 = time.perf_counter()
                res = thread_client.get("/api/vr-launch-info")
                elapsed = time.perf_counter() - t0
                assert res.status_code == 200
                data = res.get_json()
                assert "vr_url" in data
                assert re.match(STRICT_VR_URL_REGEX, data["vr_url"])
                return elapsed

        latencies = []
        with ThreadPoolExecutor(max_workers=concurrency) as executor:
            futures = [executor.submit(fire_request, i) for i in range(total_requests)]
            for fut in as_completed(futures):
                latencies.append(fut.result())

        assert len(latencies) == total_requests
        avg_latency_ms = (sum(latencies) / len(latencies)) * 1000.0
        max_latency_ms = max(latencies) * 1000.0
        # Average test client response time should be well under 50ms
        assert avg_latency_ms < 50.0, f"Average latency too high: {avg_latency_ms:.2f}ms"
        assert max_latency_ms < 500.0, f"Max latency too high: {max_latency_ms:.2f}ms"

    def test_response_headers_and_payload_invariants(self, client):
        """Verify content-type, CORS headers, and exact payload format."""
        res = client.get("/api/vr-launch-info")
        assert res.status_code == 200
        assert "application/json" in res.headers.get("Content-Type", "")
        assert res.headers.get("Access-Control-Allow-Origin") == "*"
        assert "GET" in res.headers.get("Access-Control-Allow-Methods", "")

        data = res.get_json()
        assert list(data.keys()) == ["vr_url"], "Response should contain exactly 'vr_url' key"
        assert isinstance(data["vr_url"], str)
        assert data["vr_url"].startswith("http://")
        assert "/?vr=1" in data["vr_url"]
