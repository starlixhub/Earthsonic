"""
tests/test_spaceapps_winner.py
Pytest suite verifying NASA Space Apps Challenge Winner features.
"""

from pathlib import Path


def test_html_contains_spaceapps_winner_elements():
    html_path = Path("frontend/index.html")
    assert html_path.exists(), "frontend/index.html must exist"
    content = html_path.read_text(encoding="utf-8")

    assert 'id="btn-judge-tour"' in content
    assert 'GUIDED MISSION (45s)' in content
    assert 'id="btn-open-sensors"' in content
    assert 'id="btn-export-wav"' in content


def test_tour_module_structure():
    tour_path = Path("frontend/js/ui/guided_tour.js")
    assert tour_path.exists(), "guided_tour.js must exist"
    content = tour_path.read_text(encoding="utf-8")

    assert "TOUR_CHAPTERS" in content
    assert "GuidedMissionTour" in content
    assert "1980-01" in content
    assert "1988-01" in content
    assert "1997-11" in content
    assert "2012-09" in content
    assert "2024-06" in content


def test_exporter_module_structure():
    exporter_path = Path("frontend/js/audio/exporter.js")
    assert exporter_path.exists(), "exporter.js must exist"
    content = exporter_path.read_text(encoding="utf-8")

    assert "exportMixerToWav" in content
    assert "audioBufferToWav" in content
    assert "interleaveChannels" in content
    assert "RIFF" in content
    assert "WAVE" in content


def test_sensor_spec_module_structure():
    spec_path = Path("frontend/js/ui/dimensional_spec.js")
    assert spec_path.exists(), "dimensional_spec.js must exist"
    content = spec_path.read_text(encoding="utf-8")

    assert "DimensionalSpecDrawer" in content
    assert "OCO-2" in content
    assert "MODIS-TEMP" in content
    assert "AMSR2-ICE" in content
    assert "JASON3-OHT" in content


def test_open_science_verified_badge():
    panel_path = Path("frontend/js/ui/panel.js")
    assert panel_path.exists(), "panel.js must exist"
    content = panel_path.read_text(encoding="utf-8")

    assert "NASA OPEN SCIENCE VERIFIED" in content
    assert "SHA-256 VALIDATED" in content
    assert "0% SYNTHETIC DATA" in content
