# ComfyUI-Common-toolbox

## 兼容性

| 环境 | 状态 |
|---|---|
| 秋叶整合包 aki-v2 | ✅ 主要开发测试环境 |
| 秋叶整合包 aki-v3 | ✅ 兼容（新前端） |
| ComfyUI 官方原版（含 2024.10+ 新前端） | ✅ 兼容 |
| Linux / macOS | ✅ 路径与字体已跨平台处理 |

说明：本插件不依赖任何特定发行版的私有 API — 后端走 `folder_paths` / `PromptServer` 标准接口并全部带容错降级；前端面板挂载独立 DOM、多路径取图探测，官方与整合包环境均可用。**欢迎 v3 / 官方版用户反馈测试结果**（配合下方排障日志开关，方便定位）。

## 安装

把整个 `ComfyUI-Common-toolbox/` 文件夹复制到 ComfyUI 的 `custom_nodes/` 目录下，重启 ComfyUI 即可。

```
ComfyUI/
└── custom_nodes/
    └── ComfyUI-Common-toolbox/
        ├── __init__.py
        ├── nodes.py            ← 节点定义 (Python)
        ├── core.py             ← 裁切搜索核心算法
        ├── templates.py        ← 20 种构图模板
        ├── requirements.txt
        ├── web/
        │   └── composition_nodes.js   ← 前端 UI 扩展 (自动加载)
        └── README.md
```

### 依赖

无需额外安装 — 依赖均为 ComfyUI 自带 (numpy / torch / Pillow)。`opencv-python` 为可选加速，缺失时自动回退纯 PIL 实现。

> ⚠️ 请勿把本文件夹放在其它插件目录内或重命名带版本号后缀；升级时**覆盖同名文件夹**或先删除旧文件夹再复制，避免双重注册。

## 4 个节点

### 1. Crop Mode Selector (构图模式选择器)

用 toggle 同时启用多个构图模式，可上传参考图作为自定义模板。

**输入:**

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `enable_standard` | BOOLEAN | False | 标准商业 (居中/产品展示) |
| `enable_lifestyle` | BOOLEAN | True | 自然生活 (三分法/偏心) |
| `enable_cinematic` | BOOLEAN | False | 电影感 (宽幅/对角线) |
| `enable_documentary` | BOOLEAN | False | 纪实抓拍 (边缘入场) |
| `enable_dynamic` | BOOLEAN | False | 动态运动 (对角线) |
| `enable_extreme_closeup` | BOOLEAN | False | 极近距离 (撑满) |
| `enable_environmental` | BOOLEAN | False | 环境人像 (小主体) |
| `enable_banner` | BOOLEAN | False | Banner 留白 |
| `custom_reference_images` (可选) | IMAGE | — | 上传参考图, 自动提取画幅比 |

**输出:**

| 输出 | 类型 | 说明 |
|---|---|---|
| `composition_modes` | STRING | 逗号分隔的模式名 (如 "lifestyle,cinematic") |
| `custom_aspect_ratios` | STRING | 逗号分隔的自定义画幅比 |

**前端 UI (自动加载):** SVG 构图图标卡片 + toggle 开关 + "+" 上传自定义模板 + "Update Inputs" 按钮。

### 2. Crop Generator (主节点)

**输入:**

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `image` | IMAGE | — | 输入原图 |
| `composition_modes` | STRING | lifestyle | 来自 Selector, 或手动输入逗号分隔 |
| `auto_mask_method` | 下拉 | auto | subject_mask 未连接时的自动主体估算策略 (见下) |
| `num_candidates` | INT | 12 | 输出候选数 |
| `max_aspect_variants` | INT | 2 | 每个模板最多变几种画幅 |
| `allow_crop_subject` | BOOL | True | 是否允许裁掉主体局部 |
| `min_subject_visibility` | FLOAT | 0.80 | 主体最低可见比例 |
| `head_bias` | FLOAT | 0.70 | 视觉中心受头部位置影响的权重 |
| `dedup_threshold` | FLOAT | 0.85 | 构图去重相似度上限 |
| `top_k` | INT | 3 | 推荐排名输出数 |
| `crop_index` | INT | 0 | 选择第几张作为 selected_crop (0开始) |
| `seed` | INT | 0 | 随机模式用 |
| `subject_mask` (可选) | MASK | — | 主体 mask; **不连也可用**, 不连时按 auto_mask_method 自动估算 |
| `head_hint` (可选) | MASK | — | 头部 mask |
| `custom_aspect_ratios` (可选) | STRING | — | 来自 Selector 的自定义画幅比 |

