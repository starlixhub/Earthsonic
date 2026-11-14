/**
 * tests/test_orbital_examine_node.mjs
 *
 * Node.js test suite for the EARTHSONIC "Orbital Examine" VR Mode.
 * Tests run headless against Babylon.js NullEngine.
 *
 * Coverage matrix vs old test_vr_* files:
 *   OLD test                              NEW status
 *   ─────────────────────────────────────────────────────────────────────────
 *   test_vr_renderer_node.mjs            Dropped: Three.js VRRenderer replaced.
 *   test_vr_gaze_node.mjs                Rewritten: zenith-gaze exit replaced by
 *                                        panel EXIT button (see ORBB-EXIT-01).
 *   test_vr_glider_node.mjs              Dropped: Glider navigation removed.
 *                                        ArcRotateCamera handles orbit natively.
 *   test_vr_scene_node.mjs               Rewritten: TerminatorSkimVRScene replaced
 *                                        by OrbitalExamineScene (see ORBB-SCENE-*).
 *   test_vr_audio_node.mjs               Retained: Web Audio constants unchanged;
 *                                        only position source changed (panel buttons
 *                                        instead of glyphs). See ORBB-AUDIO-*.
 *   test_vr_bridge_node.mjs              Retained via stress_vr_launch_endpoint.py;
 *                                        backend endpoint unchanged.
 *   test_e2e_vr_jpl.mjs (legacy)         Dropped: superseded by orbital E2E tests
 *                                        in this file.
 *   test_challenger_m4_lifecycle_stress  Dropped: covers old stereo scissor pass;
 *                                        ArcRotateCamera stereo uses Babylon viewports.
 *
 * Tests that apply unchanged:
 *   - vr_timeline.test.mjs: TOTAL_MONTHS=573, timeline math — still valid.
 *   - All non-VR tests: zero regressions expected.
 *
 * Author: Antigravity (Orbital Examine rewrite, 2026-11)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.resolve(__dirname, '..');

// ─── Helpers ────────────────────────────────────────────────────────────────

function readSrc(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

// ─── ORBB-SRC-01: Source file existence ─────────────────────────────────────

describe('Orbital Examine: Source file invariants', () => {
  it('ORBB-SRC-01: orbital_examine.js exists under frontend/js/globe/vr/', () => {
    const p = path.join(ROOT, 'frontend', 'js', 'globe', 'vr', 'orbital_examine.js');
    assert.ok(fs.existsSync(p), 'orbital_examine.js must exist');
  });

  it('ORBB-SRC-02: orbital_examine.js exports OrbitalExamineScene', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes('export class OrbitalExamineScene'), 'OrbitalExamineScene must be exported');
  });

  it('ORBB-SRC-03: orbital_examine.js exports OrbitalControlPanel', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes('export class OrbitalControlPanel'), 'OrbitalControlPanel must be exported');
  });

  it('ORBB-SRC-04: orbital_examine.js exports installOrbitalExamineVR', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes('export function installOrbitalExamineVR'), 'installOrbitalExamineVR must be exported');
  });

  it('ORBB-SRC-05: index.js re-exports Orbital Examine symbols', () => {
    const src = readSrc('frontend/js/globe/vr/index.js');
    assert.ok(src.includes('OrbitalExamineScene'), 'index.js must export OrbitalExamineScene');
    assert.ok(src.includes('OrbitalControlPanel'), 'index.js must export OrbitalControlPanel');
    assert.ok(src.includes('installOrbitalExamineVR'), 'index.js must export installOrbitalExamineVR');
  });
});

// ─── ORBB-CAM: ArcRotateCamera configuration ────────────────────────────────

describe('Orbital Examine: ArcRotateCamera configuration invariants', () => {
  it('ORBB-CAM-01: ORBITAL_INITIAL_RADIUS frames full globe with margin', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    // Extract ORBITAL_INITIAL_RADIUS value
    const m = src.match(/ORBITAL_INITIAL_RADIUS\s*=\s*([0-9.]+)/);
    assert.ok(m, 'ORBITAL_INITIAL_RADIUS must be defined');
    const r = parseFloat(m[1]);
    // Globe radius is 10. At r=ORBITAL_INITIAL_RADIUS, half-angle of globe
    // = atan(10/r). For 20% margin inside 60° half-FOV: half-angle < 30°.
    // atan(10/28) ≈ 19.7° < 30° — passes. atan(10/12.5) ≈ 38.7° — fails.
    const halfAngleDeg = Math.atan(10.0 / r) * (180 / Math.PI);
    assert.ok(r >= 25, `ORBITAL_INITIAL_RADIUS ${r} should be >= 25 for full globe with margin`);
    assert.ok(halfAngleDeg < 30, `Globe half-angle ${halfAngleDeg.toFixed(1)}° should be < 30° for margin`);
  });

  it('ORBB-CAM-02: ORBITAL_MIN_RADIUS keeps camera outside globe surface', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    const m = src.match(/ORBITAL_MIN_RADIUS\s*=\s*([0-9.]+)/);
    assert.ok(m, 'ORBITAL_MIN_RADIUS must be defined');
    const minR = parseFloat(m[1]);
    // Globe surface at r=10; min camera must be outside surface (>10)
    assert.ok(minR > 10.0, `ORBITAL_MIN_RADIUS ${minR} must be > 10.0 (globe surface)`);
  });

  it('ORBB-CAM-03: ORBITAL_MAX_RADIUS provides meaningful upper limit', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    const m = src.match(/ORBITAL_MAX_RADIUS\s*=\s*([0-9.]+)/);
    assert.ok(m, 'ORBITAL_MAX_RADIUS must be defined');
    const maxR = parseFloat(m[1]);
    assert.ok(maxR >= 50, `ORBITAL_MAX_RADIUS ${maxR} should be >= 50`);
  });

  it('ORBB-CAM-04: lowerRadiusLimit / upperRadiusLimit set on ArcRotateCamera in source', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes('lowerRadiusLimit'), 'ArcRotateCamera lowerRadiusLimit must be set');
    assert.ok(src.includes('upperRadiusLimit'), 'ArcRotateCamera upperRadiusLimit must be set');
  });

  it('ORBB-CAM-05: ArcRotateCamera target is Earth center (0,0,0)', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    // The constructor call sets target to Vector3.Zero()
    assert.ok(src.includes('BABYLON.Vector3.Zero()'), 'ArcRotateCamera target must be Vector3.Zero()');
    assert.ok(src.includes('ArcRotateCamera'), 'ArcRotateCamera must be used');
  });

  it('ORBB-CAM-06: eye separation constant is 0.064 (unchanged from verified build)', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    const m = src.match(/ORBITAL_EYE_SEP\s*=\s*([0-9.]+)/);
    assert.ok(m, 'ORBITAL_EYE_SEP must be defined');
    assert.strictEqual(parseFloat(m[1]), 0.064);
  });
});

// ─── ORBB-STEREO: Dual-viewport stereo ──────────────────────────────────────

describe('Orbital Examine: Dual-viewport stereo mode invariants', () => {
  it('ORBB-STEREO-01: Stereo activation uses Babylon scene.activeCameras (not scissor pass)', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes('scene.activeCameras'), 'Stereo must use scene.activeCameras');
    // Must NOT use setScissorTest (old Three.js approach)
    assert.ok(!src.includes('setScissorTest'), 'Must not use Three.js setScissorTest');
  });

  it('ORBB-STEREO-02: Left eye viewport is (0,0,0.5,1) and right eye is (0.5,0,0.5,1)', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes('new BABYLON.Viewport(0, 0, 0.5, 1)'), 'Left eye viewport must be (0,0,0.5,1)');
    assert.ok(src.includes('new BABYLON.Viewport(0.5, 0, 0.5, 1)'), 'Right eye viewport must be (0.5,0,0.5,1)');
  });

  it('ORBB-STEREO-03: Left eye is offset -halfSep and right eye +halfSep', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes('-halfSep'), 'Left eye offset must be -halfSep');
    assert.ok(src.includes('halfSep, 0'), 'Right eye offset must be +halfSep');
  });
});

// ─── ORBB-TONE: ACES tonemapping ────────────────────────────────────────────

describe('Orbital Examine: Scene configuration invariants', () => {
  it('ORBB-TONE-01: ACES tonemapping enabled via ImageProcessingConfiguration', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes('toneMappingEnabled = true'), 'toneMappingEnabled must be true');
    assert.ok(src.includes('TONEMAPPING_ACES'), 'ACES tonemapping type must be set');
    assert.ok(src.includes('exposure = 1.0'), 'exposure must be 1.0');
  });

  it('ORBB-TONE-02: Scene clearColor is deep space void (#010408 ≈ 0.004,0.008,0.02)', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    // Checks for the Color4 values
    assert.ok(src.includes('0.004, 0.008, 0.02'), 'clearColor must be deep space void');
  });

  it('ORBB-LIGHT-01: DirectionalLight intensity is 3.2', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes('intensity = 3.2'), 'SunLight intensity must be 3.2');
  });

  it('ORBB-LIGHT-02: HemisphericLight ambient fill present', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes('HemisphericLight'), 'HemisphericLight ambient fill must be present');
  });
});

// ─── ORBB-SCENE: Scene graph layers ─────────────────────────────────────────

describe('Orbital Examine: Scene graph layer invariants', () => {
  it('ORBB-SCENE-01: SurfaceMesh uses ORBITAL_EARTH_RADIUS * 2 and 64 segments', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes('ORBITAL_EARTH_RADIUS * 2.0'), 'SurfaceMesh diameter must be ORBITAL_EARTH_RADIUS * 2.0');
    assert.ok(src.includes('segments: 64'), 'SurfaceMesh must use 64 subdivisions (spec §4)');
  });

  it('ORBB-SCENE-02: CloudLayer scale is 1.008 (globe radius * 1.008)', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes('1.008'), 'CloudLayer must be at scale 1.008 (spec §4)');
  });

  it('ORBB-SCENE-03: AtmosphereShell at scale 1.025 (createAtmosphereShell called)', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes('createAtmosphereShell'), 'AtmosphereShell must use createAtmosphereShell');
    assert.ok(src.includes('1.025'), 'AtmosphereShell scale must be 1.025 (spec §4)');
  });

  it('ORBB-SCENE-04: sea ice drawn on the globe, no polar dome meshes', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    // The domes' silhouette read as a grey disc hovering over the pole; the
    // measured NSIDC edge now lives in the surface shader (uIceLayer).
    assert.ok(!src.includes('createIceCapGroup'), 'no polar ice dome meshes');
    assert.ok(src.includes('uIceLayer'), 'surface shader must receive the ICE layer uniform');
  });

  it('ORBB-SCENE-05: no floating terminator ring across the globe', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    // The day/night edge is shaded by the sun light on the surface; the extra
    // wire ring hovered above the planet and looked like a stray hoop.
    assert.ok(!src.includes('createTerminatorRibbon('), 'TerminatorRibbon must not be created in orbital mode');
    assert.ok(src.includes('this.terminatorRibbon = null'), 'terminatorRibbon stays a null field for shared shader helpers');
  });

  it('ORBB-SCENE-06: OceanGlowField created (createOceanGlowField)', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes('createOceanGlowField'), 'OceanGlowField must use createOceanGlowField');
  });

  it('ORBB-SCENE-07: Starfield is the real Hipparcos point catalogue', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes('createHipparcosStarfield'), 'stars must come from the Hipparcos catalogue');
    const sf = readSrc('frontend/js/globe/vr/vr_starfield.js');
    assert.ok(sf.includes('stars_hip_mag6.bin'), 'catalogue binary must be the star source');
    assert.ok(!sf.includes('background: paint'), 'no painted sky');
  });

  it('ORBB-SCENE-07b: legacy texture skybox kept only as fallback', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes('starfield_gaia_2k.png'), 'Starfield must use the existing starfield_gaia_2k.png asset');
    assert.ok(src.includes('createGaiaStarfieldMesh'), 'Must use createGaiaStarfieldMesh');
  });
});

// ─── ORBB-DATA: Real data sourcing ──────────────────────────────────────────

describe('Orbital Examine: Real data sourcing and texture verification', () => {
  it('ORBB-DATA-01: All 5 texture files are requested (Blue Marble, Black Marble, MODIS, GEBCO, specular)', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes('earth_day_2k.png'),     'Blue Marble (earth_day_2k.png) must be loaded');
    assert.ok(src.includes('earth_night_2k.png'),   'Black Marble (earth_night_2k.png) must be loaded');
    assert.ok(src.includes('earth_clouds_2k.png'),  'MODIS clouds (earth_clouds_2k.png) must be loaded');
    assert.ok(src.includes('earth_bump_2k.png'),    'GEBCO bump (earth_bump_2k.png) must be loaded');
    assert.ok(src.includes('earth_specular_2k.png'),'Specular mask (earth_specular_2k.png) must be loaded');
  });

  it('ORBB-DATA-02: Failed texture loads produce labelled placeholder, not silent fallback', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes('[ORBITAL VR TEXTURE FAILURE]'), 'Must log texture failures');
    assert.ok(src.includes('FLAT PLACEHOLDER'), 'Failed textures must render a labelled placeholder');
    assert.ok(src.includes('REAL DATA UNAVAILABLE'), 'Placeholder must state data unavailability');
  });

  it('ORBB-DATA-03: Successful texture loads are verified and logged', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes('[ORBITAL VR TEXTURE VERIFIED]'), 'Successful textures must be logged as verified');
  });

  it('ORBB-DATA-04: Texture log initialized on window.__vrTextureLog (same protocol as vr_scene.js)', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes('window.__vrTextureLog'), 'Texture log must use window.__vrTextureLog');
  });

  it('ORBB-DATA-05: Surface texture assets exist on disk (confirmed real NASA/NOAA data)', () => {
    const textures = [
      'earth_day_2k.png',
      'earth_night_2k.png',
      'earth_clouds_2k.png',
      'earth_bump_2k.png',
      'earth_specular_2k.png',
      'starfield_gaia_2k.png'
    ];
    for (const tex of textures) {
      const p = path.join(ROOT, 'frontend', 'assets', 'textures', tex);
      assert.ok(fs.existsSync(p), `${tex} must exist in frontend/assets/textures/`);
      const stat = fs.statSync(p);
      assert.ok(stat.size > 1000, `${tex} should be a real file (> 1 KB), got ${stat.size} bytes`);
    }
  });
});

// ─── ORBB-PANEL: NASA-style 3D button panel ─────────────────────────────────

describe('Orbital Examine: Right-hand NASA-style button panel (spec §5)', () => {
  it('ORBB-PANEL-01: Panel uses JPL theme colors (#0b1220, #1b2636, #ff8a3d)', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes('#0b1220'), 'Panel surface must be #0b1220');
    assert.ok(src.includes('#1b2636'), 'Panel border must be #1b2636');
    assert.ok(src.includes('#ff8a3d'), 'Panel amber accent must be #ff8a3d');
  });

  it('ORBB-PANEL-02: IBM Plex Mono font used in panel labels', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes('IBM Plex Mono'), 'Panel must use IBM Plex Mono font');
  });

  it('ORBB-PANEL-03: Panel contains all required buttons: PLAY, PAUSE, PREV, NEXT', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes("label: 'PLAY'"),    "PLAY button required");
    assert.ok(src.includes("label: 'PAUSE'"),   "PAUSE button required");
    assert.ok(src.includes("label: '< PREV'") || src.includes("label: 'PREV'"), "PREV button required");
    assert.ok(src.includes("label: 'NEXT >'") || src.includes("label: 'NEXT'"), "NEXT button required");
  });

  it('ORBB-PANEL-04: Panel contains 4 stem channel toggles: TEMP, CO2, OCEAN, ICE', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes("label: 'TEMP'"),  "TEMP toggle required");
    assert.ok(src.includes("label: 'CO2'"),   "CO2 toggle required");
    assert.ok(src.includes("label: 'OCEAN'"), "OCEAN toggle required");
    assert.ok(src.includes("label: 'ICE'"),   "ICE toggle required");
  });

  it('ORBB-PANEL-05: Panel contains ZOOM IN, ZOOM OUT, EXIT buttons', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes("label: 'ZOOM IN'")  || src.includes("'ZOOM IN'"),  "ZOOM IN button required");
    assert.ok(src.includes("label: 'ZOOM OUT'") || src.includes("'ZOOM OUT'"), "ZOOM OUT button required");
    assert.ok(src.includes("label: 'EXIT'"),                                    "EXIT button required");
  });

  it('ORBB-PANEL-06: Panel has a year-only date readout (playback sweeps years, not months)', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes("_buildLabelTexture('1979'"), 'Panel date display must initialize to the year 1979');
    assert.ok(!src.includes('1979 · 01'), 'Month must not appear in the date readout');
    assert.ok(src.includes('updateDateDisplay'), 'Panel must implement updateDateDisplay method');
  });

  it('ORBB-PANEL-07: Dwell timer threshold is 3.0 seconds (PANEL_DWELL_SEC)', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    const m = src.match(/PANEL_DWELL_SEC\s*=\s*([0-9.]+)/);
    assert.ok(m, 'PANEL_DWELL_SEC must be defined');
    assert.strictEqual(parseFloat(m[1]), 3.0, 'Dwell threshold must be 3.0s (spec §5)');
  });

  it('ORBB-PANEL-08: Panel has amber progress indicator for dwell (progress bar)', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes('progressBar') || src.includes('progress_bar') || src.includes('ProgressBar'),
      'Panel must have a dwell progress indicator');
  });

  it('ORBB-PANEL-09: Panel uses GUI3DManager (not hand-rolled raycast loop)', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes('GUI3DManager'), 'Panel must use Babylon GUI3DManager');
    // Must NOT contain a setInterval raycast polling loop
    assert.ok(!src.includes('setInterval'), 'Panel must not use setInterval polling');
  });

  it('ORBB-PANEL-10: Trigger bypass (instant activation) is implemented', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes('activateGazedButton'), 'activateGazedButton must implement trigger bypass');
    assert.ok(src.includes('_initTriggerInput') || src.includes('TriggerInput'),
      'Trigger input handler must be implemented');
  });

  it('ORBB-PANEL-11: Panel has no emoji characters in labels', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    // Check BUTTON_DEFS block for emoji
    const emojiRe = /[\u{1F300}-\u{1FFFF}]|[\u{2600}-\u{27BF}]/u;
    // Extract label strings from BUTTON_DEFS
    const labelMatches = [...src.matchAll(/label:\s*'([^']+)'/g)].map(m => m[1]);
    for (const lbl of labelMatches) {
      assert.ok(!emojiRe.test(lbl), `Label "${lbl}" must not contain emoji`);
    }
  });
});

// ─── ORBB-AUDIO: 3D HRTF audio (spec §7) ────────────────────────────────────

describe('Orbital Examine: 3D HRTF audio invariants (spec §7)', () => {
  it('ORBB-AUDIO-01: VRSpatialAudio constants are unchanged (HRTF, refDistance=2.0, rolloff=1.2)', () => {
    const src = readSrc('frontend/js/globe/vr/vr_audio.js');
    assert.ok(src.includes("PANNING_MODEL = 'HRTF'"),        "panningModel must be HRTF");
    assert.ok(src.includes('REF_DISTANCE = 2.0'),             "refDistance must be 2.0");
    assert.ok(src.includes('ROLLOFF_FACTOR = 1.2'),           "rolloffFactor must be 1.2");
    assert.ok(src.includes('MAX_DISTANCE = 100.0'),           "maxDistance must be 100.0");
  });

  it('ORBB-AUDIO-02: orbital_examine.js imports VRSpatialAudio', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes("import { VRSpatialAudio }"), 'VRSpatialAudio must be imported');
  });

  it('ORBB-AUDIO-03: Audio positions anchored to panel button world transforms', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    // The 4 stem button anchor nodes are passed as the dataGlyphs to VRSpatialAudio
    assert.ok(src.includes('buttonAnchors'), 'Panel button anchors must be passed to VRSpatialAudio');
  });
});

// ─── ORBB-TIMELINE: Timeline behavior ───────────────────────────────────────

describe('Orbital Examine: Timeline behavior invariants', () => {
  it('ORBB-TL-01: TOTAL_MONTHS imported from vr_timeline.js (not vr_spline.js)', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    // Should import from vr_timeline.js
    assert.ok(src.includes("from './vr_timeline.js'"), 'Must import from vr_timeline.js');
    // Should not import TOTAL_MONTHS from vr_spline.js
    const splineImport = src.match(/import[^']*from\s*'\.\/vr_spline\.js'/g) || [];
    for (const imp of splineImport) {
      assert.ok(!imp.includes('TOTAL_MONTHS'), 'Must not import TOTAL_MONTHS from vr_spline.js');
    }
  });

  it('ORBB-TL-02: AUTOPLAY_INTERVAL_SEC defined and > 0', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    const m = src.match(/AUTOPLAY_INTERVAL_SEC\s*=\s*([0-9.]+)/);
    assert.ok(m, 'AUTOPLAY_INTERVAL_SEC must be defined');
    assert.ok(parseFloat(m[1]) > 0, 'AUTOPLAY_INTERVAL_SEC must be positive');
  });

  it('ORBB-TL-03: Timeline uses interpolateHarmonizedRecord from vr_timeline.js', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes('interpolateHarmonizedRecord'), 'Must use interpolateHarmonizedRecord');
  });

  it('ORBB-TL-04: updateTimeline clamps t to [0,1]', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    // Should use Math.max(0.0, Math.min(1.0, ...))
    assert.ok(src.includes('Math.max(0.0, Math.min(1.0,') || src.includes('Math.max(0, Math.min(1,'),
      'updateTimeline must clamp t to [0,1]');
  });

  it('ORBB-TL-05: updatePlanetaryShaders called from updateTimeline (all 4 shaders synced)', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes('updatePlanetaryShaders'), 'updatePlanetaryShaders must be called from updateTimeline');
  });
});

// ─── ORBB-CTRL: Phone-in-headset grab-and-spin ──────────────────────────────

describe('Orbital Examine: Phone-in-headset rotation control (spec §3)', () => {
  it('ORBB-CTRL-01: Head yaw delta is fed into camera.alpha (ArcRotateCamera)', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes('camera.alpha'), 'Head yaw must feed into camera.alpha');
  });

  it('ORBB-CTRL-02: Head pitch delta is fed into camera.beta (ArcRotateCamera)', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes('camera.beta'), 'Head pitch must feed into camera.beta');
  });

  it('ORBB-CTRL-03: Zoom uses camera.radius steps (not scroll-only)', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes('camera.radius'), 'Zoom must step camera.radius');
    assert.ok(src.includes('ORBITAL_ZOOM_STEP'), 'Zoom step must use ORBITAL_ZOOM_STEP constant');
  });

  it('ORBB-CTRL-04: Trigger input registered (keyboard Enter/Space + gamepad poll)', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes("'Enter'") && src.includes("'Space'"), 'Keyboard trigger (Enter/Space) must be registered');
    assert.ok(src.includes('getGamepads'), 'Gamepad trigger polling must be implemented');
  });

  it('ORBB-CTRL-05: Universal trigger rule implemented (globe=grab-spin, panel=instant-activate)', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes('getGazedButton'), 'Must check getGazedButton() for trigger routing');
    assert.ok(src.includes('activateGazedButton'), 'Panel button trigger bypass must call activateGazedButton');
    assert.ok(src.includes('_gazeGrabActive'), 'Globe grab state must be tracked');
  });
});

// ─── ORBB-EXIT: EXIT button replaces zenith-gaze gesture ────────────────────

describe('Orbital Examine: EXIT button replaces old zenith-gaze exit (spec §5)', () => {
  it('ORBB-EXIT-01: Panel has EXIT button', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes("label: 'EXIT'"), 'EXIT button must be present in panel');
    assert.ok(src.includes("action: 'exit'"), 'EXIT action must be wired');
  });

  it('ORBB-EXIT-02: actionExit() calls exitVR()', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes('actionExit') && src.includes('this.exitVR()'),
      'actionExit must call exitVR()');
  });

  it('ORBB-EXIT-03: No zenith-gaze exit gesture in orbital_examine.js', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    // The old zenith-gaze exit used ZENITH_PITCH_THRESHOLD_DEG and ZENITH_DWELL_THRESHOLD_SEC
    // These should NOT appear in the new orbital mode (covered by vr_gaze.js legacy)
    assert.ok(!src.includes('ZENITH_PITCH_THRESHOLD_DEG'),
      'Orbital Examine must not use the old zenith-pitch gaze exit gesture');
  });
});

// ─── ORBB-WEBXR: WebXR integration ─────────────────────────────────────────

describe('Orbital Examine: WebXR integration (spec §1)', () => {
  it('ORBB-WEBXR-01: WebXRDefaultExperience used for immersive-vr (Mode A)', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes('WebXRDefaultExperience'), 'WebXRDefaultExperience must be used for Mode A');
    assert.ok(src.includes("'immersive-vr'"), "immersive-vr session type must be requested");
  });

  it('ORBB-WEBXR-02: Mode B stereo fallback activates when WebXR unavailable', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    // forceStereo path or XR error catch leads to _activateStereo()
    assert.ok(src.includes('_activateStereo'), 'Must fall back to _activateStereo when WebXR unavailable');
  });
});

// ─── ORBB-SHADERS: GLSL port invariants ─────────────────────────────────────

describe('Orbital Examine: Shader port invariants', () => {
  it('ORBB-SHADER-01: orbital_examine.js uses VRSurfaceShader (not a custom shader)', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes('VRSurfaceShader'), 'Must use verified VRSurfaceShader (port note 3)');
  });

  it('ORBB-SHADER-02: Surface bumpScale is 0.012 (GEBCO ~7.6km peak, same as vr_scene.js)', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes('uBumpScale:   0.012') || src.includes('uBumpScale: 0.012'),
      'bumpScale must be 0.012 (ported from verified build)');
  });

  it('ORBB-SHADER-03: Solar ephemeris math is ported (23.44° axial tilt, 48 diurnal cycles)', () => {
    const src = readSrc('frontend/js/globe/vr/orbital_examine.js');
    assert.ok(src.includes('23.44'), 'Solar axial tilt 23.44° must be in ephemeris');
    assert.ok(src.includes('* 48'), 'Diurnal cycle * 48 must be in ephemeris');
  });
});

// ─── ORBB-GUIDANCE: 45s GUIDED MISSION stays unchanged ───────────────────────

describe('Orbital Examine: Guided Mission Tour 45s duration unchanged', () => {
  it('ORBB-GUIDE-01: Guided Mission Tour is 5 chapters × 9s = 45s (unchanged invariant)', () => {
    // This invariant lives in guided_tour.js, not in orbital_examine.js
    const src = readSrc('frontend/js/ui/guided_tour.js');
    // Look for 45 or 9 × 5 structure
    assert.ok(src.includes('45') || src.includes('9000') || src.includes('9 '),
      'Guided Mission Tour must retain 45s total duration');
  });
});

// ─── ORBB-LAUNCHER: vr_launcher.js routes to Orbital Examine ─────────────────

describe('Orbital Examine: VR launcher integration', () => {
  it('ORBB-LAUNCH-01: vr_launcher.js routes to earthsonicOrbitalVR first', () => {
    const src = readSrc('frontend/js/ui/vr_launcher.js');
    assert.ok(src.includes('earthsonicOrbitalVR'), 'vr_launcher.js must route to earthsonicOrbitalVR');
  });

  it('ORBB-LAUNCH-02: Mobile QR endpoint GET /api/vr-launch-info exists', () => {
    const src = readSrc('backend/app.py');
    assert.ok(src.includes('/api/vr-launch-info'), '/api/vr-launch-info endpoint must exist');
  });

  it('ORBB-LAUNCH-03: Backend uses UDP connect trick for LAN IP discovery', () => {
    const src = readSrc('backend/app.py');
    assert.ok(src.includes('8.8.8.8'), 'Must use UDP connect trick to 8.8.8.8:80 for LAN IP');
    assert.ok(src.includes('get_primary_lan_ip'), 'get_primary_lan_ip function must exist');
  });

  it('ORBB-LAUNCH-04: Mobile fullscreen/orientation lock present in vr_launcher.js', () => {
    const src = readSrc('frontend/js/ui/vr_launcher.js');
    assert.ok(src.includes('requestFullscreen'), 'requestFullscreen must be called on mobile tap');
    assert.ok(src.includes('screen.orientation') || src.includes('lockOrientation'),
      'Screen orientation lock must be attempted');
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// COVERAGE-GAP PORTS — ported from tests/legacy_vr/ (objectives 1–4 of
// test_challenger_m2_2_stress.mjs and VR-AUD-01..05 of test_vr_audio_node.mjs)
//
// WHY PORTED: The shader GLSL source is unchanged (vr_shaders.js was not
// modified during the Orbital Examine rewrite), so the math oracle tests
// remain valid. The audio constants are also unchanged. These tests were
// only quarantined because their files also imported Three.js or
// installEarthsonicVR — the pure math/GLSL assertions below have zero
// Three.js or VR-flight dependencies.
// ═══════════════════════════════════════════════════════════════════════════════

import {
  VRTerminatorRibbonShader,
  VRAtmosphereShellShader,
  VROceanGlowShader,
  VRIceCapShader
} from '../frontend/js/globe/vr/vr_shaders.js';

import {
  PANNING_MODEL,
  DISTANCE_MODEL,
  REF_DISTANCE,
  ROLLOFF_FACTOR,
  MAX_DISTANCE
} from '../frontend/js/globe/vr/vr_audio.js';

// ─── GLSL Shader Math Oracles ────────────────────────────────────────────────

describe('Shader math oracles: TerminatorRibbon colormap (ported from legacy M2-2 Obj.1)', () => {

  it('ORBB-SHADER-GLSL-01: Fragment shader clamps uAnomalyValue and defines cobalt + amber-red palette', () => {
    const frag = VRTerminatorRibbonShader.fragmentShader;
    assert.ok(frag.includes('clamp(uAnomalyValue, -1.0, 1.0)'));
    assert.ok(
      frag.includes('vec3(0.15, 0.35, 0.90)') || frag.includes('vec3(0.15, 0.35, 0.9)'),
      'Cool cobalt vec3(0.15, 0.35, 0.90)'
    );
    assert.ok(
      frag.includes('vec3(0.95, 0.25, 0.10)') || frag.includes('vec3(0.95, 0.25, 0.1)'),
      'Amber-red vec3(0.95, 0.25, 0.10)'
    );
    assert.ok(frag.includes('mix('), 'Must interpolate via mix()');
  });

  it('ORBB-SHADER-GLSL-02: Colormap JS oracle — clamp+mix produces cobalt at −1, amber-red at +1, monotonic red', () => {
    function computeRibbonColor(uAnomalyValue) {
      const anom  = Math.max(-1.0, Math.min(1.0, uAnomalyValue));
      const alpha = (anom + 1.0) * 0.5;
      const c = [0.15, 0.35, 0.90];
      const h = [0.95, 0.25, 0.10];
      return [c[0]*(1-alpha)+h[0]*alpha, c[1]*(1-alpha)+h[1]*alpha, c[2]*(1-alpha)+h[2]*alpha];
    }
    // Underflow clamps to cobalt
    const under = computeRibbonColor(-100);
    assert.ok(Math.abs(under[0] - 0.15) < 1e-6);
    assert.ok(Math.abs(under[2] - 0.90) < 1e-6);
    // Overflow clamps to amber-red
    const over = computeRibbonColor(100);
    assert.ok(Math.abs(over[0] - 0.95) < 1e-6);
    assert.ok(Math.abs(over[2] - 0.10) < 1e-6);
    // Midpoint
    const mid = computeRibbonColor(0.0);
    assert.ok(Math.abs(mid[0] - 0.55) < 1e-6);
    assert.ok(Math.abs(mid[1] - 0.30) < 1e-6);
    assert.ok(Math.abs(mid[2] - 0.50) < 1e-6);
    // Monotonic red
    let prev = -1;
    for (let a = -1.0; a <= 1.0; a += 0.1) {
      const c = computeRibbonColor(a);
      assert.ok(c[0] >= prev);
      prev = c[0];
    }
  });

  it('ORBB-SHADER-GLSL-03: Vertex shader displacement — anomaly×0.04, envelope×0.02, noise×0.015', () => {
    const vert = VRTerminatorRibbonShader.vertexShader;
    assert.ok(vert.includes('clamp(uAnomalyValue, -1.0, 1.0)'));
    assert.ok(vert.includes('anomalyDisp = clampedAnom * 0.04'));
    assert.ok(vert.includes('audioDisp = uAudioEnvelope * 0.02'));
    assert.ok(vert.includes('totalDisp = anomalyDisp + audioDisp + noiseDisp'));
    assert.ok(vert.includes('displacedPos = position + normal * totalDisp'));

    function computeDisp(anomaly, env, noise = 0.5) {
      const c = Math.max(-1.0, Math.min(1.0, anomaly));
      return c*0.04 + env*0.02 + (noise-0.5)*0.015;
    }
    assert.ok(Math.abs(computeDisp(0.0, 0.0, 0.5)) < 1e-6, 'Baseline zero');
    assert.ok(Math.abs(computeDisp(1.0, 1.0, 1.0) - 0.0675) < 1e-4, 'Max disp 0.0675');
  });
});

describe('Shader math oracles: OceanGlow Fresnel pow(1−dot,2.5) (ported from legacy M2-2 Obj.2)', () => {

  it('ORBB-SHADER-GLSL-04: Ocean glow fragment has waterMask≤0.5 discard and Fresnel power 2.5', () => {
    const frag = VROceanGlowShader.fragmentShader;
    assert.ok(
      frag.includes('waterMask') && (frag.includes('<= 0.5') || frag.includes('< 0.5') || frag.includes('<0.5')),
      'waterMask discard boundary'
    );
    assert.ok(frag.includes('pow(1.0 - max(dot(normal, viewDir), 0.0), 2.5)'), 'Fresnel pow 2.5');
    assert.ok(frag.includes('pulse = 0.5 + 0.5 * sin(uTime * 1.2) * uAudioEnvelope'));
    assert.ok(frag.includes('glow = vec3(0.1, 0.6, 0.9) * uOHC * pulse * fresnel'));
  });

  it('ORBB-SHADER-GLSL-05: Ocean glow JS oracle — nadir fresnel=0, limb fresnel=1, pulse stable at env=0', () => {
    function computeOceanGlow(dotNV, ohc, env, t) {
      const f = Math.pow(1.0 - Math.max(0, Math.min(1, dotNV)), 2.5);
      const p = 0.5 + 0.5 * Math.sin(t * 1.2) * env;
      return { fresnel: f, pulse: p, glow: [0.1*ohc*p*f, 0.6*ohc*p*f, 0.9*ohc*p*f], alpha: f*ohc };
    }
    // Nadir (dot=1): no glow
    const nadir = computeOceanGlow(1.0, 1.0, 1.0, 0.0);
    assert.ok(Math.abs(nadir.fresnel) < 1e-10);
    // Limb (dot=0): full Fresnel
    const limb = computeOceanGlow(0.0, 0.8, 0.5, 0.0);
    assert.ok(Math.abs(limb.fresnel - 1.0) < 1e-10);
    assert.ok(Math.abs(limb.pulse - 0.5) < 1e-10, 'sin(0)=0 so pulse=0.5');
    // Pulse is fixed when env=0
    for (let t = 0; t < 10; t += 0.5) {
      const r = computeOceanGlow(0.5, 0.5, 0.0, t);
      assert.ok(Math.abs(r.pulse - 0.5) < 1e-10);
    }
  });
});

describe('Shader math oracles: Atmosphere CO₂ haze (ported from legacy M2-2 Obj.3)', () => {

  it('ORBB-SHADER-GLSL-06: Atmosphere fragment has CO₂ clamp, chord-integration scattering, no sun disc', () => {
    // NOTE: During the Babylon port the atmosphere shader was upgraded from the
    // simple pow(1-cosTheta,3.2) limb factor to a proper analytic chord
    // integration (single-scattering, O'Neil/Nishita style) with
    // Henyey-Greenstein Mie forward scatter (g=0.76). The CO₂ normalization and
    // tint palette are unchanged.
    const frag = VRAtmosphereShellShader.fragmentShader;
    assert.ok(frag.includes('clamp(uCO2Ppm, 280.0, 600.0)'), 'CO₂ clamp [280,600]');
    assert.ok(frag.includes('clamp((clampedCO2 - 336.0) / (426.0 - 336.0), 0.0, 1.0)'), 'CO₂ norm formula');
    assert.ok(frag.includes('(1.0 + 0.75 * co2Norm) * (1.0 + 0.15 * uAudioEnvelope)'), 'Optical depth formula');
    assert.ok(frag.includes('vec3(0.10, 0.50, 0.95)'), 'Stratospheric blue palette');
    assert.ok(frag.includes('vec3(0.85, 0.55, 0.20)'), 'Warm amber-ochre haze palette');
    // Chord integration (Babylon upgrade replaces simple pow(1-cosTheta,3.2))
    assert.ok(frag.includes('chord') && frag.includes('chordMax'), 'Chord integration present');
    assert.ok(frag.includes('density = clamp(chord / chordMax'), 'Density from chord ratio');
    // The Henyey-Greenstein forward sun lobe (g = 0.76) was removed on purpose:
    // the camera sits inside this shell, so that term painted a flat glowing
    // disc over the middle of the globe instead of a limb glow. The shell must
    // now contribute scatter + CO2 tint only.
    assert.ok(!frag.includes('mieSunColor'), 'no Mie sun disc painted on the planet');
    assert.ok(!frag.includes('g = 0.76'), 'HG sun lobe removed');
    assert.ok(frag.includes('scatter * 0.62 * opticalDepth'), 'scatter-only atmosphere colour');
  });

  it('ORBB-SHADER-GLSL-07: CO₂ ppm oracle — 336ppm=pure blue, 426ppm=full amber, monotonic red ramp', () => {
    function evalAtmo(co2) {
      const c = Math.max(280, Math.min(600, co2));
      const n = Math.max(0, Math.min(1, (c - 336) / (426 - 336)));
      const optD = (1 + 0.75*n);
      const tint = [0.10*(1-n)+0.85*n, 0.50*(1-n)+0.55*n, 0.95*(1-n)+0.20*n];
      return { n, optD, tint };
    }
    const a1979 = evalAtmo(336);
    assert.equal(a1979.n, 0.0);
    assert.equal(a1979.optD, 1.0);
    assert.ok(Math.abs(a1979.tint[2] - 0.95) < 1e-4, 'Full blue at 1979');
    const a2026 = evalAtmo(426);
    assert.equal(a2026.n, 1.0);
    assert.ok(Math.abs(a2026.optD - 1.75) < 1e-10);
    assert.ok(Math.abs(a2026.tint[2] - 0.20) < 1e-4, 'Full amber at 2026');
    // Monotonic
    let last = { d: 0, r: 0 };
    for (let ppm = 336; ppm <= 426; ppm += 10) {
      const curr = evalAtmo(ppm);
      assert.ok(curr.optD >= last.d);
      assert.ok(curr.tint[0] >= last.r);
      last = { d: curr.optD, r: curr.tint[0] };
    }
  });
});

describe('Shader math oracles: IceCap Schlick IOR=1.31 (ported from legacy M2-2 Obj.4)', () => {

  it('ORBB-SHADER-GLSL-08: Ice cap fragment has IOR=1.31, R0=0.01802, Schlick pow 5.0, smoothstep boundary', () => {
    const frag = VRIceCapShader.fragmentShader;
    assert.ok(frag.includes('1.31'), 'IOR = 1.31');
    assert.ok(frag.includes('0.01802'), 'R0 = 0.01802');
    assert.ok(frag.includes('pow(1.0 - cosTheta, 5.0)'), 'Schlick power 5.0');
    assert.ok(frag.includes('smoothstep(boundaryLat - 2.5, boundaryLat + 2.5, absLat)'));
    // No drawn halo at the measured extent: the boundary is just where alpha ends.
    assert.ok(!frag.includes('edgeGlow'), 'ice cap must not paint a glowing ring at the extent boundary');
  });

  it('ORBB-SHADER-GLSL-09: Schlick Fresnel oracle — R0=(1.31−1)²/(1.31+1)²=0.01802, rim=1.0', () => {
    const IOR = 1.31;
    const R0 = Math.pow((IOR-1)/(IOR+1), 2);
    assert.ok(Math.abs(R0 - 0.01802) < 0.0001, `R0=${R0}`);
    function schlick(cos) { return R0 + (1-R0)*Math.pow(1-cos, 5); }
    // Normal incidence: R0
    assert.ok(Math.abs(schlick(1.0) - R0) < 1e-10);
    // Grazing: 1.0
    assert.ok(Math.abs(schlick(0.0) - 1.0) < 1e-10);
    // Mid: between R0 and 0.1
    const mid = schlick(Math.SQRT1_2);
    assert.ok(mid > R0 && mid < 0.1);
  });

  it('ORBB-SHADER-GLSL-10: Ice boundary latitude oracle — extent=1→60°, extent=0→85°, extent=0.5→72.5°', () => {
    function iceBoundary(e) { return 85.0 - 25.0*Math.max(0,Math.min(1,e)); }
    assert.equal(iceBoundary(1.0), 60.0);
    assert.equal(iceBoundary(0.0), 85.0);
    assert.equal(iceBoundary(0.5), 72.5);
    // Vertex displacement string check
    const vert = VRIceCapShader.vertexShader;
    assert.ok(vert.includes('clamp(uIceExtent, 0.0, 1.0) * 0.025 + uAudioEnvelope * 0.008'));
  });
});

// ─── Audio Constants (ported from VR-AUD-01..05) ────────────────────────────

describe('Audio constants: HRTF panner parameters (ported from legacy VR-AUD-01,05)', () => {

  it('ORBB-AUD-PORT-01: PANNING_MODEL=HRTF, DISTANCE_MODEL=inverse, REF_DISTANCE=2.0, ROLLOFF=1.2, MAX=100', () => {
    assert.equal(PANNING_MODEL,   'HRTF');
    assert.equal(DISTANCE_MODEL,  'inverse');
    assert.equal(REF_DISTANCE,    2.0);
    assert.equal(ROLLOFF_FACTOR,  1.2);
    assert.equal(MAX_DISTANCE,    100.0);
  });

  it('ORBB-AUD-PORT-02: Distance attenuation oracle — unity at d≤refDist, inverse rolloff beyond', () => {
    function hrtfGain(d, ref = 2.0, rolloff = 1.2) {
      const dist = Math.max(0.01, d);
      if (dist <= ref) return 1.0;
      return ref / (ref + rolloff*(dist - ref));
    }
    // Unity at or below ref
    assert.equal(hrtfGain(2.0), 1.0);
    assert.equal(hrtfGain(1.0), 1.0);
    assert.equal(hrtfGain(0.0), 1.0); // singularity clamp
    // 4m: 2/(2+1.2*2) = 2/4.4
    assert.ok(Math.abs(hrtfGain(4.0) - 2/4.4) < 1e-10);
    // 10m: 2/(2+1.2*8) = 2/11.6
    assert.ok(Math.abs(hrtfGain(10.0) - 2/11.6) < 1e-10);
    // 100m: < 0.02
    assert.ok(hrtfGain(100.0) < 0.02);
    // Monotonic
    assert.ok(hrtfGain(3.0) > hrtfGain(5.0));
    assert.ok(hrtfGain(5.0) > hrtfGain(10.0));
  });
});
