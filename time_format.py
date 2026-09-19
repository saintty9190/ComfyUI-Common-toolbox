import re
import time


def parse_trigger(value):
    if value is None:
        return 0
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return 0
        try:
            return float(s)
        except ValueError:
            pass
        try:
            return float(s.replace(",", ""))
        except ValueError:
            pass
        m = re.search(r"-?\d+\.?\d*", s)
        if m:
            try:
                return float(m.group())
            except ValueError:
                pass
        return hash(s)
    type_name = type(value).__name__
    if hasattr(value, 'shape') and hasattr(value, 'dtype'):
        return (type_name, tuple(value.shape), str(value.dtype))
    if isinstance(value, dict):
        return (type_name, tuple(sorted(str(k) for k in value.keys())))
    return (type_name, id(value))


class TimeFormatNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "trigger": ("STRING", {
                    "default": "0",
                    "multiline": False,
                    "tooltip": "触发值, 变化时实时输出当前时间戳. 支持 int/float/string 连接.",
                }),
                "preset": ([
                    "%Y-%m-%d-%H%M%S",
                    "%Y-%m-%d",
                    "%H%M%S",
                    "unix",
                    "unix-ms",
                    "custom"
                ], {"default": "%Y-%m-%d-%H%M%S"}),
                "custom_format": ("STRING", {"default": "%Y/%m/%d %H:%M:%S", "multiline": False}),
            }
        }

    @classmethod
    def IS_CHANGED(cls, trigger, preset, custom_format):
        return (parse_trigger(trigger), time.time())

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("timestamp",)
    FUNCTION = "get_time"
    CATEGORY = "utils"

    def get_time(self, trigger, preset, custom_format):
        if preset == "unix":
            ts = str(int(time.time()))
        elif preset == "unix-ms":
            ts = str(int(time.time() * 1000))
        elif preset == "custom":
            try:
                ts = time.strftime(custom_format)
            except Exception as e:
                ts = f"[Format Error: {e}]"
        else:
            ts = time.strftime(preset)
        return (ts,)
