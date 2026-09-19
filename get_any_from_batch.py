

import copy
import torch



_SLICE_STRATEGIES = {}


def _register(key, strategy):
    _SLICE_STRATEGIES[key] = strategy


for _k in [
    "raw_x", "denoised",
    "noise_initial", "image_initial",
    "noise_bongflow",
    "y0_bongflow", "y0_bongflow_orig",
    "y0_standard_guide", "y0_inv_standard_guide",
    "guide_inversion_y0", "guide_inversion_y0_inv",
    "y0", "data_cached",
]:
    _register(_k, "cat0")

for _k in [
    "data_prev_", "data_prev_y_", "data_prev_x_", "data_x_prev_",
]:
    _register(_k, "cat1")

for _k in [
    "sigmas", "sigma_next",
    "end_step",
    "sampler_mode",
    "completed",
    "FLOW_STARTED", "FLOW_STOPPED",
    "model_call_counts",
]:
    _register(_k, "shared")

for _k in [
    "last_rng", "last_rng_substep",
]:
    _register(_k, "warn")



def _norm_index(start, total):
    """将索引归一化到 [0, total) 区间"""
    if total <= 0:
        return 0
    return start % total


def _slice_dim0(tensor, start, length):
    """沿 dim=0 切片张量, 返回 clone"""
    total = tensor.shape[0]
    if total == 0:
        return tensor.clone()
    s = _norm_index(start, total)
    e = min(s + length, total)
    return tensor[s:e].clone()


def _slice_dim1(tensor, start, length):
    """沿 dim=1 切片张量 (如 [4, B, C, H, W]), 返回 clone"""
    if tensor.ndim < 2:
        return tensor.clone()
    total = tensor.shape[1]
    if total == 0:
        return tensor.clone()
    s = _norm_index(start, total)
    e = min(s + length, total)
    return tensor[:, s:e].clone()


def _auto_slice(val, key, start, length):
    """
    未知字段的自动切片策略:
      - torch.Tensor 且 dim>=1 → 按 dim=0 切片
      - dict → 递归切片 state_info
      - list / tuple → 按索引切片
      - 标量/其他 → 原样返回
    """
    if isinstance(val, torch.Tensor):
        if val.ndim >= 1 and val.shape[0] > 0:
            total = val.shape[0]
            s = _norm_index(start, total)
            e = min(s + length, total)
            return val[s:e].clone()
        return val.clone() if val.ndim >= 1 else val

    if isinstance(val, dict):
        return _slice_state_info(val, start, length)

    if isinstance(val, list):
        total = len(val)
        if total > 0:
            s = _norm_index(start, total)
            e = min(s + length, total)
            return val[s:e]
        return list(val)

    if isinstance(val, tuple):
        total = len(val)
        if total > 0:
            s = _norm_index(start, total)
            e = min(s + length, total)
            return val[s:e]
        return val

    return val


def _slice_state_info(state_info, start, length):
    """
    切片 state_info dict。

    根据 _SLICE_STRATEGIES 策略表:
      - "cat0"   → 沿 dim=0 切片
      - "cat1"   → 沿 dim=1 切片
      - "shared" → 原样保留
      - "warn"   → 原样保留
      - "skip"   → 丢弃
      - 未知     → 自动探测
    """
    if not state_info:
        return {}

    result = {}
    for key, val in state_info.items():
        if val is None:
            continue

        strategy = _SLICE_STRATEGIES.get(key)

        if strategy == "cat0" and isinstance(val, torch.Tensor):
            result[key] = _slice_dim0(val, start, length)
        elif strategy == "cat1" and isinstance(val, torch.Tensor):
            result[key] = _slice_dim1(val, start, length)
        elif strategy in ("shared", "warn"):
            result[key] = val
        elif strategy == "skip":
            pass
        else:
            result[key] = _auto_slice(val, key, start, length)

    return result


def _slice_latent(latent, start, length):
    """切片 latent dict (含 samples / state_info / batch_index / 其他)"""
    if not isinstance(latent, dict):
        return latent

    result = {}

    if "samples" in latent and isinstance(latent["samples"], torch.Tensor):
        samples = latent["samples"]
        if samples.ndim >= 1 and samples.shape[0] > 0:
            total = samples.shape[0]
            s = _norm_index(start, total)
            e = min(s + length, total)
            result["samples"] = samples[s:e].clone()
        else:
            result["samples"] = samples.clone()
    else:
        result["samples"] = latent.get("samples")

    if "batch_index" in latent:
        bi = latent["batch_index"]
        if isinstance(bi, list) and len(bi) > 0:
            total = len(bi)
            s = _norm_index(start, total)
            e = min(s + length, total)
            result["batch_index"] = bi[s:e]
        else:
            result["batch_index"] = bi

    if "state_info" in latent and latent["state_info"] is not None:
        result["state_info"] = _slice_state_info(
            latent["state_info"], start, length
        )

    handled = {"samples", "batch_index", "state_info"}
    for key in latent:
        if key in handled:
            continue
        val = latent[key]
        if val is None:
            continue
        result[key] = _auto_slice(val, key, start, length)

    return result



class GetAnyFromBatch:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "any_input": ("*", {}),
                "batch_index": (
                    "INT",
                    {"default": 0, "min": -99999, "max": 99999},
                ),
                "length": (
                    "INT",
                    {"default": 1, "min": 1, "max": 99999},
                ),
            }
        }

    RETURN_TYPES = ("*",)
    RETURN_NAMES = ("sliced",)
    FUNCTION = "execute"
    CATEGORY = "utils"
    DESCRIPTION = """
从 batch 中按索引切片, 取出指定区间的数据。
支持 latent / Tensor / list / tuple / 基础类型。
正确处理 ClownsharK 等采样器的 state_info 数据。
与 Batch Any Merge 互为逆操作。
"""

    def execute(self, any_input, batch_index, length):
        if any_input is None:
            return (None,)

        if isinstance(any_input, torch.Tensor):
            if any_input.ndim < 1 or any_input.shape[0] == 0:
                return (any_input.clone(),)
            total = any_input.shape[0]
            start = _norm_index(batch_index, total)
            end = min(start + length, total)
            return (any_input[start:end].clone(),)

        if isinstance(any_input, dict) and "samples" in any_input:
            samples = any_input["samples"]
            if (
                isinstance(samples, torch.Tensor)
                and samples.ndim >= 1
                and samples.shape[0] > 0
            ):
                total = samples.shape[0]
                start = _norm_index(batch_index, total)
                return (_slice_latent(any_input, start, length),)
            return (copy.deepcopy(any_input),)

        if isinstance(any_input, list):
            total = len(any_input)
            if total == 0:
                return (list(any_input),)
            start = _norm_index(batch_index, total)
            end = min(start + length, total)
            return (any_input[start:end],)

        if isinstance(any_input, tuple):
            total = len(any_input)
            if total == 0:
                return (any_input,)
            start = _norm_index(batch_index, total)
            end = min(start + length, total)
            return (any_input[start:end],)

        return (any_input,)
