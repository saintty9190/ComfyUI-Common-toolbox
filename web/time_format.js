
import { app } from "../../scripts/app.js";

const MULTI_TYPES = [
    "STRING", "INT", "FLOAT", "BOOLEAN",
    "IMAGE", "LATENT", "MASK",
    "MODEL", "CLIP", "VAE", "CONDITIONING"
];

function _clog(...args) {
    try {
        if (localStorage.getItem("comp_crop_debug") === "1") {
            console.log("[TimeFormat]", ...args);
        }
    } catch (_) {}
}

function findWidget(node, name) {
    for (const w of node.widgets || []) {
        if (w.name === name) return w;
    }
    return null;
}

function parseValue(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "number" && !isNaN(value)) return value;
    let s = String(value).trim();
    if (!s) return null;
    let n = parseFloat(s);
    if (!isNaN(n)) return n;
    n = parseFloat(s.replace(/,/g, ""));
    if (!isNaN(n)) return n;
    const m = s.match(/-?\d+\.?\d*/);
    if (m) { n = parseFloat(m[0]); if (!isNaN(n)) return n; }
    return null;
}

app.registerExtension({
    name: "CommonToolbox.TimeFormat",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "Time Format") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const node = this;
            onNodeCreated?.apply(this, arguments);

            let attempts = 0;
            function tryBind() {
                attempts++;
                const triggerW = findWidget(node, "trigger");
                if (!triggerW) {
                    if (attempts < 10) setTimeout(tryBind, 50 + attempts * 50);
                    return;
                }

                if (node._tfBound) return;
                node._tfBound = true;

                // ── 扩展 trigger input slot 为多类型 ──
                let trigInput = (node.inputs || []).find(i => i.name === "trigger");
                if (trigInput) {
                    trigInput.type = MULTI_TYPES;
                } else if (node.addInput) {
                    node.addInput("trigger", MULTI_TYPES);
                    const ni = node.inputs[node.inputs.length - 1];
                    if (ni) ni.widget = { name: "trigger" };
                }

                // ── trigger 变化 → 标记 dirty, 触发重算 ──
                let lastParsed = parseValue(triggerW.value);
                const origCb = triggerW.callback;
                triggerW.callback = function (v) {
                    const parsed = parseValue(v);
                    _clog(`trigger: "${v}" → ${parsed}`);
                    if (parsed !== null && parsed !== lastParsed) {
                        lastParsed = parsed;
                        node.setDirtyCanvas(true, true);
                        _clog("节点已标记 dirty");
                    }
                    origCb?.apply(this, arguments);
                };

                // ── 连接变化时也触发 ──
                const origConn = node.onConnectionsChange;
                node.onConnectionsChange = function (side, slot, connected, linkInfo) {
                    origConn?.apply(this, arguments);
                    if (side === 1) {
                        const input = node.inputs?.[slot];
                        if (input?.name === "trigger" && connected) {
                            setTimeout(() => {
                                node.setDirtyCanvas(true, true);
                                _clog("trigger 已连接, 标记 dirty");
                            }, 50);
                        }
                    }
                };

                _clog("绑定完成", { trigger: triggerW.value });
            }

            setTimeout(tryBind, 50);
        };
    },
});
