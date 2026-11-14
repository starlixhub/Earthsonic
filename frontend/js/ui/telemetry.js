/**
 * frontend/js/ui/telemetry.js
 * NASA Flight-Deck Telemetry Bar & Toast Notification System.
 * NASA Space Apps Challenge 2026: "The Earth Information Jukebox"
 */

let toastContainer = null;

/**
 * Initialize or get toast notification container.
 */
function getToastContainer() {
  if (toastContainer && document.body.contains(toastContainer)) {
    return toastContainer;
  }
  let el = document.getElementById('toast-container');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast-container';
    el.className = 'toast-container';
    document.body.appendChild(el);
  }
  toastContainer = el;
  return toastContainer;
}

/**
 * Display an aerospace telemetry HUD toast notification.
 * @param {string} message - Text content
 * @param {'info'|'success'|'warning'|'error'} [type='info'] - Status type
 * @param {number} [duration=3000] - Duration in ms
 */
export function showToast(message, type = 'info', duration = 3000) {
  if (typeof document === 'undefined') return null;

  const container = getToastContainer();
  const toast = document.createElement('div');
  toast.className = `telemetry-toast toast-${type}`;

  const iconMap = {
    info: '&#9670;',
    success: '&#10003;',
    warning: '&#9888;',
    error: '&#10007;'
  };

  toast.innerHTML = `
    <span class="toast-icon">${iconMap[type] || '&#9670;'}</span>
    <span class="toast-msg">${message}</span>
  `;

  container.appendChild(toast);

  // Trigger enter animation
  requestAnimationFrame(() => {
    toast.classList.add('toast-visible');
  });

  // Schedule dismissal
  const timer = setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }, duration);

  return {
    element: toast,
    dismiss: () => {
      clearTimeout(timer);
      toast.classList.remove('toast-visible');
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }
  };
}

/**
 * Update top telemetry status badge text and state.
 * @param {string} text - Status label
 * @param {'nominal'|'active'|'warning'|'alert'} [state='nominal']
 */
export function updateTelemetryStatus(text, state = 'nominal') {
  if (typeof document === 'undefined') return;
  const badge = document.getElementById('telemetry-status');
  if (badge) {
    badge.textContent = text ? text.replace(/&bull;/g, '•').replace(/&deg;/g, '°') : '';
  }
}

/**
 * Format current UTC time for flight-deck mission clock.
   * @returns {string} e.g. "2026-11-03 04:35:00 UTC"
  */
export function getFormattedMissionTime() {
  const now = new Date();
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  const ss = String(now.getUTCSeconds()).padStart(2, '0');
  const yyyy = String(now.getUTCFullYear());
  const mo = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mo}-${dd} ${hh}:${mm}:${ss} UTC`;
}

