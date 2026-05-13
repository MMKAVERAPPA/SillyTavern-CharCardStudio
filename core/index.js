// core/index.js
// Barrel re-exports for all core singletons.
// Import from here for cleaner code: import { apiManager, memoryManager } from '../core/index.js'

export { apiManager, ApiManager, CCSApiError, classifyApiError } from './api.js';
export { auditEngine }                                             from './audit.js';
export { cardManager, FIELD_LABELS }                              from './card.js';
export { chatEngine }                                             from './chat.js';
export { contextBuilder }                                         from './context-builder.js';
export { memoryManager }                                          from './memory.js';
export { parseFieldBlocks, detectPhaseSwitch }                    from './parser.js';
export { skillRouter }                                            from './skill-router.js';
export { statsManager }                                           from './stats.js';
export { worldInfoManager }                                       from './worldinfo.js';
