# Project: EARTHSONIC "Terminator Skim" VR Mode & JPL Mission Console Aesthetic

## Architecture
EARTHSONIC is upgraded with a high-fidelity capability showcase featuring:
1. **2D JPL Mission Console HUD**: High-precision flat dark mission console palette, IBM Plex typography, semantic controls, outline icons, zero gradients/shadows, preserving all existing DOM/CSS test contracts.
2. **Backend LAN IP & Mobile QR Bridge**: Flask binding to `0.0.0.0` with `GET /api/vr-launch-info` (UDP connect trick to 8.8.8.8:80), zero-CDN HTML5 canvas QR generator, desktop launch modal, and mobile `/?vr=1` auto-fullscreen launcher with audio unlock and orientation lock.
3. **Normalized 3D Planetary Scene Graph**: Normalized units (`EARTH_RADIUS = 10.0`, skim altitude 10.22, near = 0.05, far = 250.0), `ACESFilmicToneMapping`, 573-month `CatmullRomCurve3` TimeSpline, IcosahedronGeometry EarthGroup, CloudLayer, AtmosphereShell, IceCapGroup, TerminatorRibbon, OceanGlowField, Gaia deep-sky starfield skybox, mobile texture budget (<= 4096x2048, 25.17 MB VRAM).
4. **4-Channel Audio-Reactive Physical Shaders**: AnalyserNodes (fftSize = 256, `uAudioEnvelope` 0..1) driving GISTEMP v4 TerminatorRibbon color ramp, Mauna Loa AtmosphereShell limb scattering haze, NOAA NCEI OceanGlowField subsurface Fresnel pulse (strictly masked to ocean), and NSIDC IceCapGroup polar rim displacement.
5. **Controller-Free Glider Navigation & Diegetic Gaze Glyphs**: Gyroscope yaw / mouse drag with +/-15 deg deadzone, damped acceleration along TimeSpline, 100% locked horizontal horizon (zero roll/bank); DataGlyphs[0..3] on -18 deg horizon arc with 600ms raycast gaze dwell ring fill and solo/mute toggling.
6. **3D HRTF Spatial Audio**: Web Audio AudioListener on VR camera; 4 HRTF PannerNodes (`panningModel = 'HRTF'`, `refDistance = 2.0`, `rolloffFactor = 1.2`) dynamically matching DataGlyphs 3D world positions with microsecond sample sync.
7. **Minimal Chrome-Free VR Screen**: Total 2D chrome isolation, diegetic 1.5s zenith gaze exit, 3s fading onboarding prompt, amber ring loading spinner, dual-mode WebXR + side-by-side stereo scissor fallback (`eyeSep = 0.064`).
8. **Preservation & Non-Regression**: 100% preservation of all 656 existing pytest tests, all 71 node tests, all Flask API endpoints, and STRAUSS sonification pipelines.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | JPL 2D Color Palette | #060a12 bg, #0b1220 surface, #1b2636 hairlines, #ff8a3d primary amber, #6fe3ff secondary cyan, #dce6f2 text, #7b8ba3 labels | M1 | R1 |
| 2 | JPL Typography & Styling | IBM Plex Mono for telemetry/badges; IBM Plex Sans for body/controls; remove box-shadows & gradients; >=44px touch targets | M1 | R1 |
| 3 | Semantic HTML & Outlines | Semantic `<button>`/`<a>`/`<input>`, Tabler outline icons, visible focus states, zero emoji | M1 | R1 |
| 4 | Test Contract Invariants | Preserve `#telemetry-matrix-grid`, Unicode bullet, `#070709`, slider tracks `#18181b` & thumb `#f4f4f5`, tour buttons | M1 | R1, R8 |
| 5 | LAN IP Discovery Endpoint | Flask `GET /api/vr-launch-info` returning `{"vr_url": "http://<LAN_IP>:<PORT>/?vr=1"}` via UDP connect trick | M1 | R7 |
| 6 | Zero-CDN QR Generator | HTML5 canvas/SVG QR matrix generator rendering scannable QR in `#vr-desktop-modal` | M1 | R7 |
| 7 | Desktop Launch Modal | JPL-styled modal with scannable QR code, copyable link, and `[ ENTER SPLIT-SCREEN VR ON THIS PC ]` button | M1 | R7 |
| 8 | Mobile Launcher Overlay | `/?vr=1` tap-to-lock button handling audio unlock, motion permission, fullscreen, and orientation lock | M1 | R7 |
| 9 | Normalized Planetary Scale | `EARTH_RADIUS = 10.0`, skim altitude 10.22, near = 0.05, far = 250.0, ACESFilmicToneMapping (exposure = 1.0), zero z-fighting | M2 | R2 |
| 10 | Real Dataset Textures | NASA Blue Marble diffuse, Black Marble VIIRS night emissive, MODIS clouds, GEBCO elevation, NSIDC ice extent | M2 | R2 |
| 11 | Gaia Deep Starfield Skybox | NASA SVS Gaia + Hipparcos equirectangular deep-sky map, no procedural point scatter | M2 | R2 |
| 12 | 4-Stem AnalyserNodes | AnalyserNode (fftSize = 256, `uAudioEnvelope` 0..1) on each of the 4 mixer tracks | M2 | R3 |
| 13 | TerminatorRibbon Shader | Curves along day/night boundary (`cross(sunDir, surfaceNormal)`), cobalt to amber-red ramp, noise displacement | M2 | R3 |
| 14 | AtmosphereShell Shader | Scale 1.025, Mie + Rayleigh limb scattering driven by `uCO2Ppm` (336 to 426+ ppm) shifting blue to amber-ochre haze | M2 | R3 |
| 15 | OceanGlowField Shader | Subsurface Fresnel bioluminescent shader strictly masked to ocean pixels (`waterMask > 0.5`) pulsing with `uOHC` and `uAudioEnvelope` | M2 | R3 |
| 16 | IceCapGroup Shader | Dynamic polar cap displacement and boundary alpha tracking NSIDC monthly data with IOR = 1.31 rim lighting | M2 | R3 |
| 17 | TimeSpline Trajectory | `THREE.CatmullRomCurve3` parameterized across 573 continuous monthly records (1979-2026) | M2 | R2, R4 |
| 18 | Inertial Yaw Glider Navigation | Gyroscope yaw / mouse drag with +/-15 deg deadzone; damped acceleration `timelineVelocity += yawExcess * 0.0004; *= 0.92;` | M3 | R4 |
| 19 | 100% Locked Horizon | Zero roll/bank at all times during flight to prevent VR motion sickness | M3 | R4 |
| 20 | Diegetic Gaze Glyphs | DataGlyphs[0..3] on -18 deg horizon arc; 600ms raycast dwell fills ring shader (`uProgress: 0..1`) and toggles stem solo/mute | M3 | R4 |
| 21 | 3D HRTF Spatial Audio Routing | Camera AudioListener; 4 HRTF PannerNodes (`refDistance = 2.0`, `rolloffFactor = 1.2`) tracking DataGlyphs world positions | M3 | R5 |
| 22 | Timeline & Audio Playhead Sync | Seamless lockstep synchronization between glider timeline position and Web Audio playback | M3 | R4, R5 |
| 23 | Minimal Chrome-Free VR Isolation | Total hiding of all 2D chrome (.mission-header, .globe-hud-overlay, .orchestra-dock, sliders, labels, readouts, debug counters) | M4 | R6 |
| 24 | Diegetic Zenith Gaze Exit | 1.5s sustained gaze at zenith (pitch >= +75 deg) exits VR cleanly; zero floating exit buttons | M4 | R6 |
| 25 | Fading Onboarding Prompt | "Look to steer. Hold gaze to select." displays for ~3s on first VR entry, then fades completely | M4 | R6 |
| 26 | Amber Ring Loading State | Single centered amber ring spinner on black for loading / mode transition | M4 | R6 |
| 27 | Dual-Mode VR Renderer | WebXR `immersive-vr` + manual dual-eye `renderer.setScissor` side-by-side stereo pass (`eyeSep = 0.064`) | M4 | R2, R6 |
| 28 | Comprehensive E2E Test Suite | Automated test suite verifying R1-R7 across all 4 tiers (Feature, Boundary, Combinations, Real-World) | M5 | E2E Track |
| 29 | Adversarial Coverage Hardening | Tier 5 white-box stress testing, edge-case generation, and Forensic Integrity Audit verification | M5 | R8 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | JPL Console Theme & Mobile QR Bridge | Features 1, 2, 3, 4, 5, 6, 7, 8 (2D Theme, QR modal, Flask LAN IP, launcher overlay, preservation) | none | DONE |
| M2 | Normalized Scene Graph & Planetary Shaders | Features 9, 10, 11, 12, 13, 14, 15, 16, 17 (Orbital scale, shaders, assets, AnalyserNodes, TimeSpline) | M1 | DONE |
| M3 | Glider Navigation & 3D HRTF Spatial Audio | Features 18, 19, 20, 21, 22 (Inertial yaw glider, deadzone, horizon lock, gaze glyphs, HRTF panners) | M2 | DONE |
| M4 | Chrome-Free VR Screen & Dual Stereo Pipeline | Features 23, 24, 25, 26, 27 (Chrome isolation, zenith exit, onboarding prompt, WebXR + scissor stereo) | M3 | DONE |
| M5 | Final Milestone: E2E Test Suite & Adversarial Audit | Features 28, 29 (100% pass of E2E suite, 656 pytest, 71 node, Tier 5 hardening, Forensic Audit CLEAN) | M4 | DONE |

