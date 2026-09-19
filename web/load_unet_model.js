import { app } from "../../scripts/app.js";
const WIDGET_MARGIN = 15;
const WIDGET_ARROW_MARGIN = 6;
const WIDGET_ARROW_WIDTH = 10;
const WIDGET_RADIUS_RATIO = 0.5;
const WIDGET_HEIGHT = 20;
const PREVIEW_MAX_SIZE = 260;
const PREVIEW_OFFSET = 16;

function _menuMaxHeight() {
    return Math.max(200, Math.round(window.innerHeight * 0.8));
}

const LORA_NAME_FONT_PX = 11;

let MENU_FONT_SIZE = 15;         // 打开菜单时由 _syncMenuFontSize() 按缩放刷新
let MENU_FONT_SIZE_SMALL = 13;   // 图标 / 箭头等辅助元素
const MENU_LINE_HEIGHT = 1.45;   // 行高倍数，保证字形不被压扁

let _canvasCssPerUnit = 1;

function _updateCanvasCssScale(ctx) {
    try {
        const canvasEl = app && app.canvas && app.canvas.canvas;
        if (!canvasEl || !canvasEl.width || !ctx || !ctx.getTransform) return;
        const rect = canvasEl.getBoundingClientRect();
        if (!rect || !rect.width) return;
        const t = ctx.getTransform();
        const a = Math.hypot(t.a, t.b);
        if (!isFinite(a) || a <= 0) return;
        const f = a * (rect.width / canvasEl.width);
        if (isFinite(f) && f > 0) _canvasCssPerUnit = f;
    } catch (e) {
        /* 忽略：沿用上一次的换算因子 */
    }
}

function _syncMenuFontSize() {
    let f = _canvasCssPerUnit;
    if (!isFinite(f) || f <= 0) {
        try {
            f = (app && app.canvas && app.canvas.ds && app.canvas.ds.scale) || 1;
        } catch (e) {
            f = 1;
        }
    }
    const px = Math.round(LORA_NAME_FONT_PX * f);
    MENU_FONT_SIZE = Math.max(11, Math.min(34, px));
    MENU_FONT_SIZE_SMALL = Math.max(10, Math.round(MENU_FONT_SIZE * 0.85));
}

let _unetListCache = null;


// ============================================================
// 工具函数
// ============================================================

function drawRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function fitString(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let lo = 0, hi = text.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (ctx.measureText(text.slice(0, mid) + "…").width <= maxWidth) lo = mid + 1;
        else hi = mid;
    }
    return text.slice(0, Math.max(0, lo - 1)) + "…";
}

function pointInRect(px, py, rect) {
    return px >= rect[0] && px <= rect[0] + rect[2] &&
           py >= rect[1] && py <= rect[1] + rect[3];
}


// ============================================================
// UNET 列表获取
// ============================================================

async function getUnetList() {
    if (_unetListCache && _unetListCache.length > 0) return _unetListCache;
    try {
        // 优先从已加载的节点定义中读取（最实时）
        const def = app.nodeTypesByClassName?.["UNETLoader"];
        if (def?.input?.required?.unet_name?.[0]?.length) {
            _unetListCache = def.input.required.unet_name[0].slice();
            return _unetListCache;
        }
        const resp = await fetch("/object_info/UNETLoader");
        const data = await resp.json();
        if (data?.UNETLoader?.input?.required?.unet_name?.[0]?.length) {
            _unetListCache = data.UNETLoader.input.required.unet_name[0].slice();
            return _unetListCache;
        }
    } catch (e) {
        console.warn("[LoadUnetModel] 获取 UNET 列表失败", e);
    }
    return [];
}

function refreshUnetList() {
    _unetListCache = null;
}

// 加载 UNET 预览图
function loadUnetPreview(unetName) {
    return new Promise((resolve) => {
        if (!unetName || unetName === "None") {
            resolve(null);
            return;
        }
        const url = `/common-toolbox/unet_preview?name=${encodeURIComponent(unetName)}`;
        const img = new Image();
        img.onload = () => resolve(url);
        img.onerror = () => resolve(null);
        img.src = url;
    });
}


// ============================================================
// 全局预览图浮动层（DOM，在 canvas 之上，不被裁剪）
// ============================================================

let _previewEl = null;
let _previewVisible = false;
let _lastMouseX = 0;
let _lastMouseY = 0;
// 鼠标当前屏幕高度（clientY），用于让预览图的垂直中心与鼠标高度对齐
let _pointerY = null;
// 当前悬停行（菜单项）的屏幕矩形，用于衡量预览图离用户视线有多远
let _anchorRect = null;
let _previewReposRaf = 0;

