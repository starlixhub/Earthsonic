// Temp smoke: shader factories + sync engine on NullEngine
import * as shaders from '../frontend/js/globe/vr/vr_shaders.js';
import { BABYLON } from '../frontend/vendor/babylon/babylon.core.module.js';

const engine = new BABYLON.NullEngine();
const scene = new BABYLON.Scene(engine);

const ribbon = shaders.createTerminatorRibbon(scene);
console.log('ribbon:', ribbon.name, 'verts:', ribbon.getTotalVertices(), 'mat:', ribbon.material.constructor.name,
  'depthWrite:', ribbon.material.depthWrite, 'side:', ribbon.material.side,
  'backFaceCulling:', ribbon.material.backFaceCulling);

const atm = shaders.createAtmosphereShell(scene);
console.log('atm:', atm.name, 'verts:', atm.getTotalVertices(), 'side:', atm.material.side,
  'bfc:', atm.material.backFaceCulling, 'depthWrite:', atm.material.depthWrite);

const ocean = shaders.createOceanGlowField(scene);
console.log('ocean:', ocean.name, 'verts:', ocean.getTotalVertices(), 'side:', ocean.material.side);

const ice = shaders.createIceCapGroup(scene);
console.log('ice children:', ice.getChildMeshes().map((c) => c.name).join(', '));

const ring = shaders.createGlyphProgressRing(scene);
console.log('ring:', ring.name, ring.material.uniforms.uProgress.value, ring.material.uniforms.uColor.value);

ring.material.uniforms.uProgress.value = 0.42;
console.log('ring after set:', ring.material.uniforms.uProgress.value);

shaders.updatePlanetaryShaders({
  terminatorRibbon: ribbon,
  atmosphereShell: atm,
  oceanGlowField: ocean,
  iceCapGroup: ice,
  timelineProgress: 0.75,
  monthRecord: {
    temperature_anomaly: 0.86,
    co2_ppm: 421.5,
    normalized_ocean_temp: 0.88,
    normalized_sea_ice_extent: 0.35
  },
  audioEnvelopes: [0.2, 0.3, 0.4, 0.5],
  clockTime: 12.5,
  sunDirection: { x: 0.5, y: 0.6, z: 0.6 },
  sunPosition: { x: 50, y: 30, z: 50 },
  scene
});

console.log('ribbon anom:', ribbon.material.uniforms.uAnomalyValue.value,
  'prog:', ribbon.material.uniforms.uTimelineProgress.value,
  'co2:', atm.material.uniforms.uCO2Ppm.value,
  'ice extent:', ice.getChildMeshes()[0].material.uniforms.uIceExtent.value,
  'quat:', JSON.stringify(ribbon.rotationQuaternion ? ribbon.rotationQuaternion.asArray().map((n) => Number(n.toFixed(3))) : null));

engine.dispose();
console.log('SMOKE OK');
