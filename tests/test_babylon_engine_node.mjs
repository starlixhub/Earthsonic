/**
 * tests/test_babylon_engine_node.mjs
 * Verification of the vendored Babylon.js engine layer (engine portability
 * contract for the Babylon.js VR migration).
 *
 * These tests run on NullEngine (Babylon's headless engine) so they pin the
 * Node-side invariants of the migration:
 *   - the vendored single-file bundle imports cleanly in Node (no window / no
 *     WebGL at import time)
 *   - NullEngine + Scene construct the same scene-graph shapes the VR
 *     subsystem uses (Mesh / TransformNode / cameras / ShaderMaterial)
 *   - the pure Babylon objects used by the ported subsystems exist
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { BABYLON, BABYLON_GUI } from '../frontend/vendor/babylon/babylon.core.module.js';

const {
  NullEngine,
  Scene,
  Vector3,
  Quaternion,
  Matrix,
  Color3,
  Color4,
  TransformNode,
  MeshBuilder,
  StandardMaterial,
  ShaderMaterial,
  Effect,
  UniversalCamera,
  TargetCamera,
  DirectionalLight,
  HemisphericLight,
  Ray,
  RawTexture,
  Tools
} = BABYLON;

describe('Babylon Engine Port: Node-side Invariants (NullEngine)', () => {

  it('BB-INST-01: vendored bundle exports engine + GUI namespaces without DOM', () => {
    assert.ok(BABYLON, 'BABYLON namespace must export from the vendored bundle');
    assert.ok(BABYLON_GUI, 'BABYLON_GUI namespace must export from the vendored bundle');
    assert.equal(typeof NullEngine, 'function');
    assert.equal(typeof Scene, 'function');
    // 3D GUI classes are direct exports of the GUI package (no sub-namespace)
    assert.equal(typeof BABYLON_GUI.GUI3DManager, 'function');
    assert.equal(typeof BABYLON_GUI.HolographicButton, 'function');
    assert.equal(typeof BABYLON_GUI.MeshButton3D, 'function');
    assert.equal(typeof BABYLON_GUI.Control3D, 'function');
    assert.ok(BABYLON.HolographicButton || BABYLON_GUI.HolographicButton, 'HolographicButton must be reachable');
  });

  it('BB-NULL-01: NullEngine constructs a scene with full scene-graph primitives', () => {
    const engine = new NullEngine();
    try {
      const scene = new Scene(engine);
      assert.ok(scene);

      const earth = new TransformNode('EarthGroup', scene);
      const sphere = MeshBuilder.CreateSphere('SurfaceMesh', { diameter: 20.0, segments: 64 }, scene);
      sphere.parent = earth;
      assert.equal(sphere.name, 'SurfaceMesh');
      assert.ok(sphere.parent === earth);

      const box = MeshBuilder.CreateSphere('Dot', { diameter: 0.1 }, scene);
      assert.ok(box);

      const cam = new UniversalCamera('VR_PerspectiveCamera', new Vector3(0, 0, 0), scene);
      cam.fov = 1.3089969389957472; // 75 deg
      assert.ok(cam);

      const sun = new DirectionalLight('SunLight', new Vector3(1, -1, 1), scene);
      sun.intensity = 3.2;
      assert.equal(sun.name, 'SunLight');

      const sky = new HemisphericLight('SpaceAmbientLight', new Vector3(0, 1, 0), scene);
      assert.ok(sky);

      const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1), 0.1, 250);
      assert.ok(ray.intersectsSphere({ center: new Vector3(0, 0, -2), radius: 0.25 }));

      const q = new Quaternion(0, 0, 0, 1);
      const m = Matrix.Identity();
      const v = new Vector3(1, 2, 3);
      assert.equal(v.length(), Math.sqrt(14));
      assert.ok(q);
      assert.ok(m);
      assert.ok(Color3.FromHexString('#ff8a3d'));
      assert.ok(Color4.FromHexString('#ff8a3dff'));
      assert.ok(typeof Tools === 'function' || typeof Tools === 'object');

      scene.dispose();
    } finally {
      engine.dispose();
    }
  });

  it('BB-SM-01: ShaderMaterial registers GLSL via Effect.ShadersStore and constructs on NullEngine', () => {
    const engine = new NullEngine();
    try {
      const scene = new Scene(engine);

      Effect.ShadersStore['bbSmokeVertexShader'] = 'precision highp float; attribute vec3 position; uniform mat4 world; uniform mat4 viewProjection; void main(){ gl_Position = viewProjection * world * vec4(position, 1.0); }';
      Effect.ShadersStore['bbSmokeFragmentShader'] = 'precision highp float; uniform vec3 uColor; void main(){ gl_FragColor = vec4(uColor, 1.0); }';

      const sphere = MeshBuilder.CreateSphere('Ribbon', { diameter: 20.03 }, scene);
      const mat = new ShaderMaterial('SmokeMat', scene, {
        vertex: 'bbSmoke',
        fragment: 'bbSmoke'
      }, {
        attributes: ['position', 'normal', 'uv'],
        uniforms: ['world', 'viewProjection', 'uColor'],
        needAlphaBlending: true
      });
      mat.setVector3('uColor', new Vector3(0.15, 0.35, 0.9));
      sphere.material = mat;

      assert.ok(mat);
      assert.equal(mat.name, 'SmokeMat');
      sphere.dispose();
      scene.dispose();
    } finally {
      engine.dispose();
      delete Effect.ShadersStore['bbSmokeVertexShader'];
      delete Effect.ShadersStore['bbSmokeFragmentShader'];
    }
  });

  it('BB-TEX-01: RawTexture placeholder constructor works headless', () => {
    const engine = new NullEngine();
    try {
      const scene = new Scene(engine);
      const placeholder = RawTexture.CreateRGBATexture(new Uint8Array(16), 2, 2, scene, false, false, BABYLON.Texture.NEAREST_SAMPLINGMODE, BABYLON.Engine.TEXTUREFORMAT_RGBA);
      assert.ok(placeholder);
      scene.dispose();
    } finally {
      engine.dispose();
    }
  });
});