// 合并同一帧内的多次重定位请求，避免 mousemove 高频触发
function _schedulePreviewReposition() {
    if (!_previewVisible) return;
    if (_previewReposRaf) return;
    _previewReposRaf = requestAnimationFrame(function () {
        _previewReposRaf = 0;
        _positionPreview(_lastMouseX, _lastMouseY);
    });
}

function _ensurePreviewEl() {
    if (_previewEl) return _previewEl;
    _previewEl = document.createElement("div");
    _previewEl.className = "lum-preview";
    _previewEl.style.cssText = `
        position: fixed;
        z-index: 99990;
        pointer-events: none;
        display: none;
        background: rgba(20, 20, 25, 0.95);
        border: 2px solid #7c3aed;
        border-radius: 8px;
        padding: 4px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
        max-width: ${PREVIEW_MAX_SIZE}px;
        max-height: ${PREVIEW_MAX_SIZE}px;
        overflow: hidden;
    `;
    const img = document.createElement("img");
    img.style.cssText = `
        display: block;
        max-width: ${PREVIEW_MAX_SIZE}px;
        max-height: ${PREVIEW_MAX_SIZE}px;
        object-fit: contain;
        border-radius: 4px;
    `;
    _previewEl.appendChild(img);
    document.body.appendChild(_previewEl);
    return _previewEl;
}

function _showPreview(imgSrc, mouseX, mouseY) {
    _lastMouseX = mouseX;
    _lastMouseY = mouseY;
    const el = _ensurePreviewEl();
    const img = el.querySelector("img");
    const srcChanged = img.src !== window.location.origin + imgSrc && img.src !== imgSrc;
    if (srcChanged) {
        img.src = imgSrc;
        img.onload = function () {
            if (_previewVisible) _positionPreview(_lastMouseX, _lastMouseY);
        };
    }
    _previewVisible = true;
    el.style.display = "block";
    _positionPreview(mouseX, mouseY);
}

// 收集当前所有可见的级联菜单面板矩形（用于预览图避让）
function _visibleMenuRects() {
    const rects = [];
    const menus = _selectorMenu && _selectorMenu.menus;
    if (!menus || !menus.length) return rects;
    for (const m of menus) {
        if (!m || !m.parentNode) continue;
        if (m.style && m.style.display === "none") continue;
        const r = m.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        rects.push({ x: r.left, y: r.top, w: r.width, h: r.height });
    }
    return rects;
}

// 两个矩形的重叠面积
function _rectOverlapArea(a, b) {
    const ow = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const oh = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (ow <= 0 || oh <= 0) return 0;
    return ow * oh;
}