**`auto_mask_method` 主体估算策略**（仅当 `subject_mask` 未连接或为空时生效；已连接的 mask 永远优先）:

| 选项 | 耗时 | 说明 |
|---|---|---|
| `grabcut` | ~0.3-1s | opencv GrabCut 精细分割, 边界更准; 需 opencv |

> 内部回退链: grabcut 失败 → saliency 谱残差显著性 (纯 numpy, 零依赖) → center 中心区域兜底 (画面中央 70%)。三层保险，节点永不崩。

**输出:**

| 输出 | 类型 | 说明 |
|---|---|---|
| `crops` | IMAGE | N 个候选 (resize 到第一张尺寸, 无黑边) |
| `selected_crop` | IMAGE | 单张原始尺寸裁切 (由 crop_index 选择) |
| `crop_bboxes` | STRING | JSON, 每个候选的 bbox + 尺寸 + 元数据 |
| `composition_labels` | STRING | 每个候选的标签 + 实际尺寸 |
| `contact_sheet` | IMAGE | 拼图预览 |
| `best_indices` | STRING | Ranker 推荐的 Top-K |

### 3. Crop Chooser (交互选图)

连接 Generator 的 `crops` 后，节点面板直接显示缩略图网格（含**原图**对比 cell）：

1. 工作流跑到 Chooser 时**队列暂停**，等待点选
2. 点缩略图选中 → 点 **[Progress]** → 同一条队列下游继续执行
3. 点 ComfyUI 顶部"终止进程" → 立即取消等待（标准 ComfyUI 中断行为）
4. 点 **[重新生成]** → 自动取消当前等待 + 递增上游 Generator seed + 重新提交子图
   - 如果在此之前改了 **Crop Mode Selector** 的多选模式，新选的构图模式**自动生效**
   - 子图提交范围含上游 Selector（buildUpClosure 递归遍历），不需要手动重跑 Selector
   - Once Pause 模式下通过 gen_ts 版本检测自动清除旧选择，强制重新阻塞等待

支持 Once Pause（记住上次选择）等模式；兼容 Easy-Use For/While Loop 循环体、LG 组执行器、秋叶整合包复合 id。

### 4. Contact Sheet Builder (拼图工具)

独立通用拼图节点，不依赖其它节点。

## 文件保存说明 (重要)

候选裁切图与参考图保存在 ComfyUI **temp 目录**（`ComfyUI/temp/comp_crop_*`），与 Preview Image 节点同款机制：

- ✅ 不永久占用磁盘 — ComfyUI **重启时自动清理**
- ⚠️ 需要保留成品的，请把 Chooser 的输出接到 **Save Image** 节点（存入 `output/`），不要依赖 temp 里的临时文件

节点之间传递的是内存中的 tensor 数据，选图 → 出图全链路不依赖 temp 文件。

## 推荐工作流

### A. 无需 mask (快速流程, 省掉分割节点)

```
[Load Image] ─────┐
                   │
                   ▼
          [Crop Mode Selector]  ← toggle 选模式
                   │ composition_modes
                   ▼
          [Crop Generator]  ← auto_mask_method=auto 即可
                   │ crops
                   ▼
          [Crop Chooser]  ← 画布点缩略图 + [Progress]
                   │ selected_crop
                   ▼
              [Save Image]  ← 原始尺寸成品
```

适合 AI 生图（主体清晰、多居中）的快速出图，省去 SAM2/分割节点的耗时。

### B. 自带 mask (精细流程)

```
[Load Image] ──► [SAM2 / 分割] ──► subject_mask
    │                                 │
    │                                 ▼
    │                        [Crop Mode Selector]  ← toggle 选模式
    │                                 │ composition_modes
    │                                 ▼
    └───────────────────────► [Crop Generator]
                                 │ crops
                                 ▼
                        [Crop Chooser]  ← 画布点缩略图 + [Progress]
                                 │ selected_crop
                                 ▼
                            [Save Image]  ← 原始尺寸成品
```

已有主体分割结果时连 `subject_mask`，节点会用它而非自动估算。

## 20 种构图模板