## Interface Contracts
### M1 ↔ M2, M3, M4 (VR Trigger Contract)
- Button `#btn-enter-vr` in top bar triggers modal `#vr-desktop-modal` on desktop or initiates VR on mobile.
- `GET /api/vr-launch-info` returns `{ "vr_url": "http://<LAN_IP>:<PORT>/?vr=1" }`.
- Direct URL `/?vr=1` activates `#mobile-vr-launcher` overlay with `[ TAP TO LOCK LANDSCAPE & INSERT INTO VR HEADSET ]`.
- Upon tap / launch confirmation, calls `window.earthsonicVR.enterVR({ mode: 'auto' | 'stereo' | 'webxr' })`.

### M2 ↔ M3 (Scene Graph & Audio Contract)
- `window.earthsonicVR` exposes `cameraRig`, `camera`, `timeSpline`, `dataGlyphs[4]`, `updateTimeline(t)`.
- `EarthOrchestraMixer` provides `getTrackAnalyser(trackId)` returning `AnalyserNode` with `fftSize = 256`.
- Each frame, shader uniforms `uAudioEnvelope`, `uAnomalyValue`, `uCO2Ppm`, `uOHC`, `uIceExtent` update from the active month record and analyser envelopes.

### M3 ↔ M4 (Interaction & Audio Spatialization Contract)
- `DataGlyphs[i]` maintain world coordinates along the -18 deg horizon arc.
- `mixer.tracks[i]` connects through `pannerNode` with `panningModel = 'HRTF'`, `refDistance = 2.0`, `rolloffFactor = 1.2`, synced to `DataGlyphs[i].getWorldPosition()`.
- Gaze raycaster inspects intersection with `DataGlyphs[i]`. When dwell >= 600ms, calls `mixer.toggleTrackMute(trackId)` and pulses glyph.

