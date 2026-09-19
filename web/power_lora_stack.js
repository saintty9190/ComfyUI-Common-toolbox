import { app } from "../../scripts/app.js";


// ============================================================
// 常量
// ============================================================

const ROW_HEIGHT = 16;
const HEADER_HEIGHT = 18;
const ADD_BTN_HEIGHT = 24;
const MARGIN = 6;
const WIDGET_SPACING = 4;
const MAX_LORAS = 50;
const PREVIEW_MAX_SIZE = 250; // 预览图最大边长
const PREVIEW_OFFSET = 16;   // 预览图与鼠标的偏移量

const HIDDEN_INPUT_PORTS = ["model", "clip"];
const HIDDEN_OUTPUT_PORTS = ["model", "clip"];

const LORA_NAME_FONT_PX = 11;   // 与 PowerLoraRowWidget.draw 中的名称字号保持一致

let MENU_FONT_SIZE = 15;        // 打开菜单时由 _syncMenuFontSize() 按缩放刷新
let MENU_FONT_SIZE_SMALL = 13;  // 图标 / 箭头等辅助元素
const MENU_LINE_HEIGHT = 1.45;  // 行高倍数，保证字形不被压扁

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

function _menuMaxHeight() {
    return Math.max(200, Math.round(window.innerHeight * 0.8));
}

let _loraListCache = null;


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

function _contentBodyHeight(node, hiddenInputs, hiddenOutputs) {
    const LG = typeof LiteGraph !== "undefined" ? LiteGraph : {};
    const slotH = LG.NODE_SLOT_HEIGHT || 20;
    const widgetH = LG.NODE_WIDGET_HEIGHT || 20;
    const minW = 220;

    const hidIn = hiddenInputs || [];
    const hidOut = hiddenOutputs || [];

    const widgets = node.widgets || [];
    const hasWidgets = widgets.length > 0;
    // 已被转成 widget 的输入端口不参与纵向排布
    const isWidgetSlot = (s) => !!(s && s.widget && hasWidgets);

    // 只有"可见的纵向端口"才占行；隐藏端口会被压缩到第一行
    const nIn = (node.inputs || []).filter(
        (s) => s && !s.pos && !isWidgetSlot(s) && hidIn.indexOf(s.name) < 0
    ).length;
    const nOut = (node.outputs || []).filter(
        (s) => s && !s.pos && hidOut.indexOf(s.name) < 0
    ).length;
    const rows = Math.max(nIn, nOut);

    let h = 0;
    if (rows > 0) {
        h = (rows - 1 + 0.7) * slotH + slotH / 2; // 端口区底部
    }
    h += 2; // _arrangeWidgets 的起始偏移

    for (const w of widgets) {
        if (!w || w.type === "hidden") continue;
        let wh = widgetH;
        if (w.computeSize) {
            const r = w.computeSize(minW);
            if (r && isFinite(r[1])) wh = r[1];
        }
        h += wh + 4;
    }

    h += 6; // 底部留白
    return Math.max(h, 40);
}

function _compactSlotRow(list, index, hiddenNames) {
    if (!list || !list[index]) return index;
    let compact = 0;
    const isHidden = (i) => hiddenNames.indexOf(list[i]?.name) >= 0;

    if (isHidden(index)) {
        const visIdx = list.findIndex((x) => hiddenNames.indexOf(x?.name) < 0);
        if (visIdx >= 0) {
            for (let i = 0; i < visIdx; i++) {
                if (!isHidden(i)) compact++;
            }
            return compact;
        }
        return 0;
    }

    for (let i = 0; i < index; i++) {
        if (!isHidden(i)) compact++;
    }
    return compact;
}

async function getLoraList() {
    if (_loraListCache) return _loraListCache;
    try {
        const def = app.nodeTypesByClassName?.["LoraLoader"];
        if (def?.input?.required?.lora_name?.[0]) {
            _loraListCache = def.input.required.lora_name[0];
            return _loraListCache;
        }
        const resp = await fetch("/object_info/LoraLoader");
        const data = await resp.json();
        if (data?.LoraLoader?.input?.required?.lora_name?.[0]) {
            _loraListCache = data.LoraLoader.input.required.lora_name[0];
            return _loraListCache;
        }
    } catch (e) {
        console.warn("[PowerLoraStack] 获取 LoRA 列表失败", e);
    }
    return [];
}

function refreshLoraList() {
    _loraListCache = null;
}

// 加载 LoRA 预览图
function loadLoraPreview(loraName) {
    return new Promise((resolve) => {
        if (!loraName || loraName === "None") {
            resolve(null);
            return;
        }
        // 使用自定义 API 路由（ComfyUI 内置 /view 不支持 loras 类型）
        const url = `/common-toolbox/lora_preview?name=${encodeURIComponent(loraName)}`;
        const img = new Image();
        img.onload = () => resolve(url);
        img.onerror = () => resolve(null);
        img.src = url;
    });
}


// ============================================================
// Power Lora Row Widget
// ============================================================

class PowerLoraRowWidget {
    constructor(index) {
        this.type = "custom";
        this.name = `power_lora_${index}`;
        this.index = index;
        this._value = { on: true, lora: "", strength: 1.0 };
        this._adjusting = null;
        this._hover = false;
        this._previewImg = null;
        this._previewLoading = false;
        this._previewLoaded = false;

        // 交互区域 bounds: [x, y, w, h]（节点内坐标）
        this._bounds = {
            toggle: [0, 0, 0, 0],
            name: [0, 0, 0, 0],
            strength: [0, 0, 0, 0],
        };
    }

    get value() {
        if (!this._value.lora) return "";
        return JSON.stringify(this._value);
    }

    set value(v) {
        if (!v || v === "") {
            this._value = { on: true, lora: "", strength: 1.0 };
            return;
        }
        if (typeof v === "string") {
            try {
                this._value = JSON.parse(v);
            } catch (e) {
                this._value = { on: true, lora: "", strength: 1.0 };
            }
        } else if (typeof v === "object") {
            this._value = { ...v };
        }
        // 切换 LoRA 时重置预览缓存
        this._previewImg = null;
        this._previewLoading = false;
        this._previewLoaded = false;
    }

    get loraData() {
        return this._value;
    }

    set loraData(v) {
        this._value = { ...v };
        this._previewImg = null;
        this._previewLoading = false;
        this._previewLoaded = false;
    }

    computeSize(width) {
        return [width, ROW_HEIGHT];
    }

