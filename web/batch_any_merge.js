import { app } from "../../scripts/app.js";


function setupDynamicInputs(node, { prefix, countWidget = "inputcount", type = "*" } = {}) {
    const rebuild = () => {
        if (!node.inputs) node.inputs = [];

        const countW = node.widgets?.find(w => w.name === countWidget);
        if (!countW) return;

        const target = countW.value;
        const current = node.inputs.filter(i => i.name?.startsWith(prefix)).length;

        if (target === current) return;

        let firstPrefixIndex = node.inputs.findIndex(i => i.name?.startsWith(prefix));
        if (firstPrefixIndex < 0) firstPrefixIndex = 0;

        if (target < current) {
            for (let i = 0; i < current - target; i++) {
                let lastIdx = -1;
                for (let j = node.inputs.length - 1; j >= 0; j--) {
                    if (node.inputs[j].name?.startsWith(prefix)) {
                        lastIdx = j;
                        break;
                    }
                }
                if (lastIdx >= 0) {
                    node.removeInput(lastIdx);
                }
            }
        } else {
            for (let i = current + 1; i <= target; i++) {
                let lastPrefixIdx = -1;
                for (let j = 0; j < node.inputs.length; j++) {
                    if (node.inputs[j].name?.startsWith(prefix)) {
                        lastPrefixIdx = j;
                    }
                }
                if (lastPrefixIdx < 0) {
                    node.addInput(`${prefix}${i}`, type);
                } else {
                    node.addInput(`${prefix}${i}`, type);
                    const newInput = node.inputs.pop();
                    node.inputs.splice(lastPrefixIdx + 1, 0, newInput);
                }
            }
        }

        if (node.graph && node.graph.setCanvasDirty) {
            node.graph.setCanvasDirty();
        }
    };

    const countW = node.widgets?.find(w => w.name === countWidget);
    if (countW) {
        const countIdx = node.widgets.indexOf(countW);
        node.addWidget("button", "Update inputs", null, rebuild);
    } else {
        node.addWidget("button", "Update inputs", null, rebuild);
    }

    if (countW) {
        const origCb = countW.callback;
        countW.callback = function (value, canvas) {
            const r = origCb ? origCb.apply(this, arguments) : undefined;
            if (!canvas) {
                rebuild();
            }
            return r;
        };
    }

    return rebuild;
}


app.registerExtension({
    name: "CommonToolbox.BatchAnyMerge",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "Batch Any Merge") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const node = this;
            onNodeCreated?.apply(this, arguments);

            const rebuild = setupDynamicInputs(node, {
                type: "*",
                prefix: "any_",
                countWidget: "inputcount",
            });

            requestAnimationFrame(() => {
                rebuild();
            });
        };
    },
});
