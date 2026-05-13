// ui/chat-panel.js
// Chat area: message rendering, streaming, accept bars, variation panels, edit/resend
// FIX: restoreHistory pushes to messages, cancelStreaming(), annotation leak fix, markdown order fix

export class ChatPanel {
    constructor() {
        this.container = null;
        this.inputEl = null;
        this.sendBtn = null;
        this.abortBtn = null;
        this.streamingEl = null;
        this.onSend = null;
        this.onAbort = null;
        this.messages = [];
        this._annotationAbort = null; // AbortController for annotation listener
        this._windowSize = 50;        // max .ccs-msg nodes in DOM at once
        this._firstVisibleIdx = 0;    // index in this.messages of first DOM-rendered msg
    }

    init(containerId, onSend, onAbort) {
        this.container = document.getElementById(containerId);
        this.onSend = onSend;
        this.onAbort = onAbort;
    }

    bindInput(inputId, sendBtnId, abortBtnId) {
        this.inputEl  = document.getElementById(inputId);
        this.sendBtn  = document.getElementById(sendBtnId);
        this.abortBtn = document.getElementById(abortBtnId);

        // Abort button hidden by default — shown during generation
        if (this.abortBtn) this.abortBtn.style.display = 'none';

        this.sendBtn?.addEventListener('click', () => this._handleSend());
        this.abortBtn?.addEventListener('click', () => {
            this.onAbort?.();
            this.cancelStreaming(); // FIX: also clean up streaming element
            this.setInputEnabled(true); // re-enable immediately on stop
        });

        this.inputEl?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._handleSend(); }
        });

        // Auto-grow textarea
        this.inputEl?.addEventListener('input', () => {
            this.inputEl.style.height = 'auto';
            this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 200) + 'px';
        });
    }

    _handleSend() {
        const text = this.inputEl?.value.trim();
        if (!text) return;
        this.addMessage('user', text);
        this.inputEl.value = '';
        this.inputEl.style.height = 'auto';
        this.onSend?.(text);
    }

    // ── Message rendering ─────────────────────────────────────────────────────

    addMessage(role, content) {
        this._dismissWelcome();
        const index = this.messages.length;
        const el = this._buildMessageEl(role, content, index);
        this.container?.appendChild(el);
        this.messages.push({ role, content, el, index, ts: Date.now() });

        // Virtual windowing: prune oldest DOM nodes when over the limit
        const domCount = this.container?.querySelectorAll('.ccs-msg').length || 0;
        if (domCount > this._windowSize) this._pruneOldMessages();

        this._scrollToBottom();
        return el;
    }

    // Build a message DOM element (extracted for reuse in virtual scrolling)
    _buildMessageEl(role, content, index) {
        const el = document.createElement('div');
        el.className = `ccs-msg ccs-msg-${role}`;
        el.dataset.index = index;

        const bubble = document.createElement('div');
        bubble.className = 'ccs-msg-bubble';
        bubble.innerHTML = this._renderMarkdown(content);

        const time = document.createElement('div');
        time.className = 'ccs-msg-time';
        time.textContent = 'just now';
        time.dataset.ts = Date.now();

        const actions = document.createElement('div');
        actions.className = 'ccs-msg-actions';

        if (role === 'user') {
            actions.innerHTML = `
                <button class="ccs-msg-btn" title="Edit &amp; Resend">✏️</button>
                <button class="ccs-msg-btn" title="Resend">🔁</button>
            `;
            actions.querySelector('[title="Edit & Resend"]').addEventListener('click', () => this._editMessage(index, el));
            actions.querySelector('[title="Resend"]').addEventListener('click', () => this._resendMessage(index));
        } else {
            actions.innerHTML = `<button class="ccs-msg-btn" title="Copy">📋</button>`;
            actions.querySelector('[title="Copy"]').addEventListener('click', () => {
                navigator.clipboard.writeText(content).catch(() => {});
            });
        }

        el.appendChild(bubble);
        el.appendChild(time);
        el.appendChild(actions);
        return el;
    }

    // Virtual windowing helpers
    _pruneOldMessages() {
        const domMsgs = [...(this.container?.querySelectorAll('.ccs-msg') || [])];
        const excess = domMsgs.length - this._windowSize;
        if (excess <= 0) return;
        for (let i = 0; i < excess; i++) {
            domMsgs[i].remove();
            this._firstVisibleIdx++;
        }
        this._ensureLoadMoreSentinel();
    }

    _ensureLoadMoreSentinel() {
        if (this.container?.querySelector('.ccs-load-more')) return;
        if (this._firstVisibleIdx <= 0) return;
        const sentinel = document.createElement('div');
        sentinel.className = 'ccs-load-more';
        const hidden = this._firstVisibleIdx;
        sentinel.innerHTML = `<button class="ccs-load-more-btn">▲ Load ${Math.min(hidden, 30)} earlier messages</button>`;
        sentinel.querySelector('button').addEventListener('click', () => this._loadMoreMessages());
        this.container?.prepend(sentinel);
    }

    _loadMoreMessages() {
        if (this._firstVisibleIdx <= 0) {
            this.container?.querySelector('.ccs-load-more')?.remove();
            return;
        }
        const batchSize = 30;
        const loadFrom = Math.max(0, this._firstVisibleIdx - batchSize);
        const toLoad = this.messages.slice(loadFrom, this._firstVisibleIdx);
        if (!toLoad.length) return;

        // Preserve scroll offset from bottom
        const scrollBottom = (this.container?.scrollHeight || 0) - (this.container?.scrollTop || 0);
        const sentinel = this.container?.querySelector('.ccs-load-more');

        // Rebuild DOM nodes for loaded messages (newest-first in DOM order)
        [...toLoad].reverse().forEach(msg => {
            const el = this._buildMessageEl(msg.role, msg.content, msg.index);
            msg.el = el;
            if (sentinel) sentinel.after(el);
            else this.container?.prepend(el);
        });

        this._firstVisibleIdx = loadFrom;
        if (this.container) this.container.scrollTop = this.container.scrollHeight - scrollBottom;

        // Update or remove sentinel
        if (this._firstVisibleIdx <= 0) {
            sentinel?.remove();
        } else {
            const btn = sentinel?.querySelector('button');
            if (btn) btn.textContent = `▲ Load ${Math.min(this._firstVisibleIdx, 30)} earlier messages`;
        }
    }

    // Replay saved session history into DOM on re-open
    // FIX: Now pushes to this.messages so edit/resend works on restored messages
    restoreHistory(conversationHistory) {
        if (!conversationHistory?.length) return;
        const msgs = conversationHistory.filter(m => m.role === 'user' || m.role === 'assistant');
        if (!msgs.length) return;

        // If history exceeds window, only render the last _windowSize messages;
        // push older messages into this.messages but not into the DOM.
        const renderFrom = Math.max(0, msgs.length - this._windowSize);

        for (let i = 0; i < renderFrom; i++) {
            const m = msgs[i];
            const index = this.messages.length;
            this.messages.push({ role: m.role, content: m.content, el: null, index, ts: Date.now() });
        }
        this._firstVisibleIdx = renderFrom;

        if (renderFrom > 0) this._ensureLoadMoreSentinel();

        for (let i = renderFrom; i < msgs.length; i++) {
            const m = msgs[i];
            this._dismissWelcome();
            const index = this.messages.length;
            const el = this._buildMessageEl(m.role, m.content, index);
            this.container?.appendChild(el);
            this.messages.push({ role: m.role, content: m.content, el, index, ts: Date.now() });
        }
        this._scrollToBottom();
    }

    addSystemMessage(text, type = 'info') {
        const el = document.createElement('div');
        el.className = `ccs-sys-msg ccs-sys-${type}`;
        el.innerHTML = this._renderMarkdown(text);
        this.container?.appendChild(el);
        this._scrollToBottom();
        return el;
    }

    // ── Streaming ─────────────────────────────────────────────────────────────

    startStreaming() {
        const el = document.createElement('div');
        el.className = 'ccs-msg ccs-msg-assistant ccs-msg-streaming';
        el.innerHTML = `<div class="ccs-msg-bubble"><span class="ccs-typing-dots"><span></span><span></span><span></span></span></div>`;
        this.container?.appendChild(el);
        this.streamingEl = el;
        this._scrollToBottom();
    }

    finalizeStream(content) {
        if (this.streamingEl) {
            const bubble = this.streamingEl.querySelector('.ccs-msg-bubble');
            if (bubble) bubble.innerHTML = this._renderMarkdown(content);
            this.streamingEl.classList.remove('ccs-msg-streaming');

            const actions = document.createElement('div');
            actions.className = 'ccs-msg-actions';
            actions.innerHTML = `<button class="ccs-msg-btn" title="Copy">📋</button>`;
            actions.querySelector('[title="Copy"]').addEventListener('click', () => {
                navigator.clipboard.writeText(content).catch(() => {});
            });
            this.streamingEl.appendChild(actions);

            const index = this.messages.length;
            this.messages.push({ role: 'assistant', content, el: this.streamingEl, index });
            this.streamingEl.dataset.index = index;
            this.streamingEl = null;
        }
        this._scrollToBottom();
    }

    // FIX: Cancel/remove streaming element when generation is aborted or errors out
    cancelStreaming() {
        if (this.streamingEl) {
            this.streamingEl.remove();
            this.streamingEl = null;
        }
    }

    // ── Edit / Resend ─────────────────────────────────────────────────────────

    _editMessage(index, el) {
        const msg = this.messages[index];
        if (!msg || msg.role !== 'user') return;

        const bubble = el.querySelector('.ccs-msg-bubble');
        const original = msg.content;

        // Replace bubble with inline editor
        bubble.innerHTML = `
            <textarea class="ccs-inline-edit">${this._escapeHtml(original)}</textarea>
            <div class="ccs-inline-edit-actions">
                <button class="ccs-btn ccs-btn-primary ccs-edit-send-btn">✅ Update &amp; Resend</button>
                <button class="ccs-btn ccs-btn-ghost ccs-edit-cancel-btn">Cancel</button>
            </div>
        `;
        const textarea = bubble.querySelector('textarea');
        textarea.style.height = Math.max(textarea.scrollHeight, 60) + 'px';
        textarea.focus();

        bubble.querySelector('.ccs-edit-send-btn').addEventListener('click', () => {
            const newContent = textarea.value.trim();
            if (!newContent) return;

            // Update message in array and DOM
            msg.content = newContent;
            bubble.innerHTML = this._renderMarkdown(newContent);

            // Remove all messages after this one from DOM and array
            const toRemove = this.messages.slice(index + 1);
            for (const m of toRemove) m.el?.remove();
            this.messages = this.messages.slice(0, index + 1);

            // Also remove any system messages / accept bars after this message element
            this._removeElementsAfter(el);

            // Resend
            this.onSend?.(newContent, index);
        });

        bubble.querySelector('.ccs-edit-cancel-btn').addEventListener('click', () => {
            bubble.innerHTML = this._renderMarkdown(original);
        });
    }

    _resendMessage(index) {
        const msg = this.messages[index];
        if (!msg || msg.role !== 'user') return;

        // Remove all messages after this one
        const toRemove = this.messages.slice(index + 1);
        for (const m of toRemove) m.el?.remove();
        this.messages = this.messages.slice(0, index + 1);

        // Also remove any system messages / accept bars after this message element
        this._removeElementsAfter(msg.el);

        this.onSend?.(msg.content, index);
    }

    // Remove all sibling DOM elements that come after `el` in the container
    _removeElementsAfter(el) {
        if (!el || !this.container) return;
        while (el.nextSibling) {
            el.nextSibling.remove();
        }
    }

    // ── Accept bars ───────────────────────────────────────────────────────────

    addAcceptBar(fieldName, content, onAccept) {
        const bar = document.createElement('div');
        bar.className = 'ccs-accept-bar';

        const tokens = Math.round(content.length / 4);
        const preview = content.length > 120 ? content.substring(0, 120) + '...' : content;

        bar.innerHTML = `
            <div class="ccs-accept-header">
                <span class="ccs-accept-label">📝 ${fieldName} <span class="ccs-token-badge">~${tokens}t</span></span>
                <div class="ccs-accept-btns">
                    <button class="ccs-btn ccs-btn-primary ccs-accept-btn" title="Write to card">✅ Accept</button>
                    <button class="ccs-btn ccs-btn-ghost ccs-preview-toggle" title="Toggle preview">👁</button>
                    <button class="ccs-btn ccs-btn-ghost ccs-reject-btn" title="Discard">✕</button>
                </div>
            </div>
            <div class="ccs-accept-preview" style="display:none;">${this._escapeHtml(preview)}</div>
        `;

        bar.querySelector('.ccs-accept-btn').addEventListener('click', () => {
            onAccept(fieldName, content);
            bar.innerHTML = `<span class="ccs-accept-label">✅ ${fieldName} written to card</span>`;
        });

        bar.querySelector('.ccs-preview-toggle').addEventListener('click', (e) => {
            const preview = bar.querySelector('.ccs-accept-preview');
            preview.style.display = preview.style.display === 'none' ? 'block' : 'none';
            e.target.textContent = preview.style.display === 'none' ? '👁' : '🙈';
        });

        bar.querySelector('.ccs-reject-btn').addEventListener('click', () => {
            bar.innerHTML = `<span class="ccs-accept-label">🗑 ${fieldName} discarded</span>`;
        });

        this.container?.appendChild(bar);
        this._scrollToBottom();
    }

    addVariation(fieldName, label, content, onAccept) {
        const el = document.createElement('div');
        el.className = 'ccs-variation-card';
        const tokens = Math.round(content.length / 4);
        const preview = content.length > 200 ? content.substring(0, 200) + '...' : content;
        el.innerHTML = `
            <div class="ccs-variation-header">
                <span class="ccs-variation-label">🎲 ${label}</span>
                <span class="ccs-token-badge">~${tokens}t</span>
                <button class="ccs-btn ccs-btn-primary ccs-var-accept-btn">✅ Use This</button>
            </div>
            <pre class="ccs-variation-preview">${this._escapeHtml(preview)}</pre>
        `;
        el.querySelector('.ccs-var-accept-btn').addEventListener('click', () => {
            onAccept(fieldName, content);
            el.classList.add('ccs-variation-accepted');
            el.querySelector('.ccs-var-accept-btn').textContent = '✅ Accepted';
        });
        this.container?.appendChild(el);
        this._scrollToBottom();
    }

    // ── Inline annotation ─────────────────────────────────────────────────────

    enableInlineAnnotation(session, onRequest) {
        // Use AbortController for leak-proof cleanup — auto-aborts even if destroy() isn't called
        this.disableInlineAnnotation();

        this._annotationAbort = new AbortController();
        document.addEventListener('mouseup', () => {
            const selection = window.getSelection();
            if (!selection || selection.isCollapsed) return;
            const text = selection.toString().trim();
            if (!text || text.length < 5) return;

            // Only trigger inside chat container
            if (!this.container?.contains(selection.anchorNode)) return;

            this._showAnnotationPopup(text, selection.getRangeAt(0), onRequest);
        }, { signal: this._annotationAbort.signal });
    }

    // AbortController cleanup — calling abort() removes the listener automatically
    disableInlineAnnotation() {
        this._annotationAbort?.abort();
        this._annotationAbort = null;
    }

    _showAnnotationPopup(selectedText, range, onRequest) {
        document.getElementById('ccs-annotation-popup')?.remove();
        const popup = document.createElement('div');
        popup.id = 'ccs-annotation-popup';
        popup.className = 'ccs-annotation-popup';
        popup.innerHTML = `
            <button class="ccs-ann-btn" data-action="expand">🔍 Expand</button>
            <button class="ccs-ann-btn" data-action="specific">🎯 More Specific</button>
            <button class="ccs-ann-btn" data-action="explain">💡 Explain Choice</button>
        `;
        const rect = range.getBoundingClientRect();
        const studioEl = document.getElementById('ccs-studio');
        const studioRect = studioEl?.getBoundingClientRect() || { top: 0, left: 0 };
        popup.style.top = (rect.top - studioRect.top - 44) + 'px';
        popup.style.left = Math.max(0, rect.left - studioRect.left) + 'px';
        studioEl?.appendChild(popup);

        popup.querySelectorAll('.ccs-ann-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                popup.remove();
                onRequest(selectedText, action);
            });
        });

        document.addEventListener('click', () => popup.remove(), { once: true });
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    setInputEnabled(enabled) {
        if (this.inputEl) this.inputEl.disabled = !enabled;
        if (this.sendBtn) this.sendBtn.disabled = !enabled;
        if (this.abortBtn) this.abortBtn.style.display = enabled ? 'none' : '';
    }

    clear() {
        if (this.container) this.container.innerHTML = '';
        this.messages = [];
        this.streamingEl = null;
        this._firstVisibleIdx = 0; // reset virtual window
    }

    // Full cleanup — called when studio closes
    destroy() {
        this.disableInlineAnnotation();
        this.cancelStreaming();
        this.clear();
    }

    _scrollToBottom() {
        if (this.container) {
            this.container.scrollTop = this.container.scrollHeight;
        }
    }

    // FIX: Process code blocks FIRST before inline formatting to prevent corruption
    _renderMarkdown(text) {
        if (!text) return '';

        // Step 1: Extract code blocks and replace with placeholders
        const codeBlocks = [];
        let processed = text.replace(/```[\w]*\n?([\s\S]*?)```/g, (match, code) => {
            const idx = codeBlocks.length;
            codeBlocks.push(`<pre><code>${code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`);
            return `\x00CODEBLOCK_${idx}\x00`;
        });

        // Step 2: Extract inline code and replace with placeholders
        const inlineCode = [];
        processed = processed.replace(/`([^`]+)`/g, (match, code) => {
            const idx = inlineCode.length;
            inlineCode.push(`<code>${code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>`);
            return `\x00INLINE_${idx}\x00`;
        });

        // Step 3: Escape HTML in remaining text
        processed = processed.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // Step 4: Apply inline formatting (bold, italic, headings)
        processed = processed
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/^#{1,3} (.+)$/gm, (_, h) => `<div class="ccs-md-heading">${h}</div>`)
            .replace(/\n/g, '<br>');

        // Step 5: Restore code blocks and inline code
        for (let i = 0; i < codeBlocks.length; i++) {
            processed = processed.replace(`\x00CODEBLOCK_${i}\x00`, codeBlocks[i]);
        }
        for (let i = 0; i < inlineCode.length; i++) {
            processed = processed.replace(`\x00INLINE_${i}\x00`, inlineCode[i]);
        }

        return processed;
    }

    _escapeHtml(text) {
        return (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ── Welcome screen ────────────────────────────────────────────────────────

    renderWelcomeScreen(callbacks = {}) {
        if (!this.container) return;
        this._welcomeCallbacks = callbacks;
        const welcome = document.createElement('div');
        welcome.className = 'ccs-welcome';
        welcome.id = 'ccs-welcome';
        welcome.innerHTML = `
            <div class="ccs-welcome-title">What shall we create?</div>
            <div class="ccs-welcome-subtitle">Start a new character or improve an existing one</div>
            <div class="ccs-welcome-cards">
                <div class="ccs-welcome-card" data-action="pitch">
                    <div class="ccs-welcome-card-icon">💡</div>
                    <div class="ccs-welcome-card-title">Pitch a Concept</div>
                    <div class="ccs-welcome-card-desc">Describe your character idea and I'll help develop it</div>
                </div>
                <div class="ccs-welcome-card" data-action="surprise">
                    <div class="ccs-welcome-card-icon">🎲</div>
                    <div class="ccs-welcome-card-title">Surprise Me</div>
                    <div class="ccs-welcome-card-desc">I'll generate 3 original concepts for you to choose from</div>
                </div>
                <div class="ccs-welcome-card" data-action="improve">
                    <div class="ccs-welcome-card-icon">📂</div>
                    <div class="ccs-welcome-card-title">Improve Existing</div>
                    <div class="ccs-welcome-card-desc">Review and enhance this character's card</div>
                </div>
            </div>
        `;
        welcome.querySelectorAll('.ccs-welcome-card').forEach(card => {
            card.addEventListener('click', () => {
                const action = card.dataset.action;
                this._dismissWelcome();
                this._welcomeCallbacks?.[action]?.();
            });
        });
        this.container.appendChild(welcome);
    }

    _dismissWelcome() {
        const el = this.container?.querySelector('#ccs-welcome');
        if (!el) return;
        el.classList.add('ccs-welcome-fade');
        el.addEventListener('animationend', () => el.remove(), { once: true });
    }
}

export const chatPanel = new ChatPanel();
