// core/stats.js
// Usage statistics tracking for CharCardStudio

import { memoryManager } from './memory.js';

class StatsManager {
    constructor() {
        this._initGlobalStats();
    }

    _initGlobalStats() {
        const settings = memoryManager.getGlobalSettings();
        if (!settings.stats) {
            settings.stats = {
                totals: {
                    messages: 0,
                    fieldsGenerated: 0,
                    variations: 0,
                    quickEdits: 0,
                    tokensIn: 0,
                    tokensOut: 0,
                    sessions: 0
                },
                history: [] // [{ date: 'YYYY-MM-DD', metrics: {} }]
            };
            memoryManager.updateGlobalSettings({ stats: settings.stats });
        }
    }

    _getTodayStr() {
        return new Date().toISOString().split('T')[0];
    }

    record(metric, value = 1) {
        const settings = memoryManager.getGlobalSettings();
        if (!settings.stats) this._initGlobalStats();
        
        const stats = settings.stats;
        
        // Update total
        if (typeof stats.totals[metric] !== 'undefined') {
            stats.totals[metric] += value;
        } else {
            stats.totals[metric] = value;
        }

        // Update daily history
        const today = this._getTodayStr();
        let todayRecord = stats.history.find(r => r.date === today);
        if (!todayRecord) {
            todayRecord = { date: today, metrics: {} };
            stats.history.push(todayRecord);
            // keep only last 365 days
            if (stats.history.length > 365) stats.history.shift();
        }
        
        if (typeof todayRecord.metrics[metric] !== 'undefined') {
            todayRecord.metrics[metric] += value;
        } else {
            todayRecord.metrics[metric] = value;
        }

        memoryManager.updateGlobalSettings({ stats });
    }

    getStats() {
        const settings = memoryManager.getGlobalSettings();
        return settings.stats || { totals: {}, history: [] };
    }
}

export const statsManager = new StatsManager();
