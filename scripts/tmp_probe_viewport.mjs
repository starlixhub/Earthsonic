import { BABYLON } from '../frontend/vendor/babylon/babylon.core.module.js';

// Does NullEngine honor renderWidth/renderHeight?
const e = new BABYLON.NullEngine({ renderWidth: 1600, renderHeight: 900 });
console.log('null engine size:', e.getRenderWidth(), e.getRenderHeight());

const s = new BABYLON.Scene(e);
const c = new BABYLON.UniversalCamera('c', BABYLON.Vector3.Zero(), s);
console.log('default viewport:', c.viewport ? `${c.viewport.x},${c.viewport.y},${c.viewport.width},${c.viewport.height}` : 'undefined');
c.viewport = new BABYLON.Viewport(0, 0, 0.5, 1.0);
console.log('after set:', `${c.viewport.x},${c.viewport.y},${c.viewport.width},${c.viewport.height}`);
console.log('viewport func-', typeof BABYLON.Viewport);
