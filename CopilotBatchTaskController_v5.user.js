// ==UserScript==
// @name         Copilot Batch Task Controller v5
// @namespace    http://tampermonkey.net/
// @version      5.1
// @description  批次 Copilot 任務控制器：三段式收合 + 分頁同步 + 執行紀錄 + 對話映射 + 跨重導向分頁識別
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
    const urlParams = new URLSearchParams(location.search);
    const urlBatchTask = urlParams.get('batch_task');
    if (urlBatchTask !== null) {
        sessionStorage.setItem('cbtc_batch_task', urlBatchTask);
        sessionStorage.setItem('cbtc_auto_submit', urlParams.get('auto_submit') || '0');
    }
    const isSlavePage   = urlBatchTask !== null || sessionStorage.getItem('cbtc_batch_task') !== null;
    const CHANNEL_NAME = 'copilot-batch-ctrl';
    const TABS = 5;
    const PANEL_STATE_KEY = 'panelState';
    const HTML_CAPTURE_MAX_LENGTH = 8000;
    const PAGE_TEXT_MAX_LENGTH = 6000;
    const MAX_DISPLAYED_LOGS = 6;
    const TAB_OPEN_DELAY_MS = 2500;
    const MAX_CONV_ID_POLL_ATTEMPTS = 240;
    let htmlPickActive = false;
    let focusedSlot = 0;
    let panelState = GM_getValue(PANEL_STATE_KEY, 'full');
    let slotConvMap = GM_getValue('slot_conv_map', {});
    let lastSlotRegisterTs = 0;
    const bc = createBroadcastChannel();

    initMasterUI();
    if (isCopilotPage && isSlavePage) initSlaveMode();

    // ══════════════════════════════════════════════
    //  主控 UI
    // ══════════════════════════════════════════════
    function createBroadcastChannel() {
        try { return new BroadcastChannel(CHANNEL_NAME); }
        catch (_) { return null; }
    }

    function initMasterUI() {
        const panel = document.createElement('div');
        panel.id = 'cbtc-panel';
        panel.innerHTML = buildPanelHTML(TABS);
        const bar = document.createElement('div');
        bar.id = 'cbtc-bar';
        bar.innerHTML = buildBarHTML(TABS);
        const rail = document.createElement('div');
        rail.id = 'cbtc-rail';
        rail.innerHTML = buildRailHTML(TABS);

        injectStyles();
        document.body.appendChild(panel);
        document.body.appendChild(bar);
        document.body.appendChild(rail);
        applyPanelState(panelState);

        document.getElementById('cbtc-titlebar').addEventListener('click', () => {
            if (panelState === 'full') setPanelState('bar');
        });

        document.getElementById('cbtc-bar-to-rail').addEventListener('click', e => {
            e.stopPropagation();
            if (panelState === 'bar') setPanelState('rail');
        });
        bar.addEventListener('click', () => setPanelState('full'));
        rail.addEventListener('click', () => setPanelState('full'));

        document.querySelectorAll('.cbtc-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => switchTab(parseInt(btn.dataset.tab, 10)));
        });

        document.querySelectorAll('.cbtc-textarea').forEach(el => {
            el.addEventListener('input', updateTabContentMarkers);
        });
        document.getElementById('cbtc-start').addEventListener('click', startBatchTasks);
        document.getElementById('cbtc-template').addEventListener('click', loadTemplate);
        initCaptureMenu();
        initExecutionLog();
        document.addEventListener('keydown', handleEscKey);

        if (bc) {
            bc.addEventListener('message', e => {
                const data = e.data || {};
                if (data.type === 'tabFocused') {
                    const slot = Number(data.slot);
                    if (Number.isInteger(slot) && slot >= 0 && slot < TABS) {
                        switchTab(slot);
                    }
                }
            });
        }

        checkPendingCapture();
        setInterval(() => {
            pollSlotRegister();
            refreshIndicators();
        }, 500);
        restoreStatus();
        switchTab(0);
        updateTabContentMarkers();
        refreshExecutionLog();
    }

    function setPanelState(nextState) {
        panelState = nextState;
        GM_setValue(PANEL_STATE_KEY, panelState);
        applyPanelState(panelState);
    }

    function applyPanelState(state) {
        const panel = document.getElementById('cbtc-panel');
        const bar   = document.getElementById('cbtc-bar');
        const rail  = document.getElementById('cbtc-rail');
        if (!panel || !bar || !rail) return;
        panel.style.display = state === 'full' ? '' : 'none';
        bar.style.display   = state === 'bar' ? '' : 'none';
        rail.style.display  = state === 'rail' ? 'flex' : 'none';
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
            <div id="cbtc-log-section">
                <div id="cbtc-log-header">🧾 執行紀錄 <span id="cbtc-log-count">0</span></div>
                <div id="cbtc-log-list"></div>
                <div id="cbtc-log-detail" style="display:none"></div>
            </div>
        `;
    }

    function buildBarHTML(n) {
        const badges = Array.from({length: n}, (_, i) =>
            `<span class="cbtc-badge" id="badge-T${i+1}" title="T${i+1}：待機">T${i+1}</span>`
        ).join('');
        return `<button id="cbtc-bar-to-rail" title="縮到側邊">◀</button><span id="cbtc-bar-label">⚡ Copilot</span>${badges}<span id="cbtc-bar-expand">▲</span>`;
    }

    function buildRailHTML(n) {
        const dots = Array.from({length: n}, (_, i) =>
            `<span class="cbtc-rail-dot" id="rail-dot-T${i+1}" title="T${i+1}">T${i+1}</span>`
        ).join('');
        return `<div id="cbtc-rail-dots">${dots}</div>`;
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
            max-height:82vh;
            overflow:hidden;
            transition:width .2s ease,height .2s ease;
        }
        #cbtc-panel.log-expanded {
            width:520px;
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
        #cbtc-log-section {
            margin:10px 14px 0;padding:8px;background:rgba(0,0,0,.26);
            border-radius:8px;border:1px solid rgba(255,255,255,.12);
        }
        #cbtc-log-header {
            display:flex;align-items:center;justify-content:space-between;
            font-size:12px;font-weight:700;opacity:.95;margin-bottom:6px;
        }
        #cbtc-log-count {
            min-width:20px;height:20px;border-radius:10px;
            display:inline-flex;align-items:center;justify-content:center;
            background:rgba(0,210,255,.25);border:1px solid rgba(0,210,255,.5);
            font-size:11px;padding:0 6px;
        }
        #cbtc-log-list {
            max-height:92px;overflow-y:auto;
        }
        .cbtc-log-row {
            width:100%;text-align:left;border:none;cursor:pointer;
            padding:7px 8px;border-radius:7px;background:rgba(255,255,255,.06);
            color:#fff;margin:0 0 6px;font-size:12px;
        }
        .cbtc-log-row:last-child { margin-bottom:0; }
        .cbtc-log-row:hover { background:rgba(0,210,255,.2); }
        #cbtc-log-detail {
            margin-top:8px;padding:10px;border-radius:8px;
            background:rgba(0,0,0,.3);border:1px solid rgba(0,210,255,.35);
            max-height:260px;overflow:auto;white-space:pre-wrap;font-size:12px;
        }
        #cbtc-bar {
            position:fixed;bottom:16px;right:20px;z-index:2147483647;
            background:linear-gradient(135deg,#1e3c72,#2a5298);
            border-radius:24px;padding:7px 14px;display:flex;align-items:center;
            gap:8px;cursor:pointer;font-family:'Segoe UI',sans-serif;
            box-shadow:0 4px 20px rgba(0,0,0,.45);
            border:1px solid rgba(255,255,255,.2);color:#fff;font-size:13px;
        }
        #cbtc-bar-to-rail {
            border:none;border-radius:12px;padding:3px 6px;cursor:pointer;
            color:#fff;background:rgba(255,255,255,.16);font-size:11px;
        }
        #cbtc-bar-label { font-weight:700;margin-right:4px; }
        .cbtc-badge {
            width:24px;height:24px;border-radius:50%;background:rgba(255,255,255,.15);
            display:flex;align-items:center;justify-content:center;
            font-size:10px;font-weight:700;border:2px solid rgba(255,255,255,.2);
        }
        .cbtc-badge.slot-unassigned,.cbtc-rail-dot.slot-unassigned { border-color:#9aa0ad;background:rgba(255,255,255,.12); }
        .cbtc-badge.slot-pending,.cbtc-rail-dot.slot-pending { border-color:#ffd700;background:rgba(255,215,0,.2); }
        .cbtc-badge.slot-generating,.cbtc-rail-dot.slot-generating { border-color:#36c7ff;background:rgba(54,199,255,.2); }
        .cbtc-badge.slot-done,.cbtc-rail-dot.slot-done { border-color:#51cf66;background:rgba(81,207,102,.2); }
        .cbtc-badge.slot-error,.cbtc-rail-dot.slot-error { border-color:#ff4757;background:rgba(255,71,87,.2); }
        .cbtc-badge.focused,.cbtc-rail-dot.focused { box-shadow:0 0 0 2px #00f5ff inset,0 0 8px rgba(0,245,255,.9); }
        #cbtc-bar-expand { opacity:.7;font-size:12px; }
        #cbtc-rail {
            position:fixed;right:0;top:50%;transform:translateY(-50%);
            width:28px;height:180px;border-radius:8px 0 0 8px;
            background:linear-gradient(180deg,#1e3c72,#2a5298);
            border:1px solid rgba(255,255,255,.2);border-right:none;
            z-index:2147483647;display:none;cursor:pointer;
            box-shadow:0 10px 32px rgba(0,0,0,.45);
        }
        #cbtc-rail-dots {
            width:100%;height:100%;display:flex;flex-direction:column;
            align-items:center;justify-content:space-evenly;
        }
        .cbtc-rail-dot {
            width:20px;height:20px;border-radius:50%;font-size:9px;font-weight:700;
            border:2px solid rgba(255,255,255,.2);display:flex;
            align-items:center;justify-content:center;color:#fff;
            background:rgba(255,255,255,.14);
        }
        `;
        document.head.appendChild(s);
    }

    function switchTab(idx) {
        focusedSlot = idx;
        document.querySelectorAll('.cbtc-tab-btn').forEach((b,i) => b.classList.toggle('active', i === idx));
        document.querySelectorAll('.cbtc-pane').forEach((p,i) => p.classList.toggle('active', i === idx));
        refreshIndicators();
    }

    function updateTabContentMarkers() {
        for (let i = 0; i < TABS; i++) {
            const tabBtn = document.querySelector(`.cbtc-tab-btn[data-tab="${i}"]`);
            const el = document.getElementById(`task-list-${i}`);
            if (!tabBtn || !el) continue;
            tabBtn.classList.toggle('has-content', !!el.value.trim());
        }
    }

    function refreshIndicators() {
        const all = GM_getValue('batch_status', []);
        for (let i = 0; i < TABS; i++) {
            const slotState = getSlotState(i, all);
            const isFocused = focusedSlot === i;
            const title = getSlotTitle(i, all.find(x => x.tabIndex === i));
            const badge = document.getElementById(`badge-T${i+1}`);
            const railDot = document.getElementById(`rail-dot-T${i+1}`);
            if (badge) {
                badge.className = `cbtc-badge slot-${slotState}${isFocused ? ' focused' : ''}`;
                badge.title = title;
            }
            if (railDot) {
                railDot.className = `cbtc-rail-dot slot-${slotState}${isFocused ? ' focused' : ''}`;
                railDot.title = title;
            }
        }
    }

    function getSlotState(tabIndex, statuses) {
        const status = statuses.find(x => x.tabIndex === tabIndex);
        const pendingFlag = GM_getValue(`slot_pending_${tabIndex}`, 0);
        if (status?.status === 'done') return 'done';
        if (status?.status === 'error') return 'error';
        if (status?.status === 'running') return 'generating';
        if (status?.status === 'waiting' || pendingFlag) return 'pending';
        return 'unassigned';
    }

    function getSlotTitle(tabIndex, statusRow) {
        const convId = slotConvMap[tabIndex];
        const label = {
            waiting: '待處理',
            running: '生成中',
            done: '已完成',
            error: '錯誤'
        }[statusRow?.status] || '未分配';
        const suffix = convId ? ` / ${convId}` : '';
        return `T${tabIndex+1}：${label}${suffix}`;
    }

    function pollSlotRegister() {
        const raw = GM_getValue('slot_register', null);
        if (!raw) return;
        let data = raw;
        if (typeof raw === 'string') {
            try { data = JSON.parse(raw); } catch (_) { return; }
        }
        if (!data || typeof data !== 'object') return;
        const ts = Number(data.ts) || Date.now();
        if (ts <= lastSlotRegisterTs) return;
        const slot = Number(data.slot);
        const convId = data.convId;
        if (!Number.isInteger(slot) || slot < 0 || slot >= TABS || typeof convId !== 'string') return;
        lastSlotRegisterTs = ts;
        slotConvMap[slot] = convId;
        GM_setValue('slot_conv_map', slotConvMap);
        GM_setValue(`slot_pending_${slot}`, 0);
        GM_setValue('slot_register', null);
        refreshIndicators();
    }

    function initExecutionLog() {
        const list = document.getElementById('cbtc-log-list');
        if (!list) return;
        list.addEventListener('click', e => {
            const row = e.target.closest('.cbtc-log-row');
            if (!row) return;
            const idx = Number(row.dataset.index);
            if (!Number.isInteger(idx)) return;
            openLogDetail(idx);
        });
    }

    function appendExecutionLog(items) {
        const log = GM_getValue('execLog', []);
        GM_setValue('execLog', [...log, ...items]);
    }

    function getDisplaySlot(entry) {
        if (Number.isInteger(entry?.tabIndex)) return entry.tabIndex + 1;
        return Number(entry?.slot) || 0;
    }

    function refreshExecutionLog() {
        const log = GM_getValue('execLog', []);
        const count = document.getElementById('cbtc-log-count');
        const list = document.getElementById('cbtc-log-list');
        if (count) count.textContent = String(log.length);
        if (!list) return;
        if (!log.length) {
            list.innerHTML = '<div style="opacity:.65;font-size:12px;padding:6px 2px">尚無執行紀錄</div>';
            return;
        }
        const rows = log.map((entry, idx) => ({ entry, idx })).reverse().slice(0, MAX_DISPLAYED_LOGS);
        list.innerHTML = rows.map(({entry, idx}) => {
            const prompt = String(entry.prompt || '').replace(/\s+/g, ' ').trim();
            const preview = prompt.length > 38 ? `${prompt.substring(0, 38)}...` : prompt;
            const displaySlot = getDisplaySlot(entry);
            return `<button class="cbtc-log-row" data-index="${idx}">
                <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
                    <span style="font-weight:700">T${displaySlot}</span>
                    <span style="opacity:.8">${escapeHtml(entry.status || '')}</span>
                </div>
                <div style="opacity:.9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(preview)}</div>
            </button>`;
        }).join('');
    }

    function openLogDetail(index) {
        const log = GM_getValue('execLog', []);
        const item = log[index];
        if (!item) return;
        const displaySlot = getDisplaySlot(item);
        const panel = document.getElementById('cbtc-panel');
        const detail = document.getElementById('cbtc-log-detail');
        if (!panel || !detail) return;
        panel.classList.add('log-expanded');
        detail.style.display = '';
        detail.innerHTML = [
            `<div style="font-weight:700;margin-bottom:8px">T${displaySlot} · ${escapeHtml(item.status || '')}</div>`,
            `<div style="opacity:.75;margin-bottom:8px">${escapeHtml(item.submittedAt || '')}</div>`,
            `<div>${escapeHtml(item.prompt || '')}</div>`
        ].join('');
    }

    function collapseLogDetail() {
        const panel = document.getElementById('cbtc-panel');
        const detail = document.getElementById('cbtc-log-detail');
        if (panel) panel.classList.remove('log-expanded');
        if (detail) detail.style.display = 'none';
    }

    function handleEscKey(e) {
        if (e.key === 'Escape') collapseLogDetail();
    }

    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function updateExecutionLogStatus(tabIndex, status) {
        const log = GM_getValue('execLog', []);
        const displaySlot = tabIndex + 1;
        for (let i = log.length - 1; i >= 0; i--) {
            if (log[i].tabIndex === tabIndex || log[i].slot === displaySlot) {
                log[i].status = status;
                break;
            }
        }
        GM_setValue('execLog', log);
        refreshExecutionLog();
    }

    // ══════════════════════════════════════════════
    //  批次執行
    // ══════════════════════════════════════════════
    function startBatchTasks() {
        const tasks = [];
        for (let i = 0; i < TABS; i++) {
            const el = document.getElementById(`task-list-${i}`);
            const v  = el ? el.value.trim() : '';
            if (v) tasks.push({ tabIndex: i, task: v });
        }
        if (tasks.length === 0) { alert('請至少在一個分頁輸入任務'); return; }

        GM_setValue('batch_tasks', tasks);
        GM_setValue('batch_status', tasks.map(t => ({
            ...t, status: 'waiting', message: '等待中', time: null
        })));
        appendExecutionLog(tasks.map(t => ({
            tabIndex: t.tabIndex,
            slot: t.tabIndex + 1,
            prompt: t.task,
            submittedAt: new Date().toISOString(),
            status: 'submitted'
        })));
        for (const t of tasks) {
            const el = document.getElementById(`task-list-${t.tabIndex}`);
            if (el) {
                el.value = '';
                el.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
        updateAllStatusDisplay();
        refreshExecutionLog();
        updateTabContentMarkers();

        const runInCurrentTab = isCopilotPage && !isSlavePage;
        let startIndex = 0;

        if (runInCurrentTab) {
            setSlotPending(tasks[0].tabIndex);
            executeTask(tasks[0].task, tasks[0].tabIndex);
            startIndex = 1;
        } else {
            const first = tasks[0];
            setSlotPending(first.tabIndex);
            GM_openInTab(`https://m365.cloud.microsoft/?batch_task=${first.tabIndex}&auto_submit=1`, { active: true });
            updateTaskStatus(first.tabIndex, 'running', '分頁已開啟，等待載入...');
            startIndex = 1;
        }

        for (let j = startIndex; j < tasks.length; j++) {
            setTimeout(() => {
                const { tabIndex } = tasks[j];
                setSlotPending(tabIndex);
                GM_openInTab(`https://m365.cloud.microsoft/?batch_task=${tabIndex}&auto_submit=1`, { active: false });
                updateTaskStatus(tabIndex, 'running', '分頁已開啟，等待載入...');
            }, j * TAB_OPEN_DELAY_MS);
        }

        GM_notification({ title: '批次任務已啟動', text: `共 ${tasks.length} 個任務`, timeout: 3000 });
    }

    // ══════════════════════════════════════════════
    //  子分頁模式
    // ══════════════════════════════════════════════
    function initSlaveMode() {
        const params = new URLSearchParams(location.search);
        const raw = params.get('batch_task') ?? sessionStorage.getItem('cbtc_batch_task');
        const isInitialLoad = params.get('batch_task') !== null;
        const autoSubmit = (params.get('auto_submit') ?? sessionStorage.getItem('cbtc_auto_submit') ?? '1') !== '0';
        const tabIndex = parseInt(raw, 10);
        if (!Number.isInteger(tabIndex)) return;
        const tasks    = GM_getValue('batch_tasks', []);
        const entry    = tasks.find(t => t.tabIndex === tabIndex);
        setupAutoTabSync(tabIndex);
        startConversationIdPoll(tabIndex);
        if (entry) document.title = `[T${tabIndex+1}] ${entry.task.substring(0,20)}...`;
        if (entry && isInitialLoad && autoSubmit) {
            setTimeout(() => executeTask(entry.task, tabIndex), 4000);
        }
    }

    function setupAutoTabSync(tabIndex) {
        if (!bc) return;
        const emit = () => bc.postMessage({ type: 'tabFocused', slot: tabIndex });
        window.addEventListener('focus', emit);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') emit();
        });
        emit();
    }

    function startConversationIdPoll(tabIndex) {
        let attempts = 0;
        const timer = setInterval(() => {
            attempts++;
            const m = location.href.match(/\/conversation\/([0-9a-f-]{36})/i);
            if (m) {
                clearInterval(timer);
                GM_setValue('slot_register', { slot: tabIndex, convId: m[1], ts: Date.now() });
                return;
            }
            if (attempts >= MAX_CONV_ID_POLL_ATTEMPTS) clearInterval(timer);
        }, 500);
    }

    function setSlotPending(tabIndex) {
        GM_setValue(`slot_pending_${tabIndex}`, Date.now());
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
        updateExecutionLogStatus(tabIndex, ({
            waiting: 'pending',
            running: 'generating',
            done: 'done',
            error: 'error'
        })[status] || status);
        updateAllStatusDisplay();
    }

    function updateAllStatusDisplay() {
        const statuses = GM_getValue('batch_status', []);
        for (let i = 0; i < TABS; i++) {
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
        refreshIndicators();
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
        for (let i = 0; i < TABS; i++) {
            const el = document.getElementById(`task-list-${i}`);
            if (el) el.value = tpls[i];
        }
        updateTabContentMarkers();
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

        for (let i = 0; i < TABS; i++) {
            const btn = document.createElement('button');
            btn.textContent = `T${i+1}`;
            btn.style.cssText = 'margin:2px 3px;padding:3px 9px;border-radius:6px;border:none;background:rgba(0,210,255,.3);color:#fff;cursor:pointer;font-size:12px';
            btn.addEventListener('click', () => {
                const el = document.getElementById(`task-list-${i}`);
                if (el) {
                    el.value += (el.value ? '\n' : '') + content;
                    el.dispatchEvent(new Event('input'));
                }
                updateTabContentMarkers();
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
            return !!el.closest('#cbtc-panel, #cbtc-bar, #cbtc-rail, #cbtc-pick-tip');
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
            // 維持輸出乾淨，避免序列化出 class=""
            if (!node.getAttribute('class')) node.removeAttribute('class');
            let html = node.outerHTML || '';
            // 依字元截斷供 Prompt 使用（可能不是完整 DOM 片段），刻意以長度限制優先，避免提示詞過長
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
        return clone.innerText.replace(/\n{3,}/g, '\n\n').trim().substring(0, PAGE_TEXT_MAX_LENGTH);
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