    draw(ctx, node, width, posY, height) {
        const w = width - MARGIN * 2;
        const x = MARGIN;
        const y = posY;
        const midY = y + ROW_HEIGHT / 2;
        const enabled = this._value.on;

        ctx.save();
        if (!enabled) ctx.globalAlpha = 0.4;

        // Toggle
        const tw = 20, th = 12;
        const tx = x, ty = y + (ROW_HEIGHT - th) / 2;
        this._bounds.toggle = [tx, ty, tw, th];
        ctx.fillStyle = enabled ? "#10b981" : "#9ca3af";
        drawRoundedRect(ctx, tx, ty, tw, th, 6);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        const kx = enabled ? tx + tw - th + 1 : tx + 1;
        ctx.arc(kx + th / 2 - 1, ty + th / 2, th / 2 - 2, 0, Math.PI * 2);
        ctx.fill();

        // Lora name
        const nameX = tx + tw + 6;
        const strW = 50;
        const nameMaxW = w - (tw + 6) - strW - 6;
        this._bounds.name = [nameX, y, Math.max(nameMaxW, 30), ROW_HEIGHT];

        // 保存 ctx 变换矩阵（mousemove 中用来反算鼠标坐标）
        if (node && ctx.getTransform) {
            node._ctxTransform = ctx.getTransform();
        }
        // 同步刷新「图坐标 → 屏幕 CSS 像素」换算因子，供 DOM 菜单字号使用
        _updateCanvasCssScale(ctx);

        const selectorOpen = !!_selectorMenu;
        if (this._value.lora && node && node._hoverMouse && !selectorOpen) {
            const mx = node._hoverMouse[0];
            const my = node._hoverMouse[1];
            const wasHover = this._hover;
            this._hover = pointInRect(mx, my, this._bounds.name);
            if (this._hover && !wasHover) {
                // 加载并显示 DOM 预览层
                this.ensurePreview(node);
            }
            if (wasHover !== this._hover) {
                if (!this._hover) {
                    _hidePreview();
                    _hideRightClickHit();
                }
                node.setDirtyCanvas(true, false);
            }

            // 悬停在文件名上 → 更新 DOM 右键热区位置（纯 DOM，不依赖 LiteGraph 事件）
            if (this._hover && node._ctxTransform) {
                const t = node._ctxTransform;
                const [bx, by, bw, bh] = this._bounds.name;
                const canvasX1 = t.a * bx + t.c * by + t.e;
                const canvasY1 = t.b * bx + t.d * by + t.f;
                const canvasX2 = t.a * (bx + bw) + t.c * (by + bh) + t.e;
                const canvasY2 = t.b * (bx + bw) + t.d * (by + bh) + t.f;
                const canvasEl = app.canvas?.canvas;
                if (canvasEl) {
                    const rect = canvasEl.getBoundingClientRect();
                    const scaleX = rect.width / canvasEl.width;
                    const scaleY = rect.height / canvasEl.height;
                    const screenX = rect.left + canvasX1 * scaleX;
                    const screenY = rect.top + canvasY1 * scaleY;
                    const screenW = (canvasX2 - canvasX1) * scaleX;
                    const screenH = (canvasY2 - canvasY1) * scaleY;
                    _updateRightClickHit(node, this, screenX, screenY, screenW, screenH);
                }
            }
        } else if (!this._value?.lora || selectorOpen) {
            if (this._hover) {
                _hidePreview();
                _hideRightClickHit();
            }
            this._hover = false;
        }

        // 悬停时文件名高亮
        ctx.fillStyle = this._hover ? "#7c3aed" : LiteGraph.WIDGET_TEXT_COLOR;
        ctx.font = "11px sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        const displayName = (this._value.lora || "None").split("/").pop()
            .replace(/\.(safetensors|pt|pth|ckpt|bin)$/i, "");
        ctx.fillText(fitString(ctx, displayName, nameMaxW), nameX, midY);

        // Strength box
        const sx = x + w - strW;
        const sy = y + 2;
        const sh = ROW_HEIGHT - 4;
        this._bounds.strength = [sx, sy, strW, sh];
        ctx.fillStyle = LiteGraph.WIDGET_BGCOLOR;
        ctx.strokeStyle = LiteGraph.WIDGET_OUTLINE_COLOR;
        drawRoundedRect(ctx, sx, sy, strW, sh, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR;
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(Number(this._value.strength || 1).toFixed(2), sx + strW / 2, midY);

        if (!enabled) ctx.globalAlpha = 1;

        ctx.restore();
    }

    mouse(event, pos, node) {
        const px = pos[0];
        const py = pos[1];

        // 右键 → 弹出自定义排序菜单
        // （注：本版前端不会把 contextmenu 派发给 widget，右键实际由文件名上的
        //   DOM 热区处理；这里保留兼容分支，便于适配其它前端版本）
        if (event.type === "contextmenu") {
            if (pointInRect(px, py, this._bounds.name)) {
                this._showRightClickMenu(event, node);
                return true;
            }
            return false;
        }

        if (event.type === "pointerdown") {
            if (pointInRect(px, py, this._bounds.toggle)) {
                this._value.on = !this._value.on;
                node.setDirtyCanvas(true, true);
                return true;
            }
            // Strength：单击直接弹出数值输入框
            //
            // 约束：ComfyUI 前端对 type==="custom" 的 widget 只派发
            //   pointerdown / pointerup 两种事件（LGraphCanvas.processWidgetClick
            //   中 toConcreteWidget 对 custom 返回 undefined），
            //   pointermove 与 dblClick 都不会下发。
            //   因此数值输入只能走"单击即弹出输入框"这一条路径。
            if (pointInRect(px, py, this._bounds.strength)) {
                this._promptStrength(event, node);
                return true;
            }
            if (pointInRect(px, py, this._bounds.name)) {
                this._showChooser(event, node);
                return true;
            }
            return false;
        }

        // pointermove：部分前端版本会派发，保留拖拽微调能力作兜底
        if (event.type === "pointermove") {
            if (this._adjusting) {
                const dx = px - this._adjusting.startX;
                let newVal = this._adjusting.startVal + dx * 0.01;
                newVal = Math.round(newVal * 100) / 100;
                newVal = Math.max(-10, Math.min(10, newVal));
                this._value.strength = newVal;
                node.setDirtyCanvas(true, true);
                return true;
            }
            return false;
        }

        if (event.type === "pointerup") {
            if (this._adjusting) this._adjusting = null;
            return true;
        }

        return false;
    }

    // 弹出数值输入框修改 strength
    _promptStrength(event, node) {
        const canvas = app.canvas;
        // 当前前端把 prompt 挂在 LGraphCanvas 上（rgthree 也是这么用的）；
        // LiteGraph.prompt 作为老版本兜底。
        let promptFn = null;
        if (canvas && typeof canvas.prompt === "function") {
            promptFn = canvas.prompt.bind(canvas);
        } else if (typeof LiteGraph !== "undefined" && typeof LiteGraph.prompt === "function") {
            promptFn = LiteGraph.prompt.bind(LiteGraph);
        }
        if (!promptFn) return;

        const current = Number(this._value.strength);
        const widget = this;
        promptFn("Strength", isFinite(current) ? current : 1, function (v) {
            // 取消 / 空输入时回调可能拿到 null 或空串 —— 此时保持原值不变
            if (v === null || v === undefined || v === "") return;
            const num = parseFloat(v);
            if (!isFinite(num)) return;
            widget._value.strength = Math.max(-10, Math.min(10, Math.round(num * 100) / 100));
            node.setDirtyCanvas(true, true);
        }, event);
    }

    // 双击：部分前端版本会派发，行为与单击一致（弹输入框）
    dblClick(event, pos, node) {
        const px = pos[0];
        if (pointInRect(px, pos[1], this._bounds.strength)) {
            this._promptStrength(event, node);
            return true;
        }
        if (pointInRect(px, pos[1], this._bounds.name)) {
            this._showChooser(event, node);
            return true;
        }
        return false;
    }

    // 右键菜单（自定义 DOM，不走 LiteGraph 原生）
    _showRightClickMenu(event, node) {
        _hidePreview();
        this._hover = false;

        const list = node._loraWidgets || [];
        const idx = list.indexOf(this);
        if (idx < 0) return; // 已不在列表中，不弹菜单

        const total = list.length;
        const canMoveUp = idx > 0;
        const canMoveDown = idx < total - 1;
        const row = this;

        const items = [
            {
                label: (row._value.on ? "⚫  Disable" : "🟢  Enable"),
                onClick: function () {
                    row._value.on = !row._value.on;
                    node.setDirtyCanvas(true, true);
                }
            },
            { separator: true },
            {
                label: "⬆️  Move to Top",
                disabled: !canMoveUp,
                onClick: function () { node._moveLora(idx, 0); }
            },
            {
                label: "⬆️  Move Up",
                disabled: !canMoveUp,
                onClick: function () { node._moveLora(idx, idx - 1); }
            },
            {
                label: "⬇️  Move Down",
                disabled: !canMoveDown,
                onClick: function () { node._moveLora(idx, idx + 1); }
            },
            {
                label: "⬇️  Move to Bottom",
                disabled: !canMoveDown,
                onClick: function () { node._moveLora(idx, total - 1); }
            },
            { separator: true },
            {
                label: "🗑️  Remove",
                onClick: function () { node._removeLora(idx); }
            },
        ];

        _showSimpleMenu(event.clientX, event.clientY, items);
    }

    async _showChooser(event, node) {
        // 弹出选择器时隐藏悬停预览
        _hidePreview();
        this._hover = false;

        const loras = await getLoraList();
        const row = this;

        const clientX = event.clientX || 0;
        const clientY = event.clientY || 0;

        _showLoraSelector(clientX, clientY, loras, row._value.lora || null, function (value) {
            if (value) {
                row._value.lora = value;
                row._previewImg = null;
                row._previewLoading = false;
                row._previewLoaded = false;
                row._previewImgUrl = null;
            } else {
                row._value.lora = null;
                row._previewImg = null;
                row._previewLoading = false;
                row._previewLoaded = false;
                row._previewImgUrl = null;
            }
            node.setDirtyCanvas(true, true);
        });
    }

    // 触发加载预览图
    async ensurePreview(node) {
        if (this._previewLoading || this._previewLoaded) {
            if (this._previewLoaded && this._previewImgUrl) {
                _showPreview(this._previewImgUrl, node._lastMouseX || 0, node._lastMouseY || 0);
            }
            return;
        }
        if (!this._value.lora || this._value.lora === "None") return;

        this._previewLoading = true;
        const imgUrl = await loadLoraPreview(this._value.lora);
        this._previewImgUrl = imgUrl;
        this._previewLoaded = !!imgUrl;
        this._previewLoading = false;
        if (this._hover && imgUrl) {
            _showPreview(imgUrl, node._lastMouseX || 0, node._lastMouseY || 0);
        }
    }

    serializeValue(node, index) {
        if (!this._value.lora) return "";
        return JSON.stringify(this._value);
    }

    configure(data) {
        if (data?.value !== undefined) {
            this.value = data.value;
        }
    }
}


// ============================================================
// Header Widget
// ============================================================

class PowerLoraHeaderWidget {
    constructor() {
        this.type = "custom";
        this.name = "_header";
        this._toggleBounds = [0, 0, 0, 0];
    }

