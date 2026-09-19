import { app } from "../../scripts/app.js";

const _clog = (...a) => {
    try {
        // eslint-disable-next-line no-console
        if (localStorage.getItem("comp_crop_debug") === "1") console.log(...a);
    } catch (_) { /* localStorage 不可用时静默 */ }
};

function _pureId(x) {
    const s = String(x ?? "");
    const parts = s.split(/[.:_-]+/);
    const last = parts[parts.length - 1];
    return /^\d+$/.test(last) ? last : s;
}

function _baseId(x) {
    let s = String(x ?? "").trim();
    if (!s) return s;
    if (s.includes(":")) s = s.split(":", 1)[0];   // GraphBuilder 虚拟后缀
    if (s.includes(".")) s = s.split(".").pop();   // 秋叶复合 id 末段
    return s;
}

const _LIVE_HINTS = new Set();
const _TERMINAL_HINTS = {
    interrupted: "已中断",
    execution_error: "已失败",
    execution_success: "已结束",
};

const chooserFlow = {
    runningNodeId: null,
    _hooked: false,
    lastTerminal: null,
    here(nodeId) {
        if (this.runningNodeId == null) return false;
        const r = String(this.runningNodeId);
        const n = String(nodeId);
        if (r === n) return true;
        return _baseId(r) === _baseId(n);
    },
};

async function sendChooserMessage(nodeId, action, index = -1, extra = {}) {
    try {
        const apiObj = app?.api;
        const url = apiObj?.apiURL?.("/comp_crop/chooser_message")
            || "/comp_crop/chooser_message";
        const body = {
            node_id: String(nodeId), action, index, ...extra,
        };
        const resp = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            keepalive: true,   // beforeunload 场景下也能送达
        });
        const data = await resp.json().catch(() => ({}));
        _clog(
            `message ${action} @${nodeId} →`,
            JSON.stringify(data)
        );
        return data;
    } catch (e) {
        console.warn(
            `message ${action} @${nodeId} failed:`,
            e?.message || e
        );
        return null;
    }
}



async function _serverQueueBusy() {
    const apiObj = app?.api;
    if (!apiObj || typeof apiObj.fetchApi !== "function") return null;
    try {
        const res = await apiObj.fetchApi("/queue");
        if (!res || res.status !== 200) return null;
        const data = await res.json();
        const running = (data && data.queue_running) || [];
        const pending = (data && data.queue_pending) || [];
        return (running.length + pending.length) > 0;
    } catch (_) {
        return null;
    }
}

function _hookChooserFlowEvents() {
    if (chooserFlow._hooked) return;
    chooserFlow._hooked = true;
    const apiObj = app?.api;
    if (!apiObj?.addEventListener) {
        return;
    }
    // executing: {node: id} 开始执行 / {node: null} 本轮队列收尾
    apiObj.addEventListener("executing", (e) => {
        const nid = e?.detail?.node;
        chooserFlow.runningNodeId =
            (nid === null || nid === undefined) ? null : nid;
    });
    for (const ev of ["execution_error", "interrupted", "execution_success"]) {
        apiObj.addEventListener(ev, () => {
            chooserFlow.runningNodeId = null;
            chooserFlow.lastTerminal = ev;
            const text = _TERMINAL_HINTS[ev];
            if (text) {
                for (const fn of _LIVE_HINTS) {
                    try { fn(text); } catch (_) { /* 单面板失败不影响其余 */ }
                }
            }
        });
    }
    // 关闭/刷新页面前兜底取消 — 否则后端轮询要挂到 4h 超时
    window.addEventListener("beforeunload", () => {
        if (chooserFlow.runningNodeId != null) {
            sendChooserMessage(chooserFlow.runningNodeId, "cancel");
        }
    }, true);
}

// ═══════════════════════════════════════════════════════════════
//  1. SVG 构图图标库 (白色背景 + 灰色主体轮廓)
// ═══════════════════════════════════════════════════════════════

const MODES = [
    {
        key: "standard", label: "标准商业", count: 5,
        svg: `<svg viewBox="0 0 60 60"><rect width="60" height="60" fill="#fff" stroke="#d0d0d0"/><line x1="30" y1="0" x2="30" y2="60" stroke="#eee" stroke-dasharray="2,3"/><line x1="0" y1="30" x2="60" y2="30" stroke="#eee" stroke-dasharray="2,3"/><rect x="22" y="22" width="16" height="16" fill="#999" rx="2"/></svg>`,
    },
    {
        key: "lifestyle", label: "自然生活", count: 7,
        svg: `<svg viewBox="0 0 60 60"><rect width="60" height="60" fill="#fff" stroke="#d0d0d0"/><line x1="20" y1="0" x2="20" y2="60" stroke="#e8e8e8" stroke-dasharray="2,2"/><line x1="40" y1="0" x2="40" y2="60" stroke="#e8e8e8" stroke-dasharray="2,2"/><line x1="0" y1="20" x2="60" y2="20" stroke="#e8e8e8" stroke-dasharray="2,2"/><line x1="0" y1="40" x2="60" y2="40" stroke="#e8e8e8" stroke-dasharray="2,2"/><rect x="10" y="10" width="14" height="14" fill="#999" rx="2"/></svg>`,
    },
    {
        key: "cinematic", label: "电影感", count: 4,
        svg: `<svg viewBox="0 0 60 60"><rect width="60" height="60" fill="#fff" stroke="#d0d0d0"/><rect x="0" y="8" width="60" height="6" fill="#333" opacity="0.15"/><rect x="0" y="46" width="60" height="6" fill="#333" opacity="0.15"/><rect x="14" y="28" width="32" height="12" fill="#999" rx="1"/></svg>`,
    },
    {
        key: "documentary", label: "纪实抓拍", count: 3,
        svg: `<svg viewBox="0 0 60 60"><rect width="60" height="60" fill="#fff" stroke="#d0d0d0"/><rect x="40" y="16" width="28" height="28" fill="#bbb" rx="2" opacity="0.4"/><rect x="40" y="16" width="20" height="28" fill="#999" rx="2"/></svg>`,
    },
    {
        key: "dynamic", label: "动态运动", count: 4,
        svg: `<svg viewBox="0 0 60 60"><rect width="60" height="60" fill="#fff" stroke="#d0d0d0"/><line x1="0" y1="60" x2="60" y2="0" stroke="#e8e8e8" stroke-dasharray="3,2"/><rect x="10" y="34" width="14" height="14" fill="#999" rx="2" transform="rotate(-20 17 41)"/></svg>`,
    },
    {
        key: "extreme_closeup", label: "极近距离", count: 2,
        svg: `<svg viewBox="0 0 60 60"><rect width="60" height="60" fill="#fff" stroke="#d0d0d0"/><rect x="6" y="6" width="48" height="48" fill="#999" rx="3"/><rect x="20" y="14" width="8" height="8" fill="#ccc" rx="4"/><rect x="34" y="14" width="8" height="8" fill="#ccc" rx="4"/></svg>`,
    },
    {
        key: "environmental", label: "环境人像", count: 3,
        svg: `<svg viewBox="0 0 60 60"><rect width="60" height="60" fill="#fff" stroke="#d0d0d0"/><rect x="25" y="25" width="10" height="10" fill="#999" rx="1"/><circle cx="48" cy="14" r="4" fill="#ddd"/><path d="M 0 48 Q 30 42 60 48" stroke="#ddd" fill="none"/></svg>`,
    },
    {
        key: "banner", label: "Banner留白", count: 3,
        svg: `<svg viewBox="0 0 60 60"><rect width="60" height="60" fill="#fff" stroke="#d0d0d0"/><rect x="6" y="20" width="10" height="20" fill="#999" rx="1"/><line x1="22" y1="30" x2="52" y2="30" stroke="#ddd" stroke-dasharray="3,2"/></svg>`,
    },
];


// ═══════════════════════════════════════════════════════════════
//  2. CSS 样式 (仅卡片网格,无上传区)
// ═══════════════════════════════════════════════════════════════

const STYLE_ID = "composition-common-toolbox-styles";

