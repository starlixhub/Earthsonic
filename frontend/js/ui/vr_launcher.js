/**
 * frontend/js/ui/vr_launcher.js
 * VR Launch Coordinator: Desktop QR Bridge & Mobile Fullscreen Onboarding.
 * NASA Space Apps Challenge / EARTHSONIC.
 */

import { renderQRCodeToCanvas } from './qrcode.js';
import { showToast } from './telemetry.js';

export class VRLauncher {
  constructor(app) {
    this.app = app;
    this.elements = {};
    this.cachedLaunchUrl = null;
    this.isOpen = false;
  }

  init() {
    this.cacheElements();
    this.bindEvents();
    this.checkMobileAutoLaunch();
  }

  cacheElements() {
    this.elements = {
      btnEnterVr: document.getElementById('btn-enter-vr'),
      desktopModal: document.getElementById('vr-desktop-modal'),
      btnCloseModal: document.getElementById('btn-close-vr-modal'),
      qrCanvas: document.getElementById('vr-qr-canvas'),
      qrLoading: document.getElementById('vr-qr-loading'),
      urlInput: document.getElementById('vr-url-input'),
      btnCopyLink: document.getElementById('btn-copy-vr-link'),
      btnCopyLinkText: document.getElementById('btn-copy-vr-link-text'),
      btnEnterPcStereo: document.getElementById('btn-enter-pc-stereo'),
      mobileLauncher: document.getElementById('mobile-vr-launcher'),
      btnMobileTap: document.getElementById('btn-mobile-vr-tap')
    };
  }

