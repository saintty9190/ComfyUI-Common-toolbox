

import copy
import torch


# ────────────────────────────────────────────────────────────
# state_info 切片策略注册表
# ────────────────────────────────────────────────────────────
# 与 batch_any_merge 的合并策略表保持一致的字段分类,
# 但本文件完全独立, 不依赖 batch_any_merge 的导入。
#
# 策略类型:
#   "cat0"   : 沿 dim=0 切片 (batch 维在第 0 维的张量)
#   "cat1"   : 沿 dim=1 切片 (batch 维在第 1 维的张量, 如 [4, B, C, H, W])
#   "shared" : 原样保留 (所有样本共享的字段)
#   "warn"   : 原样保留 + 警告 (RNG 状态等无法按 batch 切片的字段)
#   "skip"   : 丢弃 (极少用)

_SLICE_STRATEGIES = {}


def _register(key, strategy):
    _SLICE_STRATEGIES[key] = strategy


# per-batch 张量 (dim=0 为 batch 维)
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

# per-batch 张量 (dim=1 为 batch 维, 形状 [4, B, ...])
for _k in [
    "data_prev_", "data_prev_y_", "data_prev_x_", "data_x_prev_",
]:
    _register(_k, "cat1")

# 共享字段 (所有样本一致, 原样保留)
for _k in [
    "sigmas", "sigma_next",
    "end_step",
    "sampler_mode",
    "completed",
    "FLOW_STARTED", "FLOW_STOPPED",
    "model_call_counts",
]:
    _register(_k, "shared")

# RNG 状态 (原样保留, 无法按 batch 切片)
for _k in [
    "last_rng", "last_rng_substep",
]:
    _register(_k, "warn")


# ────────────────────────────────────────────────────────────
# 切片工具函数
# ────────────────────────────────────────────────────────────

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

    # 标量 / 其他类型: 原样返回
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

    # ── 切片 samples ──
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

    # ── 切片 batch_index ──
    if "batch_index" in latent:
        bi = latent["batch_index"]
        if isinstance(bi, list) and len(bi) > 0:
            total = len(bi)
            s = _norm_index(start, total)
            e = min(s + length, total)
            result["batch_index"] = bi[s:e]
        else:
            result["batch_index"] = bi

    # ── 切片 state_info ──
    if "state_info" in latent and latent["state_info"] is not None:
        result["state_info"] = _slice_state_info(
            latent["state_info"], start, length
        )

    # ── 处理其他键 ──
    handled = {"samples", "batch_index", "state_info"}
    for key in latent:
        if key in handled:
            continue
        val = latent[key]
        if val is None:
            continue
        result[key] = _auto_slice(val, key, start, length)

    return result


# ────────────────────────────────────────────────────────────
# 节点类
# ────────────────────────────────────────────────────────────

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

        # ── torch.Tensor ──
        if isinstance(any_input, torch.Tensor):
            if any_input.ndim < 1 or any_input.shape[0] == 0:
                return (any_input.clone(),)
            total = any_input.shape[0]
            start = _norm_index(batch_index, total)
            end = min(start + length, total)
            return (any_input[start:end].clone(),)

        # ── latent dict (含 samples) ──
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

        # ── list ──
        if isinstance(any_input, list):
            total = len(any_input)
            if total == 0:
                return (list(any_input),)
            start = _norm_index(batch_index, total)
            end = min(start + length, total)
            return (any_input[start:end],)

        # ── tuple ──
        if isinstance(any_input, tuple):
            total = len(any_input)
            if total == 0:
                return (any_input,)
            start = _norm_index(batch_index, total)
            end = min(start + length, total)
            return (any_input[start:end],)

        # ── 基础类型 / 其他: 原样返回 ──
        return (any_input,)
