/**
 * tests/test_dimensional_spec_empirical.mjs
 * Empirical Adversarial Test Harness for DimensionalSpecDrawer
 * Evaluates production class extracted verbatim from DIMENSIONAL_DRAWING_ASSESSMENT.md.
 */

import assert from 'node:assert/strict';
import test, { describe, beforeEach } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { setupMockDOM } from './mock_dom.js';

// Setup Mock DOM before importing extracted module
const { mockWin, mockDoc } = setupMockDOM();

// Dynamically extract class from DIMENSIONAL_DRAWING_ASSESSMENT.md to guarantee verbatim fidelity
const mdPath = path.resolve('DIMENSIONAL_DRAWING_ASSESSMENT.md');
const mdContent = fs.readFileSync(mdPath, 'utf8');
const secIndex = mdContent.indexOf('### 5.2 Production Implementation Module');
assert.ok(secIndex !== -1, 'Must locate Section 5.2 in DIMENSIONAL_DRAWING_ASSESSMENT.md');
const afterSec = mdContent.slice(secIndex);
const codeMatch = afterSec.match(/```javascript\r?\n([\s\S]*?)\r?\n```/);
assert.ok(codeMatch, 'Must find javascript code block under Section 5.2');
const extractedPath = path.resolve('tests/extracted_dimensional_spec.js');
fs.writeFileSync(extractedPath, codeMatch[1], 'utf8');

// Import the extracted class
const { DimensionalSpecDrawer } = await import('./extracted_dimensional_spec.js');

function createMockGlobe(initialEnabled = true) {
  const flyToCalls = [];
  return {
    controls: {
      enabled: initialEnabled
    },
    flyTo(lat, lon, alt, dur) {
      flyToCalls.push({ lat, lon, alt, dur });
    },
    _getFlyToCalls() {
      return flyToCalls;
    }
  };
}