function _positionPreview(anchorX, anchorY) {
    if (!_previewVisible || !_previewEl) return;
    _lastMouseX = anchorX;
    _lastMouseY = anchorY;
    const el = _previewEl;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (!w || !h) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const PAD = 8;   // 与窗口边缘的最小间距
    const GAP = 10;  // 与菜单面板的最小间距
    const safeL = PAD + GAP;       // 横向安全区左边界
    const safeR = vw - PAD - GAP;  // 横向安全区右边界

    const obstacles = _visibleMenuRects();

    // ── 无菜单：保持原有「鼠标右下方，越界翻转」行为 ──
    if (!obstacles.length) {
        let left = anchorX + PREVIEW_OFFSET;
        let top = anchorY + PREVIEW_OFFSET;
        if (left + w > vw - PAD) left = anchorX - PREVIEW_OFFSET - w;
        if (top + h > vh - PAD) top = anchorY - PREVIEW_OFFSET - h;
        if (left < PAD) left = PAD;
        if (top < PAD) top = PAD;
        el.style.left = left + "px";
        el.style.top = top + "px";
        return;
    }

    // ── 有菜单：避让菜单 + 与鼠标高度对齐 ──
    const pointerY =
        (typeof _pointerY === "number" && isFinite(_pointerY)) ? _pointerY : anchorY;
    const centeredY = pointerY - h / 2; // 垂直中心落在鼠标高度上

    // 所有菜单面板的整体外框
    let ux1 = Infinity, uy1 = Infinity, ux2 = -Infinity, uy2 = -Infinity;
    for (const r of obstacles) {
        if (r.x < ux1) ux1 = r.x;
        if (r.y < uy1) uy1 = r.y;
        if (r.x + r.w > ux2) ux2 = r.x + r.w;
        if (r.y + r.h > uy2) uy2 = r.y + r.h;
    }

    const cands = [
        // 首选：贴菜单整体外框的右侧 / 左侧，纵向与鼠标高度居中对齐
        { x: ux2 + GAP, y: centeredY },
        { x: ux1 - GAP - w, y: centeredY },
        // 次选：横向仍贴在菜单外框旁，纵向与悬停行对齐
        { x: ux2 + GAP, y: anchorY },
        { x: ux1 - GAP - w, y: anchorY },
        // 再次：菜单外框的下方 / 上方
        { x: anchorX, y: uy2 + GAP },
        { x: anchorX, y: uy1 - GAP - h },
        // 贴角对齐
        { x: ux2 + GAP, y: uy1 },
        { x: ux1 - GAP - w, y: uy1 },
        { x: ux2 + GAP, y: uy2 - h },
        { x: ux1 - GAP - w, y: uy2 - h },
        // 兜底：锚点相对位置
        { x: anchorX + PREVIEW_OFFSET, y: anchorY + PREVIEW_OFFSET },
        { x: anchorX - PREVIEW_OFFSET - w, y: anchorY + PREVIEW_OFFSET },
        { x: anchorX + PREVIEW_OFFSET, y: anchorY - PREVIEW_OFFSET - h },
        { x: anchorX - PREVIEW_OFFSET - w, y: anchorY - PREVIEW_OFFSET - h },
    ];

    let best = null;
    let bestScore = Infinity;
    for (let i = 0; i < cands.length; i++) {
        // 夹进窗口内
        const x = Math.max(PAD, Math.min(cands[i].x, vw - PAD - w));
        const y = Math.max(PAD, Math.min(cands[i].y, vh - PAD - h));

        // 横向余量不足量：候选的理想横向位置如果连 GAP 的呼吸空间都留不出来，
        // 说明这一侧被菜单挤到了窗口角落，不足的部分记为 squeezeX。
        // 即使恰好「塞得下」，只要贴着窗口边缘也会被判为挤压，从而让位给另一侧。
        const squeezeX =
            Math.max(0, safeL - cands[i].x) + Math.max(0, cands[i].x + w - safeR);

        const box = { x: x, y: y, w: w, h: h };
        let overlap = 0;
        for (const r of obstacles) overlap += _rectOverlapArea(box, r);
        // 垂直偏差：预览图垂直中心与鼠标高度之差，越小越便于观察
        const devY = Math.abs(y + h / 2 - pointerY);
        // 水平偏差：优先用「预览图与悬停行之间的横向间隙」衡量
        //   —— 间隙越小，预览图离用户正在看的那一行越近，
        //   这样左右两侧比较的就是「谁离光标更近」，而不是谁离行的右边缘更近；
        //   没有悬停行信息时退回「与锚点的水平距离」。
        let devX;
        if (_anchorRect) {
            devX = Math.max(0, _anchorRect.left - (x + w), x - _anchorRect.right);
        } else {
            devX = Math.abs(x - anchorX);
        }
        // 打分优先级：
        //   重叠面积 > 垂直偏差 > 横向余量不足量 > 水平间隙 > 候选顺序
        // 垂直偏差权重（1000/px）仍高于挤压权重（400/px），
        // 因此「与鼠标高度对齐」依旧是最优先的观感目标。
        const score = overlap * 1000000 + devY * 1000 + squeezeX * 400 + devX * 10 + i;
        if (score < bestScore) {
            bestScore = score;
            best = { x: x, y: y };
        }
    }
    if (best) {
        el.style.left = best.x + "px";
        el.style.top = best.y + "px";
    }
}

function _hidePreview() {
    _previewVisible = false;
    if (_previewEl) {
        _previewEl.style.display = "none";
    }
}


// ============================================================
// 自定义 UNET 选择器（纯 DOM，级联子菜单 + 悬停预览）
// ============================================================

let _selectorMenu = null;
let _selectorPreviewUnet = null;
let _selectorPreviewUrl = null;
let _selectorPreviewLoading = false;

// 构建目录树
function _buildUnetTree(units) {
    const root = { name: "", children: [], files: [], isFolder: true, path: "" };

    for (const item of units) {
        if (!item) continue;
        if (String(item).toLowerCase() === "none") continue;

        // 同时支持 / 和 \ 两种路径分隔符
        const parts = String(item).split(/[\\/]/);
        let current = root;
        let currentPath = "";

        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (!part) continue;
            currentPath = currentPath ? currentPath + "/" + part : part;
            let child = current.children.find(function (c) { return c.name === part; });
            if (!child) {
                child = { name: part, children: [], files: [], isFolder: true, path: currentPath };
                current.children.push(child);
            }
            current = child;
        }

        const fileName = parts[parts.length - 1];
        if (!fileName || fileName.toLowerCase() === "none") continue;
        current.files.push({ name: fileName, fullPath: item });
    }

    function sortNode(node) {
        node.children.sort(function (a, b) { return a.name.localeCompare(b.name); });
        node.files.sort(function (a, b) { return a.name.localeCompare(b.name); });
        for (const child of node.children) sortNode(child);
    }
    sortNode(root);
    return root;
}

