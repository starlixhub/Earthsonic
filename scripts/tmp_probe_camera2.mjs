// Probe #2: parented camera transform behavior (one-off, temp)
import { BABYLON } from '../frontend/vendor/babylon/babylon.core.module.js';

const engine = new BABYLON.NullEngine();
const scene = new BABYLON.Scene(engine);

const rig = new BABYLON.TransformNode('rig', scene);
const cam = new BABYLON.UniversalCamera('c', BABYLON.Vector3.Zero(), scene);
cam.parent = rig;
rig.rotationQuaternion = BABYLON.Quaternion.RotationYawPitchRoll(1.5, 0, 0); // yaw
scene.render();
console.log('parented cam world fwd:', cam.getForwardRay(1.0).direction.toString());
console.log('parented cam globalPosition:', cam.globalPosition.toString());

// Aim formula check: point camera at d = normalize(1, 0.6, -0.7)
const d = new BABYLON.Vector3(1, 0.6, -0.7).normalize();
cam.rotation.x = -Math.asin(d.y);
cam.rotation.y = Math.atan2(d.x, d.z);
cam.rotation.z = 0;
scene.render();
const f = cam.getForwardRay(1.0).direction;
console.log('aimed forward:', f.toString(), '| expected d:', d.toString(),
  '| dot:', BABYLON.Vector3.Dot(f, d).toFixed(6));