describe('DimensionalSpecDrawer - Lifecycle & DOM Operations', () => {
  beforeEach(() => {
    setupMockDOM();
  });

  test('TC-DOM-01: Instantiation with configuration mounts correctly with expected initial styles', () => {
    const globe = createMockGlobe();
    const mixer = {};
    const customMount = globalThis.document.createElement('div');
    globalThis.document.body.appendChild(customMount);

    const drawer = new DimensionalSpecDrawer({
      globe,
      mixer,
      mountPoint: customMount
    });

    assert.equal(drawer.isOpen, false, 'Drawer must initialize in closed state');
    assert.equal(drawer.currentSensorId, 'OCO-2', 'Default sensor should be OCO-2');
    assert.ok(drawer.container, 'Container DOM node must be created');
    assert.equal(drawer.container.id, 'dimensional-spec-drawer');
    assert.ok(drawer.container.classList.contains('hidden'), 'Container must have hidden class');
    assert.equal(drawer.container.getAttribute('role'), 'dialog', 'Must specify ARIA role dialog');
    assert.equal(drawer.container.getAttribute('aria-modal'), 'true', 'Must specify aria-modal true');
    assert.equal(customMount.children.includes(drawer.container), true, 'Container must be appended to mountPoint');
    assert.equal(globalThis.window.getListenerCount('keydown'), 1, 'Must attach 1 window keydown listener');
    assert.equal(globalThis.window.getListenerCount('resize'), 1, 'Must attach 1 window resize listener');
  });

  test('TC-DOM-02: open() transitions container visibility and populates viewport with SVG', () => {
    const globe = createMockGlobe();
    const drawer = new DimensionalSpecDrawer({ globe });

    drawer.open();

    assert.equal(drawer.isOpen, true, 'isOpen flag must be true');
    assert.equal(drawer.container.classList.contains('hidden'), false, 'hidden class must be removed');
    assert.equal(drawer.container.style.display, 'flex', 'display style must be flex');
    assert.ok(drawer.viewport.innerHTML.includes('<svg id="dw-sheet-svg"'), 'Viewport must contain generated SVG');
    assert.ok(drawer.viewport.innerHTML.includes('NASA OCO-2 HIGH-RESOLUTION GRATING SPECTROMETER'), 'Must render default sensor title');
  });

  test('TC-DOM-03: close() hides container and cancels any pending animation frame', () => {
    const globe = createMockGlobe();
    const drawer = new DimensionalSpecDrawer({ globe });

    drawer.open();
    drawer.animationFrameId = 777; // Simulate active animation frame

    drawer.close();

    assert.equal(drawer.isOpen, false, 'isOpen flag must be false');
    assert.equal(drawer.container.classList.contains('hidden'), true, 'hidden class must be present');
    assert.equal(drawer.container.style.display, 'none', 'display style must be none');
    assert.equal(drawer.animationFrameId, null, 'animationFrameId must be reset to null');
    assert.equal(globalThis.window.cancelledRafs.has(777), true, 'cancelAnimationFrame must have been invoked');
  });

  test('TC-DOM-04: destroy() unmounts DOM element and cleans up all listeners and references', () => {
    const globe = createMockGlobe();
    const mountPoint = globalThis.document.createElement('div');
    globalThis.document.body.appendChild(mountPoint);

    const drawer = new DimensionalSpecDrawer({ globe, mountPoint });
    drawer.open();
    drawer.animationFrameId = 888;

    drawer.destroy();

    // Check window listeners cleared
    assert.equal(globalThis.window.getListenerCount('keydown'), 0, 'keydown listener must be removed from window');
    assert.equal(globalThis.window.getListenerCount('resize'), 0, 'resize listener must be removed from window');

    // Check DOM unmounted
    assert.equal(mountPoint.children.length, 0, 'Container element must be unmounted from mountPoint');

    // Check reference nullification
    assert.equal(drawer.container, null, 'container reference must be null');
    assert.equal(drawer.viewport, null, 'viewport reference must be null');
    assert.equal(drawer.selectEl, null, 'selectEl reference must be null');
    assert.equal(drawer.closeBtn, null, 'closeBtn reference must be null');
    assert.equal(drawer.globe, null, 'globe reference must be null');
    assert.equal(drawer.mixer, null, 'mixer reference must be null');
  });
});

describe('DimensionalSpecDrawer - OrbitControls Suppression & Camera Fly-To', () => {
  beforeEach(() => {
    setupMockDOM();
  });

  test('TC-ORB-01: open() disables OrbitControls; close() restores OrbitControls', () => {
    const globe = createMockGlobe(true);
    const drawer = new DimensionalSpecDrawer({ globe });

    assert.equal(globe.controls.enabled, true, 'Initially enabled');

    drawer.open();
    assert.equal(globe.controls.enabled, false, 'OrbitControls must be disabled while open');

    drawer.close();
    assert.equal(globe.controls.enabled, true, 'OrbitControls must be re-enabled when closed');
  });

  test('TC-ORB-02: destroy() while open restores OrbitControls to true', () => {
    const globe = createMockGlobe(true);
    const drawer = new DimensionalSpecDrawer({ globe });

    drawer.open();
    assert.equal(globe.controls.enabled, false, 'Disabled on open');

    drawer.destroy();
    assert.equal(globe.controls.enabled, true, 'Must restore OrbitControls to true during destroy()');
  });

  test('TC-ORB-03: Globe camera flyTo coupling triggers with correct telemetry coordinates', () => {
    const globe = createMockGlobe();
    const drawer = new DimensionalSpecDrawer({ globe });

    // 1. Initial open triggers OCO-2
    drawer.open('OCO-2');
    let calls = globe._getFlyToCalls();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { lat: 19.5362, lon: -155.5763, alt: 1.85, dur: 1.6 });

    // 2. Select MODIS-TEMP
    drawer.loadSensorBlueprint('MODIS-TEMP');
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1], { lat: 0.0, lon: 20.0, alt: 2.1, dur: 1.6 });

    // 3. Select AMSR2-ICE
    drawer.loadSensorBlueprint('AMSR2-ICE');
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[2], { lat: 82.0, lon: 0.0, alt: 1.9, dur: 1.6 });

    // 4. Select JASON3-OHT
    drawer.loadSensorBlueprint('JASON3-OHT');
    assert.equal(calls.length, 4);
    assert.deepEqual(calls[3], { lat: -25.0, lon: -130.0, alt: 2.2, dur: 1.6 });
  });

  test('TC-ORB-04: Gracefully handles missing controls or non-function flyTo', () => {
    // Globe without controls and without flyTo
    const minimalGlobe = {};
    const drawer = new DimensionalSpecDrawer({ globe: minimalGlobe });

    assert.doesNotThrow(() => {
      drawer.open();
      drawer.close();
      drawer.destroy();
    }, 'Must not throw when globe lacks controls or flyTo');
  });
});