### M4 ↔ M5 (VR Screen Isolation & Test Contract)
- `.vr-mode-active` class added to `<body>` cleanly hides all 2D UI elements.
- Diegetic zenith gaze (> 75 deg pitch for 1.5s) triggers `window.earthsonicVR.exitVR()`.
- All existing 2D tests pass against the unmodified 2D DOM tree.

## Code Layout
- `backend/app.py`: Flask backend, `GET /api/vr-launch-info`, host `0.0.0.0`
- `frontend/index.html`: 2D markup, VR button `#btn-enter-vr`, desktop QR modal `#vr-desktop-modal`, mobile launcher `#mobile-vr-launcher`
- `frontend/css/main.css`, `frontend/css/globe.css`, `frontend/css/orchestra.css`: JPL dark mission-console styling, `.vr-mode-active` isolation rules
- `frontend/js/ui/qrcode.js`: Zero-CDN pure JS QR matrix rendering to HTML5 canvas
- `frontend/js/ui/vr_launcher.js`: Desktop modal handling, LAN IP fetching, mobile launch gesture
- `frontend/js/globe/vr/`: VR subsystem modules:
  - `vr_scene.js`: Normalized planetary scale (R=10.0, alt=10.22, near=0.05, far=250), CameraRig, EarthGroup, Starfield
  - `vr_shaders.js`: TerminatorRibbon, AtmosphereShell, OceanGlowField, IceCapGroup shaders
  - `vr_glider.js`: Gyroscope / mouse drag inertial timeline glider with +/-15 deg deadzone, horizon lock, TimeSpline
  - `vr_gaze.js`: Raycasting, 600ms gaze dwell progress ring, 1.5s zenith exit detection
  - `vr_audio.js`: AudioListener, 4 HRTF PannerNodes bound to DataGlyphs
  - `vr_renderer.js`: WebXR session manager + dual-eye `renderer.setScissor` side-by-side stereo fallback (`eyeSep = 0.064`)
- `tests/`: Automated pytest suites, node suites, and E2E verification suites
