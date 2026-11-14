# E2E Test Infra: EARTHSONIC VR Mode & JPL Mission Console

## Test Philosophy
- Opaque-box, requirement-driven testing derived from `ORIGINAL_REQUEST.md` and user-facing specifications.
- Completely independent of internal implementation designs.
- Methodology: Category-Partition + Boundary Value Analysis (BVA) + Pairwise Combinatorial Testing + Real-World Workload Testing across 4 tiers.

## Feature Inventory & Test Coverage Goals
| # | Feature | Source (Requirement) | Tier 1 (Feature >=5) | Tier 2 (Boundary >=5) | Tier 3 (Cross-Feature) | Tier 4 (Real-World) |
|---|---------|----------------------|:--------------------:|:---------------------:|:----------------------:|:-------------------:|
| 1 | JPL 2D Color Tokens | R1 | 5 | 5 | ✓ | ✓ |
| 2 | JPL Typography & Styling | R1 | 5 | 5 | ✓ | ✓ |
| 3 | Semantic HTML & Outlines | R1 | 5 | 5 | ✓ | ✓ |
| 4 | Preservation Invariants | R1, R8 | 5 | 5 | ✓ | ✓ |
| 5 | LAN IP Discovery Route | R7 | 5 | 5 | ✓ | ✓ |
| 6 | Zero-CDN QR Generator | R7 | 5 | 5 | ✓ | ✓ |
| 7 | Desktop Launch Modal | R7 | 5 | 5 | ✓ | ✓ |
| 8 | Mobile Launcher Overlay | R7 | 5 | 5 | ✓ | ✓ |
| 9 | Normalized Planetary Units | R2 | 5 | 5 | ✓ | ✓ |
| 10 | Real Dataset Textures | R2 | 5 | 5 | ✓ | ✓ |
| 11 | Gaia Deep Starfield Skybox | R2 | 5 | 5 | ✓ | ✓ |
| 12 | 4-Stem AnalyserNodes | R3 | 5 | 5 | ✓ | ✓ |
| 13 | TerminatorRibbon Shader | R3 | 5 | 5 | ✓ | ✓ |
| 14 | AtmosphereShell CO2 Haze | R3 | 5 | 5 | ✓ | ✓ |
| 15 | OceanGlowField Bioluminescence | R3 | 5 | 5 | ✓ | ✓ |
| 16 | IceCapGroup Polar Extent Rim | R3 | 5 | 5 | ✓ | ✓ |
| 17 | 573-Month TimeSpline | R2, R4 | 5 | 5 | ✓ | ✓ |
| 18 | Inertial Yaw Glider Deadzone | R4 | 5 | 5 | ✓ | ✓ |
| 19 | 100% Locked Horizon | R4 | 5 | 5 | ✓ | ✓ |
| 20 | Diegetic Gaze Glyphs Dwell | R4 | 5 | 5 | ✓ | ✓ |
| 21 | 3D HRTF Spatial Audio Routing | R5 | 5 | 5 | ✓ | ✓ |
| 22 | Timeline & Audio Playhead Sync | R4, R5 | 5 | 5 | ✓ | ✓ |
| 23 | Minimal Chrome-Free VR Isolation | R6 | 5 | 5 | ✓ | ✓ |
| 24 | Diegetic Zenith Gaze Exit | R6 | 5 | 5 | ✓ | ✓ |
| 25 | Fading Onboarding Prompt | R6 | 5 | 5 | ✓ | ✓ |
| 26 | Amber Ring Loading State | R6 | 5 | 5 | ✓ | ✓ |
| 27 | Dual-Mode VR Renderer (WebXR + Stereo) | R2, R6 | 5 | 5 | ✓ | ✓ |
| 28 | Baseline Preservation (656 tests) | R8 | 5 | 5 | ✓ | ✓ |
| 29 | Zero Tampering / Facade Auditing | Integrity | 5 | 5 | ✓ | ✓ |

## Test Architecture
- Python Test Suites: `tests/test_e2e_vr_jpl.py` (executed via `py -m pytest tests/test_e2e_vr_jpl.py -v`)
- Node.js Test Suites: `tests/test_e2e_vr_jpl.mjs` (executed via `node --test tests/test_e2e_vr_jpl.mjs`)
- Full Baseline Assertion: `py -m pytest` must pass all 656 baseline tests + all new E2E tests with exit code 0.
- Pass/Fail Semantics: Strict exit code 0; zero skips; zero unhandled errors.

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Target Behavior |
|---|----------|--------------------|-----------------|
| S1 | Desktop Judging Workflow | F1, F2, F3, F7, F27 | Judge loads 2D dashboard, inspects JPL theme, clicks [TERMINATOR SKIM VR], sees QR code and PC stereo button, enters side-by-side stereo view |
| S2 | Mobile VR Headset Flow | F5, F6, F8, F23, F25 | Mobile client scans QR code, loads `/?vr=1`, taps full-screen launcher, unlocks audio & orientation, enters chrome-free VR with locked horizon |
| S3 | 47-Year Glider Flight (1979-2026) | F9, F13, F14, F15, F16, F17, F18, F22 | Glider navigates from 1979 to 2026; ribbon shifts cobalt to crimson; CO2 limb haze rises; ice caps shrink; audio stays sample-locked |
| S4 | Diegetic STEM Auditioning | F12, F20, F21 | User gazes at Ocean Heat mote (-18° pitch) for 600ms; progress ring fills; audio stem solos; HRTF panner matches 3D position |
| S5 | High-Attitude Flight & Zenith Escape | F19, F24, F26 | User looks straight up (pitch >= 75°) for 1.5s; ring fills; system cleanly returns to 2D console without persistent exit button |
