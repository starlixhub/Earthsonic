/**
 * tests/test_ui_refinements_node.mjs
 * Verification of EARTHSONIC UI Consolidation & Sonic Presets Refinements.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = path.resolve();

test('UI Consolidation: Viewport and markup structure', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'frontend', 'index.html'), 'utf-8');

  // 1. Full-bleed shell. The old inline `width:100vw; height:100vh;
  //    background:#070709` gave way to the instrument frame: a CSS grid that
  //    fills the viewport with the void ground from tokens.css.
  const frameCss = fs.readFileSync(path.join(ROOT_DIR, 'frontend', 'css', 'frame.css'), 'utf-8');
  assert.ok(indexHtml.includes('class="frame"'), 'index.html hosts the frame grid');
  assert.ok(frameCss.includes('width: 100%'), 'frame spans the viewport width');
  assert.ok(frameCss.includes('height: 100dvh'), 'frame spans the viewport height');
  assert.ok(frameCss.includes('var(--ink)'), 'frame ground comes from the void token');

  // 2. Standalone Mid-Deck visualizer row removed
  assert.ok(!indexHtml.includes('<section class="visualizer-hud">'), 'Standalone visualizer-hud section removed');

  // 3. 64-band spectrum canvas behind timeline scrubber
  assert.ok(indexHtml.includes('class="scrubber-spectrum-container"'), 'Scrubber spectrum container present');
  assert.ok(indexHtml.includes('id="spectrum-canvas"'), 'spectrum-canvas present behind scrubber');
  assert.ok(indexHtml.includes('id="orchestra-seek-slider"'), 'orchestra-seek-slider present');

  // 4. Compact master bus module with waveform canvas and RMS dBFS readout
  assert.ok(indexHtml.includes('class="transport-master-module"'), 'transport-master-module present');
  assert.ok(indexHtml.includes('id="waveform-canvas"'), 'waveform-canvas present inside master bus module');
  assert.ok(indexHtml.includes('id="rms-db-text"'), 'rms-db-text present inside master bus module');
  assert.ok(indexHtml.includes('id="master-vol-slider"'), 'master-vol-slider present inside master bus module');

  // 5. Manual pan sliders removed from 4 channel strips
  assert.ok(!indexHtml.includes('class="strip-pan-slider"'), 'strip-pan-slider removed from mixer channels');
  assert.ok(!indexHtml.includes('class="strip-pan-row"'), 'strip-pan-row removed from mixer channels');

  // 6. Live equation badges present on each of the 4 channel strips
  assert.ok(indexHtml.includes('id="eq-badge-surface_temperature"'), 'Live equation badge for surface_temperature present');
  assert.ok(indexHtml.includes('id="eq-badge-atmospheric_co2"'), 'Live equation badge for atmospheric_co2 present');
  assert.ok(indexHtml.includes('id="eq-badge-ocean_temperature"'), 'Live equation badge for ocean_temperature present');
  assert.ok(indexHtml.includes('id="eq-badge-sea_ice_extent"'), 'Live equation badge for sea_ice_extent present');

  // 7. Mission Preset selector in Top Flight Header
  assert.ok(indexHtml.includes('id="mission-preset-select"'), 'Mission preset selector present in header');
  assert.ok(indexHtml.includes('PRESET_1988_CO2'), 'PRESET_1988_CO2 option present');
  assert.ok(indexHtml.includes('PRESET_1998_EL_NINO'), 'PRESET_1998_EL_NINO option present');
  assert.ok(indexHtml.includes('PRESET_2012_ARCTIC'), 'PRESET_2012_ARCTIC option present');
  assert.ok(indexHtml.includes('PRESET_DELTA_1980_2025'), 'PRESET_DELTA_1980_2025 option present');
});

test('Sonic Presets: MISSION_PRESETS definition and configuration', async () => {
  const { MISSION_PRESETS } = await import('../frontend/js/app.js');

  assert.ok(MISSION_PRESETS.PRESET_1988_CO2, 'PRESET_1988_CO2 defined');
  assert.equal(MISSION_PRESETS.PRESET_1988_CO2.targetDate, '1988-01');
  assert.deepEqual(MISSION_PRESETS.PRESET_1988_CO2.solos, ['atmospheric_co2']);
  assert.equal(MISSION_PRESETS.PRESET_1988_CO2.soloDurationSec, 4.0);
  assert.equal(MISSION_PRESETS.PRESET_1988_CO2.camera.lat, 19.53);
  assert.equal(MISSION_PRESETS.PRESET_1988_CO2.camera.lon, -155.57);

  assert.ok(MISSION_PRESETS.PRESET_1998_EL_NINO, 'PRESET_1998_EL_NINO defined');
  assert.equal(MISSION_PRESETS.PRESET_1998_EL_NINO.targetDate, '1997-11');
  assert.deepEqual(MISSION_PRESETS.PRESET_1998_EL_NINO.solos, ['surface_temperature', 'ocean_temperature']);
  assert.equal(MISSION_PRESETS.PRESET_1998_EL_NINO.camera.lat, 0.0);
  assert.equal(MISSION_PRESETS.PRESET_1998_EL_NINO.camera.lon, -140.0);

  assert.ok(MISSION_PRESETS.PRESET_2012_ARCTIC, 'PRESET_2012_ARCTIC defined');
  assert.equal(MISSION_PRESETS.PRESET_2012_ARCTIC.targetDate, '2012-09');
  assert.deepEqual(MISSION_PRESETS.PRESET_2012_ARCTIC.solos, ['sea_ice_extent', 'surface_temperature']);
  assert.equal(MISSION_PRESETS.PRESET_2012_ARCTIC.camera.lat, 82.0);
  assert.equal(MISSION_PRESETS.PRESET_2012_ARCTIC.camera.lon, 0.0);

  assert.ok(MISSION_PRESETS.PRESET_DELTA_1980_2025, 'PRESET_DELTA_1980_2025 defined');
  assert.ok(MISSION_PRESETS.PRESET_DELTA_1980_2025.isDelta);
  assert.ok(MISSION_PRESETS.PRESET_DELTA_1980_2025.periodA.includes('1980'));
  assert.ok(MISSION_PRESETS.PRESET_DELTA_1980_2025.periodB.includes('2025'));
});

test('Mixer & Stereo Stage: Balanced stereo panning and stereo widening', async () => {
  const { TRACK_CONFIGS, EarthOrchestraMixer } = await import('../frontend/js/audio/mixer.js');

  const ch1 = TRACK_CONFIGS.find(t => t.id === 'surface_temperature');
  const ch2 = TRACK_CONFIGS.find(t => t.id === 'atmospheric_co2');
  const ch3 = TRACK_CONFIGS.find(t => t.id === 'ocean_temperature');
  const ch4 = TRACK_CONFIGS.find(t => t.id === 'sea_ice_extent');

  assert.equal(ch1.defaultPan, 0.0, 'CH1 Surface Temp centered (0.0)');
  assert.equal(ch2.defaultPan, -0.15, 'CH2 CO2 panned -0.15');
  assert.equal(ch3.defaultPan, 0.0, 'CH3 Ocean Heat centered (0.0)');
  assert.equal(ch4.stereoWidened, true, 'CH4 Sea Ice stereo widened');

  const mixer = new EarthOrchestraMixer();
  assert.equal(mixer.getTrack('surface_temperature').pan, 0.0);
  assert.equal(mixer.getTrack('atmospheric_co2').pan, -0.15);
  assert.equal(mixer.getTrack('ocean_temperature').pan, 0.0);
  assert.equal(mixer.getTrack('sea_ice_extent').stereoWidened, true);
});
