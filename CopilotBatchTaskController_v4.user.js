// ==UserScript==
// @name         Copilot Batch Task Controller v4
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  批次 Copilot 任務控制器：全網頁主控面板 + HTML 區塊截取
// @author       Fi5herL
// @match        *://*/*
// @grant        GM_openInTab
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_notification
// @grant        window.close
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const isCopilotPage = /m365\.cloud\.microsoft|copilot\.microsoft\.com|bing\.com\/chat/.test(location.href);
    const isSlavePage   = location.href.includes('batch_task=');
    const HTML_CAPTURE_MAX_LENGTH = 8000;
    let htmlPickActive = false;

    initMasterUI();
    if (isCopilotPage && isSlavePage) initSlaveMode();

    // ══════════════════════════════════════════════
    //  主控 UI
    // ══════════════════════════════════════════════
    function initMasterUI() {
        const TABS = 5;
        let collapsed = GM_getValue('ui_collapsed', false);

        const panel = document.createElement('div');
        panel.id = 'cbtc-panel';
        panel.innerHTML = buildPanelHTML(TABS);
        document.body.appendChild(panel);
        injectStyles();

        const bar = document.createElement('div');
        bar.id = 'cbtc-bar';
        bar.innerHTML = buildBarHTML(TABS);
        document.body.appendChild(bar);

        applyCollapsed(collapsed);

        document.getElementById('cbtc-titlebar').addEventListener('click', () => {
            collapsed = true;
            GM_setValue('ui_collapsed', true);
            applyCollapsed(true);
        });

        bar.addEventListener('click', () => {
            collapsed = false;
            GM_setValue('ui_collapsed', false);
            applyCollapsed(false);
        });

        document.querySelectorAll('.cbtc-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => switchTab(parseInt(btn.dataset.tab)));
        });

        document.getElementById('cbtc-start').addEventListener('click', startBatchTasks);
        document.getElementById('cbtc-template').addEventListener('click', loadTemplate);
        initCaptureMenu();

        checkPendingCapture();
        setInterval(refreshBar, 2000);
        restoreStatus();
    }

    function buildPanelHTML(n) {
        const tabs = Array.from({length: n}, (_, i) =>
            `<button class="cbtc-tab-btn${i===0?' active':''}" data-tab="${i}">T${i+1}</button>`
        ).join('');
        const panes = Array.from({length: n}, (_, i) =>
            `<div class="cbtc-pane${i===0?' active':''}" data-pane="${i}">
                <textarea class="cbtc-textarea" id="task-list-${i}" placeholder="在此輸入任務（每行一個 Prompt）"></textarea>
                <div class="cbtc-status-box" id="status-box-${i}"><span style="color:#8892b0">等待任務...</span></div>
            </div>`
        ).join('');
        return `
            <div id="cbtc-titlebar">
                <span>⚡ Copilot 批次控制器</span>
                <span id="cbtc-collapse-hint" title="點擊縮小">▼</span>
            </div>
            <div id="cbtc-tabs">${tabs}</div>
            <div id="cbtc-panes">${panes}</div>
            <div id="cbtc-actions">
                <button id="cbtc-start">🚀 批次執行</button>
                <button id="cbtc-template" class="sec">📋 範本</button>
                <button id="cbtc-capture" class="sec">📎 截取</button>
            </div>
            <div id="cbtc-capture-menu" style="display:none">
                <div class="cbtc-cap-item" id="cbtc-cap-selected">✂️ 截取選取文字</div>
                <div class="cbtc-cap-item" id="cbtc-cap-page">📄 截取整頁文字</div>
                <div class="cbtc-cap-item" id="cbtc-cap-html">🧩 截取 HTML 區塊</div>
            </div>
            <div id="cbtc-capture-notice" style="display:none"></div>
        `;
    }

    function buildBarHTML(n) {
        const badges = Array.from({length: n}, (_, i) =>
            `<span class="cbtc-badge" id="badge-T${i+1}" title="T${i+1}：待機">T${i+1}</span>`
        ).join('');
        return `<span id="cbtc-bar-label">⚡ Copilot</span>${badges}<span id="cbtc-bar-expand">▲</span>`;
    }

    function injectStyles() {
        const s = document.createElement('style');
        s.textContent = `
        #cbtc-panel {
            position:fixed;bottom:60px;right:20px;width:360px;
            background:linear-gradient(135deg,#1e3c72,#2a5298);
            border-radius:14px;padding:0 0 14px;z-index:2147483647;
            font-family:'Segoe UI',sans-serif;color:#fff;
            box-shadow:0 10px 40px rgba(0,0,0,.5);
            border:1px solid rgba(255,255,255,.18);
        }
        #cbtc-titlebar {
            display:flex;justify-content:space-between;align-items:center;
            padding:14px 16px 10px;font-size:15px;font-weight:700;
            cursor:pointer;border-radius:14px 14px 0 0;user-select:none;
        }
        #cbtc-titlebar:hover { background:rgba(255,255,255,.06); }
        #cbtc-collapse-hint { opacity:.6;font-size:13px; }
        #cbtc-tabs { display:flex;gap:6px;padding:0 14px 10px; }
        .cbtc-tab-btn {
            flex:1;padding:6px 0;border:1px solid rgba(255,255,255,.25);
            background:rgba(255,255,255,.08);color:#fff;border-radius:8px;
            cursor:pointer;font-size:13px;font-weight:600;position:relative;
        }
        .cbtc-tab-btn.active { background:rgba(0,210,255,.35);border-color:#00d2ff; }
        .cbtc-tab-btn.has-content::after {
            content:'';position:absolute;top:4px;right:4px;
            width:6px;height:6px;border-radius:50%;background:#51cf66;
        }
        .cbtc-pane { display:none;padding:0 14px; }
        .cbtc-pane.active { display:block; }
        .cbtc-textarea {
            width:100%;min-height:90px;background:rgba(0,0,0,.3);
            border:1px solid rgba(255,255,255,.2);border-radius:8px;
            padding:10px;color:#fff;font-size:13px;resize:vertical;
            box-sizing:border-box;margin-bottom:8px;
        }
        .cbtc-textarea::placeholder { color:rgba(255,255,255,.45); }
        .cbtc-status-box {
            background:rgba(0,0,0,.25);border-radius:8px;padding:8px 10px;
            font-size:12px;max-height:100px;overflow-y:auto;
        }
        .si { display:flex;align-items:center;gap:6px;margin-bottom:5px;padding:5px 7px;background:rgba(255,255,255,.04);border-radius:5px; }
        .si-dot { width:10px;height:10px;border-radius:50%;flex-shrink:0; }
        .si-dot.w{background:#ffd700}
        .si-dot.r{background:#00d2ff;animation:pulse 1s infinite}
        .si-dot.d{background:#51cf66}
        .si-dot.e{background:#ff4757}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        #cbtc-actions { display:flex;gap:8px;padding:10px 14px 0; }
        #cbtc-actions button {
            flex:1;padding:10px;border:none;border-radius:8px;
            color:#fff;font-weight:700;cursor:pointer;font-size:13px;
        }
        #cbtc-start { background:linear-gradient(135deg,#00d2ff,#3a7bd5); }
        #cbtc-actions button.sec { background:rgba(255,255,255,.12); }
        #cbtc-capture-menu {
            margin:8px 14px 0;padding:8px;background:rgba(0,0,0,.25);
            border-radius:8px;border:1px solid rgba(255,255,255,.14);
        }
        .cbtc-cap-item {
            padding:8px;border-radius:7px;cursor:pointer;
            background:rgba(255,255,255,.1);font-size:13px;
        }
        .cbtc-cap-item + .cbtc-cap-item { margin-top:5px; }
        .cbtc-cap-item:hover { background:rgba(0,210,255,.25); }
        .cbtc-pick-highlight {
            outline:2px solid #00d2ff !important;
            background:rgba(0,210,255,.08) !important;
        }
        #cbtc-pick-tip {
            position:fixed;z-index:2147483647;padding:6px 10px;border-radius:6px;
            background:rgba(10,20,40,.95);color:#fff;font-size:12px;
            border:1px solid rgba(0,210,255,.5);pointer-events:none;
            font-family:'Segoe UI',sans-serif;
        }
        #cbtc-capture-notice {
            margin:10px 14px 0;padding:9px 12px;background:rgba(0,210,255,.18);
            border-radius:8px;font-size:12px;border:1px solid rgba(0,210,255,.4);
        }
        #cbtc-bar {
            position:fixed;bottom:16px;right:20px;z-index:2147483647;
            background:linear-gradient(135deg,#1e3c72,#2a5298);
            border-radius:24px;padding:7px 14px;display:flex;align-items:center;
            gap:8px;cursor:pointer;font-family:'Segoe UI',sans-serif;
            box-shadow:0 4px 20px rgba(0,0,0,.45);
            border:1px solid rgba(255,255,255,.2);color:#fff;font-size:13px;
        }
        #cbtc-bar-label { font-weight:700;margin-right:4px; }
        .cbtc-badge {
            width:24px;height:24px;border-radius:50%;background:rgba(255,255,255,.15);
            display:flex;align-items:center;justify-content:center;
            font-size:10px;font-weight:700;border:2px solid rgba(255,255,255,.2);
        }
        .cbtc-badge.w { border-color:#ffd700; }
        .cbtc-badge.r { border-color:#00d2ff;animation:pulse 1s infinite; }
        .cbtc-badge.d { border-color:#51cf66; }
        .cbtc-badge.e { border-color:#ff4757; }
        #cbtc-bar-expand { opacity:.7;font-size:12px; }
        `;
        document.head.appendChild(s);
    }

    function applyCollapsed(c) {
        const panel = document.getElementById('cbtc-panel');
        const bar   = document.getElementById('cbtc-bar');
        if (!panel || !bar) return;
        panel.style.display = c ? 'none' : '';
        bar.style.display   = c ? '' : 'none';
    }

    function switchTab(idx) {
        document.querySelectorAll('.cbtc-tab-btn').forEach((b,i) => b.classList.toggle('active', i===idx));
        document.querySelectorAll('.cbtc-pane').forEach((p,i) => p.classList.toggle('active', i===idx));
    }

    function refreshBar() {
        const all = GM_getValue('batch_status', []);
        for (let i = 0; i < 5; i++) {
            const badge = document.getElementById(`badge-T${i+1}`);
            if (!badge) continue;
            const s = all.find(x => x.tabIndex === i);
            badge.className = 'cbtc-badge' + (s ? ' ' + s.status[0] : '');
            badge.title = s ? `T${i+1}：${s.message}` : `T${i+1}：待機`;
        }
    }

    // ══════════════════════════════════════════════
    //  批次執行
    // ══════════════════════════════════════════════
    function startBatchTasks() {
        const tasks = [];
        for (let i = 0; i < 5; i++) {
            const el = document.getElementById(`task-list-${i}`);
            const v  = el ? el.value.trim() : '';
            if (v) tasks.push({ tabIndex: i, task: v });
        }
        if (tasks.length === 0) { alert('請至少在一個分頁輸入任務'); return; }

        GM_setValue('batch_tasks', tasks);
        GM_setValue('batch_status', tasks.map(t => ({
            ...t, status: 'waiting', message: '等待中', time: null
        })));
        updateAllStatusDisplay();

        const runInCurrentTab = isCopilotPage && !isSlavePage;
        let startIndex = 0;

        if (runInCurrentTab) {
            executeTask(tasks[0].task, tasks[0].tabIndex);
            startIndex = 1;
        } else {
            const first = tasks[0];
            GM_openInTab(`https://m365.cloud.microsoft/?batch_task=${first.tabIndex}&auto_submit=1`, { active: true });
            updateTaskStatus(first.tabIndex, 'running', '分頁已開啟，等待載入...');
            startIndex = 1;
        }

        for (let j = startIndex; j < tasks.length; j++) {
            setTimeout(() => {
                const { tabIndex } = tasks[j];
                GM_openInTab(`https://m365.cloud.microsoft/?batch_task=${tabIndex}&auto_submit=1`, { active: false });
                updateTaskStatus(tabIndex, 'running', '分頁已開啟，等待載入...');
            }, j * 2500);
        }

        GM_notification({ title: '批次任務已啟動', text: `共 ${tasks.length} 個任務`, timeout: 3000 });
    }

    // ══════════════════════════════════════════════
    //  子分頁模式
    // ══════════════════════════════════════════════
    function initSlaveMode() {
        const tabIndex = parseInt(new URLSearchParams(location.search).get('batch_task'));
        const tasks    = GM_getValue('batch_tasks', []);
        const entry    = tasks.find(t => t.tabIndex === tabIndex);
        if (!entry) return;
        document.title = `[T${tabIndex+1}] ${entry.task.substring(0,20)}...`;
        setTimeout(() => executeTask(entry.task, tabIndex), 4000);
    }

    // ══════════════════════════════════════════════
    //  核心：執行任務（Lexical Editor）
    // ══════════════════════════════════════════════
    function executeTask(task, tabIndex) {
        updateTaskStatus(tabIndex, 'running', '等待輸入框...');
        let tries = 0;
        const t = setInterval(() => {
            tries++;
            const box = findInputBox();
            if (box) {
                clearInterval(t);
                updateTaskStatus(tabIndex, 'running', '正在輸入...');
                typeIntoLexical(box, task);
                let sendTry = 0;
                const w = setInterval(() => {
                    sendTry++;
                    const btn = findSendButton();
                    if (btn && !btn.disabled) {
                        clearInterval(w);
                        btn.click();
                        updateTaskStatus(tabIndex, 'running', '已送出，等待回應...');
                        monitorResponse(tabIndex);
                    } else if (sendTry >= 15) {
                        clearInterval(w);
                        box.dispatchEvent(new KeyboardEvent('keydown', {
                            key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
                        }));
                        updateTaskStatus(tabIndex, 'running', '已送出 (Enter)，等待回應...');
                        monitorResponse(tabIndex);
                    }
                }, 300);
            } else if (tries >= 60) {
                clearInterval(t);
                updateTaskStatus(tabIndex, 'error', '逾時：找不到輸入框');
            }
        }, 500);
    }

    function findInputBox() {
        return document.getElementById('m365-chat-editor-target-element')
            || document.querySelector('[data-lexical-editor="true"]')
            || document.querySelector('[role="textbox"][contenteditable="true"]')
            || document.querySelector('textarea');
    }

    function typeIntoLexical(el, text) {
        el.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
        document.execCommand('insertText', false, text);
        el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }

    function findSendButton() {
        for (const sel of [
            'button[data-testid="send-button"]',
            'button[aria-label="傳送訊息"]',
            'button[aria-label*="傳送"]',
            'button[aria-label*="Send"]',
            'button[type="submit"]:not([disabled])'
        ]) {
            const b = document.querySelector(sel);
            if (b && !b.disabled) return b;
        }
        return null;
    }

    function monitorResponse(tabIndex) {
        let n = 0;
        const t = setInterval(() => {
            n++;
            const stop = document.querySelector(
                'button[aria-label*="停止"],button[aria-label*="Stop"],button[aria-label*="stop"]'
            );
            const has = document.querySelectorAll(
                '[data-testid="chat-message"],.cib-message-body,[class*="message-body"]'
            ).length > 0;
            if (has && !stop) {
                clearInterval(t);
                updateTaskStatus(tabIndex, 'done', '✅ 回應完成');
            } else if (n >= 150) {
                clearInterval(t);
                updateTaskStatus(tabIndex, 'done', '⚠️ 逾時，請手動確認');
            }
        }, 2000);
    }

    // ══════════════════════════════════════════════
    //  狀態管理
    // ══════════════════════════════════════════════
    function updateTaskStatus(tabIndex, status, message) {
        let statuses = GM_getValue('batch_status', []);
        const s = statuses.find(x => x.tabIndex === tabIndex);
        if (s) {
            s.status  = status;
            s.message = message;
            s.time    = new Date().toLocaleTimeString();
        }
        GM_setValue('batch_status', statuses);
        updateAllStatusDisplay();
    }

    function updateAllStatusDisplay() {
        const statuses = GM_getValue('batch_status', []);
        for (let i = 0; i < 5; i++) {
            const box = document.getElementById(`status-box-${i}`);
            if (!box) continue;
            const s = statuses.find(x => x.tabIndex === i);
            if (!s) { box.innerHTML = '<span style="color:#8892b0">等待任務...</span>'; continue; }
            const dotClass = { waiting:'w', running:'r', done:'d', error:'e' }[s.status] || 'w';
            const label    = { waiting:'等待中', running:'執行中', done:'完成', error:'錯誤' }[s.status] || '';
            box.innerHTML = `<div class="si">
                <div class="si-dot ${dotClass}"></div>
                <div style="flex:1;min-width:0">
                    <div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                        ${s.task.substring(0,30)}${s.task.length>30?'...':''}
                    </div>
                    <div style="opacity:.75">${label}：${s.message}${s.time?' ('+s.time+')':''}</div>
                </div>
            </div>`;
            const tabBtn = document.querySelector(`.cbtc-tab-btn[data-tab="${i}"]`);
            if (tabBtn) tabBtn.classList.add('has-content');
        }
        refreshBar();
    }

    function restoreStatus() { updateAllStatusDisplay(); }

    function loadTemplate() {
        const tpls = [
            "請分析這份數據的趨勢並指出異常點",
            "請將以下內容翻譯成繁體中文，保持專業術語準確",
            "請總結這份文件的三個重點和兩個行動建議",
            "請檢查這段程式碼的潛在錯誤和優化空間",
            "請比較這兩個方案的優缺點並給出建議"
        ];
        for (let i = 0; i < 5; i++) {
            const el = document.getElementById(`task-list-${i}`);
            if (el) el.value = tpls[i];
        }
    }

    // ══════════════════════════════════════════════
    //  待貼入內容提示
    // ══════════════════════════════════════════════
    function checkPendingCapture() {
        const content = GM_getValue('pending_capture', '');
        if (!content) return;
        GM_setValue('pending_capture', '');
        const notice = document.getElementById('cbtc-capture-notice');
        if (!notice) return;
        notice.style.display = '';
        notice.textContent = '';

        const label = document.createElement('span');
        label.innerHTML = `📋 <b>已截取網頁內容</b>（${content.length} 字）貼入：`;
        notice.appendChild(label);

        for (let i = 0; i < 5; i++) {
            const btn = document.createElement('button');
            btn.textContent = `T${i+1}`;
            btn.style.cssText = 'margin:2px 3px;padding:3px 9px;border-radius:6px;border:none;background:rgba(0,210,255,.3);color:#fff;cursor:pointer;font-size:12px';
            btn.addEventListener('click', () => {
                const el = document.getElementById(`task-list-${i}`);
                if (el) {
                    el.value += (el.value ? '\n' : '') + content;
                    el.dispatchEvent(new Event('input'));
                }
                notice.style.display = 'none';
            });
            notice.appendChild(btn);
        }

        const close = document.createElement('button');
        close.textContent = '✕';
        close.style.cssText = 'margin:2px 3px;padding:3px 9px;border-radius:6px;border:none;background:rgba(255,71,87,.3);color:#fff;cursor:pointer;font-size:12px';
        close.addEventListener('click', () => notice.style.display = 'none');
        notice.appendChild(close);
    }

    function initCaptureMenu() {
        const panel = document.getElementById('cbtc-panel');
        const btn = document.getElementById('cbtc-capture');
        const menu = document.getElementById('cbtc-capture-menu');
        if (!panel || !btn || !menu) return;

        btn.addEventListener('click', e => {
            e.stopPropagation();
            menu.style.display = menu.style.display === 'none' ? '' : 'none';
        });
        panel.addEventListener('click', e => e.stopPropagation());
        document.addEventListener('click', () => menu.style.display = 'none');

        document.getElementById('cbtc-cap-selected').addEventListener('click', () => {
            const sel = window.getSelection().toString().trim();
            if (!sel) { alert('請先在頁面上選取文字'); return; }
            menu.style.display = 'none';
            sendCaptureToCopilot(sel);
        });

        document.getElementById('cbtc-cap-page').addEventListener('click', () => {
            menu.style.display = 'none';
            sendCaptureToCopilot(extractPageText());
        });

        document.getElementById('cbtc-cap-html').addEventListener('click', () => {
            menu.style.display = 'none';
            startHtmlPickMode();
        });
    }

    function startHtmlPickMode() {
        if (htmlPickActive) return;
        htmlPickActive = true;

        const tip = document.createElement('div');
        tip.id = 'cbtc-pick-tip';
        tip.textContent = '點擊以選取此區塊 | 按 ESC 取消';
        document.body.appendChild(tip);

        let hovered = null;

        const clearHovered = () => {
            if (hovered) hovered.classList.remove('cbtc-pick-highlight');
            hovered = null;
        };

        const cleanup = () => {
            clearHovered();
            if (tip.parentNode) tip.parentNode.removeChild(tip);
            document.removeEventListener('mousemove', onMove, true);
            document.removeEventListener('click', onClick, true);
            document.removeEventListener('keydown', onKeyDown, true);
            htmlPickActive = false;
        };

        const shouldIgnore = el => {
            if (!el || !(el instanceof Element)) return true;
            return !!el.closest('#cbtc-panel, #cbtc-bar, #cbtc-pick-tip');
        };

        const onMove = e => {
            tip.style.left = `${e.clientX + 14}px`;
            tip.style.top = `${e.clientY + 14}px`;
            const target = e.target;
            if (shouldIgnore(target)) {
                clearHovered();
                return;
            }
            if (hovered !== target) {
                clearHovered();
                hovered = target;
                hovered.classList.add('cbtc-pick-highlight');
            }
        };

        const onClick = e => {
            e.preventDefault();
            e.stopPropagation();
            if (!hovered) return;
            const node = hovered.cloneNode(true);
            node.classList.remove('cbtc-pick-highlight');
            if (!node.className) node.removeAttribute('class');
            let html = node.outerHTML || '';
            if (html.length > HTML_CAPTURE_MAX_LENGTH) html = html.substring(0, HTML_CAPTURE_MAX_LENGTH);
            cleanup();
            sendCaptureToCopilot(formatHtmlCapture(html));
        };

        const onKeyDown = e => {
            if (e.key === 'Escape') cleanup();
        };

        document.addEventListener('mousemove', onMove, true);
        document.addEventListener('click', onClick, true);
        document.addEventListener('keydown', onKeyDown, true);
    }

    function extractPageText() {
        const clone = document.body.cloneNode(true);
        clone.querySelectorAll('script,style,nav,header,footer,aside,[aria-hidden="true"]')
             .forEach(el => el.remove());
        return clone.innerText.replace(/\n{3,}/g, '\n\n').trim().substring(0, 6000);
    }

    function sendCaptureToCopilot(text) {
        GM_setValue('pending_capture', text);
        GM_openInTab('https://m365.cloud.microsoft/', { active: true });
        alert(`已截取 ${text.length} 字，正在開啟 Copilot 頁面…\n請在面板選擇要貼入的分頁（T1～T5）`);
    }

    function formatHtmlCapture(html) {
        return ['以下是截取的 HTML 區塊：', '```html', '', html, '```'].join('\n');
    }

})();