  bindEvents() {
    // Top-bar button
    if (this.elements.btnEnterVr) {
      this.elements.btnEnterVr.addEventListener('click', () => {
        this.openDesktopModal();
      });
    }

    // Modal Close
    if (this.elements.btnCloseModal) {
      this.elements.btnCloseModal.addEventListener('click', () => this.closeDesktopModal());
    }

    // Click outside dialog to close
    if (this.elements.desktopModal) {
      this.elements.desktopModal.addEventListener('click', (e) => {
        if (e.target === this.elements.desktopModal) {
          this.closeDesktopModal();
        }
      });
    }

    // Escape key
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.isOpen) {
          this.closeDesktopModal();
        } else if (typeof window !== 'undefined' && window.earthsonicVR && window.earthsonicVR.isVRActive) {
          window.earthsonicVR.exitVR();
        }
      }
    });

    // Copy Link Button
    if (this.elements.btnCopyLink) {
      this.elements.btnCopyLink.addEventListener('click', () => this.copyLaunchLink());
    }

    // Enter Split-Screen Stereo on this PC
    if (this.elements.btnEnterPcStereo) {
      this.elements.btnEnterPcStereo.addEventListener('click', () => {
        this.closeDesktopModal();
        this.enterLocalVR('stereo');
      });
    }

    // Mobile Tap Target
    if (this.elements.btnMobileTap) {
      this.elements.btnMobileTap.addEventListener('click', () => this.handleMobileTap());
    }
  }

  checkMobileAutoLaunch() {
    if (typeof window === 'undefined' || !window.location) return;
    const params = new URLSearchParams(window.location.search);
    const isVR = params.get('vr') === '1' || params.get('vr') === 'true';

    if (isVR && this.elements.mobileLauncher) {
      this.elements.mobileLauncher.classList.remove('hidden');
      this.elements.mobileLauncher.style.display = 'flex';
    }
  }

  /**
   * Phone / tablet detection. iPadOS reports a desktop UA, so a coarse pointer
   * plus a narrow viewport counts as mobile too.
   */
  isMobileDevice() {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    const uaMobile = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|Opera Mini|IEMobile/i.test(ua);
    const coarse = (typeof window !== 'undefined' && window.matchMedia)
      ? window.matchMedia('(pointer: coarse)').matches
      : false;
    const narrow = typeof window !== 'undefined' && window.innerWidth <= 1024;
    return uaMobile || (coarse && narrow);
  }

  async openDesktopModal() {
    // On a phone the modal is a dead end: it only shows a QR code that points
    // the phone back at this same page. Go straight into the VR view.
    if (this.isMobileDevice()) {
      await this.handleMobileTap();
      return;
    }
    if (!this.elements.desktopModal) return;
    this.elements.desktopModal.classList.remove('hidden');
    this.elements.desktopModal.style.display = 'flex';
    this.isOpen = true;

    // Fetch LAN IP info if not already cached
    await this.loadLaunchInfo();
  }

  closeDesktopModal() {
    if (!this.elements.desktopModal) return;
    this.elements.desktopModal.classList.add('hidden');
    this.elements.desktopModal.style.display = 'none';
    this.isOpen = false;
  }

  async loadLaunchInfo() {
    let launchUrl = this.cachedLaunchUrl;

    if (!launchUrl) {
      if (this.elements.qrLoading) this.elements.qrLoading.classList.remove('hidden');

      try {
        const res = await fetch('/api/vr-launch-info');
        if (res.ok) {
          const data = await res.json();
          if (data && data.vr_url) {
            launchUrl = data.vr_url;
            this.cachedLaunchUrl = launchUrl;
          }
        }
      } catch (err) {
        console.warn('[VRLauncher] /api/vr-launch-info unavailable, using local origin fallback:', err.message);
      }

      // Fallback to current browser origin
      if (!launchUrl) {
        const origin = window.location.origin || `${window.location.protocol}//${window.location.host}`;
        launchUrl = `${origin}/?vr=1`;
        this.cachedLaunchUrl = launchUrl;
      }

      if (this.elements.qrLoading) this.elements.qrLoading.classList.add('hidden');
    }

    // Populate URL input
    if (this.elements.urlInput) {
      this.elements.urlInput.value = launchUrl;
    }

    // Render Canvas QR Code
    if (this.elements.qrCanvas) {
      try {
        renderQRCodeToCanvas(this.elements.qrCanvas, launchUrl, {
          size: 200,
          margin: 3,
          darkColor: '#060a12',
          lightColor: '#ffffff'
        });
      } catch (qrErr) {
        console.error('[VRLauncher] QR generation failed:', qrErr);
      }
    }
  }

  async copyLaunchLink() {
    const url = (this.elements.urlInput && this.elements.urlInput.value) || this.cachedLaunchUrl;
    if (!url) return;

    let copied = false;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch (e) {
        console.warn('[VRLauncher] Clipboard API error:', e);
      }
    }

    if (!copied && this.elements.urlInput) {
      try {
        this.elements.urlInput.select();
        document.execCommand('copy');
        copied = true;
      } catch (e) {
        console.warn('[VRLauncher] execCommand copy error:', e);
      }
    }

    if (this.elements.btnCopyLinkText) {
      const original = this.elements.btnCopyLinkText.textContent;
      this.elements.btnCopyLinkText.textContent = 'COPIED ✓';
      setTimeout(() => {
        if (this.elements.btnCopyLinkText) {
          this.elements.btnCopyLinkText.textContent = original;
        }
      }, 2000);
    }
    showToast('Mobile VR launch URL copied to clipboard', 'success', 2500);
  }

  async handleMobileTap() {
    // 1. Resume AudioContext
    try {
      if (this.app && this.app.mixer && this.app.mixer.ctx) {
        if (this.app.mixer.ctx.state === 'suspended') {
          await this.app.mixer.ctx.resume();
        }
      } else if (window.AudioContext || window.webkitAudioContext) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!window._sharedAudioCtx) window._sharedAudioCtx = new AudioCtx();
        if (window._sharedAudioCtx.state === 'suspended') await window._sharedAudioCtx.resume();
      }
    } catch (e) {
      console.warn('[VRLauncher] AudioContext unlock notice:', e);
    }

    // 2. iOS 13+ DeviceOrientation permission
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' &&
          typeof DeviceOrientationEvent.requestPermission === 'function') {
        await DeviceOrientationEvent.requestPermission();
      }
    } catch (e) {
      console.warn('[VRLauncher] DeviceOrientation permission notice:', e);
    }

    // 3. Request Fullscreen
    try {
      const docEl = document.documentElement;
      if (docEl.requestFullscreen) {
        await docEl.requestFullscreen().catch(() => {});
      } else if (docEl.webkitRequestFullscreen) {
        await docEl.webkitRequestFullscreen();
      }
    } catch (e) {
      console.warn('[VRLauncher] Fullscreen request notice:', e);
    }

    // 4. Orientation Lock
    try {
      if (screen.orientation && typeof screen.orientation.lock === 'function') {
        await screen.orientation.lock('landscape').catch(() => {});
      }
    } catch (e) {
      console.warn('[VRLauncher] Screen orientation lock notice:', e);
    }

    // 5. Hide mobile launcher overlay (button does not persist)
    if (this.elements.mobileLauncher) {
      this.elements.mobileLauncher.classList.add('hidden');
      this.elements.mobileLauncher.style.display = 'none';
    }

    // 6. Ensure live audio stems are playing
    if (this.app && this.app.mixer && !this.app.mixer.isPlaying) {
      try {
        if (typeof this.app.loadAudioStemsIfNeeded === 'function') {
          await this.app.loadAudioStemsIfNeeded();
        }
        if (typeof this.app.mixer.play === 'function') {
          this.app.mixer.play();
        }
      } catch (e) {
        console.warn('[VRLauncher] Audio start notice:', e);
      }
    }

    // 7. Transition into VR
    this.enterLocalVR('auto');
  }

  enterLocalVR(mode = 'auto') {
    // Prefer Orbital Examine (M5) if available, fall back to legacy Terminator Skim
    const orbVR = window.earthsonicOrbitalVR;
    const legacyVR = window.earthsonicVR;

    if (orbVR && typeof orbVR.enterVR === 'function') {
      orbVR.enterVR({ forceStereo: mode === 'stereo' });
    } else if (legacyVR && typeof legacyVR.enterVR === 'function') {
      legacyVR.enterVR({ mode });
    } else {
      // Contractual dispatch for Milestone M4 VR subsystem
      window.dispatchEvent(new CustomEvent('earthsonic:enter-vr', {
        detail: { mode, timestamp: Date.now() }
      }));
      document.body.classList.add('vr-mode-active');
      showToast(
        mode === 'stereo'
          ? 'Entered Split-Screen VR (Orbital Examine)'
          : 'Entered Orbital Examine VR Mode',
        'info', 3000
      );
    }
  }
}