describe('DimensionalSpecDrawer - Responsive Resize & Keyboard Interactions', () => {
  beforeEach(() => {
    setupMockDOM();
  });

  test('TC-RES-01: Resize event recalculates SVG maxHeight only when drawer is open', () => {
    const globe = createMockGlobe();
    const drawer = new DimensionalSpecDrawer({ globe });

    drawer.open();
    drawer.viewport.clientHeight = 600;

    // Trigger window resize
    globalThis.window.dispatchEvent({ type: 'resize' });

    const svg = drawer.viewport.querySelector('svg');
    assert.ok(svg, 'SVG must be in viewport');
    assert.equal(svg.style.maxHeight, '568px', 'maxHeight should be 600 - 32 = 568px');

    // Update clientHeight and dispatch resize again
    drawer.viewport.clientHeight = 900;
    globalThis.window.dispatchEvent({ type: 'resize' });
    assert.equal(svg.style.maxHeight, '868px', 'maxHeight should be 900 - 32 = 868px');

    // Close drawer
    drawer.close();
    drawer.viewport.clientHeight = 1000;
    globalThis.window.dispatchEvent({ type: 'resize' });
    // Should NOT have updated because isOpen is false
    assert.equal(svg.style.maxHeight, '868px', 'maxHeight must not change when drawer is closed');
  });

  test('TC-KEY-01: Escape key closes drawer when open', () => {
    const globe = createMockGlobe();
    const drawer = new DimensionalSpecDrawer({ globe });

    drawer.open();
    assert.equal(drawer.isOpen, true);

    // Dispatch Escape
    globalThis.window.dispatchEvent({ type: 'keydown', key: 'Escape' });
    assert.equal(drawer.isOpen, false, 'Escape key must close drawer');
  });

  test('TC-KEY-02: Non-Escape keys do not close drawer', () => {
    const globe = createMockGlobe();
    const drawer = new DimensionalSpecDrawer({ globe });

    drawer.open();
    assert.equal(drawer.isOpen, true);

    globalThis.window.dispatchEvent({ type: 'keydown', key: 'Enter' });
    globalThis.window.dispatchEvent({ type: 'keydown', key: 'Tab' });
    globalThis.window.dispatchEvent({ type: 'keydown', key: 'Space' });

    assert.equal(drawer.isOpen, true, 'Non-escape keys should not close drawer');
  });

  test('TC-BTN-01: Close button click closes drawer', () => {
    const globe = createMockGlobe();
    const drawer = new DimensionalSpecDrawer({ globe });

    drawer.open();
    assert.equal(drawer.isOpen, true);

    drawer.closeBtn.dispatchEvent({ type: 'click' });
    assert.equal(drawer.isOpen, false, 'Clicking closeBtn must close drawer');
  });
});