function _loadUnetSelectorPreview(unetName, itemEl) {
    if (_selectorPreviewUnet === unetName && _selectorPreviewUrl) {
        const rect = itemEl.getBoundingClientRect();
        _anchorRect = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
        _positionPreview(rect.right + 8, rect.top);
        return;
    }
    if (_selectorPreviewLoading) return;

    _selectorPreviewUnet = unetName;
    _selectorPreviewUrl = null;
    _selectorPreviewLoading = true;
    _hidePreview();

    loadUnetPreview(unetName).then(function (url) {
        if (!_selectorMenu || _selectorPreviewUnet !== unetName) {
            _selectorPreviewLoading = false;
            return;
        }
        if (url) {
            _selectorPreviewUrl = url;
            const rect = itemEl.getBoundingClientRect();
            _anchorRect = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
            _showPreview(url, rect.right + 8, rect.top);
        }
        _selectorPreviewLoading = false;
    }).catch(function () {
        _selectorPreviewLoading = false;
    });
}

function _showUnetSelector(clientX, clientY, units, currentValue, onSelect) {
    _hideUnetSelector();

    // 先按当前画布缩放刷新字号，再创建面板（面板字号在创建时写入 inline style）
    _syncMenuFontSize();

    const tree = _buildUnetTree(units);
    const allMenus = [];
    let hideTimer = null;

    function scheduleHide() {
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(function () {
            while (allMenus.length > 1) {
                const m = allMenus.pop();
                if (m && m.parentNode) m.parentNode.removeChild(m);
            }
        }, 200);
    }
    function cancelHide() {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    }

    // 菜单项（根菜单与子菜单共用）
    function makeItemEl(item, parentPanel, depth) {
        const row = document.createElement("div");
        row.style.cssText = `
            padding: 6px 10px;
            cursor: pointer;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: ${MENU_FONT_SIZE}px;
            line-height: ${MENU_LINE_HEIGHT};
            color: #ddd;
        `;

        const selected = item.selected;
        if (selected) {
            row.style.background = "#3b2a5c";
            row.style.color = "#c4b5fd";
        }

        const icon = document.createElement("span");
        icon.style.cssText = `width: 18px; text-align: center; flex-shrink: 0; font-size: ${MENU_FONT_SIZE_SMALL}px;`;
        icon.textContent = item.icon || "📄";
        row.appendChild(icon);

        const label = document.createElement("span");
        label.style.cssText = "flex: 1; overflow: hidden; text-overflow: ellipsis;";
        label.textContent = item.label;
        row.appendChild(label);

        if (item.children && item.children.length > 0) {
            const arrow = document.createElement("span");
            arrow.style.cssText = `font-size: ${MENU_FONT_SIZE_SMALL}px; color: #888; flex-shrink: 0;`;
            arrow.textContent = "▶";
            row.appendChild(arrow);
        }

        row.addEventListener("mouseenter", function (e) {
            cancelHide();
            // 记录鼠标高度：预览图优先与鼠标所在高度对齐
            if (e && typeof e.clientY === "number") _pointerY = e.clientY;
            row.style.background = selected ? "#3b2a5c" : "#35353d";

            const myDepth = allMenus.indexOf(parentPanel);
            while (allMenus.length > myDepth + 1) {
                const m = allMenus.pop();
                if (m && m.parentNode) m.parentNode.removeChild(m);
            }

            // 级联子菜单
            if (item.children && item.children.length > 0) {
                const subPanel = makeMenuPanel(item.children, depth + 1);
                allMenus.push(subPanel);

                const rowRect = row.getBoundingClientRect();
                const subRect = subPanel.getBoundingClientRect();
                let left = rowRect.right - 1;
                let top = rowRect.top - 4;

                if (left + subRect.width > window.innerWidth - 8) {
                    left = rowRect.left - subRect.width + 1;
                }
                if (top + subRect.height > window.innerHeight - 8) {
                    top = window.innerHeight - subRect.height - 8;
                }
                if (top < 8) top = 8;

                subPanel.style.left = left + "px";
                subPanel.style.top = top + "px";
            }

            // 悬停预览图
            if (item.unetPath) {
                _loadUnetSelectorPreview(item.unetPath, row);
            }
        });

        row.addEventListener("mousemove", function (e) {
            // 鼠标在同一行内上下移动时，预览图实时跟随鼠标高度
            if (e && typeof e.clientY === "number") _pointerY = e.clientY;
            _schedulePreviewReposition();
        });

        row.addEventListener("mouseleave", function () {
            row.style.background = selected ? "#3b2a5c" : "";
            if (!item.children || item.children.length === 0) {
                _hidePreview();
            }
            scheduleHide();
        });

        row.addEventListener("click", function (e) {
            e.stopPropagation();
            if (item.children && item.children.length > 0) return;
            if (item.onClick) item.onClick(item.value);
            _hideUnetSelector();
        });

        return row;
    }

    function makeMenuPanel(items, depth) {
        const panel = document.createElement("div");
        panel.className = "lum-menu-panel";
        panel.style.cssText = `
            position: fixed;
            z-index: ${99999 + depth};
            background: #2a2a30;
            border: 1px solid #444450;
            border-radius: 6px;
            box-shadow: 0 6px 20px rgba(0,0,0,0.5);
            min-width: 280px;
            max-width: 560px;
            max-height: ${_menuMaxHeight()}px;
            overflow-y: auto;
            overflow-x: hidden;
            padding: 4px 0;
            font-family: Arial, sans-serif;
            font-size: ${MENU_FONT_SIZE}px;
            line-height: ${MENU_LINE_HEIGHT};
        `;

        for (const item of items) {
            if (item.separator) {
                const sep = document.createElement("div");
                sep.style.cssText = "height: 1px; background: #444450; margin: 4px 8px;";
                panel.appendChild(sep);
            } else {
                panel.appendChild(makeItemEl(item, panel, depth));
            }
        }

        panel.addEventListener("mouseenter", cancelHide);
        panel.addEventListener("mouseleave", scheduleHide);

        document.body.appendChild(panel);
        return panel;
    }

    // tree → 菜单项
    function treeNodeToMenuItems(node) {
        const items = [];
        for (const child of node.children) {
            const childItems = treeNodeToMenuItems(child);
            if (childItems.length > 0) {
                items.push({
                    label: child.name,
                    icon: "📁",
                    children: childItems,
                });
            }
        }
        for (const file of node.files) {
            items.push({
                label: file.name,
                icon: "📄",
                unetPath: file.fullPath,
                value: file.fullPath,
                selected: file.fullPath === currentValue,
                onClick: function (val) { onSelect(val); },
            });
        }
        return items;
    }

    // ===== 根菜单（带搜索框） =====
    const rootPanel = document.createElement("div");
    rootPanel.className = "lum-menu-panel";
    rootPanel.style.cssText = `
        position: fixed;
        z-index: 99999;
        background: #2a2a30;
        border: 1px solid #444450;
        border-radius: 8px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.6);
        width: 360px;
        max-height: ${_menuMaxHeight()}px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        font-family: Arial, sans-serif;
        font-size: ${MENU_FONT_SIZE}px;
        line-height: ${MENU_LINE_HEIGHT};
        color: #ddd;
    `;

    const titleBar = document.createElement("div");
    titleBar.style.cssText = `
        padding: 9px 12px;
        font-weight: 600;
        color: #a78bfa;
        background: #22222a;
        border-bottom: 1px solid #444450;
    `;
    titleBar.textContent = "Select UNET / Diffusion Model";
    rootPanel.appendChild(titleBar);

    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "搜索...";
    searchInput.style.cssText = `
        padding: 7px 10px;
        background: #22222a;
        border: none;
        border-bottom: 1px solid #444450;
        color: #ddd;
        outline: none;
        font-size: ${MENU_FONT_SIZE}px;
        font-family: Arial, sans-serif;
    `;
    rootPanel.appendChild(searchInput);

    const listArea = document.createElement("div");
    listArea.style.cssText = `
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 4px 0;
    `;
    rootPanel.appendChild(listArea);

    function renderList(filter) {
        while (allMenus.length > 1) {
            const m = allMenus.pop();
            if (m && m.parentNode) m.parentNode.removeChild(m);
        }
        listArea.innerHTML = "";
        const f = (filter || "").toLowerCase();

        if (!f) {
            const menuItems = treeNodeToMenuItems(tree);
            if (menuItems.length === 0) {
                const empty = document.createElement("div");
                empty.style.cssText = "padding: 16px; text-align: center; color: #666;";
                empty.textContent = "没有可用的 UNET 模型";
                listArea.appendChild(empty);
                return;
            }
            for (const item of menuItems) {
                listArea.appendChild(makeItemEl(item, rootPanel, 0));
            }
        } else {
            const results = [];
            function search(node) {
                for (const file of node.files) {
                    if (file.fullPath.toLowerCase().indexOf(f) >= 0) {
                        results.push({
                            label: file.fullPath,
                            icon: "📄",
                            unetPath: file.fullPath,
                            value: file.fullPath,
                            selected: file.fullPath === currentValue,
                            onClick: function (val) { onSelect(val); },
                        });
                    }
                }
                for (const child of node.children) search(child);
            }
            search(tree);
            results.sort(function (a, b) { return a.label.localeCompare(b.label); });

            if (results.length === 0) {
                const empty = document.createElement("div");
                empty.style.cssText = "padding: 16px; text-align: center; color: #666;";
                empty.textContent = "没有匹配的结果";
                listArea.appendChild(empty);
            } else {
                for (const item of results) {
                    listArea.appendChild(makeItemEl(item, rootPanel, 0));
                }
            }
        }
    }

    renderList("");
    allMenus.push(rootPanel);

    searchInput.addEventListener("input", function (e) {
        renderList(e.target.value);
    });

    document.body.appendChild(rootPanel);
    const rootRect = rootPanel.getBoundingClientRect();
    let left = clientX;
    let top = clientY;
    if (left + rootRect.width > window.innerWidth - 8) {
        left = window.innerWidth - rootRect.width - 8;
    }
    if (top + rootRect.height > window.innerHeight - 8) {
        top = window.innerHeight - rootRect.height - 8;
    }
    if (top < 8) top = 8;
    rootPanel.style.left = left + "px";
    rootPanel.style.top = top + "px";

    setTimeout(function () { searchInput.focus(); }, 0);

    function onOutsideDown(e) {
        for (const m of allMenus) {
            if (m && m.contains && m.contains(e.target)) return;
        }
        _hideUnetSelector();
    }
    function onKeyDown(e) {
        if (e.key === "Escape") _hideUnetSelector();
    }
    window.addEventListener("mousedown", onOutsideDown, true);
    window.addEventListener("pointerdown", onOutsideDown, true);
    window.addEventListener("keydown", onKeyDown, true);

    _selectorMenu = {
        menus: allMenus,
        _onOutsideDown: onOutsideDown,
        _onKeyDown: onKeyDown,
    };
}

