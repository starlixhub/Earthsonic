"""
tests/test_api.py
Comprehensive contract tests for EARTHSONIC Flask REST API endpoints:
  - GET /api/health
  - GET /api/datasets
  - GET /api/datasets/<dataset_id>
  - GET /api/timeseries/<dataset_id>
  - GET /api/timeseries/harmonized
  - GET /api/timeseries/zonal
  - Query parameter filtering (start/end)
  - Error handling & CORS validation
"""

import pytest
from backend.app import create_app
from backend.config import TestingConfig


@pytest.fixture(scope="module")
def client():
    app = create_app(TestingConfig)
    with app.test_client() as test_client:
        yield test_client


class TestHealthAndDiscovery:
    """Verifies service health and root discovery endpoints."""

    def test_health_endpoint(self, client):
        res = client.get("/api/health")
        assert res.status_code == 200
        data = res.get_json()
        assert data["status"] == "healthy"
        assert data["datasets_ready"] is True
        assert data["total_harmonized_months"] == 573
        assert "NASA/NOAA" in data["authenticity_verification"]

    def test_api_index(self, client):
        res = client.get("/api")
        assert res.status_code == 200
        data = res.get_json()
        assert "endpoints" in data
        assert "/api/datasets" in data["endpoints"]
        assert "/api/timeseries/harmonized" in data["endpoints"]

    def test_root_index(self, client):
        res = client.get("/")
        assert res.status_code == 200

    def test_cors_headers_present(self, client):
        res = client.get("/api/health")
        assert res.headers.get("Access-Control-Allow-Origin") == "*"
        assert "GET" in res.headers.get("Access-Control-Allow-Methods", "")

    def test_404_json_error(self, client):
        res = client.get("/api/non_existent_route_404")
        assert res.status_code == 404
        data = res.get_json()
        assert data["error"] == "Not Found"


class TestDatasetCatalogAPI:
    """Verifies dataset catalog and metadata endpoints."""

    def test_list_all_datasets(self, client):
        res = client.get("/api/datasets")
        assert res.status_code == 200
        data = res.get_json()
        assert "datasets" in data
        datasets = data["datasets"]

        required = [
            "global_surface_temperature",
            "atmospheric_co2",
            "ocean_temperature",
            "sea_ice_extent"
        ]
        for req in required:
            assert req in datasets, f"Missing required dataset: {req}"
            info = datasets[req]
            assert "title" in info
            assert "agency" in info
            assert "units" in info
            assert "temporal_coverage" in info
            assert "sonification_mapping" in info

        assert "dataset_list" in data
        assert len(data["dataset_list"]) == 4

    def test_get_single_dataset_metadata(self, client):
        res = client.get("/api/datasets/global_surface_temperature")
        assert res.status_code == 200
        data = res.get_json()
        assert data["id"] == "global_surface_temperature"
        assert data["units"] == "°C"
        assert "1951-1980" in data["baseline"]

    def test_dataset_metadata_aliases(self, client):
        # co2 alias
        res = client.get("/api/datasets/co2")
        assert res.status_code == 200
        assert res.get_json()["id"] == "atmospheric_co2"

        # ocean alias
        res = client.get("/api/datasets/ocean")
        assert res.status_code == 200
        assert res.get_json()["id"] == "ocean_temperature"

        # sea_ice alias
        res = client.get("/api/datasets/ice")
        assert res.status_code == 200
        assert res.get_json()["id"] == "sea_ice_extent"

    def test_unknown_dataset_returns_404(self, client):
        res = client.get("/api/datasets/unknown_mars_temperature")
        assert res.status_code == 404
        data = res.get_json()
        assert "error" in data
        assert "available_datasets" in data