describe('DimensionalSpecDrawer - Mathematical Invariants & SVG CAD Schema', () => {
  beforeEach(() => {
    setupMockDOM();
  });

  test('TC-MATH-01: Determinant stroke invariant compensation factor --u is mathematically exact', () => {
    const globe = createMockGlobe();
    const drawer = new DimensionalSpecDrawer({ globe });

    drawer.open('OCO-2');
    const svgContent = drawer.viewport.innerHTML;

    // Upstream formula:
    // sc = 0.45, ia = 0.94 * sc = 0.423, ib = 0.17 * sc = 0.0765
    // ic = -0.34 * sc = -0.153, id = 0.47 * sc = 0.2115
    // det = |ia * id - ib * ic| = |0.423 * 0.2115 - 0.0765 * -0.153| = |0.0894645 - (-0.0117045)| = 0.101169
    // u = 1 / sqrt(0.101169) = 3.1439739... -> u.toFixed(4) = '3.1440'
    assert.ok(svgContent.includes('--u: 3.1440;'), 'SVG root style must include exact calculated --u invariant');
  });

  test('TC-CAD-01: Exploded axonometric view contains all 5 parallel oblique stack layers (L0-L4)', () => {
    const globe = createMockGlobe();
    const drawer = new DimensionalSpecDrawer({ globe });

    drawer.open('OCO-2');
    const svgContent = drawer.viewport.innerHTML;

    assert.ok(svgContent.includes('L0 · GROUND DATUM'), 'Must render Layer 0 Ground Datum');
    assert.ok(svgContent.includes('L1 · THERMAL SCRIM'), 'Must render Layer 1 Thermal Scrim');
    assert.ok(svgContent.includes('L2 · MAIN CHASSIS'), 'Must render Layer 2 Main Chassis');
    assert.ok(svgContent.includes('L3 · OPTICAL BENCH'), 'Must render Layer 3 Optical Bench');
    assert.ok(svgContent.includes('L4 · CRYO SENSOR'), 'Must render Layer 4 Cryo Sensor');
    assert.ok(svgContent.includes('VIEW B · 2.5D AXONOMETRIC EXPLODED LAYER STACK'), 'Must include view label');
  });
});