function _hideUnetSelector() {
    if (_selectorMenu) {
        if (_selectorMenu._onOutsideDown) {
            window.removeEventListener("mousedown", _selectorMenu._onOutsideDown, true);
            window.removeEventListener("pointerdown", _selectorMenu._onOutsideDown, true);
        }
        if (_selectorMenu._onKeyDown) {
            window.removeEventListener("keydown", _selectorMenu._onKeyDown, true);
        }
        if (_selectorMenu.menus) {
            for (const m of _selectorMenu.menus) {
                if (m && m.parentNode) m.parentNode.removeChild(m);
            }
        }
        _selectorMenu = null;
    }
    _selectorPreviewUnet = null;
    _selectorPreviewUrl = null;
    _selectorPreviewLoading = false;
    // 菜单关闭后清空鼠标高度 / 悬停行缓存，避免影响 widget 悬停预览
    _pointerY = null;
    _anchorRect = null;
    _hidePreview();
}


// ============================================================
// 自定义 unet_name Widget
// ============================================================

class UnetNameWidget {
    constructor(initialValue) {
        this.type = "custom";
        this.name = "unet_name";
        this.value = initialValue || "";
        this.options = {};
        this._hover = false;
        this._bounds = [0, 0, 0, 0];
        this._previewImgUrl = null;
        this._previewLoading = false;
        this._previewLoadedFor = null;
    }