function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
        /* ─── 主面板 ─── */
        .comp-selector-panel {
            font-family: system-ui, sans-serif;
            background: #1e1e1e;
            border: 1px solid #3a3a3a;
            border-radius: 8px;
            padding: 8px;
            width: 90%;
            min-width: 220px;
            height: auto !important;
            box-sizing: border-box;
            user-select: none;
            margin: 8px auto;
            pointer-events: none;
            overflow: hidden;
        }
        .comp-selector-panel .comp-panel-title,
        .comp-selector-panel .comp-mode-card,
        .comp-selector-panel .comp-selector-status {
            pointer-events: auto;
        }
        .comp-panel-title {
            font-size: 11px;
            color: #888;
            margin: 0 0 6px 2px;
            letter-spacing: 0.5px;
        }
        .comp-selector-status {
            font-size: 10px;
            line-height: 1.5;
            margin-top: 6px;
            padding: 4px 6px;
            border-radius: 4px;
            background: #262626;
            border: 1px solid #3a3a3a;
            color: #999;
            text-align: left;
            min-height: 12px;
            word-break: break-all;
        }
        .comp-selector-status.ok {
            border-color: #2e5e2e;
            color: #7c7;
        }
        .comp-selector-status.warn {
            border-color: #7a5c1e;
            color: #db9;
        }

        :root, .comp-selector-panel, .comp-chooser-panel {
            --comp-row-gap: 6px;
        }
        /* ─── 模式卡片网格 (图表信息模式) ─── */
        .comp-mode-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: var(--comp-row-gap);
        }
        .comp-mode-card {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 3px;
            padding: 5px 3px 4px;
            background: #2a2a2a;
            border: 1.5px solid #3a3a3a;
            border-radius: 6px;
            cursor: pointer;
            transition: border-color 0.15s, background 0.15s;
            position: relative;
        }
        .comp-mode-card:hover {
            border-color: #666;
            background: #323232;
        }
        .comp-mode-card.active {
            border-color: #4CAF50;
            background: #263326;
        }
        .comp-mode-card .comp-icon {
            width: 44px;
            height: 44px;
            border-radius: 4px;
            overflow: hidden;
            background: #fff;
            flex-shrink: 0;
        }
        .comp-mode-card .comp-icon svg {
            width: 100%;
            height: 100%;
            display: block;
        }
        .comp-mode-card .comp-name {
            font-size: 11px;
            color: #bbb;
            white-space: nowrap;
        }
        .comp-mode-card.active .comp-name {
            color: #6f6;
            font-weight: 600;
        }
        .comp-mode-card .comp-dot {
            position: absolute;
            top: 4px;
            right: 4px;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #444;
        }
        .comp-mode-card.active .comp-dot {
            background: #4CAF50;
            box-shadow: 0 0 4px #4CAF50;
        }
        .comp-mode-card .comp-tpl-count {
            position: absolute;
            top: 3px;
            left: 5px;
            font-size: 9px;
            line-height: 1.2;
            color: #7a7a7a;          /* 浅灰, 不抢主体 */
            font-weight: 600;
            font-variant-numeric: tabular-nums;
            pointer-events: none;     /* 不挡点击 */
        }
        .comp-info {
            display: inline-block;
            margin-left: 4px;
            font-size: 10px;
            color: #888;
            cursor: help;
            vertical-align: middle;
        }

        /* ─── Crop Chooser 缩略图网格 ─── */
        .comp-chooser-panel {
            background: #1e1e1e;
            border: 1px solid #333;
            border-radius: 8px;
            padding: 8px;
            width: 90%;
            min-width: 320px;
            height: auto !important;
            box-sizing: border-box;
            user-select: none;
            margin: 8px auto;
            pointer-events: none;
            overflow: hidden;
        }
        .comp-chooser-panel .comp-chooser-title,
        .comp-chooser-panel .comp-chooser-grid,
        .comp-chooser-panel .comp-chooser-diag,
        .comp-chooser-panel .comp-chooser-actions,
        .comp-chooser-panel .comp-chooser-status {
            pointer-events: auto;
        }
        .comp-chooser-title {
            font-size: 11px;
            color: #888;
            margin: 0 0 6px 2px;
            letter-spacing: 0.5px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .comp-chooser-title .comp-counter {
            color: #4CAF50;
            font-weight: 600;
        }
        .comp-chooser-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
            gap: var(--comp-row-gap);
            margin-bottom: 8px;
        }
        .comp-chooser-cell {
            aspect-ratio: 1 / 1;
            align-self: stretch;     /* 保留: 同行 cell 同高 (现由 aspect-ratio:1/1 天然保证) */
            position: relative;
            background: #000;
            border: 2px solid #3a3a3a;
            border-radius: 4px;
            cursor: pointer;
            overflow: hidden;
            transition: border-color 0.15s, transform 0.1s;
        }
        .comp-chooser-cell:hover {
            border-color: #888;
            transform: scale(1.02);
        }
        .comp-chooser-cell.selected {
            border-color: #4CAF50;
            box-shadow: 0 0 8px rgba(76, 175, 80, 0.6);
        }
        .comp-chooser-cell.reference {
            border-color: #4a90e2;
            border-style: dashed;
            cursor: pointer;
        }
        .comp-chooser-cell.reference.selected {
            border-color: #4CAF50;
            border-style: solid;
            box-shadow: 0 0 8px rgba(76, 175, 80, 0.6);
        }
        .comp-chooser-cell.reference.selected img {
            opacity: 1;
        }
        .comp-chooser-cell.reference::before {
            content: "点选原图";
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(74, 144, 226, 0.92);
            color: #fff;
            font-size: 11px;
            font-weight: 700;
            padding: 4px 10px;
            border-radius: 3px;
            z-index: 2;
            opacity: 0;
            transition: opacity 0.18s;
            box-shadow: 0 2px 6px rgba(0,0,0,0.5);
        }
        .comp-chooser-cell.reference.selected::before {
            content: "已选原图";
        }
        .comp-chooser-cell.reference:hover::before {
            opacity: 1;
        }
        .comp-chooser-cell.reference img {
            opacity: 0.85;                /* 未选中略灰化, 选中恢复 1.0 */
        }
        .comp-cell-ref-badge {
            position: absolute;
            top: 2px;
            right: 2px;
            background: rgba(74, 144, 226, 0.92);
            color: #fff;
            font-size: 9px;
            font-weight: 700;
            padding: 1px 5px;
            border-radius: 2px;
            pointer-events: none;
            z-index: 2;
            letter-spacing: 0.5px;
        }
        .comp-chooser-cell img {
            width: 100%;
            height: 100%;
            object-fit: contain;
            display: block;
        }
        .comp-chooser-cell .comp-cell-index {
            position: absolute;
            top: 2px;
            left: 2px;
            background: rgba(0, 0, 0, 0.7);
            color: #fff;
            font-size: 9px;
            padding: 1px 4px;
            border-radius: 2px;
            font-weight: 600;
        }
        .comp-chooser-cell .comp-cell-label {
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            background: linear-gradient(transparent, rgba(0, 0, 0, 0.85));
            color: #ddd;
            font-size: 8px;
            padding: 6px 3px 2px;
            text-align: center;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .comp-chooser-cell.selected .comp-cell-index {
            background: #4CAF50;
            color: #000;
        }
        .comp-cell-star {
            position: absolute;
            top: 2px;
            right: 2px;
            background: rgba(255, 180, 0, 0.92);
            color: #000;
            font-size: 9px;
            font-weight: 700;
            padding: 1px 4px;
            border-radius: 2px;
            pointer-events: none;
            box-shadow: 0 0 4px rgba(255, 180, 0, 0.5);
        }
        .comp-chooser-actions {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .comp-btn {
            padding: 6px 10px;
            background: #2a4a2a;
            color: #6f6;
            border: 1px solid #4CAF50;
            border-radius: 4px;
            font-size: 11px;
            cursor: pointer;
            text-align: center;
            transition: background 0.15s;
        }
        .comp-btn:hover {
            background: #3a6a3a;
        }
        .comp-btn.regen {
            background: #2a3a4a;
            color: #6cf;
            border-color: #48a;
        }
        .comp-btn.regen:hover {
            background: #3a5a6a;
        }
        .comp-chooser-status {
            font-size: 10px;
            color: #888;
            text-align: center;
            margin-top: 4px;
            min-height: 12px;
        }

        .comp-collapsed {
            display: none !important;
        }

        .ccg-placeholder {
            padding: 2px 4px;
            color: #777;
            font-size: 10px;
            text-align: center;
            line-height: 1.4;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
    `;
    document.head.appendChild(style);
}

// ═══════════════════════════════════════════════════════════════
//  3. 工具函数
// ═══════════════════════════════════════════════════════════════

function hideWidget(widget) {
    if (!widget) return;
    widget.origType = widget.type;
    widget.origDraw = widget.draw;
    widget.type = "hidden";
    widget.label = "";
    // ⚠ 不要清 widget.value: modes_csv 是用户的勾选状态, _selected_index 是
    //   用户点选的索引, 清空会破坏序列化与选中状态. widget.hidden=true 后
    //   LiteGraph 不再绘制, value 仍然在内存里, 序列化照常.
    widget.hidden = true;       // ★ 核心: LiteGraph 跳过不可见 widget
    widget.computeSize = () => [0, 0];   // 高度归零, layout 完全折叠
    if (widget.inputEl) widget.inputEl.style.display = "none";
    widget.draw = () => {};     // 双保险: 新 LiteGraph 走 widget.draw 时也 noop
}

function waitForWidget(node, name, cb, attempt = 0) {
    if (attempt > 100) {  // 最多 3 秒, 兜底防死循环
        return;
    }
    const w = node.widgets?.find((x) => x.name === name);
    if (w) cb(w);
    else setTimeout(() => waitForWidget(node, name, cb, attempt + 1), 30);
}

function measurePanelHeight(panel, widthHint) {
    // ── 累加子元素 offsetHeight + panel padding，避免 panel.offsetHeight
    //    随容器拉伸而膨胀，从而切断 "测高→节点变高→容器拉伸→测高更大" 的反馈环。
    try {
        const cs = getComputedStyle(panel);
        const padTop = parseFloat(cs.paddingTop) || 0;
        const padBottom = parseFloat(cs.paddingBottom) || 0;
        let h = padTop + padBottom;
        let valid = false;
        for (const child of panel.children) {
            if (child.offsetHeight > 0) valid = true;
            const ccs = getComputedStyle(child);
            h += child.offsetHeight
                + (parseFloat(ccs.marginTop) || 0)
                + (parseFloat(ccs.marginBottom) || 0);
        }
        if (valid && h > 0) {
            panel._lastValidH = h;          // 缓存：拖拽时 offsetHeight 抖动可降级使用
            return h;
        }
    } catch (e) { /* 降级到缓存 / 离屏测量 */ }

    if (panel._lastValidH && panel._lastValidH > 0) return panel._lastValidH;

    const saved = {
        position: panel.style.position,
        left: panel.style.left,
        top: panel.style.top,
        visibility: panel.style.visibility,
        width: panel.style.width,
    };
    const wasConnected = panel.isConnected;
    try {
        panel.style.position = "fixed";
        panel.style.left = "-9999px";
        panel.style.top = "0";
        panel.style.visibility = "hidden";
        if (widthHint) panel.style.width = widthHint + "px";
        if (!wasConnected) document.body.appendChild(panel);
        let h2 = panel.offsetHeight;
        if (h2 > 0) panel._lastValidH = h2;
    } catch (e) { /* 静默降级 */ } finally {
        if (!wasConnected && panel.isConnected) panel.remove();
        Object.assign(panel.style, saved);
    }
    return panel._lastValidH || 0;
}

// ═══════════════════════════════════════════════════════════════
//  4. 构建 DOM 面板 (仅模式卡片网格)
// ═══════════════════════════════════════════════════════════════

function buildPanel(node) {
    let modesWidget = null;

    const VALID_KEYS = new Set(MODES.map(m => m.key));
    const parseModes = () => {
        const out = new Set();
        for (const part of String(modesWidget?.value ?? "").split(",")) {
            const k = part.trim();
            if (VALID_KEYS.has(k)) out.add(k);
        }
        return out;
    };
    const writeModes = (set) => {
        if (!modesWidget) return;
        const ordered = MODES.filter(m => set.has(m.key)).map(m => m.key);
        modesWidget.value = ordered.join(",") || "lifestyle";
    };


    // ── 面板容器 ──
    const panel = document.createElement("div");
    panel.className = "comp-selector-panel";

    const title = document.createElement("div");
    title.className = "comp-panel-title";
    title.textContent = "构图模式 (可多选)";
    panel.appendChild(title);

    // ── 模式卡片网格 ──
    const grid = document.createElement("div");
    grid.className = "comp-mode-grid";

    let polled = false;
    waitForWidget(node, "modes_csv", (w) => {
        if (polled) return;
        polled = true;
        modesWidget = w;
        hideWidget(w);
        // 归一化: 空/无效值(含旧工作流反序列化出的 boolean)→ 默认 lifestyle
        if (parseModes().size === 0) writeModes(new Set(["lifestyle"]));
        for (const c of grid.querySelectorAll(".comp-mode-card")) {
            const k = c.dataset.modeKey;
            if (k) c.classList.toggle("active", parseModes().has(k));
        }
        node.setDirtyCanvas(true, true);
    });

    let updateStatus = () => {};
    let dirtySinceLastRun = false;

    for (const mode of MODES) {
        const card = document.createElement("div");
        card.className = "comp-mode-card";
        card.dataset.modeKey = mode.key;
        card.innerHTML = `
            <span class="comp-tpl-count" title="该模式包含 ${mode.count} 个构图模板。注意: 实际生成的候选数 = 去重后模板 × 画幅变体, 受 Generator 的 num_candidates 参数截断.">${mode.count ?? ""}</span>
            <span class="comp-dot"></span>
            <div class="comp-icon">${mode.svg}</div>
            <div class="comp-name">${mode.label}</div>
        `;

        const getEnabled = () => parseModes().has(mode.key);

        const syncCard = () => {
            card.classList.toggle("active", getEnabled());
        };

        const syncAllCards = () => {
            const s = parseModes();
            for (const c of grid.querySelectorAll(".comp-mode-card")) {
                const k = c.dataset.modeKey;
                if (!k || !VALID_KEYS.has(k)) continue;
                c.classList.toggle("active", s.has(k));
            }
        };

        card.addEventListener("click", (e) => {
            e.stopPropagation();
            const s = parseModes();
            if (s.has(mode.key)) s.delete(mode.key); else s.add(mode.key);
            writeModes(s);
            syncAllCards();
            dirtySinceLastRun = true;
            updateStatus();
        });

        grid.appendChild(card);
    }


    panel.appendChild(grid);

    const statusBar = document.createElement("div");
    statusBar.className = "comp-selector-status";
    panel.appendChild(statusBar);

    const getSelectedCount = () => parseModes().size;

    const isConnected = () => {
        const out = node.outputs?.find(
            (o) => o.name === "composition_modes");
        return !!(out && out.links && out.links.length > 0);
    };

    updateStatus = () => {
        const connected = isConnected();
        const n = getSelectedCount();
        const activeCount = panel.querySelectorAll(".comp-mode-card.active").length;
        if (modesWidget && activeCount !== n) {
            for (const c of panel.querySelectorAll(".comp-mode-card")) {
                const k = c.dataset.modeKey;
                if (k) c.classList.toggle("active", parseModes().has(k));
            }
        }
        statusBar.classList.toggle("ok", connected && !dirtySinceLastRun);
        statusBar.classList.toggle("warn", !connected || dirtySinceLastRun);
        const explain = (connected && n > 0)
            ? ' <span class="comp-info" title="候选数 ≠ 模板角标: 多模式会去重, 每模板最多 × 画幅变体 (默认 max_aspect_variants=2), 最终受 Generator 的 num_candidates 截断.">ⓘ</span>'
            : '';
        if (!connected) {
            statusBar.innerHTML =
                "⚠ 未连接 — 从右侧 composition_modes 拖线到" +
                " Crop Generator 的同名输入口";
        } else if (dirtySinceLastRun) {
            statusBar.innerHTML =
                `已选 ${n} 个模式 · 按 Ctrl+Enter 重新运行生效${explain}`;
        } else {
            statusBar.innerHTML = `✓ 已连接 · 当前 ${n} 个模式生效中${explain}`;
        }
    };

    // 连线变化时刷新状态 (方案C)
    const origOnConnChange = node.onConnectionsChange;
    node.onConnectionsChange = function (side, slot, connected) {
        origOnConnChange?.apply(this, arguments);
        setTimeout(updateStatus, 0);
    };
    // 工作流执行完成后清脏标记
    try {
        app.api?.addEventListener?.("status", (ev) => {
            if (ev?.detail?.exec_info?.queue_remaining === 0) {
                dirtySinceLastRun = false;
                updateStatus();
            }
        });
    } catch (e) { /* 老版本无此事件, 静默降级 */ }

    // regen 成功后清脏标记 (Chooser 内部同步重跑, 不走队列,
    // 无 status 事件; Chooser 前端 dispatch 此事件通知)
    window.addEventListener("comp-crop-regen-success", () => {
        dirtySinceLastRun = false;
        updateStatus();
    });

    updateStatus();

    // ── 注入为 DOM widget ──
    if (typeof node.addDOMWidget === "function") {
        let lastPanelH = 0;
        node._cachedPanelH = 0;
        const fitSelectorNode = () => {
            try {
                const LG = window.LiteGraph || {};
                const titleH = LG.NODE_TITLE_HEIGHT || 30;
                const slotH = LG.NODE_SLOT_HEIGHT || 20;
                const slots = Math.max(
                    node.inputs?.length || 0,
                    node.outputs?.length || 0
                );
                let widgetH = 0;
                for (const w of node.widgets || []) {
                    if (!w || w.name === "composition_panel") continue;
                    if (w.hidden) continue;
                    let wh = 0;
                    try { wh = w.computeSize?.()?.[1] || 0; } catch (_) {}
                    if (wh < 0) wh = 0;
                    widgetH += wh + 4;
                }
                const wHint = node.size[0] - 30;
                const panelContentH = measurePanelHeight(panel, wHint) || 400;
                node._cachedPanelH = panelContentH;
                // size[1] is body height (excludes title bar) — do NOT add titleH
                // +20: CSS margin 8*2 + buffer 4; +10: bottom clearance (8px visible + 2px buffer)
                const panelH = panelContentH + 20 + 10;
                const minH = slots * slotH + widgetH + panelH;
                if (minH > 0 && Math.abs(minH - node.size[1]) > 2) {
                    node.size[1] = minH;
                    node.setDirtyCanvas(true, true);
                }
                lastPanelH = panelContentH;
            } catch (e) { /* 静默降级 */ }
        };
        // Use cached panel height to prevent race condition with _arrangeWidgets
        // (which calls getMinHeight on every frame; live measurement could differ
        //  from what fitSelectorNode used, causing _arrangeWidgets to grow the node
        //  to exactly fit the widget — leaving zero bottom clearance for resize handle)
        const domWidget = node.addDOMWidget(
            "composition_panel",
            "comp_selector_panel",
            panel,
            {
                margin: 0,
                getMinHeight: () => (node._cachedPanelH || 400) + 20,
                getHeight: () => (node._cachedPanelH || 400) + 20,
                getMaxHeight: () => (node._cachedPanelH || 400) + 20,
            }
        );
        domWidget.serialize = false;
        domWidget.serializeValue = undefined;
        setTimeout(fitSelectorNode, 60);
        setTimeout(fitSelectorNode, 150);
        setTimeout(fitSelectorNode, 400);
        setTimeout(fitSelectorNode, 800);
        if (typeof ResizeObserver !== "undefined") {
            let roTimer = null;
            const ro = new ResizeObserver(() => {
                if (roTimer) clearTimeout(roTimer);
                roTimer = setTimeout(() => {
                    const cur = measurePanelHeight(panel, node.size[0] - 30);
                    if (cur > 0 && Math.abs(cur - lastPanelH) > 1) {
                        panel._lastValidH = 0;
                        fitSelectorNode();
                    }
                }, 50);
            });
            ro.observe(panel);
        }
    } else {
        console.warn(
            "[Crop Mode Selector] addDOMWidget 不可用, " +
            "面板 UI 未注入; 原生 modes_csv 文本框保持可用"
        );
        return;
    }
}

// ═══════════════════════════════════════════════════════════════
//  4b. Crop Chooser 面板 (Image Chooser 风格)
// ═══════════════════════════════════════════════════════════════

async function buildChooserPanel(node) {
    const LGraphNode = node.constructor;
    if (typeof LGraphNode.prototype.addDOMWidget !== "function") {
        console.warn(
            "[Crop Chooser] addDOMWidget 不可用, " +
            "面板 UI 未注入"
        );
        return;
    }

    let idxWidget = null;
    let selectedIdx = -1;
    function syncIdxWidget(state) {
        if (!idxWidget) return;
        let target;
        if (state === "fired") {
            target = (selectedIdx >= 0 || selectedIdx === -2) ? selectedIdx : -1;
        } else {
            target = -1;  // 'idle' / 'pick-pending' 都是 -1
        }
        try {
            if (idxWidget.value !== target) {
                idxWidget.value = target;
                _clog(`syncIdxWidget → ${target} (state=${state})`);
            }
        } catch (e) {
            // readonly widget 不能静默吞掉, 否则 selected_index 无法同步
            console.warn(
                `syncIdxWidget failed: ${e.message}; ` +
                `widget is readonly — selected_index 同步失败, 请检查 ComfyUI 版本`
            );
        }
    }
    waitForWidget(node, "_selected_index", (w) => {
        idxWidget = w;
        hideWidget(w);
        syncIdxWidget("idle");
        node.setDirtyCanvas(true, true);
    });

    let bboxList = [];
    let bestIndices = [];
    let userPicked = false; // 用户手动点选过后不再自动改默认选中

    function parseMetadata(raw) {
        let parsed = null;
        try {
            parsed = JSON.parse(raw);
        } catch (e) {
            return;
        }
        if (Array.isArray(parsed)) {
            bboxList = parsed;
            bestIndices = [];
        } else if (parsed && typeof parsed === "object") {
            bboxList = Array.isArray(parsed.crops) ? parsed.crops : [];
            bestIndices = Array.isArray(parsed.best_indices)
                ? parsed.best_indices.map(Number).filter(
                      (x) => Number.isInteger(x) && x >= 0)
                : [];
        }
    }

    function isRerouteNode(n) {
        if (!n) return false;
        const t = (n.type || "") + "";
        return t === "Reroute" || t === "NodeReroute" || /reroute/i.test(t);
    }
    function isDataSourceNode(n) {
        if (!n) return false;
        const t = (n.type || "") + "";
        return t === "Crop Generator";
    }
    function resolveDataSourceNode(startNode) {
        let cur = startNode;
        const seen = new Set();
        let hops = 0;
        while (cur && !seen.has(cur.id) && hops < 16) {
            seen.add(cur.id);
            if (isDataSourceNode(cur)) return { node: cur, hops: hops };
            if (!isRerouteNode(cur)) return { node: cur, hops: hops };
            // 追 upstream: Reroute 只有 1 个 input slot
            const firstInput = cur.inputs && cur.inputs[0];
            if (!firstInput || !firstInput.link) return { node: cur, hops: hops };
            const link = app.graph.links[firstInput.link];
            if (!link) return { node: cur, hops: hops };
            const upstream = app.graph.getNodeById(link.origin_id);
            if (!upstream) return { node: cur, hops: hops };
            cur = upstream;
            hops++;
        }
        return { node: cur, hops: hops };
    }

    function getSourceNode() {
        const inputSlot = node.inputs?.find((i) => i.name === "crops");
        if (!inputSlot || !inputSlot.link) return null;
        const link = app.graph.links[inputSlot.link];
        if (!link) return null;
        const direct = app.graph.getNodeById(link.origin_id);
        if (!direct) return null;
        const { node: resolved, hops } = resolveDataSourceNode(direct);
        if (direct.id !== resolved.id || hops > 0) {
            _clog(
                `ENTRY resolve: direct=${direct.id} (${direct.type}) ` +
                `→ resolved=${resolved?.id} (${resolved?.type || "?"}) hops=${hops}`
            );
        }
        return resolved;
    }

    async function fetchMetadata() {
        // 1) widget 手动模式 (粘贴了新结构 JSON 才生效)
        const bboxWidget = node.widgets?.find(
            (w) => w.name === "crop_bboxes"
        );
        const wv = bboxWidget && typeof bboxWidget.value === "string"
            ? bboxWidget.value.trim() : "";
        if (wv.startsWith("{") || (wv.startsWith("[") && wv !== "[]")) {
            const before = bestIndices.length;
            parseMetadata(bboxWidget.value);
            if (bboxList.length > 0 || before !== bestIndices.length) {
                return;
            }
        }
        // 2) history 拉取上游 Generator 的 crop_bboxes 输出
        const src = getSourceNode();
        if (!src || !app.api) return;
        try {
            const history = await app.api.getHistory();
            // ComfyUI /api/history 直接返回 {prompt_id: {outputs:{...}}, ...}
            const histObj = history || {};
            const keys = Object.keys(histObj);
            _clog("[Chooser][fetchMetadata] history keys:", keys.length);
            for (let k = keys.length - 1; k >= 0; k--) {
                const outputs = histObj[keys[k]] &&
                    histObj[keys[k]].outputs;
                if (!outputs) continue;
                const out = outputs[String(src.id)];
                if (!out || !out.crop_bboxes) continue;
                // history 里 STRING 输出是数组 ["...json..."]
                const raw = Array.isArray(out.crop_bboxes)
                    ? out.crop_bboxes[0] : out.crop_bboxes;
                if (typeof raw === "string" && raw.trim()) {
                    parseMetadata(raw);
                    return;
                }
            }
        } catch (e) {
            /* history 不可用则静默降级 */
        }
        try {
            await tryPath3(src);
            const meta = _path3Meta.get(String(src.id));
            if (meta) {
                if (typeof meta.crop_bboxes === "string" &&
                    meta.crop_bboxes.trim().startsWith("{")) {
                    parseMetadata(meta.crop_bboxes);   // 同时填 bboxList + bestIndices
                } else if (Array.isArray(meta.best_indices) &&
                           meta.best_indices.length) {
                    bestIndices = meta.best_indices.map(Number).filter(
                        (x) => Number.isInteger(x) && x >= 0);
                }
                if (bboxList.length > 0 || bestIndices.length > 0) {
                    _clog("[Chooser] fetchMetadata: path3 fallback ✓",
                        "bbox=" + bboxList.length,
                        "best_indices=" + JSON.stringify(bestIndices));
                    return;
                }
            }
        } catch (_) { /* path3 兜底失败静默 */ }
    }

    function applyBestDefault() {
        if (userPicked) return;
        if (bestIndices.length > 0) {
            const guess = bestIndices[0];
            const n = bboxList.length;
            if (n === 0 || guess < n) {
                selectedIdx = guess;
                if (idxWidget) idxWidget.value = guess;
            }
        }
    }

    // ── 工具: 拿上游 crops IMAGE 的所有图 (dataURL 数组) ──
    //   标准节点 (Preview/Save) 会把图片存到 sourceNode.imgs,
    //   但自定义 Python 节点的 IMAGE 输出不会, 只在 history.outputs.images
    //   里以文件引用形式存在. 这里两种路径都覆盖.
    async function getInputImages() {
        _clog("[Chooser] getInputImages() called");
        const inputWidget = node.inputs?.find(
            (i) => i.name === "crops"
        );
        if (!inputWidget || !inputWidget.link) {
            return [];
        }

        const linkId = inputWidget.link;
        const link = app.graph.links[linkId];
        if (!link) {
            return [];
        }

        const directNode = app.graph.getNodeById(link.origin_id);
        if (!directNode) {
            return [];
        }
        const { node: sourceNode, hops } = resolveDataSourceNode(directNode);
        if (directNode.id !== sourceNode.id || hops > 0) {
            _clog(
                `ENTRY getInputImages resolve: ` +
                `direct=${directNode.id} (${directNode.type}) ` +
                `→ resolved=${sourceNode?.id} (${sourceNode?.type || "?"}) hops=${hops}`
            );
        }
        _clog("[Chooser] sourceNode:", sourceNode.id, sourceNode.title || sourceNode.type);

        cachedSourceNode = sourceNode;
        cachedDirectNode = directNode;
        cachedHops = hops;
        if (typeof updateDiagBar === "function") updateDiagBar();

        setupExecutedListener(sourceNode, link.origin_slot);

        try {
            const path3Refs = await tryPath3(sourceNode);
            if (path3Refs && path3Refs.length) {
                _clog("[Chooser] path3 ✓ got", path3Refs.length,
                    "refs for sourceNode", sourceNode.id);
                return refsToPreviews(path3Refs);
            }
        } catch (_) { /* 静默降级 */ }

        const slotIdx = link.origin_slot;
        const liveCacheFields = [
            "_compImageRefs", "imageOutput", "_imageOutput", "images", "_images"
        ];
        for (const f of liveCacheFields) {
            const v = sourceNode[f];
            if (Array.isArray(v) && v.length) {
                _clog("[Chooser] path1d (sourceNode." + f + ") got", v.length, "refs");
                return refsToPreviews(v);
            }
        }
        // slot 缓存
        if (Array.isArray(sourceNode._outputs) && typeof slotIdx === "number") {
            const cached = sourceNode._outputs[slotIdx];
            if (Array.isArray(cached) && cached.length) {
                _clog("[Chooser] path1d (sourceNode._outputs[" + slotIdx + "]) got", cached.length, "imgs");
                return refsToPreviews(cached);
            }
        }

        // 路径 1: 标准节点隐藏 widget (Preview/Save Image 有 _images / images)
        let cached = null;
        for (const w of (sourceNode.widgets || [])) {
            if (w.name && (w.name === "_images" || w.name === "images")) {
                if (Array.isArray(w.value) && w.value.length) {
                    cached = w.value;
                    break;
                }
            }
        }
        if (cached && cached.length) {
            _clog("[Chooser] path1 (widget " + sourceNode.id + ") got", cached.length, "imgs");
            return refsToPreviews(cached);
        }
        if (Array.isArray(sourceNode.imgs) && sourceNode.imgs.length) {
            _clog("[Chooser] path1b (sourceNode.imgs) got", sourceNode.imgs.length, "imgs");
            return sourceNode.imgs;
        }
        // ══════════════════════════════════════════════════════════
        //  路径 1c: crops_manifest 多层兜底 (任一层命中即返回)
        //   1c-1: 本节点 crops_manifest widget (粘贴模式)
        //   1c-2: 本节点 widgets_values[slotIdx] (forceInput socket, 连线模式)
        //   1c-3: 上游 Generator history.outputs[genId].crops_manifest  ★关键
        //   1c-4: 上游 Generator widgets 查找 (兜底)
        //   完全走工作流图, 不依赖连线, 不依赖全局文件.
        // ══════════════════════════════════════════════════════════
        const manifestRaw = await readManifestMultiPath(node, sourceNode);
        if (manifestRaw) {
            try {
                const manifest = JSON.parse(manifestRaw);
                if (Array.isArray(manifest) && manifest.length) {
                    const viewBase = app.api.apiURL("/view");
                    const urls = manifest.filter((p) => !!p).map((relpath) => ({
                        __previewUrl: `${viewBase}?filename=${encodeURIComponent(
                            relpath.split(/[/\\]/).pop()
                        )}&subfolder=${encodeURIComponent(
                            relpath.includes("/") || relpath.includes("\\")
                                ? relpath.split(/[/\\]/).slice(0, -1).join("/")
                                : ""
                        )}&type=temp`
                    }));
                    if (urls.length) {
                        _clog("[Chooser] path1c (crops_manifest) got", urls.length, "urls");
                        return urls;
                    }
                }
            } catch (e) {
                console.warn("[Chooser] crops_manifest parse fail", e);
            }
        }

        // 不采用"全局 latest manifest 文件"这类兜底:
        // 固定文件名的全局 IO 会与多 Generator 实例 / 其他插件冲突.
        // 可靠来源是 crops_manifest 连线 / 上游 history (path1c, 工作流图内).
        _clog("[Chooser] path1 empty, trying history API...");

        // 路径 2: history API — 上次执行的 IMAGE 输出以文件路径列表存储
        //   outputs[node_id].images = [{filename, subfolder, type}, ...]
        //   数量与 crops batch 张数一致 (ComfyUI server 保存 batch 时按张分文件).
        if (!app.api) {
            console.warn("[Chooser] app.api not available");
            return [];
        }
        try {
            const history = await app.api.getHistory();
            // ComfyUI /api/history 返回结构因版本而异:
            //   • 老版本/部分 wrapper: {prompt_id: {outputs:{...}}, ...}
            //   • 新版本: array of prompts [...]
            //   这里两种都支持, 都按 prompt 集合遍历.
            _clog("[Chooser] history raw type:", typeof history,
                "isArray:", Array.isArray(history),
                "len:", Array.isArray(history) ? history.length : Object.keys(history||{}).length);

            const entries = [];
            if (Array.isArray(history)) {
                for (const item of history) {
                    if (item && typeof item === "object") entries.push(item);
                }
            } else if (history && typeof history === "object") {
                // 老格式: {prompt_id: {...}}, 每个 value 是 prompt 对象
                for (const k of Object.keys(history)) {
                    entries.push(history[k]);
                }
            }

            // 详细诊断: 第一个 entry 长什么样
            if (entries.length) {
                const last = entries[entries.length - 1];
                _clog("[Chooser] history[last] keys:", Object.keys(last || {}));
            }

            // 缓存 lazy-load 的 full prompt (避免重复 fetch)
            //   key: promptId, value: full prompt dict (含 outputs)
            const fullCache = new Map();
            async function fetchFullPrompt(promptId) {
                if (fullCache.has(promptId)) return fullCache.get(promptId);
                const url = app.api.apiURL(`/history/${promptId}`);
                _clog("[fetchFullPrompt: GET", url);
                try {
                    const resp = await fetch(url);
                    _clog("[fetch status:", resp.status, resp.statusText);
                    if (resp.ok) {
                        const data = await resp.json();
                        const wrapperKeys = Object.keys(data || {});
                        const inner = data?.outputs
                            ? data                       // 直接就是 entry (防御性)
                            : (data?.[promptId] || null); // 标准格式: {promptId: entry}
                        _clog("[fetch OK, wrapper keys:",
                            wrapperKeys, "entry has outputs:",
                            !!inner?.outputs,
                            inner?.outputs ? Object.keys(inner.outputs) : "(none)");
                        fullCache.set(promptId, inner || data);
                        return inner || data;
                    }
                } catch (err) {
                        console.warn("[Chooser] /history/" + promptId + " fetch err", err);
                    }
                return null;
            }

            for (let k = entries.length - 1; k >= 0; k--) {
                // 兼容多种结构:
                //   • 老标准: entries[k].outputs[node_id].images[]
                //   • 新标准: entries[k].prompt.outputs[node_id].images[]
                //   • 秋叶整合包: 顶层 history 无 outputs (只剩 outputs_count),
                //     必须 GET /history/{promptId} 才能拿到完整 outputs[node_id].
                const e = entries[k];
                let promptId = e?.id || e?.prompt_id || e?.prompt?.id;
                let matching = null; // 找到的图片引用数组

                _clog("[path2 entry", k,
                    "promptId=" + JSON.stringify(promptId),
                    "hasOutputs=" + !!e?.outputs,
                    "hasPreviewOutput=" + !!e?.preview_output);

                // 1) 先看 e.outputs (老标准 / 新标准 / /history/{id} full body)
                if (e?.outputs && typeof e.outputs === "object" &&
                    !Array.isArray(e.outputs)) {
                    const out = e.outputs[String(sourceNode.id)];
                    if (out?.images?.length) matching = out.images;
                    else if (Array.isArray(out?._comp_image_refs) && out._comp_image_refs.length) {
                        matching = out._comp_image_refs;
                    }
                }
                if (!matching && e?.prompt?.outputs) {
                    const out = e.prompt.outputs[String(sourceNode.id)];
                    if (out?.images?.length) matching = out.images;
                    else if (Array.isArray(out?._comp_image_refs) && out._comp_image_refs.length) {
                        matching = out._comp_image_refs;
                    }
                }

                if (!matching && promptId) {
                    const full = await fetchFullPrompt(promptId);
                    const out = full?.outputs?.[String(sourceNode.id)];
                    if (out?.images?.length) {
                        matching = out.images;
                        _clog("[lazy /history hit images, got",
                            matching.length, "for node", sourceNode.id);
                    } else if (Array.isArray(out?._comp_image_refs) && out._comp_image_refs.length) {
                        matching = out._comp_image_refs;
                        _clog("[lazy /history hit _comp_image_refs, got",
                            matching.length, "for node", sourceNode.id);
                    }
                }

                // 3) preview_output fallback (老 wrapper 缓存, 包含所有 IMAGE 节点)
                if (!matching && e?.preview_output) {
                    const po = e.preview_output;
                    let refs = null;
                    if (Array.isArray(po)) refs = po;
                    else if (po && typeof po === "object" && po.nodeId) refs = [po];
                    else if (typeof po === "string" && po.trim()) {
                        try {
                            const parsed = JSON.parse(po);
                            if (Array.isArray(parsed)) refs = parsed;
                            else if (parsed && typeof parsed === "object" && parsed.nodeId)
                                refs = [parsed];
                        } catch (_) {}
                    }
                    if (refs?.length) {
                        matching = refs.filter(
                            (it) => it && String(it.nodeId) === String(sourceNode.id)
                        );
                        if (!matching.length) matching = null;
                    }
                }
                if (!matching || !matching.length) {
                    _clog("[Chooser] path2: no matching images for node",
                        sourceNode.id, "in entry", k);
                    continue;
                }
                const targetN = bboxList.length || 0;
                const sliced = targetN > 0 ? matching.slice(0, targetN) : matching;
                _clog("[Chooser] path2 history got", sliced.length,
                    "images for node", sourceNode.id, " ");
                return refsToPreviews(sliced);
            }
        } catch (e) {
            console.warn("[Chooser] history fetch err", e);
        }
        return [];
    }

    async function getReferenceImage() {
        const refInput = node.inputs?.find((i) => i.name === "reference_image");
        if (!refInput || !refInput.link) {
            _clog("reference: reference_image 输入未连线 → null");
            return null;
        }
        const link = app.graph.links[refInput.link];
        if (!link) {
            return null;
        }
        const directNode = app.graph.getNodeById(link.origin_id);
        if (!directNode) {
            return null;
        }
        const { node: sourceNode } = resolveDataSourceNode(directNode);
        if (!sourceNode) {
            return null;
        }
        _clog(
            `reference: source=${sourceNode.id} (${sourceNode.type || "?"})`
        );

        try {
            const url = app.api.apiURL(`/comp_crop/refimg/${node.id}`);
            const resp = await fetch(url);
            if (resp.ok) {
                const data = await resp.json();
                if (data?.ref?.filename) {
                    const viewBase = app.api.apiURL("/view");
                    const p = new URLSearchParams({
                        filename: data.ref.filename || "",
                        subfolder: data.ref.subfolder || "",
                        type: data.ref.type || "output",
                    });
                    _clog(
                        `reference: A0 后端 refimg ✓ ` +
                        `${data.ref.subfolder}/${data.ref.filename}`
                    );
                    return { __previewUrl: `${viewBase}?${p.toString()}` };
                }
            }
            _clog(
                `reference: A0 miss (HTTP ${resp.status}, ` +
                `队列尚未跑到本节点或 reference_image 未连线)`
            );
        } catch (e) {
            console.warn("reference: A0 fetch err", e?.message || e);
        }

        const slotIdx = link.origin_slot;

        // A) path3 自定义路由 (若 reference 接 Generator)
        try {
            const p3 = await tryPath3(sourceNode);
            if (p3 && p3.length) {
                const previews = refsToPreviews(p3);
                _clog("reference: A path3 命中 (注意: Generator refs 是裁切图)");
                return previews[0] || null;
            }
        } catch (_) { /* 静默降级 */ }

        // B) sourceNode 字段 cache
        const fields = ["images", "_images", "imageOutput", "_imageOutput", "_compImageRefs"];
        for (const f of fields) {
            const v = sourceNode[f];
            if (Array.isArray(v) && v.length) {
                const previews = refsToPreviews(v);
                _clog(`reference: B 字段 cache 命中 (${f})`);
                return previews[0] || null;
            }
        }
        // C) LiteGraph _outputs[slotIdx]
        if (Array.isArray(sourceNode._outputs) && typeof slotIdx === "number") {
            const cached = sourceNode._outputs[slotIdx];
            if (Array.isArray(cached) && cached.length) {
                const previews = refsToPreviews(cached);
                _clog("reference: C _outputs[slot] 命中");
                return previews[0] || null;
            }
        }
        // D) 隐藏 widget (_images / images)
        let wc = null;
        for (const w of (sourceNode.widgets || [])) {
            if (w.name && (w.name === "_images" || w.name === "images")) {
                if (Array.isArray(w.value) && w.value.length) {
                    wc = w.value;
                    break;
                }
            }
        }
        if (wc && wc.length) {
            const previews = refsToPreviews(wc);
            _clog("reference: D 隐藏 widget 命中");
            return previews[0] || null;
        }
        // E) sourceNode.imgs (原始 tensor / 已渲染 dataURL)
        if (Array.isArray(sourceNode.imgs) && sourceNode.imgs.length) {
            _clog("reference: E sourceNode.imgs 命中");
            return sourceNode.imgs[0] || null;
        }
        return null;
    }

    function tensorToDataURL(tensor, maxSize = 128) {
        // tensor: [H, W, 3] 或 [1, H, W, 3], 0~1 float
        let arr = tensor;
        if (arr.dim && arr.dim() === 4) arr = arr[0];
        const data = Array.from(arr.data ? arr.data() : arr);
        const h = arr.shape ? arr.shape[arr.shape.length - 2] : arr.dims[arr.dims.length - 2];
        const w = arr.shape ? arr.shape[arr.shape.length - 1] : arr.dims[arr.dims.length - 1];
        const c = data.length / (h * w);

        // downsample to maxSize for thumbnail
        const scale = Math.min(1, maxSize / Math.max(h, w));
        const dh = Math.max(1, Math.round(h * scale));
        const dw = Math.max(1, Math.round(w * scale));

        const canvas = document.createElement("canvas");
        canvas.width = dw;
        canvas.height = dh;
        const ctx = canvas.getContext("2d");
        const imgData = ctx.createImageData(dw, dh);

        for (let y = 0; y < dh; y++) {
            const sy = Math.floor(y / scale);
            for (let x = 0; x < dw; x++) {
                const sx = Math.floor(x / scale);
                const srcIdx = (sy * w + sx) * c;
                const dstIdx = (y * dw + x) * 4;
                imgData.data[dstIdx + 0] = Math.round(data[srcIdx + 0] * 255);
                imgData.data[dstIdx + 1] = (c >= 2) ? Math.round(data[srcIdx + 1] * 255) : imgData.data[dstIdx + 0];
                imgData.data[dstIdx + 2] = (c >= 3) ? Math.round(data[srcIdx + 2] * 255) : imgData.data[dstIdx + 0];
                imgData.data[dstIdx + 3] = 255;
            }
        }
        ctx.putImageData(imgData, 0, 0);
        return canvas.toDataURL("image/jpeg", 0.7);
    }

    let panel = null, grid = null, actions = null, status = null,
        counter = null, domWidget = null, panelMounted = false,
        diagBar = null;

    function _hint(text) {
        if (!status) return;
        status.textContent = text || "";
        status.style.color = "";    // 回落 .comp-chooser-status 的 #888 灰
    }

    let cachedSourceNode = null;
    let cachedDirectNode = null;
    let cachedHops = 0;

    let progressBtnRef = null;
    function setProgressEnabled(enabled) {
        if (!progressBtnRef) return;
        progressBtnRef.disabled = !enabled;
        progressBtnRef.style.opacity = enabled ? "1" : "0.45";
        progressBtnRef.style.cursor = enabled ? "pointer" : "not-allowed";
    }

    function updateDiagBar() {
        if (!diagBar) return;
        if (!cachedSourceNode) {
            diagBar.textContent = "等待数据源...";
            diagBar.style.color = "#bbb";
            diagBar.style.background = "rgba(255,255,255,0.03)";
            return;
        }
        const t = cachedSourceNode.type || "?";
        const id = cachedSourceNode.id;
        const isGen = t === "Crop Generator";
        if (isGen) {
            diagBar.textContent = `✓ 数据源: ${t} (#${id})${cachedHops ? ` (追穿 Reroute ${cachedHops} 跳)` : ""}`;
            diagBar.style.color = "#7fc97f";
            diagBar.style.background = "rgba(127, 201, 127, 0.12)";
        } else {
            const hint = (t === "LoadImage" || t === "LoadImageMask")
                ? "crops 应连 Crop Generator.crops(IMAGE),不是 LoadImage"
                : "crops 应连 Crop Generator 的输出";
            diagBar.textContent =
                `⚠️ 接线错误: sourceNode=${t}(#${id}); ${hint}`;
            diagBar.style.color = "#ff8a8a";
            diagBar.style.background = "rgba(255, 138, 138, 0.18)";
        }
    }

    function mountPanel() {
        if (panelMounted) return;
        panelMounted = true;

        panel = document.createElement("div");
        panel.className = "comp-chooser-panel";

        const title = document.createElement("div");
        title.className = "comp-chooser-title";
        title.innerHTML =
            '<span>裁切缩略图 (点击选择)</span>' +
            '<span class="comp-counter" data-counter>未选</span>';
        panel.appendChild(title);
        counter = title.querySelector("[data-counter]");

        grid = document.createElement("div");
        grid.className = "comp-chooser-grid";
        panel.appendChild(grid);

        diagBar = document.createElement("div");
        diagBar.className = "comp-chooser-diag";
        diagBar.style.cssText =
            "font-size:10px;line-height:1.3;padding:2px 6px;" +
            "border-radius:3px;margin:2px 0 4px 0;" +
            "color:#bbb;background:rgba(255,255,255,0.03);";
        diagBar.textContent = "等待数据源...";
        panel.appendChild(diagBar);

        actions = document.createElement("div");
        actions.className = "comp-chooser-actions";
        actions.innerHTML =
            '<button class="comp-btn" data-progress>Progress selected image</button>' +
            '<button class="comp-btn regen" data-regen>重新生成</button>';
        panel.appendChild(actions);

        status = document.createElement("div");
        status.className = "comp-chooser-status";
        status.textContent = "等待中";
        panel.appendChild(status);

        _LIVE_HINTS.add(_hint);
        const _origOnRemoved = node.onRemoved;
        node.onRemoved = function () {
            _LIVE_HINTS.delete(_hint);
            return _origOnRemoved?.apply(this, arguments);
        };

        const progressBtn = actions.querySelector("[data-progress]");
        const regenBtn = actions.querySelector("[data-regen]");
        progressBtnRef = progressBtn;
        progressBtn.addEventListener("click", async () => {
            if (selectedIdx === -1 ||
                (selectedIdx >= 0 && !bboxList[selectedIdx])) {
                _hint("请选择");
                return;
            }
            progressBtn.style.background = "";
            progressBtn.style.color = "";
            progressBtn.style.fontWeight = "";

            let resp = await sendChooserMessage(node.id, "select", selectedIdx);
            if (!resp || !resp.waiting) {
                for (let i = 0; i < 3; i++) {
                    await new Promise((r) => setTimeout(r, 350));
                    resp = await sendChooserMessage(node.id, "select", selectedIdx);
                    if (resp && resp.waiting) break;
                }
            }
            if (resp && resp.waiting) {
                _hint("已发送");
                _clog(
                    `progress: select 唤醒成功, ` +
                    `无需重入队 (node=${node.id})`
                );
                return;
            }
            // 后端没有本节点的等待会话 → 判断队列状态再决定
            if (chooserFlow.runningNodeId != null &&
                !chooserFlow.here(node.id)) {
                // 队列正在跑别的节点 (上游还没执行到本节点) — 不重复入队,
                // 等本节点暂停等待时再按 Progress (或本轮跑完自然暂停).
                _hint("执行中");
                _clog(
                    `progress: 队列忙于 node=` +
                    `${chooserFlow.runningNodeId}, 跳过重入队`
                );
                return;
            }
            const _busy = await _serverQueueBusy();
            if (_busy === true) {
                // 队列仍活 (select 只是瞬时 miss: 会话间隙/事件丢失)
                _hint("执行中");
                _clog(
                    "progress: 服务端队列非空 " +
                    "(GET /queue) — select 未命中但队列仍活, 拒绝重入队, " +
                    "等下一轮 chooser 会话注册后再点 Progress"
                );
                return;
            }
            if (_busy === false) {
                const _t = chooserFlow.lastTerminal;
                _hint(_TERMINAL_HINTS[_t] || "队列已结束");
                _clog(
                    "progress: select 未命中 (无等待会话) " +
                    `且服务端队列空闲 — 终态=${_t || "未知(事件丢失)"} ` +
                    "不再重复排队. 如需重跑请用节点 GENERATE / " +
                    "LG 组按钮."
                );
                return;
            }
            _hint("检测失败");
        });


        regenBtn.addEventListener("click", async () => {
            const selectorNode = (app.graph?._nodes || []).find((n) =>
                n.comfyClass === "Crop Mode Selector" ||
                n.type === "Crop Mode Selector"
            );
            const modesW = selectorNode?.widgets?.find(
                (w) => w.name === "modes_csv"
            );
            const currentModes = modesW?.value ? String(modesW.value) : "";
            const extra = currentModes ? { composition_modes: currentModes } : {};
            const resp = await sendChooserMessage(node.id, "regen", -1, extra);
            if (resp && resp.waiting) {
                _hint("重新生成中...");
                _clog(`regen: 已标记 (node=${node.id} modes=${currentModes || "缓存"})`);
                // 轮询等新 crops 落地 (后端重跑更新 LATEST_REFS.ts)
                _waitRegenRefs();
            } else {
                _hint("无活动会话");
                console.warn(
                    `regen: 后端无本节点等待会话 (node=${node.id}), ` +
                    "请确认 Chooser 当前正阻塞等待"
                );
            }
        });

        // regen 后等待后端缓存 ts 更新 → 清 path3 缓存 → 重新渲染缩略图
        const _waitRegenRefs = async () => {
            const startTs = Date.now();
            let lastTs = 0;
            try {
                const url = app.api.apiURL(`/comp_crop/refs/${node.id}`);
                const r0 = await fetch(url);
                if (r0.ok) lastTs = (await r0.json()).ts || 0;
            } catch (_) { /* 首次拉取失败按 0 处理 */ }
            const deadline = startTs + 180000;   // 最长等 3 分钟
            while (Date.now() < deadline) {
                await new Promise((r) => setTimeout(r, 800));
                try {
                    const url = app.api.apiURL(`/comp_crop/refs/${node.id}`);
                    const resp = await fetch(url);
                    if (!resp.ok) continue;
                    const data = await resp.json();
                    const ts = data?.ts || 0;
                    if (ts !== lastTs) {
                        // 新 crops 落地 → 刷新
                        _purgePath3();
                        _resetSelection();
                        await fetchMetadata();
                        renderGrid();
                        // 通知 Crop Mode Selector 清除脏标记
                        // (regen 已用当前 modes 重跑, 新 toggle 已生效)
                        window.dispatchEvent(
                            new CustomEvent("comp-crop-regen-success")
                        );
                        _clog(`regen: refs.ts 更新 ${lastTs} → ${ts}, 已刷新`);
                        return;
                    }
                } catch (_) { /* 单次失败继续轮询 */ }
            }
            _clog("regen: 等待 refs 更新超时 (180s), 请手动确认");
        };

        // 注册 DOM widget — 使用缓存高度避免与 _arrangeWidgets 的竞态条件
        node._cachedPanelH = 0;
        domWidget = node.addDOMWidget(
            "chooser_panel",
            "custom",
            panel,
            {
                serialize: false,
                serializeValue: undefined,
                hideOnZoom: false,
                margin: 0,
                getMinHeight: () => (node._cachedPanelH || 400) + 20,
                getHeight: () => (node._cachedPanelH || 400) + 20,
                getMaxHeight: () => (node._cachedPanelH || 400) + 20,
            }
        );
        domWidget.serialize = false;
        domWidget.serializeValue = undefined;
        _clog("[Chooser] mountPanel: 第一次有图, 动态注册 DOM widget");
        setProgressEnabled(false);
        updateDiagBar();
        setTimeout(() => { resizeNodeToFit(); }, 50);
        setTimeout(() => { resizeNodeToFit(); }, 300);
        if (typeof ResizeObserver !== "undefined") {
            let roTimer = null;
            const ro = new ResizeObserver(() => {
                if (roTimer) clearTimeout(roTimer);
                roTimer = setTimeout(() => {
                    if (panel) panel._lastValidH = 0;
                    resizeNodeToFit();
                }, 50);
            });
            ro.observe(panel);
        }
    }


    let _renderGeneration = 0;

    async function renderGrid() {
        const _myGen = ++_renderGeneration;
        syncIdxWidget("pick-pending");
        const imgs = await getInputImages();
        if (_myGen !== _renderGeneration) return;

        if (imgs.length === 0) {
            if (panelMounted) {
                const titleEl = panel.querySelector(".comp-chooser-title");
                if (titleEl) titleEl.style.display = "none";
                grid.innerHTML = '<div class="ccg-placeholder">等待图片…</div>';
                counter.textContent = "";
                if (actions) actions.style.display = "none";
                if (status) {
                    status.textContent = "";
                    status.style.color = "";
                }
            }
            resizeNodeToFit();
            return;
        }

        // 第一次有图: 懒加载挂 panel (后续 imgs 变化不会再 mount)
        mountPanel();
        const titleElShow = panel.querySelector(".comp-chooser-title");
        if (titleElShow) titleElShow.style.display = "";
        if (actions) actions.style.display = "";
        grid.innerHTML = "";

        const n = imgs.length || (bboxList.length || 1);

        for (let i = 0; i < n; i++) {
            const cell = document.createElement("div");
            cell.className = "comp-chooser-cell" +
                (i === selectedIdx ? " selected" : "");
            cell.dataset.index = String(i);


            const num = document.createElement("div");
            num.className = "comp-cell-index";
            num.textContent = String(i + 1).padStart(2, "0");
            cell.appendChild(num);

            // ⭐ 推荐徽章 (Ranker best_indices, 排名从 1 开始)
            const rank = bestIndices.indexOf(i);
            if (rank >= 0) {
                const star = document.createElement("div");
                star.className = "comp-cell-star";
                star.textContent = "★" + (rank + 1);
                star.title = `Ranker 推荐 #${rank + 1}`;
                cell.appendChild(star);
            }

            if (imgs[i]) {
                const img = document.createElement("img");
                try {
                    // 路径 1: dataURL (来自标准节点 tensor)
                    if (imgs[i].__previewUrl) {
                        img.src = imgs[i].__previewUrl;
                    } else if (imgs[i].src) {
                        img.src = imgs[i].src;
                    } else {
                        img.src = tensorToDataURL(imgs[i], 128);
                    }
                } catch (e) {
                    console.warn("[Chooser] thumb err", e);
                }
                img.draggable = false;
                img.addEventListener("load", () => resizeNodeToFit());
                cell.appendChild(img);
            }

            const label = document.createElement("div");
            label.className = "comp-cell-label";
            const meta = bboxList[i];
            if (meta && meta.template_id) {
                const sz = meta.size || [];
                label.textContent =
                    `${meta.template_id.split("_")[0]} ${sz[0]||"?"}×${sz[1]||"?"}`;
            } else {
                label.textContent = `#${i + 1}`;
            }
            cell.appendChild(label);

            cell.addEventListener("click", () => {
                selectedIdx = i;
                userPicked = true; // 用户手动选过后不再自动切默认
                syncIdxWidget("pick-pending");
                renderGrid();
                _hint("已选 #" + (i + 1));
                counter.textContent = `#${i + 1} / ${n}`;
                setProgressEnabled(true);
            });

            grid.appendChild(cell);
        }

        const refImg = await getReferenceImage();
        if (_myGen !== _renderGeneration) return;
        if (refImg) {
            const refCell = document.createElement("div");
            refCell.className = "comp-chooser-cell reference" +
                (selectedIdx === -2 ? " selected" : "");
            refCell.title = "reference_image 原图 — 点选后按 [Progress] 输出整张原图";

            const refBadge = document.createElement("div");
            refBadge.className = "comp-cell-ref-badge";
            refBadge.textContent = "原图";
            refCell.appendChild(refBadge);

            try {
                const imgEl = document.createElement("img");
                if (refImg.__previewUrl) {
                    imgEl.src = refImg.__previewUrl;
                } else if (refImg.src) {
                    imgEl.src = refImg.src;
                } else {
                    imgEl.src = tensorToDataURL(refImg, 128);
                }
                imgEl.draggable = false;
                imgEl.addEventListener("load", () => resizeNodeToFit());
                refCell.appendChild(imgEl);
            } catch (e) {
                console.warn("reference image render err", e);
            }

            refCell.addEventListener("click", () => {
                selectedIdx = -2;    // 哨兵: 选择"原图"
                userPicked = true;
                syncIdxWidget("pick-pending");
                renderGrid();
                _hint("已选原图");
                counter.textContent = `原图 / ${imgs.length || bboxList.length}`;
                setProgressEnabled(true);
                _clog("reference cell click: selectedIdx=-2 (原图)");
            });

            grid.appendChild(refCell);
            _clog("reference cell appended to grid" +
                (selectedIdx === -2 ? " (selected)" : ""));
        } else {
            _clog(
                "reference cell skipped: getReferenceImage() → null " +
                "(console 上方有路径级诊断日志)"
            );
        }

        counter.textContent = selectedIdx === -2
            ? `原图 / ${n}`
            : (n > 0
                ? (selectedIdx >= 0 && selectedIdx < n ? `#${selectedIdx + 1} / ${n}` : `— / ${n}`)
                : "未选");
        _clog(`[Chooser] renderGrid done: n=${n}, imgs.length=${imgs.length}, bboxList.length=${bboxList.length}`);
        resizeNodeToFit();
    }

    function calcChooserPanelH() {
        if (!panelMounted || !panel) return 0;
        // measurePanelHeight 累加子元素 offsetHeight + 各自 margin + panel padding
        // 额外 +18 = CSS margin 8*2 + border 1*2
        return (measurePanelHeight(panel) || 0) + 18;
    }

    let resizeRAF = null;
    function resizeNodeToFit() {
        if (resizeRAF) cancelAnimationFrame(resizeRAF);
        resizeRAF = requestAnimationFrame(() => {
            resizeRAF = null;
            try {
                const LG = window.LiteGraph || {};
                const titleH = LG.NODE_TITLE_HEIGHT || 30;
                const slotH = LG.NODE_SLOT_HEIGHT || 20;
                const slots = Math.max(
                    node.inputs?.length || 0,
                    node.outputs?.length || 0
                );
                let widgetH = 0;
                for (const w of node.widgets || []) {
                    // 跳过 DOM widget 本身 (panel 高度单独计) 与隐藏 widget
                    if (!w || w.name === "chooser_panel") continue;
                    if (w.type === "hidden" ||
                        String(w.type).startsWith("comp-hidden-") ||
                        w.type === "convertedwidget") continue;
                    if (w.hidden) continue;
                    let wh = 0;
                    try { wh = w.computeSize?.()?.[1] || 0; } catch (_) {}
                    if (wh < 0) continue;
                    widgetH += wh + 3;
                }
                const panelContentH = measurePanelHeight(panel) || 0;
                node._cachedPanelH = panelContentH;
                // size[1] is body height (excludes title bar) — do NOT add titleH
                // +18: CSS margin 8*2 + border 1*2; +10: bottom clearance (8px visible + 2px buffer)
                const panelH = panelContentH + 18 + 10;
                const minH = slots * slotH + widgetH + panelH;
                node._compMinH = minH;
                if (minH > 0 && Math.abs(minH - node.size[1]) > 2) {
                    node.size[1] = minH;
                    node.setDirtyCanvas(true, true);
                    _clog(
                        `[Chooser] resizeNodeToFit: ` +
                        `panelContentH=${panelContentH}, calc_h=${minH}, ` +
                        `prev=${node.size[1]} → set to ${minH}`
                    );
                }
            } catch (e) {
                /* 静默降级: 保持当前尺寸 */
            }
        });
    }

    setTimeout(() => resizeNodeToFit(), 0);
    setTimeout(() => resizeNodeToFit(), 100);
    setTimeout(() => resizeNodeToFit(), 500);

    mountPanel();
    renderGrid();
    fetchMetadata().then(() => renderGrid());

    // ── 缩放重渲染 ──
    const rescaleWidget = node.widgets?.find(
        (w) => w.name === "preview_rescale"
    );
    let rescaleTimer = null;
    if (rescaleWidget) {
        const origCallback = rescaleWidget.callback;
        rescaleWidget.callback = function (value) {
            if (origCallback) origCallback.apply(this, arguments);
            if (rescaleTimer) clearTimeout(rescaleTimer);
            rescaleTimer = setTimeout(() => renderGrid(), 150);
        };
    }

    let lastSig = "";
    let pollTickCount = 0;
    let lastRefTs = 0;
    function imgsSignature(list) {
        if (!Array.isArray(list) || !list.length) return "";
        return list.map(
            (x) => x?.__previewUrl || x?.src || "tensor"
        ).join("|");
    }
    setInterval(async () => {
        if (status && chooserFlow.here(node.id)) {
            _hint("等待中");
        }
        const imgs = await getInputImages();
        const sig = imgsSignature(imgs);
        pollTickCount++;
        if (pollTickCount % 30 === 0) {
            _clog(
                `POLL 心跳: tick=${pollTickCount} ` +
                `imgs=${imgs.length} sigLen=${sig.length} ` +
                `srcRunning=${srcRunning} unchanged=${sig === lastSig}`
            );
        }
        if (sig !== lastSig) {
            const firstChange = lastSig === "";
            lastSig = sig;
            srcRunning = false;
            if (!firstChange) {
                userPicked = false;
                selectedIdx = -1;
                syncIdxWidget("idle");
                if (progressBtnRef) {
                    progressBtnRef.style.background = "";
                    progressBtnRef.style.color = "";
                    progressBtnRef.style.fontWeight = "";
                }
                setProgressEnabled(false);
                _clog("POLL: 新一轮候选到达 (签名变化), 重置选择并刷新缩略图");
            }
            await fetchMetadata();
            renderGrid();
        }
        const refIn = node.inputs?.find((i) => i.name === "reference_image");
        if (refIn && refIn.link) {
            try {
                const rr = await fetch(app.api.apiURL(`/comp_crop/refimg/${node.id}`));
                if (rr.ok) {
                    const dd = await rr.json();
                    const ts = Number(dd?.ts || 0);
                    if (dd?.ref?.filename && ts && ts !== lastRefTs) {
                        const firstRef = lastRefTs === 0;
                        lastRefTs = ts;
                        renderGrid();
                        _clog(
                            `POLL: reference refimg ` +
                            `${firstRef ? "就绪 — 补渲染对比 cell" : "更新 (新一轮)"} (ts=${ts})`
                        );
                    }
                }
            } catch (_) { /* 路由不可用 (老后端) 静默 */ }
        }
    }, 1000);

    let srcRunning = false;   // 上游 Generator 本轮是否正在跑 (占位态)
    // 源节点 id 匹配 — 兼容秋叶/LG 复合 unique_id ("5580.0.0.3.0.0.6108")
    const _srcMatches = (nid) => {
        if (nid === null || nid === undefined) return false;
        const srcId = cachedSourceNode
            ? String(cachedSourceNode.id)
            : (cachedDirectNode ? String(cachedDirectNode.id) : null);
        if (!srcId) return false;
        const s = String(nid);
        return s === srcId || _pureId(s) === _pureId(srcId);
    };
    const _purgePath3 = () => {
        const srcId = cachedSourceNode ? String(cachedSourceNode.id) : null;
        if (srcId && typeof _path3Cache !== "undefined" && _path3Cache.delete) {
            _path3Cache.delete(srcId);
        }
    };
    const _resetSelection = () => {
        userPicked = false;
        selectedIdx = -1;
        syncIdxWidget("idle");
        setProgressEnabled(false);
        if (progressBtnRef) {
            progressBtnRef.style.background = "";
            progressBtnRef.style.color = "";
            progressBtnRef.style.fontWeight = "";
        }
    };

    const _fastWatch = async () => {
        while (srcRunning) {
            await new Promise((r) => setTimeout(r, 300));
            if (!srcRunning) break;
            try {
                _purgePath3();
                const imgs = await getInputImages();
                const sig = imgsSignature(imgs);
                if (sig && sig !== lastSig) {
                    srcRunning = false;
                    lastSig = sig;          // 同步基线, 防 1s 轮询重复刷
                    _resetSelection();
                    await fetchMetadata();
                    renderGrid();
                    _clog(
                        "FAST-WATCH: 新缩略图落地 — 即时刷新"
                    );
                    break;
                }
            } catch (_) { /* 单次失败继续下一轮 */ }
        }
    };
    try {
        app.api.addEventListener("executing", (e) => {
            const nid = e?.detail?.node;
            if (!_srcMatches(nid)) return;
            if (srcRunning) return;    // 本轮已处理 (防重复触发)
            srcRunning = true;
            _resetSelection();
            _purgePath3();             // 保证后续 fetch 拿新 refs
            if (panelMounted && grid) {
                grid.innerHTML =
                    '<div class="ccg-placeholder">生成中…</div>';
                if (counter) counter.textContent = "";
            }
            _clog(
                `EXECUTING: 上源节点 ${nid} 开跑 — ` +
                `清空旧缩略图, 进入占位态 (fast-watch 启动)`
            );
            _fastWatch();
        });
        // 队列收尾 / 出错 / 中断 / 完成 → 退出占位态, 恢复渲染当前 refs
        //   (防止上游没跑完就被 cancel 时 "跑图中" 占位永久卡住)
        const _exitRunning = () => {
            if (!srcRunning) return;
            srcRunning = false;
            renderGrid();
            _clog("占位态退出 (队列收尾/出错/中断/完成)");
        };
        app.api.addEventListener("executing", (e) => {
            if (e?.detail?.node === null || e?.detail?.node === undefined) {
                _exitRunning();
            }
        });
        for (const _ev of ["execution_error", "interrupted", "execution_success"]) {
            app.api.addEventListener(_ev, _exitRunning);
        }
    } catch (err) {
        console.warn("executing 监听注册失败:", err?.message || err);
    }

    // ── 通道 2: 新 refs 落地 → 立即刷新 (不等轮询不等点击) ──
    window.addEventListener("comp-crop-refs-updated", async (e) => {
        try {
            if (!_srcMatches(e?.detail?.nodeId)) return;
            srcRunning = false;
            _purgePath3();
            _resetSelection();
            await fetchMetadata();
            renderGrid();
            // 同步 lastSig 基线 — 防止 1s 后轮询再重复 reset/render 一遍
            const imgsNow = await getInputImages();
            lastSig = imgsSignature(imgsNow);
            _clog("REFS-UPDATED: 新缩略图落地 — 已即时刷新");
        } catch (err) {
            console.warn("refs-updated 处理失败:", err?.message || err);
        }
    });

}

const _execListenerRegistry = new WeakSet();
function setupExecutedListener(sourceNode, originSlot) {
    if (!sourceNode || !app?.api) return;
    if (_execListenerRegistry.has(sourceNode)) return;
    _execListenerRegistry.add(sourceNode);

    const handler = (e) => {
        try {
            const detail = e?.detail || {};
            const executedNode = detail.node;
            if (!executedNode || String(executedNode.id) !== String(sourceNode.id)) return;

            const out = detail.output || {};

            if (Array.isArray(out._comp_image_refs) && out._comp_image_refs.length) {
                sourceNode._compImageRefs = out._comp_image_refs;
                _clog(
                    "[Chooser] executed: cached sourceNode._compImageRefs =",
                    out._comp_image_refs.length, "refs for node", sourceNode.id
                );
                try {
                    window.dispatchEvent(new CustomEvent(
                        "comp-crop-refs-updated",
                        { detail: { nodeId: String(sourceNode.id) } }
                    ));
                } catch (_) {}
                return;
            }

            // schema 2/3: 老 ui.images 兼容
            let imagesArr = null;
            for (const k of Object.keys(out)) {
                const v = out[k];
                if (v && Array.isArray(v.images) && v.images.length) {
                    imagesArr = v.images;
                    break;
                }
            }
            if (!imagesArr && Array.isArray(out.images) && out.images.length) {
                imagesArr = out.images;
            }
            if (!imagesArr) {
                for (const k of Object.keys(out)) {
                    const v = out[k];
                    if (v && typeof v === "object" && !Array.isArray(v)) {
                        if (Array.isArray(v.images) && v.images.length) {
                            imagesArr = v.images;
                            break;
                        }
                    }
                }
            }
            if (imagesArr && imagesArr.length) {
                sourceNode._compImageRefs = imagesArr;
                _clog(
                    "[Chooser] executed: cached sourceNode._compImageRefs =",
                    imagesArr.length, "images for node", sourceNode.id
                );
                try {
                    window.dispatchEvent(new CustomEvent(
                        "comp-crop-refs-updated",
                        { detail: { nodeId: String(sourceNode.id) } }
                    ));
                } catch (_) {}
            }
        } catch (err) {
            console.warn("[Chooser] executed handler err", err);
        }
    };
    app.api.addEventListener("executed", handler);
    if (app.api.addEventListener !== app.api.on) {
        try { app.api.on("executed", handler); } catch (_) {}
    }
    _clog("[Chooser] setupExecutedListener registered for sourceNode", sourceNode.id);
}

function refsToPreviews(refs) {
    if (!Array.isArray(refs) || !refs.length) return [];
    // 已经是 __previewUrl 格式的 (path1c/path2 走这条) — 透传
    if (refs[0]?.__previewUrl) return refs;
    // raw tensor 对象 (path1b sourceNode.imgs) — 透传
    if (refs[0]?.dim || refs[0]?.shape) return refs;
    // raw {filename, subfolder, type} ref — 构造 URL
    const viewBase = app?.api?.apiURL?.("/view") || "/view";
    return refs.map((img) => {
        if (!img || typeof img !== "object") return null;
        if (img.__previewUrl || img.src) return img;
        const params = new URLSearchParams({
            filename: img.filename || "",
            subfolder: img.subfolder || "",
            type: img.type || "output",
        });
        return { __previewUrl: `${viewBase}?${params.toString()}` };
    }).filter(Boolean);
}

const _path3Cache = new Map();    // node_id → {ts, refs}
const _path3Meta = new Map();     // node_id → {best_indices, crop_bboxes}


async function tryPath3(sourceNode) {
    if (!app?.api || !sourceNode?.id) return null;
    const nodeId = String(sourceNode.id);
    const cached = _path3Cache.get(nodeId);
    // 500ms 内不重复 fetch (多个 chooser 连同一 Generator 时减少 RPS)
    if (cached && (Date.now() - cached.ts) < 500) {
        return cached.refs;  // 命中可能为 []
    }
    const url = app.api.apiURL(`/comp_crop/refs/${nodeId}`);
    try {
        _clog("[path3: GET", url);
        const resp = await fetch(url);
        if (resp.ok) {
            const data = await resp.json();
            const refs = (data && Array.isArray(data.refs)) ? data.refs : [];
            _clog(
                "[path3: status=" + resp.status,
                "refs=" + refs.length,
                "best_indices=" + JSON.stringify(data?.best_indices || []),
                "ts=" + (data?.ts || 0),
                "prompt_id=" + (data?.prompt_id || "(none)")
            );
            _path3Cache.set(nodeId, { ts: Date.now(), refs });
            _path3Meta.set(nodeId, {
                best_indices: Array.isArray(data?.best_indices)
                    ? data.best_indices : [],
                crop_bboxes: (typeof data?.crop_bboxes === "string")
                    ? data.crop_bboxes : "",
            });
            return refs;
        }
    } catch (e) {
        console.warn("[path3 fetch err:", e?.message || e);
    }
    _path3Cache.set(nodeId, { ts: Date.now(), refs: [] });
    return [];
}

async function readManifestMultiPath(chooserNode, generatorNode) {

    const w = chooserNode.widgets?.find(
        (w) => w.name === "crops_manifest");
    if (w && typeof w.value === "string" && w.value && w.value !== "[]") {
        _clog("[Chooser] path1c-1 (chooser widget) hit");
        return w.value;
    }

    const cropsManifestWidget = chooserNode.widgets?.find(
        (w) => w.name === "crops_manifest");
    if (cropsManifestWidget && typeof cropsManifestWidget.value === "string" &&
        cropsManifestWidget.value && cropsManifestWidget.value !== "[]") {
        _clog("[Chooser] path1c-2 (chooser widget by name) hit");
        return cropsManifestWidget.value;
    }

    if (generatorNode && app.api) {
        try {
            const history = await app.api.getHistory();
            const entries = [];
            if (Array.isArray(history)) {
                for (const item of history) {
                    if (item && typeof item === "object") entries.push(item);
                }
            } else if (history && typeof history === "object") {
                for (const k of Object.keys(history)) entries.push(history[k]);
            }
            for (let k = entries.length - 1; k >= 0; k--) {
                const e = entries[k];
                // 找到 preview_output (单个 image ref 或数组)
                let refs = null;
                if (e?.preview_output) {
                    const po = e.preview_output;
                    if (Array.isArray(po)) refs = po;
                    else if (po && typeof po === "object" && po.nodeId) refs = [po];
                    else if (typeof po === "string" && po.trim()) {
                        try {
                            const parsed = JSON.parse(po);
                            if (Array.isArray(parsed)) refs = parsed;
                            else if (parsed && typeof parsed === "object" && parsed.nodeId)
                                refs = [parsed];
                        } catch (_) {}
                    }
                }
                if (!refs || !refs.length) continue;
                // 找属于 Generator 节点的图片引用
                const matching = refs.filter(
                    (it) => it && String(it.nodeId) === String(generatorNode.id)
                );
                if (!matching.length) continue;
                _clog("[Chooser] path1c-3 (gen history preview) got",
                    matching.length, "preview images for node", generatorNode.id);
                // 拼 view URL
                const viewBase = app.api.apiURL("/view");
                return matching.map((img) => ({
                    __previewUrl: `${viewBase}?${new URLSearchParams({
                        filename: img.filename || "",
                        subfolder: img.subfolder || "",
                        type: img.type || "output",
                    })}`
                }));
            }
            _clog("[Chooser] path1c-3: no matching preview_output for node",
                generatorNode?.id);
        } catch (e) {
            /* 静默降级 */
        }
    }
    // 1c-4: 上游 Generator widgets 查找 (兜底, 若改回 widget 模式)
    if (generatorNode) {
        const gw = generatorNode.widgets?.find(
            (w) => w.name === "crops_manifest");
        if (gw && typeof gw.value === "string" &&
            gw.value && gw.value !== "[]") {
            _clog("[Chooser] path1c-4 (gen widget) hit");
            return gw.value;
        }
    }
    return null;
}

// ═══════════════════════════════════════════════════════════════
//  5. 注册扩展
// ═══════════════════════════════════════════════════════════════

const LOAD_TIME = new Date().toLocaleTimeString("zh-CN", { hour12: false });
_clog(
    `%c[Chooser v2.3] ✓ 阻塞等待 + POST 唤醒 + 对比 cell 可选 (点原图+Progress=输出整图, idx=-2) + refimg ts 监视 (与缩略图同时出现) (loaded ${LOAD_TIME})`,
    "background:#0f9d58;color:white;padding:2px 6px;border-radius:3px;font-weight:bold"
);

/* ─── Empty Latent Selector: 宽高比缩略图下拉 ─── */
const _ELS_RATIO_DATA = {
    "1:1 (square)":      { w: 1, h: 1 },
    "4:3 (retro tv)":    { w: 4, h: 3 },
    "3:2 (photo)":       { w: 3, h: 2 },
    "16:10 (monitor)":   { w: 16, h: 10 },
    "16:9 (widescreen)": { w: 16, h: 9 },
    "2:1 (univisium)":   { w: 2, h: 1 },
    "21:9 (ultrawide)":  { w: 21, h: 9 },
    "12:5 (anamorphic)": { w: 12, h: 5 },
    "70:27 (cinerama)":  { w: 70, h: 27 },
    "32:9 (super wide)": { w: 32, h: 9 },
};

function _els_thumb_svg(ratioKey, isHorizontal, size) {
    size = size || 20;
    const r = _ELS_RATIO_DATA[ratioKey] || { w: 1, h: 1 };
    let rw = r.w, rh = r.h;
    if (!isHorizontal) { const t = rw; rw = rh; rh = t; }
    const pad = 3;
    const avail = size - pad * 2;
    const scale = Math.min(avail / rw, avail / rh);
    const w = Math.max(1, rw * scale);
    const h = Math.max(1, rh * scale);
    const x = (size - w) / 2;
    const y = (size - h) / 2;
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="none" stroke="#666" stroke-width="1.5" rx="1"/></svg>`;
}

function buildEmptyLatentSelector(node) {
    const ratioW = node.widgets?.find(w => w.name === "ratio");
    const orientW = node.widgets?.find(w => w.name === "orientation");
    if (!ratioW) return;

    const options = Object.keys(_ELS_RATIO_DATA);
    if (!options.includes(ratioW.value)) ratioW.value = options[2] || options[0];

    let isOpen = false;
    let isHorizontal = orientW ? orientW.value !== false : true;

    const wrap = document.createElement("div");
    wrap.style.cssText =
        "position:relative;box-sizing:border-box;margin:8px auto;" +
        "width:90%;max-width:270px;overflow:visible;";

    function syncMaxWidth() {
        const nw = node.size[0] || 300;
        const maxW = Math.max(120, nw - 30) + 'px';
        wrap.style.maxWidth = maxW;
        var ratioWidget = node.widgets?.find(function(w){return w.name==="ratio";});
        if (ratioWidget?.element && ratioWidget.element !== wrap) {
            ratioWidget.element.style.maxWidth = maxW;
            ratioWidget.element.style.width = '100%';
            ratioWidget.element.style.boxSizing = 'border-box';
            ratioWidget.element.style.overflow = 'hidden';
        }
    }
    node._syncElsMaxWidth = syncMaxWidth;

    const btn = document.createElement("div");
    btn.style.cssText =
        "display:flex;align-items:center;gap:8px;padding:5px 8px;" +
        "background:#2a2a2e;border:1px solid #4a4a52;border-radius:4px;" +
        "cursor:pointer;color:#ddd;font-size:13px;user-select:none;" +
        "box-sizing:border-box;width:100%;overflow:hidden;";
    const thumbSpan = document.createElement("span");
    thumbSpan.style.cssText = "display:flex;align-items:center;justify-content:center;width:24px;height:24px;background:#fff;border:1px solid #ccc;border-radius:3px;flex-shrink:0;";
    const textSpan = document.createElement("span");
    textSpan.style.flex = "1";
    const arrowSpan = document.createElement("span");
    arrowSpan.style.cssText = "color:#888;font-size:10px;";
    btn.appendChild(thumbSpan);
    btn.appendChild(textSpan);
    btn.appendChild(arrowSpan);

    const dropdown = document.createElement("div");
    dropdown.style.cssText = "position:absolute;top:100%;left:0;right:0;background:#35353a;border:1px solid #4a6cf7;border-top:none;border-radius:0 0 4px 4px;max-height:260px;overflow-y:auto;z-index:100;box-shadow:0 6px 16px rgba(0,0,0,0.6);display:none;";

    wrap.appendChild(btn);
    wrap.appendChild(dropdown);

    function updateBtn() {
        thumbSpan.innerHTML = _els_thumb_svg(ratioW.value, isHorizontal, 20);
        textSpan.textContent = ratioW.value;
        arrowSpan.textContent = isOpen ? "\u25B2" : "\u25BC";
    }

    function renderOptions() {
        dropdown.innerHTML = "";
        options.forEach(key => {
            const selected = key === ratioW.value;
            const opt = document.createElement("div");
            opt.style.cssText = `display:flex;align-items:center;gap:8px;padding:5px 8px;cursor:pointer;color:${selected ? "#fff" : "#ddd"};font-size:13px;border-bottom:1px solid #2a2a2e;${selected ? "background:#4a6cf7;" : ""}`;
            opt.onmouseenter = () => { if (!selected) opt.style.background = "#3a3a42"; };
            opt.onmouseleave = () => { if (!selected) opt.style.background = "transparent"; };
            const t = document.createElement("span");
            t.style.cssText = "display:flex;align-items:center;justify-content:center;width:24px;height:24px;background:#fff;border:1px solid #ccc;border-radius:3px;flex-shrink:0;";
            t.innerHTML = _els_thumb_svg(key, isHorizontal, 20);
            const label = document.createElement("span");
            label.textContent = key;
            opt.appendChild(t);
            opt.appendChild(label);
            opt.onclick = (e) => {
                e.stopPropagation();
                ratioW.value = key;
                isOpen = false;
                dropdown.style.display = "none";
                updateBtn();
                if (node.onWidgetChanged) node.onWidgetChanged("ratio", key, {}, node);
                if (node.setDirtyCanvas) node.setDirtyCanvas(true, true);
            };
            dropdown.appendChild(opt);
        });
    }

    btn.onclick = (e) => {
        e.stopPropagation();
        isOpen = !isOpen;
        dropdown.style.display = isOpen ? "block" : "none";
        if (isOpen) renderOptions();
        updateBtn();
    };

    document.addEventListener("click", () => {
        if (isOpen) {
            isOpen = false;
            dropdown.style.display = "none";
            updateBtn();
        }
    });

    function refreshOrientation() {
        isHorizontal = orientW ? orientW.value !== false : true;
        updateBtn();
        if (isOpen) renderOptions();
    }

    if (orientW) {
        const origCb = orientW.callback;
        orientW.callback = function () {
            refreshOrientation();
            if (origCb) origCb.apply(this, arguments);
        };
    }

    // 用 addDOMWidget 替换原 ratio combo
    if (typeof node.addDOMWidget === "function") {
        const idx = node.widgets.indexOf(ratioW);
        // 先移除原 combo
        if (idx >= 0) node.widgets.splice(idx, 1);
        // 创建 DOM widget (追加到末尾)
        const domWidget = node.addDOMWidget("ratio", "els_ratio", wrap, {
            margin: 0,
            getMinHeight: () => 44,
            getHeight: () => 44,
            getMaxHeight: () => 44,
        });
        domWidget.value = ratioW.value;
        domWidget.serializeValue = () => ratioW.value;
        // 移回原位置
        const curIdx = node.widgets.indexOf(domWidget);
        if (curIdx >= 0 && curIdx !== idx) {
            node.widgets.splice(curIdx, 1);
            node.widgets.splice(idx, 0, domWidget);
        }
    } else {
        console.warn("[Empty Latent Selector] addDOMWidget 不可用, 缩略图未加载");
    }

    updateBtn();
    setTimeout(() => { node.title = "Empty Latent Selector"; }, 0);
}

