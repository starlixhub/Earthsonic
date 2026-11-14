// Temp smoke: full headless scene construction through installEarthsonicVR (NullEngine)
import { BABYLON } from '../frontend/vendor/babylon/babylon.core.module.js';
import { BABYLON_GUI } from '../frontend/vendor/babylon/babylon.core.module.js';

// Quick engine API checks first
console.log('Vector3.set:', typeof BABYLON.Vector3.prototype.set);
console.log('Vector3.copyFromFloats:', typeof BABYLON.Vector3.prototype.copyFromFloats);
console.log('Quaternion.set:', typeof BABYLON.Quaternion.prototype.set);
console.log('TransformNode.lookAt:', typeof BABYLON.TransformNode.prototype.lookAt);
console.log('GUI3DManager:', typeof BABYLON_GUI.GUI3DManager);
console.log('Control3D:', typeof BABYLON_GUI.Control3D);

const { installEarthsonicVR } = await import('../frontend/js/globe/vr/index.js');

const vr = installEarthsonicVR(null);
await vr.init(null); // no document -> NullEngine path

const scene = vr.sceneInstance.scene;
console.log('scene:', scene.constructor.name, '| engine:', vr.sceneInstance.engine.constructor.name);

// Cameras / rig
const rig = vr.cameraRig;
console.log('rig children incl camera:', rig.name, 'camera parent:', vr.camera.parent.name);

// Stereo eye cameras
const rend = vr.vrRenderer;
rend.handleResize();
console.log('eye cams:', rend.cameraLeft.name, rend.cameraRight.name,
  'offsets:', rend.cameraLeft.position.x, rend.cameraRight.position.x);

// Stereo pass: activeCameras + viewports (mirror real flow: isVRActive set by enterVR)
vr.sceneInstance.isVRActive = true;
await rend.start('stereo');
rend.renderStereoPass();
console.log('activeCameras after start:', scene.activeCameras ? scene.activeCameras.map(c => c.name).join(' + ') : 'null');
console.log('left viewport:', JSON.stringify([scene.activeCameras[0].viewport.x, scene.activeCameras[0].viewport.width]));
console.log('right viewport:', JSON.stringify([scene.activeCameras[1].viewport.x, scene.activeCameras[1].viewport.width]));

// One explicit frame through the renderer path (uses the smoke rAF only if active)
rend._updateSubsystems(0.016);
scene.render();
console.log('frame rendered OK, mode:', rend.getMode());

// Glyphs + GUI manager
console.log('glyphs:', vr.dataGlyphs.length, 'manager controls:', vr.sceneInstance._glyphControls.length);
const g0 = vr.dataGlyphs[0];
console.log('g0 metadata:', JSON.stringify({ stemIndex: g0.metadata.stemIndex, ringUniform: typeof g0.metadata.ringUniform, hitbox: g0.metadata.hitbox && g0.metadata.hitbox.name }));

// Gaze machine wired: progress + zenith ring
const zr = vr.zenithRing;
console.log('zenith ring:', zr.name, 'parent:', zr.parent.name, 'progress uniform:', zr.material.uniforms.uProgress.value);

// Timeline sweep + spline rig motion
vr.updateTimeline(0.5);
console.log('rig pos @ t=0.5:', rig.position.x.toFixed(4), rig.position.y.toFixed(4), rig.position.z.toFixed(4),
  'quat:', [rig.rotationQuaternion.x, rig.rotationQuaternion.y, rig.rotationQuaternion.z, rig.rotationQuaternion.w].map(n => Number(n.toFixed(4))).join(','));

// Glider single-step through renderer loop
const glider = vr.glider;
glider.enable();
glider.setLookAngles(40, 0);
for (let i = 0; i < 10; i++) rend._updateSubsystems(0.016);
console.log('glider after 10 frames: v =', glider.getTimelineVelocity().toExponential(3), 'pos =', glider.getTimelinePosition().toExponential(3));

// exitVR
rend.touchExit = true;
vr.exitVR();
console.log('after exitVR: isVRActive =', vr.isVRActive, 'mode =', rend.getMode(), 'stereo =', rend.isStereoActive());

console.log('SCENE SMOKE OK');