    computeSize(width) {
        // 与原生 widget 高度一致（NODE_WIDGET_HEIGHT = 20）
        return [width, LiteGraph.NODE_WIDGET_HEIGHT || WIDGET_HEIGHT];
    }

    serializeValue(node, index) {
        return this.value || "";
    }

    configure(data) {
        if (data && data.value !== undefined) {
            this.value = data.value;
        }
    }

    draw(ctx, node, width, posY, height) {
        // ── 几何参数完全对齐 ComfyUI 原生 widget ──
        // 原生源码: ctx.roundRect(margin, y, width - margin*2, height, [height * 0.5])
        // 即左右各留 15px，圆角半径 = 高度的一半 → 胶囊形大圆角
        const x = WIDGET_MARGIN;
        const w = Math.max(20, width - WIDGET_MARGIN * 2);
        const y = posY;
        const h = height || WIDGET_HEIGHT;
        const radius = h * WIDGET_RADIUS_RATIO;
        const midY = y + h / 2;
        this._bounds = [x, y, w, h];

        const enabled = !!(this.value && this.value !== "None");

        // 背景 + 大圆角（与 weight_dtype 等原生 widget 完全一致）
        ctx.save();
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") {
            ctx.roundRect(x, y, w, h, [radius]);
        } else {
            drawRoundedRect(ctx, x, y, w, h, radius);
        }
        ctx.fillStyle = LiteGraph.WIDGET_BGCOLOR || "#222";
        ctx.fill();
        ctx.strokeStyle = this._hover ? "#7c3aed" : (LiteGraph.WIDGET_OUTLINE_COLOR || "#666");
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();

