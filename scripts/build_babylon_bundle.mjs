/**
 * scripts/build_babylon_bundle.mjs
 * Vendor Babylon.js (core + GUI) as a single-file ES module bundle for offline use.
 *
 * Rationale: the project loads Three.js from frontend/vendor/three/*.js with an
 * importmap (zero CDN). Babylon.js must follow the same policy — bundle the
 * engine locally and never fetch from a CDN at runtime.
 *
 * Output: frontend/vendor/babylon/babylon.core.module.js (core + gui)
 *
 * Usage: node scripts/build_babylon_bundle.mjs
 */

import { build } from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rootDir = path.resolve(import.meta.dirname, '..');

const babylonGuiPath = require.resolve('@babylonjs/gui/legacy/legacy.js', {
  paths: [rootDir]
});
const outDir = path.join(rootDir, 'frontend', 'vendor', 'babylon');
const outFile = path.join(outDir, 'babylon.core.module.js');

// Import the full Babylon core engine (includes NullEngine, WebXR module set,
// ShaderMaterial/Effect, cameras, materials, lights, ray, GUI exceptions, etc.)
// and the full GUI package (GUI3DManager, HolographicButton, MeshButton3D...).
const entryContents = `
import * as BABYLON from "@babylonjs/core/Legacy/legacy.js";
import * as BABYLON_GUI from "@babylonjs/gui/legacy/legacy.js";
export { BABYLON, BABYLON_GUI };
// Re-export the most used symbols directly for ergonomic named imports.
export const {
  Engine, NullEngine, Scene, Vector3, Vector2, Vector4, Quaternion, Matrix,
  Color3, Color4, Ray, TransformNode, Mesh, AbstractMesh, MeshBuilder,
  StandardMaterial, PBRMaterial, ShaderMaterial, Effect, MultiMaterial,
  Texture, RawTexture, DynamicTexture, CanvasTexture, BaseTexture,
  UniversalCamera, TargetCamera, FreeCamera, Camera, ArcRotateCamera,
  DirectionalLight, HemisphericLight, PointLight, ShadowGenerator,
  Curve3, ImageProcessingConfiguration, EngineStore, Tools,
  CreateSphere, CreatePlane, CreateBox,
  AlphaModesForAllPasses
} = BABYLON;
export { BABYLON as default };
`.trim();

const entryFile = path.join(outDir, 'babylon.bundle.entry.mjs');
fs.mkdirSync(outDir, { recursive: true });

// Running :latest @babylonjs/gui requires the core classes. The GUI legacy entry
// imports from "@babylonjs/core/..." deep paths, which esbuild resolves against
// node_modules. We keep that resolution (no externals) so the bundle is fully
// self-contained offline.
const result = await build({
  stdin: {
    contents: entryContents,
    resolveDir: outDir,
    sourcefile: 'babylon.bundle.entry.mjs',
    loader: 'js'
  },
  outfile: outFile,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  sourcemap: false,
  legalComments: 'inline',
  logLevel: 'info',
  metafile: false
});

fs.rmSync(entryFile, { force: true });

if (result.errors && result.errors.length > 0) {
  console.error('[BUILD BABYLON BUNDLE] FAILED with errors:');
  for (const e of result.errors) console.error(e);
  process.exit(1);
}

const kb = Math.round(fs.statSync(outFile).size / 1024);
console.log(`[BUILD BABYLON BUNDLE] OK -> ${path.relative(rootDir, outFile)} (${kb} KB)`);