describe('DimensionalSpecDrawer - Adversarial Stress & Edge Cases', () => {
  beforeEach(() => {
    setupMockDOM();
  });

  test('TC-ADV-01: Consecutive repeated open() calls are idempotent', () => {
    const globe = createMockGlobe();
    const drawer = new DimensionalSpecDrawer({ globe });

    drawer.open();
    const firstCallCount = globe._getFlyToCalls().length;
    assert.equal(firstCallCount, 1);

    // Call open() consecutively 3 times
    drawer.open();
    drawer.open();
    drawer.open();

    assert.equal(drawer.isOpen, true);
    assert.equal(globe._getFlyToCalls().length, 1, 'Should not re-trigger flyTo on consecutive open calls');
  });

  test('TC-ADV-02: Consecutive repeated close() calls are idempotent', () => {
    const globe = createMockGlobe();
    const drawer = new DimensionalSpecDrawer({ globe });

    drawer.open();
    drawer.close();
    assert.equal(drawer.isOpen, false);

    assert.doesNotThrow(() => {
      drawer.close();
      drawer.close();
    }, 'Repeated close calls must not throw');
    assert.equal(drawer.isOpen, false);
  });

  test('TC-ADV-03: Repeated consecutive destroy() calls do not throw', () => {
    const globe = createMockGlobe();
    const drawer = new DimensionalSpecDrawer({ globe });

    drawer.open();
    drawer.destroy();

    assert.doesNotThrow(() => {
      drawer.destroy();
      drawer.destroy();
    }, 'Consecutive destroy calls must be guarded and not throw');
  });

  test('TC-ADV-04: destroy() without ever opening does not throw', () => {
    const globe = createMockGlobe();
    const drawer = new DimensionalSpecDrawer({ globe });

    assert.doesNotThrow(() => {
      drawer.destroy();
    }, 'destroying an un-opened drawer must execute safely');

    assert.equal(drawer.container, null);
  });

  test('TC-ADV-05: Missing optional configuration parameters handle defaults safely', () => {
    // 1. No arguments at all
    assert.doesNotThrow(() => {
      const d1 = new DimensionalSpecDrawer();
      assert.equal(d1.globe, null);
      assert.equal(d1.mixer, null);
      d1.open();
      d1.close();
      d1.destroy();
    }, 'new DimensionalSpecDrawer() without options must succeed');

    // 2. Empty options object
    assert.doesNotThrow(() => {
      const d2 = new DimensionalSpecDrawer({});
      d2.destroy();
    }, 'new DimensionalSpecDrawer({}) must succeed');
  });

  test('TC-ADV-06 [CRITICAL FINDING]: Calling open() AFTER destroy() throws TypeError', () => {
    const globe = createMockGlobe();
    const drawer = new DimensionalSpecDrawer({ globe });

    drawer.destroy();

    // Because destroy() nullifies this.container, subsequent open() attempts to access this.container.classList
    assert.throws(
      () => {
        drawer.open();
      },
      {
        name: 'TypeError'
      },
      'Calling open() after destroy() should throw TypeError due to nullified container'
    );
  });

  test('TC-ADV-07 [CRITICAL FINDING]: new DimensionalSpecDrawer(null) throws TypeError', () => {
    // In JS, default parameter options = {} applies only to undefined, not null
    assert.throws(
      () => {
        new DimensionalSpecDrawer(null);
      },
      {
        name: 'TypeError'
      },
      'Passing null to constructor triggers TypeError: Cannot read properties of null (reading globe)'
    );
  });

  test('TC-ADV-08 [BEHAVIORAL FINDING]: close() forces controls.enabled=true even if pre-disabled', () => {
    // Scenario: User had already disabled OrbitControls (e.g., globe paused or inside another HUD mode)
    const globe = createMockGlobe(false); // Controls initially false!
    const drawer = new DimensionalSpecDrawer({ globe });

    assert.equal(globe.controls.enabled, false, 'Pre-condition: controls disabled');

    drawer.open();
    assert.equal(globe.controls.enabled, false);

    drawer.close();
    // close() sets controls.enabled = true without checking prior state!
    assert.equal(globe.controls.enabled, true, 'Demonstrates clobbering: controls forced to true on close');
  });

  test('TC-ADV-09: Unrecognized sensorId falls back safely without throw', () => {
    const globe = createMockGlobe();
    const drawer = new DimensionalSpecDrawer({ globe });

    // Open with non-existent sensor
    drawer.open('UNKNOWN_SENSOR_99');
    // Should fall back to default OCO-2
    assert.equal(drawer.currentSensorId, 'OCO-2');
    assert.ok(drawer.viewport.innerHTML.includes('OCO-2'));

    // Directly load invalid blueprint
    drawer.loadSensorBlueprint('NON_EXISTENT_PAYLOAD');
    // Should retain previous sensor
    assert.equal(drawer.currentSensorId, 'OCO-2');
  });

  test('TC-ADV-10: Memory Leak Teardown Check - window events detached completely', () => {
    const globe = createMockGlobe();
    const drawer = new DimensionalSpecDrawer({ globe });

    assert.equal(globalThis.window.getListenerCount('keydown'), 1);
    assert.equal(globalThis.window.getListenerCount('resize'), 1);

    drawer.destroy();

    assert.equal(globalThis.window.getListenerCount('keydown'), 0);
    assert.equal(globalThis.window.getListenerCount('resize'), 0);

    // Dispatching events to window post-destruction should produce zero effects
    assert.doesNotThrow(() => {
      globalThis.window.dispatchEvent({ type: 'keydown', key: 'Escape' });
      globalThis.window.dispatchEvent({ type: 'resize' });
    });
  });
});