        // 悬停检测（节点内坐标）
        const selectorOpen = !!_selectorMenu;
        if (node && node._hoverMouse && !selectorOpen) {
            const mx = node._hoverMouse[0];
            const my = node._hoverMouse[1];
            const wasHover = this._hover;
            this._hover = pointInRect(mx, my, this._bounds);

            if (this._hover && !wasHover) {
                this._loadAndShowPreview(node);
            } else if (!this._hover && wasHover) {
                _hidePreview();
            }
        } else if (this._hover) {
            this._hover = false;
            if (!selectorOpen) _hidePreview();
        }

        // 文件名 + 右侧箭头
        ctx.save();
        // 同步刷新「图坐标 → 屏幕 CSS 像素」换算因子，供 DOM 菜单字号使用
        _updateCanvasCssScale(ctx);
        // 原生 widget 使用 inner_text_font = normal 12px Inter
        ctx.font = "12px Inter, sans-serif";
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";

        // 名称：根目录下的一级文件夹名前缀 + unet 文件名
        //   例：Flux/Sub/model.safetensors → "Flux / model"
        //       model.safetensors（直接在根目录）→ "model"
        const parts = String(this.value || "").split(/[\\/]/).filter(Boolean);
        const rawName = parts.length ? parts[parts.length - 1] : "";
        const fileName = rawName.replace(/\.(safetensors|pt|pth|ckpt|bin)$/i, "");
        const topFolder = parts.length > 1 ? parts[0] : "";

        // 原生文本区域: left = margin*2 + 5, width = width - 85
        const textX = WIDGET_MARGIN * 2 + 5;
        const textW = Math.max(20, width - 85);

        const nameColor = enabled
            ? (this._hover ? "#c4b5fd" : (LiteGraph.WIDGET_TEXT_COLOR || "#DDD"))
            : (LiteGraph.WIDGET_DISABLED_TEXT_COLOR || "#666");
        const folderColor = enabled
            ? (this._hover ? "#a78bfa" : (LiteGraph.WIDGET_SECONDARY_TEXT_COLOR || "#999"))
            : (LiteGraph.WIDGET_DISABLED_TEXT_COLOR || "#666");

        if (!enabled) {
            ctx.fillStyle = nameColor;
            ctx.fillText("None", textX, midY);
        } else {
            const prefix = topFolder ? topFolder + " / " : "";
            // 前缀用次要文字色区分，文件名用主文字色
            const prefixW = prefix ? ctx.measureText(prefix).width : 0;

            if (prefix && prefixW < textW - 30) {
                ctx.fillStyle = folderColor;
                ctx.fillText(prefix, textX, midY);
                ctx.fillStyle = nameColor;
                ctx.fillText(
                    fitString(ctx, fileName, textW - prefixW),
                    textX + prefixW, midY
                );
            } else {
                // 无前缀，或前缀过长时整体截断
                ctx.fillStyle = nameColor;
                ctx.fillText(fitString(ctx, prefix + fileName, textW), textX, midY);
            }
        }