    computeSize(width) {
        return [width, HEADER_HEIGHT];
    }

    draw(ctx, node, width, posY, height) {
        const w = width - MARGIN * 2;
        const x = MARGIN;
        const y = posY;
        const midY = y + HEADER_HEIGHT / 2;

        const loraWidgets = node._loraWidgets || [];
        const allOn = loraWidgets.length > 0 && loraWidgets.every(w => w.loraData.on);

        // Toggle
        const tw = 26, th = 14;
        const tx = x, ty = y + (HEADER_HEIGHT - th) / 2;
        this._toggleBounds = [tx, ty, tw, th];
        ctx.fillStyle = allOn ? "#10b981" : "#9ca3af";
        drawRoundedRect(ctx, tx, ty, tw, th, 8);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        const kx = allOn ? tx + tw - th + 2 : tx + 2;
        ctx.arc(kx + th / 2 - 2, ty + th / 2, th / 2 - 2, 0, Math.PI * 2);
        ctx.fill();

        // All label
        ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR;
        ctx.globalAlpha = 0.6;
        ctx.font = "11px sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText("All", tx + tw + 6, midY);
        ctx.globalAlpha = 1;

        // Strength label
        ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR;
        ctx.globalAlpha = 0.6;
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "right";
        ctx.fillText("Strength", x + w, midY);
        ctx.globalAlpha = 1;
    }

    mouse(event, pos, node) {
        if (event.type !== "pointerdown") return false;
        if (pointInRect(pos[0], pos[1], this._toggleBounds)) {
            const loraWidgets = node._loraWidgets || [];
            const allOn = loraWidgets.length > 0 && loraWidgets.every(w => w.loraData.on);
            const newState = !allOn;
            loraWidgets.forEach(w => { w.loraData.on = newState; });
            node.setDirtyCanvas(true, true);
            return true;
        }
        return false;
    }
}


// ============================================================
// Add Button Widget
// ============================================================

class PowerLoraAddButtonWidget {
    constructor() {
        this.type = "custom";
        this.name = "_add_btn";
        this._bounds = [0, 0, 0, 0];
    }

    computeSize(width) {
        return [width, ADD_BTN_HEIGHT];
    }

    draw(ctx, node, width, posY, height) {
        const w = width - MARGIN * 2;
        const x = MARGIN;
        const y = posY;
        this._bounds = [x, y, w, ADD_BTN_HEIGHT];

        ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
        ctx.strokeStyle = "#7c3aed";
        ctx.setLineDash([4, 3]);
        drawRoundedRect(ctx, x, y, w, ADD_BTN_HEIGHT, 6);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = "#a78bfa";
        ctx.font = "bold 12px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("➕ Add Lora", x + w / 2, y + ADD_BTN_HEIGHT / 2);
    }

    mouse(event, pos, node) {
        if (event.type !== "pointerdown") return false;
        if (pointInRect(pos[0], pos[1], this._bounds)) {
            node._addNewLora(event);
            return true;
        }
        return false;
    }
}


// ============================================================
// Load Lora Stack - Unload Button Widget
// ============================================================

class UnloadButtonWidget {
    constructor(node) {
        this.type = "custom";
        // 直接占用原 unload_trigger widget 的位置与名称，
        // 这样既隐藏了原生数字输入框，又保证序列化 / prompt 参数不丢失
        this.name = "unload_trigger";
        this._node = node;
        this._counter = 0;
        this._bounds = [0, 0, 0, 0];
    }

