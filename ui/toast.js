/**
 * Toast notification system for CharCardStudio.
 * Creates a fixed container (bottom-right) and manages toast lifecycle.
 * @module ui/toast
 */

const MAX_TOASTS = 5;
const ICONS = {
  info:    'fa-solid fa-circle-info',
  success: 'fa-solid fa-circle-check',
  warning: 'fa-solid fa-triangle-exclamation',
  error:   'fa-solid fa-circle-xmark',
};

let container = null;

function ensureContainer() {
  if (container && document.body.contains(container)) return container;
  container = document.createElement('div');
  container.className = 'ccs-toast-container';
  document.body.appendChild(container);
  return container;
}

/**
 * Show a toast notification.
 * @param {string} message - Text to display.
 * @param {'info'|'success'|'warning'|'error'} [type='info']
 * @param {number} [duration=4000] - Auto-dismiss in ms. 0 = manual only.
 * @returns {HTMLElement} The toast element.
 */
export function showToast(message, type = 'info', duration = 4000) {
  const wrap = ensureContainer();

  // Enforce max visible — remove oldest
  while (wrap.children.length >= MAX_TOASTS) {
    wrap.removeChild(wrap.firstChild);
  }

  const el = document.createElement('div');
  el.className = `ccs-toast ccs-toast--${type}`;
  el.innerHTML = [
    `<i class="ccs-toast-icon ${ICONS[type] || ICONS.info}"></i>`,
    `<span class="ccs-toast-text">${escapeHtml(message)}</span>`,
    `<button class="ccs-toast-close" aria-label="Dismiss"><i class="fa-solid fa-xmark"></i></button>`,
  ].join('');

  el.querySelector('.ccs-toast-close').addEventListener('click', (e) => {
    e.stopPropagation();
    dismiss(el);
  });

  wrap.appendChild(el);

  if (duration > 0) {
    setTimeout(() => dismiss(el), duration);
  }

  return el;
}

/** Remove all visible toasts. */
export function clearAllToasts() {
  if (!container) return;
  while (container.firstChild) container.removeChild(container.firstChild);
}

/* ── internal ── */

function dismiss(el) {
  if (!el.parentNode) return;
  el.classList.add('ccs-toast-exit');
  el.addEventListener('animationend', () => el.remove(), { once: true });
  // Fallback if animation doesn't fire (e.g. reduced motion)
  setTimeout(() => el.remove(), 400);
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