        // 右侧箭头：坐标与原生 drawArrowButtons 完全一致（三角形，非 ▼ 文本）
        const arrowIn = WIDGET_MARGIN + WIDGET_ARROW_MARGIN;
        const arrowOut = arrowIn + WIDGET_ARROW_WIDTH;
        ctx.fillStyle = enabled
            ? (LiteGraph.WIDGET_TEXT_COLOR || "#DDD")
            : (LiteGraph.WIDGET_DISABLED_TEXT_COLOR || "#666");
        ctx.beginPath();
        ctx.moveTo(width - arrowOut, y + 5);
        ctx.lineTo(width - arrowIn, y + h * 0.5);
        ctx.lineTo(width - arrowOut, y + h - 5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    async _loadAndShowPreview(node) {
        if (!this.value || this.value === "None") return;

        if (this._previewLoadedFor === this.value) {
            if (this._previewImgUrl) {
                _showPreview(this._previewImgUrl, node._lastMouseX || 0, node._lastMouseY || 0);
            }
            return;
        }

        if (this._previewLoading) return;
        this._previewLoading = true;
        const target = this.value;
        const imgUrl = await loadUnetPreview(target);
        this._previewLoading = false;

        if (this.value !== target) return;
        this._previewLoadedFor = target;
        this._previewImgUrl = imgUrl;

        if (this._hover && imgUrl) {
            _showPreview(imgUrl, node._lastMouseX || 0, node._lastMouseY || 0);
        }
    }

    mouse(event, pos, node) {
        const px = pos[0];
        const py = pos[1];

        if (event.type === "pointerdown") {
            if (pointInRect(px, py, this._bounds)) {
                this._openSelector(event, node);
                return true;
            }
        }
        return false;
    }

    dblClick(event, pos, node) {
        if (pointInRect(pos[0], pos[1], this._bounds)) {
            this._openSelector(event, node);
            return true;
        }
        return false;
    }

    async _openSelector(event, node) {
        _hidePreview();
        this._hover = false;

        const units = await getUnetList();
        if (!units || units.length === 0) {
            console.warn("[LoadUnetModel] UNET 列表为空");
            return;
        }

        const clientX = event.clientX || 0;
        const clientY = event.clientY || 0;
        const widget = this;

        _showUnetSelector(clientX, clientY, units, this.value, function (value) {
            widget.value = value;
            widget._previewLoadedFor = null;
            widget._previewImgUrl = null;
            node.setDirtyCanvas(true, true);
        });
    }
}


// ============================================================
// 注册扩展
// ============================================================

app.registerExtension({
    name: "common-toolbox.load-unet-diffusion-model",

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "Load Unet Diffusion Model") return;

        nodeType.prototype.serialize_widgets = true;

        // ── 节点创建 ──
        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            if (origOnNodeCreated) origOnNodeCreated.apply(this, arguments);
            const node = this;

            // 鼠标移动：计算节点内坐标（供悬停检测使用）
            this._hoverRafPending = false;
            this._onCanvasMouseMove = function (e) {
                if (!node.graph) return;
                const canvasEl = app.canvas?.canvas;
                if (!canvasEl) return;

                node._lastMouseX = e.clientX;
                node._lastMouseY = e.clientY;

                const canvasGraph = app.canvas;
                if (canvasGraph && canvasGraph.graph_mouse && node.pos) {
                    node._hoverMouse = [
                        canvasGraph.graph_mouse[0] - node.pos[0],
                        canvasGraph.graph_mouse[1] - node.pos[1],
                    ];
                } else {
                    node._hoverMouse = null;
                }

                if (_previewVisible) {
                    _positionPreview(e.clientX, e.clientY);
                }

                if (node._hoverRafPending) return;
                node._hoverRafPending = true;
                requestAnimationFrame(() => {
                    node._hoverRafPending = false;
                    if (node.graph) node.setDirtyCanvas(true, false);
                });
            };
            const canvasEl = app.canvas?.canvas;
            if (canvasEl) {
                canvasEl.addEventListener("mousemove", this._onCanvasMouseMove);
            }

            // 鼠标离开画布 → 收起预览
            this._onCanvasMouseLeave = function () {
                _hidePreview();
                node._hoverMouse = null;
            };
            if (canvasEl) {
                canvasEl.addEventListener("mouseleave", this._onCanvasMouseLeave);
            }

            // ── 替换 unet_name widget ──
            const setup = () => {
                if (!node.widgets) return false;

                const idx = node.widgets.findIndex(w => w.name === "unet_name");
                if (idx < 0) return false;

                const original = node.widgets[idx];
                const initialValue = original.value || "";

                // 如果已经是自定义 widget，跳过
                if (original instanceof UnetNameWidget) return true;

                const custom = new UnetNameWidget(initialValue);
                node.widgets.splice(idx, 1, custom);
                return true;
            };

            // widget 可能稍后才创建，多轮重试
            const retryDelays = [0, 10, 50, 100, 200, 500];
            for (const delay of retryDelays) {
                setTimeout(() => {
                    if (!node.graph) return;
                    setup();
                    node.setDirtyCanvas(true, true);
                }, delay);
            }

            // 保持节点尺寸
            setTimeout(() => {
                if (!node.graph) return;
                const cs = node.computeSize();
                node.size[0] = Math.max(node.size[0] || 280, cs[0]);
                node.size[1] = Math.max(node.size[1] || 50, cs[1]);
                node.setDirtyCanvas(true, true);
            }, 60);
        };

        // ── 清理 ──
        const origOnRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            const canvasEl = app.canvas?.canvas;
            if (canvasEl) {
                if (this._onCanvasMouseMove) {
                    canvasEl.removeEventListener("mousemove", this._onCanvasMouseMove);
                }
                if (this._onCanvasMouseLeave) {
                    canvasEl.removeEventListener("mouseleave", this._onCanvasMouseLeave);
                }
            }
            this._onCanvasMouseMove = null;
            this._onCanvasMouseLeave = null;
            _hidePreview();
            _hideUnetSelector();
            if (origOnRemoved) origOnRemoved.apply(this, arguments);
        };

        // ── 配置恢复后刷新 ──
        const origOnConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            if (origOnConfigure) origOnConfigure.apply(this, arguments);
            const node = this;
            setTimeout(() => {
                if (!node.graph) return;
                // 同步 widget 值
                const w = node.widgets?.find(x => x.name === "unet_name");
                if (w && w.value !== undefined) {
                    w._previewLoadedFor = null;
                    w._previewImgUrl = null;
                }
                node.setDirtyCanvas(true, true);
            }, 50);
        };
    },
});
