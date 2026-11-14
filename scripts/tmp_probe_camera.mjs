// Probe Babylon camera conventions (one-off, temp)
import { BABYLON } from '../frontend/vendor/babylon/babylon.core.module.js';

const engine = new BABYLON.NullEngine();
const scene = new BABYLON.Scene(engine);
scene.activeCamera = null;

const cam = new BABYLON.UniversalCamera('c', BABYLON.Vector3.Zero(), scene);
scene.activeCamera = cam;
console.log('zero-rotation getForwardRay:', cam.getForwardRay(1.0).direction.toString());
console.log('getDirection(Axis.Z):', cam.getDirection(BABYLON.Axis.Z).toString());
console.log('upVector:', cam.upVector.toString());

cam.rotation.x = (80 * Math.PI) / 180;
console.log('rotation.x=+80deg forward:', cam.getForwardRay(1.0).direction.toString());

cam.rotation.x = 0;
cam.rotation.y = (15 * Math.PI) / 180;
console.log('rotation.y=+15deg forward:', cam.getForwardRay(1.0).direction.toString());

cam.rotation.y = 0;
// Aim camera at a point with yaw +15deg, pitch -18deg (glyph arc math, -z glyph field)
const target = new BABYLON.Vector3(
  2.0 * Math.cos((-18 * Math.PI) / 180) * Math.sin((15 * Math.PI) / 180),
  2.0 * Math.sin((-18 * Math.PI) / 180),
  -2.0 * Math.cos((-18 * Math.PI) / 180) * Math.cos((15 * Math.PI) / 180)
);
cam.lookAt(target);
console.log('after lookAt(glyphPos) forward:', cam.getForwardRay(1.0).direction.toString());
console.log('after lookAt rotation:', cam.rotation.x * 180 / Math.PI, cam.rotation.y * 180 / Math.PI, cam.rotation.z * 180 / Math.PI);

// Childed camera world matrix sanity
const rig = new BABYLON.TransformNode('rig', scene);
cam.rotation.setAll(0);
cam.parent = rig;
rig.rotationQuaternion = BABYLON.Quaternion.RotationYawPitchRoll(1.5, 0, 0);
scene.render();
console.log('parented cam globalPosition:', cam.globalPosition.toString());
console.log('parented cam world fwd:', cam.getForwardRay(1.0).direction.toString());

// TargetCamera as stereo eye child
const eye = new BABYLON.TargetCamera('eye', BABYLON.Vector3.Zero(), scene);
eye.parent = cam;
eye.position.set(0.032, 0, 0);
scene.render();
console.log('eye global pos:', eye.globalPosition.toString());
