import hashlib
import re
import secrets
from server import PromptServer
from aiohttp import web

SEED_MAX = 0xffffffffffffffff   # 2^64 - 1


def parse_trigger_value(value):
    if value is None:
        return None
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        try:
            return float(s)
        except ValueError:
            pass
        s_clean = s.replace(",", "")
        try:
            return float(s_clean)
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


MODES = ["fixed", "only trigger change", "randomize", "increment", "increment random", "decrement"]

_last_seed_display = {"node_id": None, "seed": 0}


@PromptServer.instance.routes.post("/seed_time/update")
async def seed_time_update(request):
    data = await request.json()
    _last_seed_display["node_id"] = data.get("node_id")
    return web.json_response({"ok": True})


@PromptServer.instance.routes.get("/seed_time/last")
async def seed_time_last(request):
    return web.json_response(_last_seed_display)


class TimeSeed:

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "trigger": (
                    "STRING",
                    {
                        "default": "0",
                        "multiline": False,
                        "tooltip": "触发值, 任何数字变化都会立即重新生成 seed. "
                                   "支持 int/float/string 连接, 字符串自动清洗解析.",
                    },
                ),
                "mode": (
                    MODES,
                    {
                        "default": "randomize",
                        "tooltip": "seed 生成模式.\n"
                                   "randomize: CSPRNG 随机\n"
                                   "increment: 每次 +1\n"
                                   "increment random: 每次随机 +1~100\n"
                                   "decrement: 每次 -1\n"
                                   "fixed: 固定不变\n"
                                   "only trigger change: 仅 trigger 变化时随机, Queue 不改",
                    },
                ),
            }
        }

    RETURN_TYPES = ("INT", "STRING")
    RETURN_NAMES = ("seed", "seed_text")
    FUNCTION = "get_seed"
    CATEGORY = "utils"
    OUTPUT_NODE = True

    def __init__(self):
        self._last_trigger = None
        self._current_seed = 0

    @classmethod
    def IS_CHANGED(cls, trigger, mode):
        return float("nan")

    def get_seed(self, trigger, mode):
        parsed = parse_trigger_value(trigger)

        if mode == "fixed":
            pass
        elif mode == "only trigger change":
            if parsed is not None and parsed != self._last_trigger:
                self._last_trigger = parsed
                h = hashlib.sha256(str(parsed).encode()).digest()
                self._current_seed = int.from_bytes(h[:8], 'big') % (SEED_MAX + 1)
        else:
            trigger_changed = parsed is not None and parsed != self._last_trigger
            if trigger_changed:
                self._last_trigger = parsed
            if mode == "randomize":
                self._current_seed = secrets.randbits(64)
            elif mode == "increment":
                self._current_seed = (self._current_seed + 1) % (SEED_MAX + 1)
            elif mode == "increment random":
                step = secrets.randbelow(100) + 1
                self._current_seed = (self._current_seed + step) % (SEED_MAX + 1)
            elif mode == "decrement":
                self._current_seed = (self._current_seed - 1) % (SEED_MAX + 1)

        _last_seed_display["seed"] = str(self._current_seed)
        try:
            PromptServer.instance.send_sync(
                "seed_time_value",
                {"seed": str(self._current_seed)}
            )
        except Exception:
            pass

        return {
            "result": (self._current_seed, str(self._current_seed)),
            "ui": {"values": {"seed_display": str(self._current_seed)}}
        }