    get value() {
        return this._counter;
    }

    set value(v) {
        this._counter = parseInt(v) || 0;
    }

    computeSize(width) {
        return [width, 32];
    }

    draw(ctx, node, width, posY, height) {
        const x = MARGIN;
        const w = width - MARGIN * 2;
        const y = posY + 2;
        const h = 28;
        this._bounds = [x, y, w, h];

        // 与 Power Lora Stack 的 Add 按钮保持一致的视觉语言：
        // 深色半透明底 + 浅紫色虚线边框
        ctx.save();
        ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
        ctx.strokeStyle = "#7c3aed";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        drawRoundedRect(ctx, x, y, w, h, 6);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = "#a78bfa";
        ctx.font = "bold 12px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("🔄  Unload Lora", x + w / 2, y + h / 2);
        ctx.restore();
    }

    mouse(event, pos, node) {
        if (event.type !== "pointerdown") return false;
        if (pointInRect(pos[0], pos[1], this._bounds)) {
            this._counter++;
            node.setDirtyCanvas(true, true);
            if (app.queuePrompt) {
                setTimeout(() => app.queuePrompt(0, 1), 50);
            }
            return true;
        }
        return false;
    }

    serializeValue() {
        return this._counter;
    }
}


// ============================================================
// 全局预览图浮动层（DOM 元素，在 canvas 之上，不被裁剪）
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

// ========== 右键热区 DOM 层 ==========
// 透明 DOM 元素，覆盖在当前悬停的 LoRA 文件名上，直接接收右键事件
// 完全不依赖 LiteGraph 的事件系统
let _rightClickHitEl = null;
let _rightClickWidget = null; // 当前热区对应的 widget
let _rightClickNode = null;   // 当前热区对应的 node

function _ensureRightClickHitEl() {
    if (_rightClickHitEl) return _rightClickHitEl;
    _rightClickHitEl = document.createElement("div");
    _rightClickHitEl.style.cssText = `
        position: fixed;
        z-index: 99998;
        background: transparent;
        cursor: pointer;
        display: none;
    `;
    // 右键直接弹自定义菜单
    _rightClickHitEl.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (_rightClickWidget && _rightClickNode) {
            _rightClickWidget._showRightClickMenu(e, _rightClickNode);
        }
    });
    // 左键透传：点击选择 LoRA
    _rightClickHitEl.addEventListener("mousedown", function (e) {
        if (e.button !== 0) return;
        e.stopPropagation();
        if (_rightClickWidget && _rightClickNode) {
            _rightClickWidget._showChooser(e, _rightClickNode);
        }
    });
    // mousemove 透传：保持画布的鼠标跟踪（避免悬停检测失效）
    _rightClickHitEl.addEventListener("mousemove", function (e) {
        const canvasEl = app.canvas?.canvas;
        if (!canvasEl) return;
        // 转发给 canvas 的 mousemove 处理
        const evt = new MouseEvent("mousemove", {
            clientX: e.clientX,
            clientY: e.clientY,
            bubbles: true,
            cancelable: true,
        });
        canvasEl.dispatchEvent(evt);
    });
    // 鼠标离开热区 → 隐藏（避免悬停状态残留）
    _rightClickHitEl.addEventListener("mouseleave", function () {
        _hideRightClickHit();
        _hidePreview();
        if (_rightClickWidget) {
            _rightClickWidget._hover = false;
        }
    });
    document.body.appendChild(_rightClickHitEl);
    return _rightClickHitEl;
}

function _updateRightClickHit(node, widget, screenX, screenY, w, h) {
    const el = _ensureRightClickHitEl();
    _rightClickNode = node;
    _rightClickWidget = widget;
    el.style.left = screenX + "px";
    el.style.top = screenY + "px";
    el.style.width = w + "px";
    el.style.height = h + "px";
    el.style.display = "block";
}

function _hideRightClickHit() {
    if (_rightClickHitEl) {
        _rightClickHitEl.style.display = "none";
    }
    _rightClickWidget = null;
    _rightClickNode = null;
}

