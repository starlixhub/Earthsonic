# Earthsonic

Earthsonic is a NASA Space Apps "Earth Information Jukebox" that transforms real NASA and NOAA planetary climate data into an interactive, multi-sensory experience. Real-world climate indicators and Earth observations are sonified through dynamic audio synthesis and rendered onto an explorable 3D and Virtual Reality (VR) Earth powered by Babylon.js.

## Real Data Sources

- **GISTEMP**: NASA GISS Surface Temperature Analysis (global temperature anomaly trends and gridded anomalies)
- **Mauna Loa CO2**: NOAA Global Monitoring Laboratory atmospheric carbon dioxide records
- **NOAA NCEI OHC**: NOAA National Centers for Environmental Information Ocean Heat Content
- **NSIDC Sea Ice**: National Snow and Ice Data Center Arctic and Antarctic sea ice extent
- **Blue Marble**: NASA Earth Observatory day-side global surface imagery
- **Black Marble**: NASA Earth Observatory night lights (VIIRS Day/Night Band)
- **GEBCO**: General Bathymetric Chart of the Oceans elevation and bathymetry data
- **Gaia / Hipparcos**: ESA Gaia and Hipparcos stellar astrometry catalogs for accurate 3D celestial starfields

## Run Instructions

1. Ensure Python 3.10+ is installed.
2. Launch the application:
   ```bash
   py run.py
   ```
3. Open the printed URL (default: `http://localhost:8000` or the port displayed in your terminal) in any modern web browser or WebXR-compatible VR headset.