class TestTimeseriesAPI:
    """Verifies time series data endpoints and filtering."""

    @pytest.mark.parametrize("dataset_id,expected_unit", [
        ("global_surface_temperature", "°C"),
        ("atmospheric_co2", "ppm"),
        ("ocean_temperature", "°C"),
        ("sea_ice_extent", "million km²"),
    ])
    def test_full_timeseries_all_variables(self, client, dataset_id, expected_unit):
        res = client.get(f"/api/timeseries/{dataset_id}")
        assert res.status_code == 200
        data = res.get_json()
        assert data["dataset_id"] == dataset_id
        assert expected_unit in data["units"]
        assert data["count"] == 573
        assert data["start"] == "1979-01"
        assert data["end"] == "2026-09"

        points = data["data"]
        assert len(points) == 573
        first = points[0]
        assert first["date"] == "1979-01"
        assert first["year"] == 1979
        assert first["month"] == 1
        assert "value" in first and first["value"] is not None
        assert "normalized" in first and 0.0 <= first["normalized"] <= 1.0

    def test_timeseries_aliases(self, client):
        res = client.get("/api/timeseries/temp")
        assert res.status_code == 200
        assert res.get_json()["dataset_id"] == "global_surface_temperature"

        res = client.get("/api/timeseries/keeling")
        assert res.status_code == 200
        assert res.get_json()["dataset_id"] == "atmospheric_co2"

    def test_timeseries_date_filtering(self, client):
        # 2000-01 to 2009-12 (10 years = 120 months)
        res = client.get("/api/timeseries/co2?start=2000-01&end=2009-12")
        assert res.status_code == 200
        data = res.get_json()
        assert data["count"] == 120
        assert data["start"] == "2000-01"
        assert data["end"] == "2009-12"
        assert data["data"][0]["date"] == "2000-01"
        assert data["data"][-1]["date"] == "2009-12"

    def test_timeseries_whitespace_handling(self, client):
        res = client.get("/api/timeseries/temperature?start= 2000-01 &end= 2005-12 ")
        assert res.status_code == 200
        data = res.get_json()
        assert data["count"] == 72

    def test_timeseries_start_only_filter(self, client):
        res = client.get("/api/timeseries/ocean_temp?start=2024-01")
        assert res.status_code == 200
        data = res.get_json()
        assert data["start"] == "2024-01"
        assert data["end"] == "2026-09"
        # 2024 has 12, 2025 has 12, 2026 has 9 -> 33 months
        assert data["count"] == 33

    def test_timeseries_invalid_date_format_returns_400(self, client):
        res = client.get("/api/timeseries/temperature?start=invalid-date")
        assert res.status_code == 400
        data = res.get_json()
        assert "error" in data
        assert "Invalid start format" in data["error"]

    def test_timeseries_invalid_month_returns_400(self, client):
        res = client.get("/api/timeseries/temperature?end=2020-13")
        assert res.status_code == 400
        data = res.get_json()
        assert "error" in data

    def test_timeseries_start_after_end_returns_400(self, client):
        res = client.get("/api/timeseries/temperature?start=2020-01&end=2010-01")
        assert res.status_code == 400
        data = res.get_json()
        assert "error" in data
        assert "cannot be after end" in data["error"]

    def test_timeseries_unknown_id_returns_404(self, client):
        res = client.get("/api/timeseries/unknown_sensor")
        assert res.status_code == 404
        data = res.get_json()
        assert "error" in data


class TestHarmonizedAndZonalAPI:
    """Verifies synchronized 4-track harmonized and zonal timeseries APIs."""

    def test_harmonized_default_returns_full_573_months(self, client):
        res = client.get("/api/timeseries/harmonized")
        assert res.status_code == 200
        data = res.get_json()
        assert data["period"]["total_months"] == 573
        assert len(data["months"]) == 573
        assert len(data["temperature_anomaly"]) == 573
        assert len(data["co2_ppm"]) == 573
        assert len(data["ocean_temp_anomaly"]) == 573
        assert len(data["sea_ice_extent"]) == 573
        assert len(data["records"]) == 573

    def test_harmonized_date_filtering(self, client):
        # 1990-01 to 1999-12 (10 years = 120 months)
        res = client.get("/api/timeseries/harmonized?start=1990-01&end=1999-12")
        assert res.status_code == 200
        data = res.get_json()
        assert data["period"]["total_months"] == 120
        assert len(data["months"]) == 120
        assert data["months"][0] == "1990-01"
        assert data["months"][-1] == "1999-12"

    def test_zonal_timeseries_all_bands(self, client):
        res = client.get("/api/timeseries/zonal")
        assert res.status_code == 200
        data = res.get_json()
        assert "bands" in data
        assert len(data["bands"]) == 14
        assert "64N-90N" in data["bands"]
        assert data["count"] >= 146

    def test_zonal_year_filtering(self, client):
        res = client.get("/api/timeseries/zonal?start=2000&end=2020")
        assert res.status_code == 200
        data = res.get_json()
        assert data["count"] == 21
        assert data["records"][0]["year"] == 2000
        assert data["records"][-1]["year"] == 2020

    def test_zonal_invalid_year_returns_400(self, client):
        res = client.get("/api/timeseries/zonal?start=invalid")
        assert res.status_code == 400
        data = res.get_json()
        assert "error" in data
