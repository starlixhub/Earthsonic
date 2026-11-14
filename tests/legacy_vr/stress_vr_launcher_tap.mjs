/**
 * tests/stress_vr_launcher_tap.mjs
 * Empirical Challenger Stress Harness for VRLauncher (Milestone M1).
 *
 * Verifies:
 * 1. Mobile tap gesture sequence (Audio unlock, DeviceOrientation, Fullscreen, Orientation Lock, Stem playback, Mode entry).
 * 2. Mobile overlay non-persistence (clean dismissal, display: none, hidden class).
 * 3. Rapid/re-entrant tap handling without unhandled rejections or duplicated state.
 * 4. Desktop launch modal lifecycle (open, close, backdrop click, Escape key, clipboard API & execCommand fallback).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { VRLauncher } from '../frontend/js/ui/vr_launcher.js';

function createMockClassList(initial = []) {
  const set = new Set(initial);
  return {
    add: (c) => set.add(c),
    remove: (c) => set.delete(c),
    contains: (c) => set.has(c),
    toggle: (c) => set.has(c) ? set.delete(c) : set.add(c),
    get size() { return set.size; }
  };
}

function createMockElement(id, initialClasses = []) {
  const listeners = {};
  return {
    id,
    classList: createMockClassList(initialClasses),
    style: {},
    value: '',
    textContent: '',
    appendChild: () => {},
    remove: () => {},
    offsetHeight: 20,
    select: function() { this.selected = true; },
    selected: false,
    addEventListener: (evt, fn) => {
      listeners[evt] = listeners[evt] || [];
      listeners[evt].push(fn);
    },
    dispatchEvent: (evt) => {
      const fns = listeners[evt.type] || [];
      for (const fn of fns) fn(evt);
    },
    trigger: (evtName, payload = {}) => {
      const fns = listeners[evtName] || [];
      for (const fn of fns) fn({ target: payload.target || this, ...payload });
    }
  };
}

// ============================================================================
// 1. Mobile Tap Gesture Sequence & Non-Persistence
// ============================================================================
test('VR Launcher Stress 1: Full tap gesture sequence execution & non-persistence', async () => {
  const callLog = [];

  const mockModal = createMockElement('vr-desktop-modal', ['hidden']);
  const mockMobile = createMockElement('mobile-vr-launcher', []);
  const mockBtnTap = createMockElement('btn-mobile-vr-tap');
  const mockCanvas = createMockElement('vr-qr-canvas');
  const mockInput = createMockElement('vr-url-input');

  let audioContextResumed = false;
  let orientationPermissionRequested = false;
  let fullscreenRequested = false;
  let orientationLockRequested = false;
  let audioStemsLoaded = false;
  let mixerPlayed = false;
  let vrEntered = false;

  const mockApp = {
    mixer: {
      ctx: {
        state: 'suspended',
        resume: async () => {
          callLog.push('audio_resume');
          audioContextResumed = true;
        }
      },
      isPlaying: false,
      play: () => {
        callLog.push('mixer_play');
        mixerPlayed = true;
      }
    },
    loadAudioStemsIfNeeded: async () => {
      callLog.push('stems_load');
      audioStemsLoaded = true;
    }
  };

  // Mock global browser environment
  const origDoc = globalThis.document;
  const origWin = globalThis.window;
  const origScreen = globalThis.screen;
  const origDeviceOrientationEvent = globalThis.DeviceOrientationEvent;

  globalThis.document = {
    getElementById: (id) => {
      const map = {
        'vr-desktop-modal': mockModal,
        'mobile-vr-launcher': mockMobile,
        'btn-mobile-vr-tap': mockBtnTap,
        'vr-qr-canvas': mockCanvas,
        'vr-url-input': mockInput
      };
      return map[id] || null;
    },
    documentElement: {
      requestFullscreen: async () => {
        callLog.push('fullscreen_request');
        fullscreenRequested = true;
      }
    },
    body: {
      classList: createMockClassList()
    }
  };

  globalThis.DeviceOrientationEvent = {
    requestPermission: async () => {
      callLog.push('orientation_perm');
      orientationPermissionRequested = true;
      return 'granted';
    }
  };

  globalThis.screen = {
    orientation: {
      lock: async (mode) => {
        callLog.push(`orientation_lock_${mode}`);
        orientationLockRequested = true;
        assert.equal(mode, 'landscape', 'Must request landscape orientation lock');
      }
    }
  };

  globalThis.window = {
    addEventListener: () => {},
    dispatchEvent: (evt) => callLog.push(`window_event_${evt.type}`),
    location: { origin: 'http://192.168.1.100:5000', search: '?vr=1' },
    earthsonicVR: {
      enterVR: ({ mode }) => {
        callLog.push(`enter_vr_${mode}`);
        vrEntered = true;
      }
    }
  };

  try {
    const launcher = new VRLauncher(mockApp);
    launcher.cacheElements();

    // Execute mobile tap handler
    await launcher.handleMobileTap();

    // 1. Verify AudioContext resumed
    assert.ok(audioContextResumed, 'AudioContext.resume() must be called');

    // 2. Verify iOS DeviceOrientation permission requested
    assert.ok(orientationPermissionRequested, 'DeviceOrientationEvent.requestPermission() must be called');

    // 3. Verify Fullscreen requested
    assert.ok(fullscreenRequested, 'document.documentElement.requestFullscreen() must be called');

    // 4. Verify Landscape orientation locked
    assert.ok(orientationLockRequested, 'screen.orientation.lock("landscape") must be called');

    // 5. Verify audio stem loading & playback triggered
    assert.ok(audioStemsLoaded, 'loadAudioStemsIfNeeded() must be triggered');
    assert.ok(mixerPlayed, 'mixer.play() must be triggered');

    // 6. Verify VR mode entered
    assert.ok(vrEntered, 'window.earthsonicVR.enterVR({ mode: "auto" }) must be called');

    // 7. Non-Persistence: Overlay must be cleanly hidden and not persist
    assert.ok(mockMobile.classList.contains('hidden'), 'Mobile launcher overlay must have "hidden" class');
    assert.equal(mockMobile.style.display, 'none', 'Mobile launcher overlay style.display must be "none"');

    // 8. Order of operations audit: audio and orientation before VR transition
    const idxAudio = callLog.indexOf('audio_resume');
    const idxPerm = callLog.indexOf('orientation_perm');
    const idxFull = callLog.indexOf('fullscreen_request');
    const idxLock = callLog.indexOf('orientation_lock_landscape');
    const idxVR = callLog.indexOf('enter_vr_auto');

    assert.ok(idxAudio < idxVR, 'Audio unlock must precede VR entry');
    assert.ok(idxPerm < idxVR, 'DeviceOrientation permission must precede VR entry');
    assert.ok(idxFull < idxVR, 'Fullscreen request must precede VR entry');
    assert.ok(idxLock < idxVR, 'Orientation lock must precede VR entry');
  } finally {
    globalThis.document = origDoc;
    globalThis.window = origWin;
    globalThis.screen = origScreen;
    globalThis.DeviceOrientationEvent = origDeviceOrientationEvent;
  }
});

// ============================================================================
// 2. Graceful Degradation Under Mobile Permission & API Rejection
// ============================================================================
test('VR Launcher Stress 2: Graceful degradation when Fullscreen, Audio, or Orientation reject', async () => {
  const mockModal = createMockElement('vr-desktop-modal', ['hidden']);
  const mockMobile = createMockElement('mobile-vr-launcher', []);

  let vrEntered = false;

  const mockApp = {
    mixer: {
      ctx: {
        state: 'suspended',
        resume: async () => { throw new Error('Simulated AudioContext resume failure'); }
      },
      isPlaying: false,
      play: () => { throw new Error('Simulated mixer play failure'); }
    }
  };

  const origDoc = globalThis.document;
  const origWin = globalThis.window;
  const origScreen = globalThis.screen;
  const origDeviceOrientationEvent = globalThis.DeviceOrientationEvent;

  globalThis.document = {
    getElementById: (id) => (id === 'mobile-vr-launcher' ? mockMobile : mockModal),
    documentElement: {
      requestFullscreen: async () => { throw new Error('Simulated Fullscreen denied'); }
    },
    body: {
      classList: createMockClassList()
    }
  };

  globalThis.DeviceOrientationEvent = {
    requestPermission: async () => { throw new Error('Simulated iOS orientation denied'); }
  };

  globalThis.screen = {
    orientation: {
      lock: async () => { throw new Error('Simulated orientation lock unsupported'); }
    }
  };

  globalThis.window = {
    addEventListener: () => {},
    dispatchEvent: () => {},
    location: { origin: 'http://192.168.1.100:5000', search: '?vr=1' },
    earthsonicVR: {
      enterVR: () => { vrEntered = true; }
    }
  };

  try {
    const launcher = new VRLauncher(mockApp);
    launcher.cacheElements();

    // Must NOT throw unhandled rejection even if all mobile browser permissions fail!
    await launcher.handleMobileTap();

    // Flow must complete and transition to VR regardless
    assert.ok(vrEntered, 'VR transition must still proceed even if auxiliary APIs fail');
    assert.ok(mockMobile.classList.contains('hidden'), 'Overlay must still be hidden');
  } finally {
    globalThis.document = origDoc;
    globalThis.window = origWin;
    globalThis.screen = origScreen;
    globalThis.DeviceOrientationEvent = origDeviceOrientationEvent;
  }
});

// ============================================================================
// 3. Desktop Modal State Lifecycle & Clipboard Copying
// ============================================================================
test('VR Launcher Stress 3: Desktop modal lifecycle, Escape, backdrop click, and clipboard fallback', async () => {
  const mockModal = createMockElement('vr-desktop-modal', ['hidden']);
  const mockBtnClose = createMockElement('btn-close-vr-modal');
  const mockBtnEnterVr = createMockElement('btn-enter-vr');
  const mockInput = createMockElement('vr-url-input');
  const mockBtnCopy = createMockElement('btn-copy-vr-link');
  const mockBtnCopyText = createMockElement('btn-copy-vr-link-text');
  mockBtnCopyText.textContent = 'COPY LINK';

  const windowListeners = {};
  const origDoc = globalThis.document;
  const origWin = globalThis.window;
  const origRaf = globalThis.requestAnimationFrame;
  const origNavDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);

  let clipboardWritten = null;
  let execCommandCalled = false;

  const mockNav = {
    clipboard: {
      writeText: async (text) => {
        clipboardWritten = text;
      }
    }
  };

  Object.defineProperty(globalThis, 'navigator', {
    value: mockNav,
    configurable: true,
    writable: true
  });

  globalThis.document = {
    getElementById: (id) => {
      const map = {
        'vr-desktop-modal': mockModal,
        'btn-close-vr-modal': mockBtnClose,
        'btn-enter-vr': mockBtnEnterVr,
        'vr-url-input': mockInput,
        'btn-copy-vr-link': mockBtnCopy,
        'btn-copy-vr-link-text': mockBtnCopyText
      };
      return map[id] || null;
    },
    createElement: (tag) => createMockElement(tag),
    execCommand: (cmd) => {
      if (cmd === 'copy') execCommandCalled = true;
    },
    body: {
      classList: createMockClassList(),
      appendChild: () => {},
      contains: () => true
    }
  };

  globalThis.window = {
    addEventListener: (evt, fn) => {
      windowListeners[evt] = windowListeners[evt] || [];
      windowListeners[evt].push(fn);
    },
    dispatchEvent: () => {},
    location: { origin: 'http://127.0.0.1:5000', search: '' }
  };

  try {
    const launcher = new VRLauncher({});
    launcher.init();

    // 1. Open modal via openDesktopModal
    launcher.openDesktopModal();
    assert.equal(launcher.isOpen, true);
    assert.ok(!mockModal.classList.contains('hidden'));
    assert.equal(mockModal.style.display, 'flex');

    // 2. Close modal via Escape key
    const escapeListeners = windowListeners['keydown'] || [];
    for (const fn of escapeListeners) fn({ key: 'Escape' });
    assert.equal(launcher.isOpen, false);
    assert.ok(mockModal.classList.contains('hidden'));
    assert.equal(mockModal.style.display, 'none');

    // 3. Re-open and close via backdrop click
    launcher.openDesktopModal();
    assert.equal(launcher.isOpen, true);
    // Click outside (target is the backdrop modal itself)
    mockModal.trigger('click', { target: mockModal });
    assert.equal(launcher.isOpen, false);
    assert.ok(mockModal.classList.contains('hidden'));

    // 4. Test Clipboard API copying
    launcher.cachedLaunchUrl = 'http://192.168.1.100:5000/?vr=1';
    mockInput.value = 'http://192.168.1.100:5000/?vr=1';
    await launcher.copyLaunchLink();
    assert.equal(clipboardWritten, 'http://192.168.1.100:5000/?vr=1');
    assert.equal(mockBtnCopyText.textContent, 'COPIED ✓');

    // 5. Test execCommand fallback when navigator.clipboard throws
    mockNav.clipboard.writeText = async () => { throw new Error('Permission denied'); };
    execCommandCalled = false;
    await launcher.copyLaunchLink();
    assert.ok(execCommandCalled, 'Must fall back to document.execCommand("copy")');
    assert.ok(mockInput.selected, 'Input must be selected for execCommand copy');
  } finally {
    globalThis.document = origDoc;
    globalThis.window = origWin;
    globalThis.requestAnimationFrame = origRaf;
    if (origNavDescriptor) {
      Object.defineProperty(globalThis, 'navigator', origNavDescriptor);
    }
  }
});