function _ensurePreviewEl() {
    if (_previewEl) return _previewEl;
    _previewEl = document.createElement("div");
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
    const srcChanged = img.src !== window.location.origin + imgSrc &&
                       img.src !== imgSrc;
    if (srcChanged) {
        img.src = imgSrc;
        // 图片加载完成后重新定位（加载前 offsetWidth=0）
        img.onload = function () {
            if (_previewVisible) {
                _positionPreview(_lastMouseX, _lastMouseY);
            }
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


let _selectorMenu = null;
let _selectorMenuObserver = null;
let _selectorPreviewLora = null;
let _selectorPreviewUrl = null;
let _selectorPreviewLoading = false;

function _buildLoraTree(loras) {
    const root = { name: "", children: [], files: [], isFolder: true, expanded: true, path: "" };

    for (const lora of loras) {
        // 跳过 None / 空值等非文件项
        if (!lora) continue;
        if (lora.toLowerCase() === "none") continue;

        // 同时支持 / 和 \ 两种路径分隔符
        const parts = lora.split(/[\\/]/);
        let current = root;
        let currentPath = "";

        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (!part) continue; // 跳过空段
            currentPath = currentPath ? currentPath + "/" + part : part;
            let child = current.children.find(function (c) { return c.name === part; });
            if (!child) {
                child = { name: part, children: [], files: [], isFolder: true, expanded: false, path: currentPath };
                current.children.push(child);
            }
            current = child;
        }

        const fileName = parts[parts.length - 1];
        // 跳过文件名是 none 的异常项
        if (!fileName || fileName.toLowerCase() === "none") continue;
        current.files.push({ name: fileName, fullPath: lora });
    }

    // 排序：目录在前，文件在后，都按名称排序
    function sortNode(node) {
        node.children.sort(function (a, b) { return a.name.localeCompare(b.name); });
        node.files.sort(function (a, b) { return a.name.localeCompare(b.name); });
        for (const child of node.children) {
            sortNode(child);
        }
    }
    sortNode(root);

    return root;
}

// 通用简单菜单（右键排序菜单等用）
let _simpleMenu = null;

function _showSimpleMenu(clientX, clientY, items) {
    _hideSimpleMenu();
    _hideLoraSelector();
    // 按当前画布缩放刷新字号（与 lora 名称视觉对齐）
    _syncMenuFontSize();

    const panel = document.createElement("div");
    panel.className = "pls-simple-menu";
    panel.style.cssText = `
        position: fixed;
        z-index: 99999;
        background: #2a2a30;
        border: 1px solid #444450;
        border-radius: 6px;
        box-shadow: 0 6px 20px rgba(0,0,0,0.5);
        min-width: 220px;
        max-width: 360px;
        max-height: ${_menuMaxHeight()}px;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 4px 0;
        font-family: Arial, sans-serif;
        font-size: ${MENU_FONT_SIZE}px;
        line-height: ${MENU_LINE_HEIGHT};
        color: #ddd;
    `;

    for (const item of items) {
        if (item.separator) {
            const sep = document.createElement("div");
            sep.style.cssText = "height: 1px; background: #444450; margin: 4px 8px;";
            panel.appendChild(sep);
            continue;
        }

        const row = document.createElement("div");
        row.style.cssText = `
            padding: 7px 14px;
            cursor: ${item.disabled ? "not-allowed" : "pointer"};
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            opacity: ${item.disabled ? "0.4" : "1"};
            display: flex;
            align-items: center;
            gap: 6px;
            transition: background 0.08s;
        `;

        const label = document.createElement("span");
        label.style.cssText = "flex: 1;";
        label.textContent = item.label;
        row.appendChild(label);

        if (!item.disabled) {
            row.addEventListener("mouseenter", function () {
                row.style.background = "#35353d";
            });
            row.addEventListener("mouseleave", function () {
                row.style.background = "";
            });
            row.addEventListener("click", function (e) {
                e.stopPropagation();
                if (item.onClick) item.onClick();
                _hideSimpleMenu();
            });
        }

        panel.appendChild(row);
    }

    document.body.appendChild(panel);

    // 定位
    const rect = panel.getBoundingClientRect();
    let left = clientX;
    let top = clientY;
    if (left + rect.width > window.innerWidth - 8) {
        left = window.innerWidth - rect.width - 8;
    }
    if (top + rect.height > window.innerHeight - 8) {
        top = window.innerHeight - rect.height - 8;
    }
    if (top < 8) top = 8;
    panel.style.left = left + "px";
    panel.style.top = top + "px";

    // 点击外部关闭
    function onOutsideDown(e) {
        if (!panel.contains(e.target)) _hideSimpleMenu();
    }
    function onKeyDown(e) {
        if (e.key === "Escape") _hideSimpleMenu();
    }
    window.addEventListener("mousedown", onOutsideDown, true);
    window.addEventListener("pointerdown", onOutsideDown, true);
    window.addEventListener("contextmenu", onOutsideDown, true);
    window.addEventListener("keydown", onKeyDown, true);

    _simpleMenu = {
        panel: panel,
        _onOutsideDown: onOutsideDown,
        _onKeyDown: onKeyDown,
    };
}

function _hideSimpleMenu() {
    if (_simpleMenu) {
        if (_simpleMenu._onOutsideDown) {
            window.removeEventListener("mousedown", _simpleMenu._onOutsideDown, true);
            window.removeEventListener("pointerdown", _simpleMenu._onOutsideDown, true);
            window.removeEventListener("contextmenu", _simpleMenu._onOutsideDown, true);
        }
        if (_simpleMenu._onKeyDown) {
            window.removeEventListener("keydown", _simpleMenu._onKeyDown, true);
        }
        if (_simpleMenu.panel && _simpleMenu.panel.parentNode) {
            _simpleMenu.panel.parentNode.removeChild(_simpleMenu.panel);
        }
        _simpleMenu = null;
    }
}

function _showLoraSelector(clientX, clientY, loras, currentValue, onSelect) {
    _hideLoraSelector();
    _hideSimpleMenu();

    // 先按当前画布缩放刷新字号，再创建面板（面板字号在创建时写入 inline style）
    _syncMenuFontSize();

    const tree = _buildLoraTree(loras);
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

    // 创建菜单项（通用，根菜单和子菜单都用）
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

        // 图标
        const icon = document.createElement("span");
        icon.style.cssText = `width: 18px; text-align: center; flex-shrink: 0; font-size: ${MENU_FONT_SIZE_SMALL}px;`;
        icon.textContent = item.icon || "📄";
        row.appendChild(icon);

        // 名称
        const label = document.createElement("span");
        label.style.cssText = "flex: 1; overflow: hidden; text-overflow: ellipsis;";
        label.textContent = item.label;
        row.appendChild(label);

        // 子菜单箭头
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

            // 关闭更深层的菜单
            const myDepth = allMenus.indexOf(parentPanel);
            while (allMenus.length > myDepth + 1) {
                const m = allMenus.pop();
                if (m && m.parentNode) m.parentNode.removeChild(m);
            }

            // 如果有子菜单，弹出
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

            // 预览图
            if (item.loraPath) {
                _loadSelectorPreview(item.loraPath, row);
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
            if (item.onClick) item.onClick(item.value);
            if (!item.children || item.children.length === 0) {
                _hideLoraSelector();
            }
        });

        return row;
    }

    // 创建菜单面板
    function makeMenuPanel(items, depth) {
        const panel = document.createElement("div");
        panel.className = "pls-cascade-panel";
        panel.style.cssText = `
            position: fixed;
            z-index: ${99999 + depth};
            background: #2a2a30;
            border: 1px solid #444450;
            border-radius: 6px;
            box-shadow: 0 6px 20px rgba(0,0,0,0.5);
            min-width: 260px;
            max-width: 520px;
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
                const row = makeItemEl(item, panel, depth);
                panel.appendChild(row);
            }
        }

        panel.addEventListener("mouseenter", cancelHide);
        panel.addEventListener("mouseleave", scheduleHide);

        document.body.appendChild(panel);
        return panel;
    }

    // 把 tree 节点转成菜单项数组
    function treeNodeToMenuItems(node, prefix) {
        const items = [];
        // 目录
        for (const child of node.children) {
            const childItems = treeNodeToMenuItems(child, prefix);
            if (childItems.length > 0) {
                items.push({
                    label: child.name,
                    icon: "📁",
                    children: childItems,
                });
            }
        }
        // 文件
        for (const file of node.files) {
            items.push({
                label: file.name,
                icon: "📄",
                loraPath: file.fullPath,
                value: file.fullPath,
                selected: file.fullPath === currentValue,
                onClick: function (val) { onSelect(val); },
            });
        }
        return items;
    }

    // ===== 根菜单（带搜索框） =====
    const rootPanel = document.createElement("div");
    rootPanel.style.cssText = `
        position: fixed;
        z-index: 99999;
        background: #2a2a30;
        border: 1px solid #444450;
        border-radius: 8px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.6);
        width: 300px;
        max-height: ${_menuMaxHeight()}px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        font-family: Arial, sans-serif;
        font-size: ${MENU_FONT_SIZE}px;
        line-height: ${MENU_LINE_HEIGHT};
        color: #ddd;
    `;

    // 标题
    const titleBar = document.createElement("div");
    titleBar.style.cssText = `
        padding: 9px 12px;
        font-weight: 600;
        color: #a78bfa;
        background: #22222a;
        border-bottom: 1px solid #444450;
    `;
    titleBar.textContent = "Select Lora";
    rootPanel.appendChild(titleBar);

    // 搜索框
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

    // 列表区
    const listArea = document.createElement("div");
    listArea.style.cssText = `
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 4px 0;
    `;
    rootPanel.appendChild(listArea);

    // 渲染列表
    function renderList(filter) {
        // 关闭所有子菜单
        while (allMenus.length > 1) {
            const m = allMenus.pop();
            if (m && m.parentNode) m.parentNode.removeChild(m);
        }
        listArea.innerHTML = "";
        const f = (filter || "").toLowerCase();

        if (!f) {
            // 无搜索：树状菜单
            const menuItems = treeNodeToMenuItems(tree, "");
            for (const item of menuItems) {
                listArea.appendChild(makeItemEl(item, rootPanel, 0));
            }
        } else {
            // 有搜索：扁平列表
            const results = [];
            function search(node) {
                for (const file of node.files) {
                    if (file.fullPath.toLowerCase().indexOf(f) >= 0) {
                        results.push({
                            label: file.fullPath,
                            icon: "📄",
                            loraPath: file.fullPath,
                            value: file.fullPath,
                            selected: file.fullPath === currentValue,
                            onClick: function (val) { onSelect(val); },
                        });
                    }
                }
                for (const child of node.children) {
                    search(child);
                }
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

    // 搜索
    searchInput.addEventListener("input", function (e) {
        renderList(e.target.value);
    });

    // 定位
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

    // 点击外部关闭
    function onOutsideDown(e) {
        for (const m of allMenus) {
            if (m && m.contains && m.contains(e.target)) return;
        }
        _hideLoraSelector();
    }
    function onKeyDown(e) {
        if (e.key === "Escape") _hideLoraSelector();
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

function _loadSelectorPreview(loraName, itemEl) {
    // 已经在显示这个 LoRA 的预览，只更新位置
    if (_selectorPreviewLora === loraName && _selectorPreviewUrl) {
        const rect = itemEl.getBoundingClientRect();
        _anchorRect = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
        _positionPreview(rect.right + 8, rect.top);
        return;
    }
    if (_selectorPreviewLoading) return;

    // 切换到新的 LoRA
    _selectorPreviewLora = loraName;
    _selectorPreviewUrl = null;
    _selectorPreviewLoading = true;
    _hidePreview();

    loadLoraPreview(loraName).then(function (url) {
        if (!_selectorMenu || _selectorPreviewLora !== loraName) {
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

function _hideLoraSelector() {
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
    if (_selectorMenuObserver) {
        _selectorMenuObserver.disconnect();
        _selectorMenuObserver = null;
    }
    _selectorPreviewLora = null;
    _selectorPreviewUrl = null;
    _selectorPreviewLoading = false;
    // 菜单关闭后清空鼠标高度 / 悬停行缓存，避免影响 widget 悬停预览
    _pointerY = null;
    _anchorRect = null;
    _hidePreview();
}


// ============================================================
// 注册扩展
// ============================================================

app.registerExtension({
    name: "common-toolbox.power-lora-stack",

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        // ──────────────────────────────────────────────
        // Power Lora Stack
        // ──────────────────────────────────────────────
        if (nodeData.name === "Power Lora Stack") {
            nodeType.prototype.serialize_widgets = true;

            // 节点创建
            nodeType.prototype.onNodeCreated = function () {
                this._loraWidgets = [];
                this._loraCounter = 0;
                // 新建节点标记：为 true 时允许收缩高度到刚好容纳 Add 按钮；
                // 若从工作流加载，onConfigure 会把它置为 false，从而保留用户保存的尺寸
                this._freshNode = true;

                // 删除所有默认 lora_* widgets（完全删除，不隐藏）
                this._cleanDefaultLoraWidgets();

                // 初始状态：只有 Add 按钮
                this._addAddButton();

                // 强制设置初始尺寸（收缩到只容纳 Add 按钮）
                this._fixSize(true);

                // 多次延迟重试（widgets 可能在 onNodeCreated 之后才生成，
                // ComfyUI 也可能基于默认 50 个 lora_* widget 预先算出一个很大的高度）
                const node = this;
                const retryDelays = [0, 10, 50, 100, 200, 500];
                for (const delay of retryDelays) {
                    setTimeout(() => {
                        if (!node.graph) return;
                        node._cleanDefaultLoraWidgets();
                        node._fixSize(!!node._freshNode);
                        node.setDirtyCanvas(true, false);
                    }, delay);
                }

                // 监听画布 mousemove：计算鼠标在节点内的坐标并触发重绘
                this._hoverRafPending = false;
                this._onCanvasMouseMove = function (e) {
                    if (!node.graph) return;
                    const canvasEl = app.canvas?.canvas;
                    if (!canvasEl) return;

                    // 保存屏幕坐标（用于 DOM 预览层定位）
                    node._lastMouseX = e.clientX;
                    node._lastMouseY = e.clientY;

                    // 鼠标在 canvas 上的像素坐标
                    const rect = canvasEl.getBoundingClientRect();
                    const px = e.clientX - rect.left;
                    const py = e.clientY - rect.top;

                    // 用 graph_mouse 计算节点内坐标（LiteGraph 官方 API，最可靠）
                    const canvasGraph = app.canvas;
                    if (canvasGraph && canvasGraph.graph_mouse && node.pos) {
                        node._hoverMouse = [
                            canvasGraph.graph_mouse[0] - node.pos[0],
                            canvasGraph.graph_mouse[1] - node.pos[1],
                        ];
                    } else {
                        node._hoverMouse = null;
                    }

                    // 内容区顶部 y（节点内坐标）= 第一个 LoRA widget 的 y（如果有）
                    // 用于悬停检测：_bounds.name 的 y 是相对于内容区的
                    let contentTopY = 0;
                    const loraWidgets = node._loraWidgets || [];
                    if (loraWidgets.length > 0 && loraWidgets[0]._bounds?.name) {
                        // 第一个 widget 的绝对 y - 索引 0 * 行高 = 内容区顶部
                        // 但我们不知道绝对 y... 用另一种方式：
                        // 悬停检测改用索引计算方式，不用 bounds
                    }

                    // 如果预览图正在显示，跟随鼠标移动更新位置
                    if (_previewVisible) {
                        _positionPreview(e.clientX, e.clientY);
                    }

                    if (node._hoverRafPending) return;
                    node._hoverRafPending = true;
                    requestAnimationFrame(() => {
                        node._hoverRafPending = false;
                        if (node.graph) {
                            node.setDirtyCanvas(true, false);
                        }
                    });
                };
                const canvasEl = app.canvas?.canvas;
                if (canvasEl) {
                    canvasEl.addEventListener("mousemove", this._onCanvasMouseMove);
                }

                // 鼠标离开画布时隐藏预览图
                this._onCanvasMouseLeave = function () {
                    _hidePreview();
                    canvasEl.style.cursor = "";
                    if (node._loraWidgets) {
                        let anyChanged = false;
                        for (const w of node._loraWidgets) {
                            if (w._hover) {
                                w._hover = false;
                                anyChanged = true;
                            }
                        }
                        if (anyChanged && node.graph) {
                            node.setDirtyCanvas(true, false);
                        }
                    }
                };
                if (canvasEl) {
                    canvasEl.addEventListener("mouseleave", this._onCanvasMouseLeave);
                }
            };

            // 节点移除时清理监听
            const origOnRemoved = nodeType.prototype.onRemoved;
            nodeType.prototype.onRemoved = function () {
                if (this._onCanvasMouseMove) {
                    const canvasEl = app.canvas?.canvas;
                    if (canvasEl) {
                        canvasEl.removeEventListener("mousemove", this._onCanvasMouseMove);
                        canvasEl.removeEventListener("mouseleave", this._onCanvasMouseLeave);
                    }
                    this._onCanvasMouseMove = null;
                    this._onCanvasMouseLeave = null;
                }
                _hidePreview();
                _hideRightClickHit();
                _hideSimpleMenu();
                if (origOnRemoved) origOnRemoved.apply(this, arguments);
            };

            // 清理默认 lora_* widgets
            nodeType.prototype._cleanDefaultLoraWidgets = function () {
                if (!this.widgets) return;
                // 从后往前删，避免索引问题
                for (let i = this.widgets.length - 1; i >= 0; i--) {
                    const w = this.widgets[i];
                    if (w.name && w.name.match(/^lora_\d+$/)) {
                        this.widgets.splice(i, 1);
                    }
                }
            };

            // 让节点尺寸精确适配当前内容
            //   宽度：不小于内容最小宽度，保留用户手动加宽
            //   高度：精确等于内容高度（标题 + 端口区 + widgets）
            //         端口显隐、增删 LoRA 后都靠它自适应，
            //         避免端口被隐藏后仍残留旧高度造成的空白
            nodeType.prototype._fitSize = function () {
                const s = this.computeSize();
                let targetH = s[1];
                if (!isFinite(targetH) || targetH < 30) targetH = 30;
                this.size[0] = Math.max(this.size[0] || 280, s[0]);
                this.size[1] = targetH;
                this.setDirtyCanvas(true, true);
            };

            // 兼容旧调用名
            nodeType.prototype._fixSize = function () {
                this._fitSize();
            };

            // 修改 widget / 端口后统一调用 —— 高度精确适配内容
            // 做三轮校准，覆盖 LiteGraph 内部可能的延迟测量
            nodeType.prototype._ensureNoShrink = function () {
                const node = this;
                const apply = () => {
                    if (!node.graph) return;
                    const cs = node.computeSize();
                    let h = cs[1];
                    if (!isFinite(h) || h < 30) h = 30;
                    node.size[0] = Math.max(node.size[0] || 280, cs[0]);
                    node.size[1] = h;
                    node.setDirtyCanvas(true, true);
                };
                apply();
                setTimeout(apply, 0);
                requestAnimationFrame(apply);
            };

            // 添加新 LoRA
            nodeType.prototype._addNewLora = async function (event) {
                if (this._loraCounter >= MAX_LORAS) return;
                const loras = await getLoraList();
                const node = this;

                const clientX = event.clientX || 0;
                const clientY = event.clientY || 0;

                _showLoraSelector(clientX, clientY, loras, null, function (value) {
                    if (!value) return;
                    node._addLoraWidget(value);
                });
            };

            nodeType.prototype._addLoraWidget = function (loraName) {
                if (this._loraCounter >= MAX_LORAS) return;
                this._loraCounter++;

                // 第一个 LoRA 时先加 header
                if (this._loraWidgets.length === 0) {
                    this._addHeader();
                    this._removeAddButton();
                }

                const widget = new PowerLoraRowWidget(this._loraCounter);
                widget.loraData = { on: true, lora: loraName, strength: 1.0 };
                widget._node = this;

                // 插到 Add 按钮之前，保证顺序为 [header, ...rows, addBtn]
                const addIdx = this.widgets.findIndex(w => w.name === "_add_btn");
                if (addIdx >= 0) {
                    this.widgets.splice(addIdx, 0, widget);
                } else {
                    this.widgets.push(widget);
                }

                this._loraWidgets.push(widget);

                if (!this.widgets.find(w => w.name === "_add_btn")) {
                    this._addAddButton();
                }

                // 确保节点不缩小
                this._ensureNoShrink();
            };

            nodeType.prototype._addHeader = function () {
                this.widgets.unshift(new PowerLoraHeaderWidget());
            };

            nodeType.prototype._addAddButton = function () {
                this.widgets.push(new PowerLoraAddButtonWidget());
            };

            nodeType.prototype._removeAddButton = function () {
                const idx = this.widgets.findIndex(w => w.name === "_add_btn");
                if (idx >= 0) this.widgets.splice(idx, 1);
            };

            // 移除 LoRA
            nodeType.prototype._removeLora = function (index) {
                const widget = this._loraWidgets[index];
                if (!widget) return;

                const wIdx = this.widgets.indexOf(widget);
                if (wIdx >= 0) this.widgets.splice(wIdx, 1);

                this._loraWidgets.splice(index, 1);

                if (this._loraWidgets.length === 0) {
                    this.widgets = this.widgets.filter(w =>
                        w.name !== "_header"
                    );
                }

                // 确保节点不缩小
                this._ensureNoShrink();
            };

            // 移动 LoRA
            nodeType.prototype._moveLora = function (fromIdx, toIdx) {
                if (fromIdx === toIdx) return;
                if (fromIdx < 0 || fromIdx >= this._loraWidgets.length) return;
                if (toIdx < 0 || toIdx >= this._loraWidgets.length) return;

                const [widget] = this._loraWidgets.splice(fromIdx, 1);
                this._loraWidgets.splice(toIdx, 0, widget);
                this._rebuildWidgetOrder();
                this._ensureNoShrink();
            };

            // 移动到指定位置（顶部/底部）
            nodeType.prototype._moveLoraTo = function (fromIdx, toIdx) {
                this._moveLora(fromIdx, toIdx);
            };

            nodeType.prototype._rebuildWidgetOrder = function () {
                const header = this.widgets.filter(w => w.name === "_header");
                const others = this.widgets.filter(w =>
                    w.name !== "_header" && w.name !== "_add_btn"
                    && !(w instanceof PowerLoraRowWidget)
                );
                const addBtn = this.widgets.filter(w => w.name === "_add_btn");

                this.widgets = [
                    ...header,
                    ...this._loraWidgets,
                    ...others,
                    ...addBtn,
                ];
            };

            // 从工作流加载
            const origConfigure = nodeType.prototype.configure;
            nodeType.prototype.configure = function (info) {
                this._loraWidgets = [];
                this._loraCounter = 0;
                // 从工作流加载 → 不再收缩尺寸，保留用户保存的节点大小
                this._freshNode = false;

                if (origConfigure) origConfigure.call(this, info);

                // 删除默认 lora_* widgets
                this._cleanDefaultLoraWidgets();

                // 移除之前可能存在的自定义 widgets（避免重复）
                this.widgets = this.widgets.filter(w =>
                    !w.name || !(w.name.startsWith("power_lora_") ||
                                 w.name === "_header" ||
                                 w.name === "_add_btn")
                );

                const tempW = this.size[0];

                // 从 widgets_values 重建自定义 LoRA widgets
                const widgetValues = info.widgets_values || [];
                for (const val of widgetValues) {
                    if (typeof val === "string" && val.startsWith('{"on":')) {
                        try {
                            const data = JSON.parse(val);
                            if (data.lora) {
                                if (this._loraWidgets.length === 0) {
                                    this._addHeader();
                                }
                                this._loraCounter++;
                                const w = new PowerLoraRowWidget(this._loraCounter);
                                w.loraData = data;
                                w._node = this;

                                const addIdx = this.widgets.findIndex(x => x.name === "_add_btn");
                                if (addIdx >= 0) {
                                    this.widgets.splice(addIdx, 0, w);
                                } else {
                                    this.widgets.push(w);
                                }

                                this._loraWidgets.push(w);
                            }
                        } catch (e) {}
                    }
                }

                if (!this.widgets.find(w => w.name === "_add_btn")) {
                    this._addAddButton();
                }

                // 宽度保留用户保存值；高度精确适配当前内容
                // （端口被隐藏后不再残留旧高度，避免底部空白）
                this.size[0] = Math.max(tempW || 0, 280);
                this.size[1] = Math.max(30, this.computeSize()[1]);
                this.setDirtyCanvas(true, true);

                // widgets 重建 / 端口显隐可能需要几帧才稳定，补几轮高度校准
                for (const delay of [16, 50, 120, 300]) {
                    setTimeout(() => {
                        if (!this.graph) return;
                        this._ensureNoShrink();
                    }, delay);
                }
            };

            const _origGetInputPos = nodeType.prototype.getInputPos;
            if (_origGetInputPos) {
                nodeType.prototype.getInputPos = function (index) {
                    return _origGetInputPos.call(
                        this, _compactSlotRow(this.inputs, index, HIDDEN_INPUT_PORTS)
                    );
                };
            }
            const _origGetOutputPos = nodeType.prototype.getOutputPos;
            if (_origGetOutputPos) {
                nodeType.prototype.getOutputPos = function (index) {
                    return _origGetOutputPos.call(
                        this, _compactSlotRow(this.outputs, index, HIDDEN_OUTPUT_PORTS)
                    );
                };
            }

            // ② 端口绘制：把隐藏端口的 draw 替换成空函数
            //    （_setConcreteSlots 每帧都会重建端口对象，所以在这里挂钩最稳）
            const _origSetConcreteSlots = nodeType.prototype._setConcreteSlots;
            if (_origSetConcreteSlots) {
                nodeType.prototype._setConcreteSlots = function () {
                    _origSetConcreteSlots.apply(this, arguments);
                    const neutralize = (slots, names) => {
                        if (!slots) return;
                        for (const s of slots) {
                            if (names.indexOf(s.name) >= 0) {
                                s.draw = function () {};
                            }
                        }
                    };
                    neutralize(this._concreteInputs, HIDDEN_INPUT_PORTS);
                    neutralize(this._concreteOutputs, HIDDEN_OUTPUT_PORTS);
                };
            }

            // 计算尺寸：只返回节点"体"高度（不含标题栏，与 size[1] 语义一致）
            // 内部已按"实际可见端口数"计算端口区高度 —— 隐藏 model/clip 后只剩 1 行，
            // 所以高度会自动收缩，不会残留 3 行端口的旧尺寸。
            nodeType.prototype.computeSize = function () {
                return [220, _contentBodyHeight(this, HIDDEN_INPUT_PORTS, HIDDEN_OUTPUT_PORTS)];
            };

            // ── 高度自校正 ──
            // 工作流加载时 node.graph 可能还没就绪，定时器会被跳过；
            // 且 LiteGraph 内部可能用旧的高度覆盖 size[1]。
            // 这里挂在 arrange() 上（每帧绘制前都会调用），
            // 只要高度与内容不符就立即修正 —— 不依赖任何加载时序。
            const _origArrange = nodeType.prototype.arrange;
            nodeType.prototype.arrange = function () {
                const wantH = this.computeSize()[1];
                if (isFinite(wantH) && wantH >= 30 && Math.abs((this.size[1] || 0) - wantH) > 0.5) {
                    this.size[1] = wantH;
                    // 本帧背景已按旧高度绘制，标记 dirty 让下一帧用新高度重画。
                    // 修正后不再有偏差 → 不会循环重绘。
                    this.setDirtyCanvas(true, false);
                }
                return _origArrange ? _origArrange.apply(this, arguments) : undefined;
            };
        }

        // ──────────────────────────────────────────────
        // Load Lora Stack
        // ──────────────────────────────────────────────
        if (nodeData.name === "Load Lora Stack") {
            const origOnNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                if (origOnNodeCreated) origOnNodeCreated.apply(this, arguments);
                const node = this;
                node._freshNode = true;

                // 用自定义按钮 widget 原地替换原生 unload_trigger 数字输入框
                // （原地替换 = 名称/索引不变 → 序列化与 prompt 参数完全兼容）
                const setup = () => {
                    if (!node.widgets) return;
                    const idx = node.widgets.findIndex(w => w.name === "unload_trigger");
                    if (idx < 0) return;
                    const orig = node.widgets[idx];
                    if (orig instanceof UnloadButtonWidget) return;

                    const btn = new UnloadButtonWidget(node);
                    btn.value = parseInt(orig.value) || 0;
                    node.widgets.splice(idx, 1, btn);
                    node.setDirtyCanvas(true, true);
                };

                // widget 可能在 onNodeCreated 之后才生成，多轮重试
                for (const delay of [0, 10, 50, 100, 200, 500]) {
                    setTimeout(() => {
                        if (!node.graph) return;
                        setup();
                        node._fitBodySize();
                    }, delay);
                }
            };

            // 从工作流加载 → 重置标记后做一次精确适配
            const origConfigureLls = nodeType.prototype.configure;
            nodeType.prototype.configure = function (info) {
                this._freshNode = false;
                if (origConfigureLls) origConfigureLls.call(this, info);
                const node = this;
                for (const delay of [16, 50, 120, 300]) {
                    setTimeout(() => {
                        if (!node.graph) return;
                        node._fitBodySize();
                    }, delay);
                }
            };

            // 让节点体高度精确适配内容（不含标题栏，与 size[1] 语义一致）
            nodeType.prototype._fitBodySize = function () {
                const h = _contentBodyHeight(this);
                this.size[0] = Math.max(this.size[0] || 240, 240);
                this.size[1] = Math.max(30, h);
                this.setDirtyCanvas(true, true);
            };

            // 计算尺寸：只返回节点"体"高度（不含标题栏）
            nodeType.prototype.computeSize = function () {
                return [240, _contentBodyHeight(this)];
            };

            // ── 高度自校正 ──
            // 不依赖加载时序：每帧绘制前 arrange() 都会调用，
            // 一旦高度与内容不符立即修正（旧节点打开后自动收敛）
            const _origArrangeLls = nodeType.prototype.arrange;
            nodeType.prototype.arrange = function () {
                const wantH = this.computeSize()[1];
                if (isFinite(wantH) && wantH >= 30 && Math.abs((this.size[1] || 0) - wantH) > 0.5) {
                    this.size[1] = wantH;
                    this.setDirtyCanvas(true, false);
                }
                return _origArrangeLls ? _origArrangeLls.apply(this, arguments) : undefined;
            };
        }
    },

    refreshComboInNode(defs) {
        refreshLoraList();
    }
});
