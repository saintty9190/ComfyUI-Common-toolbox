import { app } from "../../scripts/app.js";



const ROW_HEIGHT = 16;
const HEADER_HEIGHT = 18;
const ADD_BTN_HEIGHT = 24;
const MARGIN = 6;
const WIDGET_SPACING = 4;
const MAX_LORAS = 50;
const PREVIEW_MAX_SIZE = 250;
const PREVIEW_OFFSET = 16;

const HIDDEN_INPUT_PORTS = ["model", "clip"];
const HIDDEN_OUTPUT_PORTS = ["model", "clip"];

const LORA_NAME_FONT_PX = 11;

let MENU_FONT_SIZE = 15;
let MENU_FONT_SIZE_SMALL = 13;
const MENU_LINE_HEIGHT = 1.45;

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
    const isWidgetSlot = (s) => !!(s && s.widget && hasWidgets);

    const nIn = (node.inputs || []).filter(
        (s) => s && !s.pos && !isWidgetSlot(s) && hidIn.indexOf(s.name) < 0
    ).length;
    const nOut = (node.outputs || []).filter(
        (s) => s && !s.pos && hidOut.indexOf(s.name) < 0
    ).length;
    const rows = Math.max(nIn, nOut);

    let h = 0;
    if (rows > 0) {
        h = (rows - 1 + 0.7) * slotH + slotH / 2;
    }
    h += 2;

    for (const w of widgets) {
        if (!w || w.type === "hidden") continue;
        let wh = widgetH;
        if (w.computeSize) {
            const r = w.computeSize(minW);
            if (r && isFinite(r[1])) wh = r[1];
        }
        h += wh + 4;
    }

    h += 6;
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

function _hiddenSlotYOffset() {
    const LG = typeof LiteGraph !== "undefined" ? LiteGraph : {};
    return (LG.NODE_TITLE_HEIGHT || 30) + (LG.NODE_SLOT_HEIGHT || 20) + 20;
}

function _shiftHiddenSlot(list, index, hiddenNames, pos) {
    if (!pos || !list || !list[index]) return pos;
    if (hiddenNames.indexOf(list[index].name) < 0) return pos;
    return [pos[0], pos[1] - _hiddenSlotYOffset()];
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
    }
    return [];
}

function refreshLoraList() {
    _loraListCache = null;
}

function loadLoraPreview(loraName) {
    return new Promise((resolve) => {
        if (!loraName || loraName === "None") {
            resolve(null);
            return;
        }
        const url = `/common-toolbox/lora_preview?name=${encodeURIComponent(loraName)}`;
        const img = new Image();
        img.onload = () => resolve(url);
        img.onerror = () => resolve(null);
        img.src = url;
    });
}



class PowerLoraRowWidget {
    constructor(index) {
        this.type = "custom";
        this.name = `power_lora_${index}`;
        this.serialize = false;
        this.options = { serialize: false };
        this.index = index;
        this._value = { on: true, lora: "", strength: 1.0 };
        this._adjusting = null;
        this._hover = false;
        this._previewImg = null;
        this._previewLoading = false;
        this._previewLoaded = false;

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

        const nameX = tx + tw + 6;
        const strW = 50;
        const nameMaxW = w - (tw + 6) - strW - 6;
        this._bounds.name = [nameX, y, Math.max(nameMaxW, 30), ROW_HEIGHT];

        if (node && ctx.getTransform) {
            node._ctxTransform = ctx.getTransform();
        }
        _updateCanvasCssScale(ctx);

        const selectorOpen = !!_selectorMenu;
        if (this._value.lora && node && node._hoverMouse && !selectorOpen) {
            const mx = node._hoverMouse[0];
            const my = node._hoverMouse[1];
            const wasHover = this._hover;
            this._hover = pointInRect(mx, my, this._bounds.name);
            if (this._hover && !wasHover) {
                this.ensurePreview(node);
            }
            if (wasHover !== this._hover) {
                if (!this._hover) {
                    _hidePreview();
                    _hideRightClickHit();
                }
                node.setDirtyCanvas(true, false);
            }

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

        ctx.fillStyle = this._hover ? "#7c3aed" : LiteGraph.WIDGET_TEXT_COLOR;
        ctx.font = "11px sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        const displayName = (this._value.lora || "None").split("/").pop()
            .replace(/\.(safetensors|pt|pth|ckpt|bin)$/i, "");
        ctx.fillText(fitString(ctx, displayName, nameMaxW), nameX, midY);

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
                if (node && typeof node._syncBackendWidgets === "function") node._syncBackendWidgets();
                node.setDirtyCanvas(true, true);
                return true;
            }
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
            if (this._adjusting) {
                this._adjusting = null;
                if (node && typeof node._syncBackendWidgets === "function") node._syncBackendWidgets();
            }
            return true;
        }