app.registerExtension({
    name: "CommonToolbox.UI",

    setup() {
        _hookChooserFlowEvents();
    },

    async beforeRegisterNodeDef(nodeType, nodeData, appInstance) {
        // ── Crop Mode Selector: 构图模式选择器 ──
        if (nodeData.name === "Crop Mode Selector") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const node = this;
                onNodeCreated?.apply(this, arguments);
                injectStyles();
                buildPanel(node);
                node.setSize([300, 400]);
                // 重写显示标题 (ComfyUI 不支持 TITLE 类属性, 只能前端改)
                setTimeout(() => { node.title = "Crop Mode Selector"; }, 0);
            };

            const onResize = nodeType.prototype.onResize;
            nodeType.prototype.onResize = function (size) {
                if (onResize) onResize.apply(this, arguments);
                size[0] = Math.max(300, size[0]);
                size[1] = Math.max(400, size[1]);
                const w = this.widgets?.find((x) => x.name === "composition_panel");
                if (w?.element) w.element._lastValidH = 0;
            };
        }

        // ── Crop Generator: 主节点 tooltip ──
        if (nodeData.name === "Crop Generator") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const node = this;
                onNodeCreated?.apply(this, arguments);
                setTimeout(() => {
                    node.title = "Crop Generator";
                    const modesWidget = node.widgets?.find(
                        (w) => w.name === "composition_modes"
                    );
                    if (modesWidget) {
                        modesWidget.tooltip =
                            "连接 Crop Mode Selector, 或手动输入逗号分隔模式名:\n" +
                            "standard, lifestyle, cinematic, documentary, dynamic,\n" +
                            "extreme_closeup, environmental, banner";
                    }
                }, 100);
            };
        }

        // ── Crop Chooser: 裁切选择器 ──
        if (nodeData.name === "Crop Chooser") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const node = this;
                onNodeCreated?.apply(this, arguments);
                injectStyles();
                node.setSize([350, 400]);
                node._compMinH = 400;
                buildChooserPanel(node);
                setTimeout(() => { node.title = "Crop Chooser"; }, 0);
            };

            const onResize = nodeType.prototype.onResize;
            nodeType.prototype.onResize = function (size) {
                if (onResize) onResize.apply(this, arguments);
                size[0] = Math.max(320, size[0]);
                const minH = this._compMinH || 400;
                size[1] = Math.max(minH, size[1]);
                const w = this.widgets?.find((x) => x.name === "chooser_panel");
                if (w?.element) w.element._lastValidH = 0;
            };
        }

        // ── Empty Latent Selector: 宽高比缩略图下拉 ──
        if (nodeData.name === "Empty Latent Selector") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const node = this;
                onNodeCreated?.apply(this, arguments);
                buildEmptyLatentSelector(node);
                if (node._syncElsMaxWidth) node._syncElsMaxWidth();
            };

            const onResize = nodeType.prototype.onResize;
            nodeType.prototype.onResize = function (size) {
                if (onResize) onResize.apply(this, arguments);
                size[0] = Math.max(220, size[0]);
                if (this._syncElsMaxWidth) this._syncElsMaxWidth();
                requestAnimationFrame(() => {
                    if (this._syncElsMaxWidth) this._syncElsMaxWidth();
                });
            };
        }
    },
});
