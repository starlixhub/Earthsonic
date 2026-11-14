/**
 * tests/test_vr_bridge_node.mjs
 * Verification of Mobile VR Bridge, Desktop Launch Modal, and DOM contracts.
 * Babylon.js port (VR-MIGRATION-2026): NO engine dependency — the entire VR
 * bridge/UI layer is DOM-only and imports directly from the untouched
 * frontend files. Assertions are the byte-for-byte 1:1 port of the isolation
 * markup contract (index.html / app.js / vr_launcher.js are untouched).
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { VRLauncher } from '../frontend/js/ui/vr_launcher.js';

describe('Milestone M1: Terminator Skim VR Bridge & Launch Modal', () => {

  test('VR-DOM-01: HTML markup hosts all required VR desktop and mobile bridge elements', () => {
    const htmlPath = path.resolve('frontend/index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    // 1. Header launch button
    assert.ok(html.includes('id="btn-enter-vr"'), 'Must contain #btn-enter-vr in header');
    assert.ok(html.includes('TERMINATOR SKIM VR'), 'Must have high-visibility TERMINATOR SKIM VR button label');

    // 2. Desktop VR Modal
    assert.ok(html.includes('id="vr-desktop-modal"'), 'Must contain #vr-desktop-modal container');
    assert.ok(html.includes('role="dialog"'), 'Must declare role="dialog"');
    assert.ok(html.includes('aria-modal="true"'), 'Must declare aria-modal="true"');
    assert.ok(html.includes('id="btn-close-vr-modal"'), 'Must contain #btn-close-vr-modal close button');
    assert.ok(html.includes('id="vr-qr-canvas"'), 'Must contain #vr-qr-canvas for QR rendering');
    assert.ok(html.includes('width="220"'), 'QR canvas width must be 220');
    assert.ok(html.includes('height="220"'), 'QR canvas height must be 220');
    assert.ok(html.includes('id="vr-url-input"'), 'Must contain #vr-url-input');
    assert.ok(html.includes('id="btn-copy-vr-link"'), 'Must contain #btn-copy-vr-link');
    assert.ok(html.includes('id="btn-enter-pc-stereo"'), 'Must contain #btn-enter-pc-stereo button');

    // 3. Mobile VR Launcher Overlay
    assert.ok(html.includes('id="mobile-vr-launcher"'), 'Must contain #mobile-vr-launcher overlay');
    assert.ok(html.includes('id="btn-mobile-vr-tap"'), 'Must contain #btn-mobile-vr-tap target');
    assert.ok(html.includes('TAP TO LOCK LANDSCAPE &amp; INSERT INTO VR HEADSET'),
      'Must contain verbatim mobile tap instruction');
  });

  test('VR-DOM-02: Preservation of existing baseline test invariants in index.html', () => {
    const htmlPath = path.resolve('frontend/index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    assert.ok(html.includes('id="btn-judge-tour"'), 'Preserved #btn-judge-tour');
    assert.ok(html.includes('GUIDED MISSION (45s)'), 'Preserved GUIDED MISSION (45s)');
    assert.ok(html.includes('id="btn-open-sensors"'), 'Preserved #btn-open-sensors');
    assert.ok(html.includes('id="btn-export-wav"'), 'Preserved #btn-export-wav');
    assert.ok(html.includes('id="globe-viewport-container"'), 'Preserved #globe-viewport-container');
    assert.ok(html.includes('#070709'), 'Preserved #070709 background');
    assert.ok(html.includes('id="telemetry-matrix-grid"'), 'Preserved #telemetry-matrix-grid');
    assert.ok(html.includes('FLIGHT DECK ONLINE • 23.44° TILT'), 'Preserved Unicode bullet status');
  });

  test('VR-APP-01: app.js coordinates VRLauncher initialization', () => {
    const appPath = path.resolve('frontend/js/app.js');
    const appCode = fs.readFileSync(appPath, 'utf8');

    assert.ok(appCode.includes("import { VRLauncher } from './ui/vr_launcher.js';"), 'Must import VRLauncher');
    assert.ok(appCode.includes('this.vrLauncher = new VRLauncher(this);'), 'Must instantiate VRLauncher');
    assert.ok(appCode.includes('this.vrLauncher.init();'), 'Must initialize VRLauncher');
  });

  test('VR-LAUNCHER-01: VRLauncher class handles modal and tap gesture lifecycle', async () => {
    // Mock minimal DOM environment
    const classList = (initial = []) => {
      const set = new Set(initial);
      return {
        add: (c) => set.add(c),
        remove: (c) => set.delete(c),
        contains: (c) => set.has(c),
        toggle: (c) => set.has(c) ? set.delete(c) : set.add(c)
      };
    };

    const mockModal = { classList: classList(['hidden']), style: {}, addEventListener: () => {} };
    const mockMobile = { classList: classList(['hidden']), style: {}, addEventListener: () => {} };
    const mockBtnTap = { addEventListener: () => {} };
    const mockInput = { value: '', select: () => {} };

    let audioResumed = false;
    let vrEntered = false;

    const mockApp = {
      mixer: {
        ctx: {
          state: 'suspended',
          resume: async () => { audioResumed = true; }
        },
        isPlaying: false,
        play: () => {}
      }
    };

    // Global mocks
    const origDoc = globalThis.document;
    const origWin = globalThis.window;
    const origScreen = globalThis.screen;

    globalThis.document = {
      getElementById: (id) => {
        if (id === 'vr-desktop-modal') return mockModal;
        if (id === 'mobile-vr-launcher') return mockMobile;
        if (id === 'btn-mobile-vr-tap') return mockBtnTap;
        if (id === 'vr-url-input') return mockInput;
        return null;
      },
      documentElement: {
        requestFullscreen: async () => {}
      },
      body: {
        classList: classList()
      }
    };

    globalThis.window = {
      addEventListener: () => {},
      dispatchEvent: () => {},
      location: { origin: 'http://192.168.1.50:5000', search: '?vr=1' },
      earthsonicVR: {
        enterVR: ({ mode }) => {
          vrEntered = true;
          assert.ok(mode === 'auto' || mode === 'stereo');
        }
      }
    };

    globalThis.screen = {
      orientation: {
        lock: async () => {}
      }
    };

    try {
      const launcher = new VRLauncher(mockApp);
      launcher.cacheElements();

      // Test open / close modal
      launcher.openDesktopModal();
      assert.ok(!mockModal.classList.contains('hidden'), 'Modal should not have hidden class after open');

      launcher.closeDesktopModal();
      assert.ok(mockModal.classList.contains('hidden'), 'Modal should have hidden class after close');

      // Test mobile tap handler
      await launcher.handleMobileTap();
      assert.ok(audioResumed, 'AudioContext must be resumed upon mobile tap');
      assert.ok(mockMobile.classList.contains('hidden'), 'Mobile launcher button overlay must NOT persist');
      assert.ok(vrEntered, 'window.earthsonicVR.enterVR must be called');
    } finally {
      globalThis.document = origDoc;
      globalThis.window = origWin;
      globalThis.screen = origScreen;
    }
  });

});