| # | 模板 ID | 位置 | Scale | 画幅 | 允许裁主体? | 适用场景 |
|---|---|---|---|---|---|---|
| 01 | T01_Center_Standard | 居中 | M | 1:1, 4:3, 3:4 | 否 | Amazon、产品展示 |
| 02 | T02_Left_Standard | 左 | M | 1:1, 4:3, 3:4 | 否 | 文字右侧加标题 |
| 03 | T03_Right_Standard | 右 | M | 1:1, 4:3, 3:4 | 否 | Lifestyle 产品 |
| 04 | T04_Center_Tight | 居中 | L | 1:1, 3:4 | 否 | 产品特写 |
| 05 | T05_Center_Loose | 居中 | S | 1:1, 4:3, 3:2 | 否 | 环境人像 |
| 06 | T06_TopLeft_Thirds | 左上 | M | 1:1, 4:3, 3:4 | 否 | Lifestyle 经典 |
| 07 | T07_BottomRight_Thirds | 右下 | M | 1:1, 4:3, 3:4 | 否 | 镜像经典 |
| 08 | T08_TopRight_Thirds | 右上 | M | 1:1, 4:3 | 否 | Landscape |
| 09 | T09_BottomLeft_Thirds | 左下 | M | 1:1, 4:3 | 否 | 镜像 |
| 10 | T10_Left_Banner | 左 | S | 3:2, 16:9, 2:1 | 否 | Banner |
| 11 | T11_Right_Banner | 右 | S | 3:2, 16:9, 2:1 | 否 | 镜像 Banner |
| 12 | T12_Cinema_LowCenter | 居中偏下 | M | 2.39:1, 2:1, 16:9 | 否 | 电影宽幅 |
| 13 | T13_Cinema_HighCenter | 居中偏上 | M | 2.39:1, 2:1, 16:9 | 否 | 留顶部空间 |
| 14 | T14_Cinema_SideEdge | 右 | M | 2.39:1, 2:1 | 否 | 21:9 主体偏右 |
| 15 | T15_Diagonal | 左下 | M | 1:1, 4:3, 3:2 | 否 | 对角线动感 |
| 16 | T16_RightEdge_Crop | 右 | M | 1:1, 4:3, 3:2 | **是** | 纪实、半入画 |
| 17 | T17_LeftEdge_Crop | 左 | M | 1:1, 4:3, 3:2 | **是** | 纪实、运动感 |
| 18 | T18_Extreme_Closeup | 居中 | XL | 1:1, 3:4, 4:3 | **是** | 头部撑满 |
| 19 | T19_Bottom_Enter | 居中偏下 | M | 1:1, 4:3 | **是** | 下半身、脚步 |
| 20 | T20_Horizontal_Banner | 左 | S | 16:9, 2:1, 2.39:1 | 否 | 横向 Banner |

## 常见问题

### Q: crops 输出有变形?

A: `crops` 输出 resize 到第一张裁切的尺寸 (无黑边), 可能轻微变形。要原始尺寸请用 Chooser 点选，或 `selected_crop` + `crop_index`。

### Q: 重启 ComfyUI 后 temp 里的裁切图没了?

A: 这是设计行为 — temp 目录随重启自动清理，防止永久占盘。成品请接 **Save Image** 节点。

### Q: Chooser 一直显示"等待中"?

A: 先看 ComfyUI 服务端终端是否有 `CHOOSE WAIT` 日志。没有说明工作流没跑到该节点；有则检查浏览器 F12 控制台警告。前端路径探测日志默认静默，排查时在控制台执行:

```js
localStorage.setItem("comp_crop_debug", "1")
```

刷新页面后即可看到全部取图路径日志；排查完 `localStorage.removeItem("comp_crop_debug")` 恢复静默。

### Q: 前端 UI 没显示图标?

A: 确认 `web/composition_nodes.js` 文件存在, ComfyUI 重启后自动加载。旧版 ComfyUI 可能不支持 `WEB_DIRECTORY`, 需要升级。

### Q: 自定义模板上传后怎么用?

A: 上传的参考图自动提取宽高比, 附加到构图候选中。每个"启用的模板" × "每个自定义画幅" 都会生成一个候选。

### Q: 怎么同时探索多种构图风格?

A: 在 Crop Mode Selector 里 toggle 多个模式 (如 lifestyle + cinematic + documentary), 所有模式的模板会合并去重。

### Q: 兼容性?

A: 兼容秋叶 (aki) 整合包 v2/v3、ComfyUI 官方原版（含新前端）、Easy-Use For/While Loop、LG_GroupExecutor 组执行。已知的整合包 history 字段剥离、复合 unique_id 等问题内部已做兼容处理；各版本的"终止进程"中断检测也有多级 fallback。
