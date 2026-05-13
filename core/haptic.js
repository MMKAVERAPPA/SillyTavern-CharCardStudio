// core/haptic.js
// Haptic (vibration) feedback for mobile interactions
// Reads hapticFeedback toggle from globalSettings before firing

import { memoryManager } from './memory.js';

export const haptic = {
    pulse(ms = 10) {
        try {
            const s = memoryManager.getGlobalSettings?.();
            if (!s?.hapticFeedback) return;
            if ('vibrate' in navigator) navigator.vibrate(ms);
        } catch { /* silent — vibrate not available on all devices */ }
    },
    double() { this.pulse(10); setTimeout(() => this.pulse(10), 80); },
    error()   { this.pulse(30); },
};
