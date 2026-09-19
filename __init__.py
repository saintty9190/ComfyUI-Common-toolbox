"""
ComfyUI-Common-toolbox
======================
AI 生图构图优化节点包：把「主体站中间、左右对称、像证件照」的生图结果，
通过自动搜索摄影式构图，一次性产出 6~30 个候选裁切，再通过 Chooser 节点人工选优。

节点列表:
  1. CropModeSelector   — 构图模式选择器 (toggle 多选 + 卡片化 UI)
  2. CropGenerator      — 主节点, 输出全部候选 batch + bbox 元数据
  3. CropChooser        — 选择器, 点击缩略图 → Progress → 输出 selected_crop
  4. ContactSheetBuilder — 独立拼图节点 (通用工具)
  5. EmptyLatentSelector — 标准 4 通道空 latent 生成器 (宽高比/尺寸选择)
  6. TimeSeed           — 带实时触发的随机种子节点 (trigger 变化即刷新)
  7. TimeFormatNode     — 时间格式化节点 (预设/custom/unix 格式)
  8. BatchAnyMerge      — 通用批次合并节点 (支持 latent state_info 智能合并)
  9. GetAnyFromBatch    — 通用批次切片节点 (支持 latent state_info 智能切片)
 10. PowerLoraStack     — 可视化 LoRA 堆栈收集节点 (拖拽/右键/预览图)
 11. LoadLoraStack      — LoRA 堆栈加载节点 (缓存/Unload/clip 可选)
 12. LoadUnetDiffusionModel — UNET 加载节点 (级联选择器 + 悬停预览图)
"""

__version__ = "1.3"


def _clear_stale_pycache():
    """清除 __pycache__ 中的过期 .pyc 文件, 防止旧缓存导致新代码不生效。"""
    import os
    import sys

    cache_dir = os.path.join(os.path.dirname(__file__), "__pycache__")
    if not os.path.isdir(cache_dir):
        return
    for f in os.listdir(cache_dir):
        if f.endswith(".pyc"):
            pyc_path = os.path.join(cache_dir, f)
            py_name = f.split(".")[0]
            py_path = os.path.join(os.path.dirname(__file__), py_name + ".py")
            if not os.path.isfile(py_path):
                try:
                    os.remove(pyc_path)
                except OSError:
                    pass


_clear_stale_pycache()

try:
    from .nodes import (
        CropModeSelector,
        CropGenerator,
        CropChooser,
        ContactSheetBuilder,
    )
    from .empty_latent_selector import EmptyLatentSelector
    from .seed_time import TimeSeed
    from .time_format import TimeFormatNode
    from .batch_any_merge import BatchAnyMerge
    from .get_any_from_batch import GetAnyFromBatch
    from .power_lora_stack import PowerLoraStack
    from .load_lora_stack import LoadLoraStack
    from .load_unet_model import LoadUnetDiffusionModel
except Exception:
    import traceback
    print("\033[31m" + "=" * 60)
    print("[ComfyUI-Common-toolbox] 加载失败 — 节点列表将为空!")
    traceback.print_exc()
    print("=" * 60 + "\033[0m")
    CropModeSelector = CropGenerator = None
    CropChooser = ContactSheetBuilder = None
    EmptyLatentSelector = None
    TimeSeed = None
    TimeFormatNode = None
    BatchAnyMerge = None
    GetAnyFromBatch = None
    PowerLoraStack = None
    LoadLoraStack = None
    LoadUnetDiffusionModel = None

if CropModeSelector is not None:
    NODE_CLASS_MAPPINGS = {
        "Crop Mode Selector": CropModeSelector,
        "Crop Generator": CropGenerator,
        "Crop Chooser": CropChooser,
        "Contact Sheet Builder": ContactSheetBuilder,
        "Empty Latent Selector": EmptyLatentSelector,
        "Seed Time": TimeSeed,
        "Time Format": TimeFormatNode,
        "Batch Any Merge": BatchAnyMerge,
        "Get Any From Batch": GetAnyFromBatch,
        "Power Lora Stack": PowerLoraStack,
        "Load Lora Stack": LoadLoraStack,
        "Load Unet Diffusion Model": LoadUnetDiffusionModel,
    }

    NODE_DISPLAY_NAME_MAPPINGS = {
        "Crop Mode Selector": "Crop Mode Selector",
        "Crop Generator": "Crop Generator",
        "Crop Chooser": "Crop Chooser",
        "Contact Sheet Builder": "Contact Sheet Builder",
        "Empty Latent Selector": "Empty Latent Selector",
        "Seed Time": "Seed Time",
        "Time Format": "Time Format",
        "Batch Any Merge": "Batch Any Merge",
        "Get Any From Batch": "Get Any From Batch",
        "Power Lora Stack": "Power Lora Stack",
        "Load Lora Stack": "Load Lora Stack",
        "Load Unet Diffusion Model": "Load Unet Diffusion Model",
    }
else:
    NODE_CLASS_MAPPINGS = {}
    NODE_DISPLAY_NAME_MAPPINGS = {}

WEB_DIRECTORY = "./web"

try:
    from .lora_preview_api import register_routes
    register_routes()
except Exception:
    pass

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "WEB_DIRECTORY",
]