        return false;
    }

    _promptStrength(event, node) {
        const canvas = app.canvas;
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
            if (v === null || v === undefined || v === "") return;
            const num = parseFloat(v);
            if (!isFinite(num)) return;
            widget._value.strength = Math.max(-10, Math.min(10, Math.round(num * 100) / 100));
            if (node && typeof node._syncBackendWidgets === "function") node._syncBackendWidgets();
            node.setDirtyCanvas(true, true);
        }, event);
    }

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

    _showRightClickMenu(event, node) {
        _hidePreview();
        this._hover = false;

        const list = node._loraWidgets || [];
        const idx = list.indexOf(this);
        if (idx < 0) return;

        const total = list.length;
        const canMoveUp = idx > 0;
        const canMoveDown = idx < total - 1;
        const row = this;

        const items = [
            {
                label: (row._value.on ? "⚫  Disable" : "🟢  Enable"),
                onClick: function () {
                    row._value.on = !row._value.on;
                    if (node && typeof node._syncBackendWidgets === "function") node._syncBackendWidgets();
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
            if (node && typeof node._syncBackendWidgets === "function") node._syncBackendWidgets();
            node.setDirtyCanvas(true, true);
        });
    }

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



class PowerLoraHeaderWidget {
    constructor() {
        this.type = "custom";
        this.name = "_header";
        this.serialize = false;
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

        ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR;
        ctx.globalAlpha = 0.6;
        ctx.font = "11px sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText("All", tx + tw + 6, midY);
        ctx.globalAlpha = 1;

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
            if (node && typeof node._syncBackendWidgets === "function") node._syncBackendWidgets();
            node.setDirtyCanvas(true, true);
            return true;
        }
        return false;
    }
}



