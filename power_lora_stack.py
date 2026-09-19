
import json
import folder_paths

CATEGORY = "model"
MAX_LORAS = 50


class PowerLoraStack:

    @classmethod
    def INPUT_TYPES(cls):
        inputs = {
            "optional": {
                "model": ("MODEL",),
                "lora_stack": ("LORA_STACK",),
                "clip": ("CLIP",),
            }
        }
        # 声明 MAX_LORAS 个 LoRA 槽位，由前端动态控制显示
        for i in range(1, MAX_LORAS + 1):
            inputs["optional"][f"lora_{i}"] = ("STRING", {"default": ""})
        return inputs

    RETURN_TYPES = ("MODEL", "LORA_STACK", "CLIP")
    RETURN_NAMES = ("model", "lora_stack", "clip")
    FUNCTION = "build_stack"
    CATEGORY = CATEGORY

    def build_stack(self, model=None, lora_stack=None, clip=None, **kwargs):
        # 继承上游 stack
        result_stack = []
        if lora_stack is not None and isinstance(lora_stack, list):
            result_stack.extend(lora_stack)

        # 收集本节点的 LoRA 配置
        lora_entries = []
        for i in range(1, MAX_LORAS + 1):
            key = f"lora_{i}"
            value = kwargs.get(key, "")
            if not value or not isinstance(value, str):
                continue
            try:
                entry = json.loads(value)
            except (json.JSONDecodeError, TypeError):
                continue
            if not isinstance(entry, dict):
                continue
            if "lora" not in entry or not entry["lora"] or entry["lora"] == "None":
                continue
            if entry.get("on", True):
                lora_entries.append(entry)

        # 追加到结果 stack（保持三元组格式兼容 EasyLoraStack）
        for entry in lora_entries:
            lora_name = entry["lora"]
            strength = float(entry.get("strength", 1.0))
            result_stack.append((lora_name, strength, strength))

        return (model, result_stack, clip)
