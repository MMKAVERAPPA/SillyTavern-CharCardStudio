// ui/toast.js — Stacking toast notification system for v2.5.0

export class ToastManager {
    constructor() {
        this.container = null;
    }

    _ensureContainer() {
        if (this.container && document.body.contains(this.container)) return;
        this.container = document.createElement('div');
        this.container.className = 'ccs-toast-container';
        document.body.appendChild(this.container);
    }

    show(message, type = 'info', duration = 4000) {
        this._ensureContainer();

        const toast = document.createElement('div');
        toast.className = `ccs-toast-item ccs-toast-${type}`;
        
        const icons = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌' };
        toast.innerHTML = `
            <span class="ccs-toast-icon">${icons[type] || icons.info}</span>
            <span class="ccs-toast-text">${this._esc(message)}</span>
            <div class="ccs-toast-progress"><div class="ccs-toast-progress-fill" style="animation-duration:${duration}ms"></div></div>
        `;

        toast.addEventListener('click', () => this._dismiss(toast));
        this.container.prepend(toast);

        // Force reflow then add visible class for animation
        toast.offsetHeight;
        toast.classList.add('ccs-toast-visible');

        setTimeout(() => this._dismiss(toast), duration);
        return toast;
    }

    _dismiss(toast) {
        if (!toast || toast.classList.contains('ccs-toast-leaving')) return;
        toast.classList.add('ccs-toast-leaving');
        toast.addEventListener('animationend', () => toast.remove(), { once: true });
    }

    _esc(str) {
        return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }
}

export const toastManager = new ToastManager();
