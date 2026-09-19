import { app } from "../../scripts/app.js";


function setupDynamicInputs(node, { prefix, countWidget = "inputcount", type = "*" } = {}) {
    /**
     * 根据 countWidget 的值重建输入槽
     * 输入槽始终保持在 any_1 之后、inputcount 之前的位置
     */
    const rebuild = () => {
        if (!node.inputs) node.inputs = [];

        const countW = node.widgets?.find(w => w.name === countWidget);
        if (!countW) return;

        const target = countW.value;
        const current = node.inputs.filter(i => i.name?.startsWith(prefix)).length;

        if (target === current) return;

        // 找到 any_1 的索引位置 (第一个 prefix 开头的输入)
        let firstPrefixIndex = node.inputs.findIndex(i => i.name?.startsWith(prefix));
        if (firstPrefixIndex < 0) firstPrefixIndex = 0;

        if (target < current) {
            // 删除多余的输入槽 (从最后一个往前删)
            for (let i = 0; i < current - target; i++) {
                // 找到最后一个 prefix 开头的输入并删除
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
            // 增加输入槽 —— 插入到当前最后一个 prefix 输入之后
            for (let i = current + 1; i <= target; i++) {
                // 找到当前最后一个 prefix 输入的位置
                let lastPrefixIdx = -1;
                for (let j = 0; j < node.inputs.length; j++) {
                    if (node.inputs[j].name?.startsWith(prefix)) {
                        lastPrefixIdx = j;
                    }
                }
                if (lastPrefixIdx < 0) {
                    // 没有 prefix 输入, 加到开头
                    node.addInput(`${prefix}${i}`, type);
                } else {
                    // 在最后一个 prefix 输入之后插入
                    // LiteGraph 没有 insertInput, 所以我们用 addInput + 移动位置
                    node.addInput(`${prefix}${i}`, type);
                    const newInput = node.inputs.pop();
                    node.inputs.splice(lastPrefixIdx + 1, 0, newInput);
                }
            }
        }

        // 标记画布需要重绘
        if (node.graph && node.graph.setCanvasDirty) {
            node.graph.setCanvasDirty();
        }
    };

    // 添加 "Update inputs" 按钮 (在 inputcount 之后)
    // 先找到 inputcount widget 的索引, 把按钮插到它后面
    const countW = node.widgets?.find(w => w.name === countWidget);
    if (countW) {
        const countIdx = node.widgets.indexOf(countW);
        // 按钮加到 widgets 末尾 (在 inputcount 之后)
        node.addWidget("button", "Update inputs", null, rebuild);
    } else {
        node.addWidget("button", "Update inputs", null, rebuild);
    }

    // 绑定 count widget 的回调 (加载工作流时自动重建)
    if (countW) {
        const origCb = countW.callback;
        countW.callback = function (value, canvas) {
            const r = origCb ? origCb.apply(this, arguments) : undefined;
            // canvas 参数为 undefined 时表示 API 加载 / 程序化设置
            // 此时需要自动重建输入槽
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

            // 设置动态输入槽
            const rebuild = setupDynamicInputs(node, {
                type: "*",
                prefix: "any_",
                countWidget: "inputcount",
            });

            // 初始重建一次 (确保 inputcount 默认值对应的槽存在)
            // 延迟一帧以确保 widget 已初始化
            requestAnimationFrame(() => {
                rebuild();
            });
        };
    },
});