class PowerLoraAddButtonWidget {
    constructor() {
        this.type = "custom";
        this.name = "_add_btn";
        this.serialize = false;
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



class UnloadButtonWidget {
    constructor(node) {
        this.type = "custom";
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



let _previewEl = null;
let _previewVisible = false;
let _lastMouseX = 0;
let _lastMouseY = 0;
let _pointerY = null;
let _anchorRect = null;
let _previewReposRaf = 0;

function _schedulePreviewReposition() {
    if (!_previewVisible) return;
    if (_previewReposRaf) return;
    _previewReposRaf = requestAnimationFrame(function () {
        _previewReposRaf = 0;
        _positionPreview(_lastMouseX, _lastMouseY);
    });
}

let _rightClickHitEl = null;
let _rightClickWidget = null;
let _rightClickNode = null;

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
    _rightClickHitEl.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (_rightClickWidget && _rightClickNode) {
            _rightClickWidget._showRightClickMenu(e, _rightClickNode);
        }
    });
    _rightClickHitEl.addEventListener("mousedown", function (e) {
        if (e.button !== 0) return;
        e.stopPropagation();
        if (_rightClickWidget && _rightClickNode) {
            _rightClickWidget._showChooser(e, _rightClickNode);
        }
    });
    _rightClickHitEl.addEventListener("mousemove", function (e) {
        const canvasEl = app.canvas?.canvas;
        if (!canvasEl) return;
        const evt = new MouseEvent("mousemove", {
            clientX: e.clientX,
            clientY: e.clientY,
            bubbles: true,
            cancelable: true,
        });
        canvasEl.dispatchEvent(evt);
    });
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
    const PAD = 8;
    const GAP = 10;
    const safeL = PAD + GAP;
    const safeR = vw - PAD - GAP;

    const obstacles = _visibleMenuRects();

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

    const pointerY =
        (typeof _pointerY === "number" && isFinite(_pointerY)) ? _pointerY : anchorY;
    const centeredY = pointerY - h / 2;

    let ux1 = Infinity, uy1 = Infinity, ux2 = -Infinity, uy2 = -Infinity;
    for (const r of obstacles) {
        if (r.x < ux1) ux1 = r.x;
        if (r.y < uy1) uy1 = r.y;
        if (r.x + r.w > ux2) ux2 = r.x + r.w;
        if (r.y + r.h > uy2) uy2 = r.y + r.h;
    }

    const cands = [
        { x: ux2 + GAP, y: centeredY },
        { x: ux1 - GAP - w, y: centeredY },
        { x: ux2 + GAP, y: anchorY },
        { x: ux1 - GAP - w, y: anchorY },
        { x: anchorX, y: uy2 + GAP },
        { x: anchorX, y: uy1 - GAP - h },
        { x: ux2 + GAP, y: uy1 },
        { x: ux1 - GAP - w, y: uy1 },
        { x: ux2 + GAP, y: uy2 - h },
        { x: ux1 - GAP - w, y: uy2 - h },
        { x: anchorX + PREVIEW_OFFSET, y: anchorY + PREVIEW_OFFSET },
        { x: anchorX - PREVIEW_OFFSET - w, y: anchorY + PREVIEW_OFFSET },
        { x: anchorX + PREVIEW_OFFSET, y: anchorY - PREVIEW_OFFSET - h },
        { x: anchorX - PREVIEW_OFFSET - w, y: anchorY - PREVIEW_OFFSET - h },
    ];

    let best = null;
    let bestScore = Infinity;
    for (let i = 0; i < cands.length; i++) {
        const x = Math.max(PAD, Math.min(cands[i].x, vw - PAD - w));
        const y = Math.max(PAD, Math.min(cands[i].y, vh - PAD - h));

        const squeezeX =
            Math.max(0, safeL - cands[i].x) + Math.max(0, cands[i].x + w - safeR);

        const box = { x: x, y: y, w: w, h: h };
        let overlap = 0;
        for (const r of obstacles) overlap += _rectOverlapArea(box, r);
        const devY = Math.abs(y + h / 2 - pointerY);

        let devX;
        if (_anchorRect) {
            devX = Math.max(0, _anchorRect.left - (x + w), x - _anchorRect.right);
        } else {
            devX = Math.abs(x - anchorX);
        }
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
        if (!lora) continue;
        if (lora.toLowerCase() === "none") continue;

        const parts = lora.split(/[\\/]/);
        let current = root;
        let currentPath = "";

        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (!part) continue;
            currentPath = currentPath ? currentPath + "/" + part : part;
            let child = current.children.find(function (c) { return c.name === part; });
            if (!child) {
                child = { name: part, children: [], files: [], isFolder: true, expanded: false, path: currentPath };
                current.children.push(child);
            }
            current = child;
        }

        const fileName = parts[parts.length - 1];
        if (!fileName || fileName.toLowerCase() === "none") continue;
        current.files.push({ name: fileName, fullPath: lora });
    }

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

let _simpleMenu = null;

function _showSimpleMenu(clientX, clientY, items) {
    _hideSimpleMenu();
    _hideLoraSelector();
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
            if (e && typeof e.clientY === "number") _pointerY = e.clientY;
            row.style.background = selected ? "#3b2a5c" : "#35353d";

            const myDepth = allMenus.indexOf(parentPanel);
            while (allMenus.length > myDepth + 1) {
                const m = allMenus.pop();
                if (m && m.parentNode) m.parentNode.removeChild(m);
            }

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

            if (item.loraPath) {
                _loadSelectorPreview(item.loraPath, row);
            }
        });

        row.addEventListener("mousemove", function (e) {
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

    function treeNodeToMenuItems(node, prefix) {
        const items = [];
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
            const menuItems = treeNodeToMenuItems(tree, "");
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
    if (_selectorPreviewLora === loraName && _selectorPreviewUrl) {
        const rect = itemEl.getBoundingClientRect();
        _anchorRect = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
        _positionPreview(rect.right + 8, rect.top);
        return;
    }
    if (_selectorPreviewLoading) return;

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
    _pointerY = null;
    _anchorRect = null;
    _hidePreview();
}



app.registerExtension({
    name: "common-toolbox.power-lora-stack",

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "Power Lora Stack") {
            nodeType.prototype.serialize_widgets = true;

            nodeType.prototype.onNodeCreated = function () {
                this._loraWidgets = [];
                this._loraCounter = 0;
                this._freshNode = true;

                this._prepareShadowWidgets();

                this._addAddButton();

                this._fixSize(true);

                const node = this;
                const retryDelays = [0, 10, 50, 100, 200, 500];
                for (const delay of retryDelays) {
                    setTimeout(() => {
                        if (!node.graph) return;
                        node._prepareShadowWidgets();
                        node._fixSize(!!node._freshNode);
                        node.setDirtyCanvas(true, false);
                    }, delay);
                }

                this._hoverRafPending = false;
                this._onCanvasMouseMove = function (e) {
                    if (!node.graph) return;
                    const canvasEl = app.canvas?.canvas;
                    if (!canvasEl) return;

                    node._lastMouseX = e.clientX;
                    node._lastMouseY = e.clientY;

                    const rect = canvasEl.getBoundingClientRect();
                    const px = e.clientX - rect.left;
                    const py = e.clientY - rect.top;

                    const canvasGraph = app.canvas;
                    if (canvasGraph && canvasGraph.graph_mouse && node.pos) {
                        node._hoverMouse = [
                            canvasGraph.graph_mouse[0] - node.pos[0],
                            canvasGraph.graph_mouse[1] - node.pos[1],
                        ];
                    } else {
                        node._hoverMouse = null;
                    }

                    let contentTopY = 0;
                    const loraWidgets = node._loraWidgets || [];
                    if (loraWidgets.length > 0 && loraWidgets[0]._bounds?.name) {
                    }

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

            nodeType.prototype._prepareShadowWidgets = function () {
                if (!this.widgets) return;
                const shadows = [];
                const rest = [];
                for (const w of this.widgets) {
                    if (w.name && w.name.match(/^lora_\d+$/)) {
                        w.type = "hidden";
                        w.draw = function () {};
                        w.computeSize = function () { return [0, -4]; };
                        w.mouse = function () { return false; };
                        w.compute = function () {};
                        shadows.push(w);
                    } else {
                        rest.push(w);
                    }
                }
                shadows.sort((a, b) => {
                    const na = parseInt(a.name.slice(5), 10);
                    const nb = parseInt(b.name.slice(5), 10);
                    return na - nb;
                });
                this.widgets = [...rest, ...shadows];
            };

            nodeType.prototype._syncBackendWidgets = function () {
                const rows = this._loraWidgets || [];
                for (let i = 1; i <= MAX_LORAS; i++) {
                    const shadow = this.widgets.find(w => w.name === `lora_${i}`);
                    if (!shadow) continue;
                    const row = rows[i - 1];
                    if (row && row._value && row._value.lora && row._value.lora !== "None") {
                        shadow.value = JSON.stringify(row._value);
                    } else {
                        shadow.value = "";
                    }
                }
            };

            nodeType.prototype._fitSize = function () {
                const s = this.computeSize();
                let targetH = s[1];
                if (!isFinite(targetH) || targetH < 30) targetH = 30;
                this.size[0] = Math.max(this.size[0] || 280, s[0]);
                this.size[1] = targetH;
                this.setDirtyCanvas(true, true);
            };

            nodeType.prototype._fixSize = function () {
                this._fitSize();
            };

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

                if (this._loraWidgets.length === 0) {
                    this._addHeader();
                    this._removeAddButton();
                }

                const widget = new PowerLoraRowWidget(this._loraCounter);
                widget.loraData = { on: true, lora: loraName, strength: 1.0 };
                widget._node = this;

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

                this._syncBackendWidgets();
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

                this._syncBackendWidgets();
                this._ensureNoShrink();
            };

            nodeType.prototype._moveLora = function (fromIdx, toIdx) {
                if (fromIdx === toIdx) return;
                if (fromIdx < 0 || fromIdx >= this._loraWidgets.length) return;
                if (toIdx < 0 || toIdx >= this._loraWidgets.length) return;

                const [widget] = this._loraWidgets.splice(fromIdx, 1);
                this._loraWidgets.splice(toIdx, 0, widget);
                this._rebuildWidgetOrder();
                this._syncBackendWidgets();
                this._ensureNoShrink();
            };

            nodeType.prototype._moveLoraTo = function (fromIdx, toIdx) {
                this._moveLora(fromIdx, toIdx);
            };

            nodeType.prototype._rebuildWidgetOrder = function () {
                const header = this.widgets.filter(w => w.name === "_header");
                const addBtn = this.widgets.filter(w => w.name === "_add_btn");
                const shadows = this.widgets.filter(w =>
                    w.name && w.name.match(/^lora_\d+$/)
                ).sort((a, b) => {
                    const na = parseInt(a.name.slice(5), 10);
                    const nb = parseInt(b.name.slice(5), 10);
                    return na - nb;
                });
                const others = this.widgets.filter(w =>
                    w.name !== "_header" && w.name !== "_add_btn"
                    && !(w instanceof PowerLoraRowWidget)
                    && !(w.name && w.name.match(/^lora_\d+$/))
                );

                this.widgets = [
                    ...header,
                    ...this._loraWidgets,
                    ...others,
                    ...addBtn,
                    ...shadows,
                ];
            };

            const origConfigure = nodeType.prototype.configure;
            nodeType.prototype.configure = function (info) {
                this._loraWidgets = [];
                this._loraCounter = 0;
                this._freshNode = false;

                if (origConfigure) origConfigure.call(this, info);

                this._prepareShadowWidgets();

                this.widgets = this.widgets.filter(w =>
                    !w.name || !(w.name.startsWith("power_lora_") ||
                                 w.name === "_header" ||
                                 w.name === "_add_btn")
                );

                const tempW = this.size[0];

                let rebuiltFromShadows = 0;
                for (let i = 1; i <= MAX_LORAS; i++) {
                    const sh = this.widgets.find(w => w.name === `lora_${i}`);
                    const val = sh?.value;
                    if (!val || typeof val !== "string" || !val.trim()) continue;
                    try {
                        const data = JSON.parse(val);
                        if (data && typeof data === "object" && data.lora) {
                            if (this._loraWidgets.length === 0) this._addHeader();
                            this._loraCounter++;
                            const w = new PowerLoraRowWidget(this._loraCounter);
                            w.loraData = data;
                            w._node = this;
                            const addIdx = this.widgets.findIndex(x => x.name === "_add_btn");
                            if (addIdx >= 0) this.widgets.splice(addIdx, 0, w);
                            else this.widgets.push(w);
                            this._loraWidgets.push(w);
                            rebuiltFromShadows++;
                        }
                    } catch (e) {}
                }

                if (rebuiltFromShadows === 0) {
                    const widgetValues = info.widgets_values || [];
                    for (const val of widgetValues) {
                        if (typeof val === "string" && val.startsWith('{"on":')) {
                            try {
                                const data = JSON.parse(val);
                                if (data.lora) {
                                    if (this._loraWidgets.length === 0) this._addHeader();
                                    this._loraCounter++;
                                    const w = new PowerLoraRowWidget(this._loraCounter);
                                    w.loraData = data;
                                    w._node = this;
                                    const addIdx = this.widgets.findIndex(x => x.name === "_add_btn");
                                    if (addIdx >= 0) this.widgets.splice(addIdx, 0, w);
                                    else this.widgets.push(w);
                                    this._loraWidgets.push(w);
                                }
                            } catch (e) {}
                        }
                    }
                }

                if (!this.widgets.find(w => w.name === "_add_btn")) {
                    this._addAddButton();
                }

                this._syncBackendWidgets();
                this._rebuildWidgetOrder();

                this.size[0] = Math.max(tempW || 0, 280);
                this.size[1] = Math.max(30, this.computeSize()[1]);
                this.setDirtyCanvas(true, true);

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
                    const pos = _origGetInputPos.call(
                        this, _compactSlotRow(this.inputs, index, HIDDEN_INPUT_PORTS)
                    );
                    return _shiftHiddenSlot(this.inputs, index, HIDDEN_INPUT_PORTS, pos);
                };
            }
            const _origGetOutputPos = nodeType.prototype.getOutputPos;
            if (_origGetOutputPos) {
                nodeType.prototype.getOutputPos = function (index) {
                    const pos = _origGetOutputPos.call(
                        this, _compactSlotRow(this.outputs, index, HIDDEN_OUTPUT_PORTS)
                    );
                    return _shiftHiddenSlot(this.outputs, index, HIDDEN_OUTPUT_PORTS, pos);
                };
            }

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

            nodeType.prototype.computeSize = function () {
                return [220, _contentBodyHeight(this, HIDDEN_INPUT_PORTS, HIDDEN_OUTPUT_PORTS)];
            };

            const _origArrange = nodeType.prototype.arrange;
            nodeType.prototype.arrange = function () {
                const wantH = this.computeSize()[1];
                if (isFinite(wantH) && wantH >= 30 && Math.abs((this.size[1] || 0) - wantH) > 0.5) {
                    this.size[1] = wantH;
                    this.setDirtyCanvas(true, false);
                }
                return _origArrange ? _origArrange.apply(this, arguments) : undefined;
            };
        }

        if (nodeData.name === "Load Lora Stack") {
            const origOnNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                if (origOnNodeCreated) origOnNodeCreated.apply(this, arguments);
                const node = this;
                node._freshNode = true;

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

                for (const delay of [0, 10, 50, 100, 200, 500]) {
                    setTimeout(() => {
                        if (!node.graph) return;
                        setup();
                        node._fitBodySize();
                    }, delay);
                }
            };

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

            nodeType.prototype._fitBodySize = function () {
                const h = _contentBodyHeight(this);
                this.size[0] = Math.max(this.size[0] || 240, 240);
                this.size[1] = Math.max(30, h);
                this.setDirtyCanvas(true, true);
            };

            nodeType.prototype.computeSize = function () {
                return [240, _contentBodyHeight(this)];
            };

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
