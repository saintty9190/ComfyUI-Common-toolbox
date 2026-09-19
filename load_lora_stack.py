import hashlib
import folder_paths
import comfy.sd
import comfy.utils
from .lora_cache import get_cached, set_cached, unload_node_cache

CATEGORY = "model"

_bypass = {}
_last_unload = {}
_last_stack_hash = {}


def _stack_hash(lora_stack):
    """生成 lora_stack 的哈希值，用于检测变化"""
    if not lora_stack:
        return "empty"
    items = []
    for entry in lora_stack:
        if isinstance(entry, (tuple, list)) and len(entry) >= 3:
            items.append(f"{entry[0]}:{entry[1]}:{entry[2]}")
    return hashlib.md5("|".join(items).encode()).hexdigest()[:16]


def _model_hash(model):
    """生成 model 的唯一标识"""
    if model is None:
        return "none"
    return str(id(model))


class LoadLoraStack:
    """Load Lora Stack — 加载 LoRA 堆栈到 model/clip"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "lora_stack": ("LORA_STACK",),
            },
            "optional": {
                "clip": ("CLIP",),
                "unload_trigger": ("INT", {"default": 0, "min": 0, "max": 999999}),
            },
        }

    RETURN_TYPES = ("MODEL", "CLIP")
    RETURN_NAMES = ("model", "clip")
    FUNCTION = "load_stack"
    CATEGORY = CATEGORY

    def load_stack(self, model, lora_stack, clip=None, unload_trigger=0, unique_id=None):
        """
        加载 lora_stack 中的所有 LoRA。
        
        Args:
            lora_stack: LoRA 堆栈列表 [(name, model_str, clip_str), ...]
            model: 基础模型
            clip: CLIP 模型 (可选，None 时只加载 model 部分)
            unload_trigger: 卸载触发计数器（前端按钮修改触发 unload）
            unique_id: 节点唯一 ID (由 ComfyUI 框架传入)
        
        Returns:
            (model, clip): 加载所有 LoRA 后的 model 和 clip
        """
        node_id = str(unique_id) if unique_id else f"node_{id(model)}"

        last_unload_val = _last_unload.get(node_id, 0)
        if unload_trigger != last_unload_val and unload_trigger > 0:
            cleared = unload_node_cache(node_id)
            _last_unload[node_id] = unload_trigger
            _bypass[node_id] = True
            _last_stack_hash[node_id] = _stack_hash(lora_stack)
            print(f"[LoadLoraStack] 已卸载节点 {node_id} 的 LoRA 缓存 ({cleared} 条)")
            return (model, clip)

        if _bypass.get(node_id, False):
            current_hash = _stack_hash(lora_stack)
            last_hash = _last_stack_hash.get(node_id, "")
            if current_hash != last_hash:
                _bypass[node_id] = False
                _last_stack_hash[node_id] = current_hash
                print(f"[LoadLoraStack] 节点 {node_id} lora_stack 已变化，退出 bypass 模式")
            else:
                return (model, clip)

        if model is None:
            return (None, clip)

        if not lora_stack or not isinstance(lora_stack, list):
            _last_stack_hash[node_id] = _stack_hash(lora_stack)
            return (model, clip)

        current_model = model
        current_clip = clip

        for lora_entry in lora_stack:
            if not isinstance(lora_entry, (tuple, list)) or len(lora_entry) < 3:
                continue

            lora_name = lora_entry[0]
            model_strength = float(lora_entry[1])
            clip_strength = float(lora_entry[2])

            if not lora_name or lora_name == "None":
                continue

            if model_strength == 0 and (clip_strength == 0 or current_clip is None):
                continue

            cached = get_cached(node_id, lora_name, model_strength, clip_strength, current_model)
            if cached is not None:
                cached_model, cached_clip = cached
                current_model = cached_model
                if current_clip is not None and cached_clip is not None:
                    current_clip = cached_clip
                continue

            lora_path = folder_paths.get_full_path("loras", lora_name)
            if lora_path is None:
                print(f"[LoadLoraStack] 警告: LoRA 文件未找到 - {lora_name}")
                continue

            lora_data = comfy.utils.load_torch_file(lora_path, safe_load=True)

            new_model, new_clip = comfy.sd.load_lora_for_models(
                current_model, current_clip, lora_data, model_strength, clip_strength
            )

            set_cached(
                node_id, lora_name, model_strength, clip_strength,
                current_model, new_model, new_clip
            )

            current_model = new_model
            current_clip = new_clip

        _last_stack_hash[node_id] = _stack_hash(lora_stack)
        return (current_model, current_clip)
