
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

function _clog(...a) {
    try { if (localStorage.getItem("comp_crop_debug") === "1") console.log("[SeedTime]", ...a); } catch (_) {}
}

const MULTI_TYPES = [
    "STRING", "INT", "FLOAT", "BOOLEAN",
    "IMAGE", "LATENT", "MASK",
    "MODEL", "CLIP", "VAE", "CONDITIONING"
];

function findWidget(node, name) {
    for (const w of node.widgets || []) { if (w.name === name) return w; }
    return null;
}

const _seedNodes = new Map();
function registerSeedNode(node) { _seedNodes.set(node.id, node); }
function unregisterSeedNode(node) { _seedNodes.delete(node.id); }

function updateSeedDisplay(node, seed) {
    const s = String(seed);
    const seedW = findWidget(node, "seed_display");
    if (seedW && seedW.value !== s) {
        seedW.value = s;
        seedW.callback?.(s);
        node.setDirtyCanvas?.(true, true);
        // 强制下一帧重绘
        requestAnimationFrame(() => {
            node.setDirtyCanvas?.(true, true);
        });
        _clog("seed 显示更新:", s);
    }
}

// ── 监听 executed 事件 ──
api.addEventListener("executed", (e) => {
    const d = e?.detail;
    if (!d) return;
    const nodeId = d.node;
    const node = _seedNodes.get(nodeId);
    if (!node) return;
    // 从 ui.values 获取 seed_display
    const vals = d?.ui?.values || d?.output?.ui?.values;
    if (vals && vals.seed_display !== undefined) {
        updateSeedDisplay(node, vals.seed_display);
    }
});

// ── 轮询 API (备用) ──
let _pollTimer = null;
let _lastPollSeed = "";
function startPolling() {
    if (_pollTimer) return;
    _pollTimer = setInterval(async () => {
        if (_seedNodes.size === 0) return;
        try {
            const resp = await fetch("/seed_time/last");
            const data = await resp.json();
            const seedStr = String(data.seed);
            if (seedStr !== _lastPollSeed) {
                _lastPollSeed = seedStr;
                for (const [, node] of _seedNodes) {
                    updateSeedDisplay(node, seedStr);
                }
            }
        } catch (e) { /* 静默 */ }
    }, 300);
}
startPolling();

app.registerExtension({
    name: "CommonToolbox.SeedTime",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "Seed Time") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const node = this;
            onNodeCreated?.apply(this, arguments);

            // 新增 seed_display widget
            if (!findWidget(node, "seed_display")) {
                node.addWidget(
                    "text",
                    "seed_display",
                    "0",
                    () => {},
                    { serialize: false }
                );
            }

            node.setSize?.([280, 120]);
            registerSeedNode(node);

            // ── onExecuted: 节点执行完成后更新 seed_display ──
            const origOnExecuted = node.onExecuted;
            node.onExecuted = function (result) {
                origOnExecuted?.apply(this, arguments);
                console.log("[SeedTime] onExecuted:", JSON.stringify(result)?.substring(0, 300));
                // 尝试多种路径获取 seed_display
                const vals = result?.ui?.values || result?.output?.ui?.values;
                if (vals && vals.seed_display !== undefined) {
                    updateSeedDisplay(node, vals.seed_display);
                } else {
                    // 尝试直接从 output 获取
                    const seedVal = result?.output?.[0] ?? result?.output?.seed;
                    if (seedVal !== undefined) {
                        updateSeedDisplay(node, seedVal);
                    }
                }
            };

            let attempts = 0;
            function tryBind() {
                attempts++;
                const triggerW = findWidget(node, "trigger");
                if (!triggerW) {
                    if (attempts < 10) setTimeout(tryBind, 50 + attempts * 50);
                    return;
                }
                if (node._seedTimeBound) return;
                node._seedTimeBound = true;

                let trigInput = (node.inputs || []).find(i => i.name === "trigger");
                if (trigInput) {
                    trigInput.type = MULTI_TYPES;
                } else if (node.addInput) {
                    node.addInput("trigger", MULTI_TYPES);
                    const ni = node.inputs[node.inputs.length - 1];
                    ni.widget = { name: "trigger" };
                }

                const origTrig = triggerW.callback;
                triggerW.callback = function (v) {
                    node.setDirtyCanvas?.(true, true);
                    origTrig?.apply(this, arguments);
                };

                const origOnConn = node.onConnectionsChange;
                node.onConnectionsChange = function (side, slot, connected, linkInfo) {
                    origOnConn?.apply(this, arguments);
                    if (side === 1) {
                        const inp = node.inputs?.[slot];
                        if (inp?.name === "trigger") node.setDirtyCanvas?.(true, true);
                    }
                };

                _clog("绑定完成");
            }
            setTimeout(tryBind, 50);

            const origOnRemoved = node.onRemoved;
            node.onRemoved = function () {
                unregisterSeedNode(node);
                origOnRemoved?.apply(this, arguments);
            };
        };
    },
});
