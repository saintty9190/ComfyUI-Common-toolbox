
import torch
import comfy.utils



_MERGE_STRATEGIES = {}


def register_strategy(key, strategy):
    """注册指定 key 的合并策略"""
    _MERGE_STRATEGIES[key] = strategy


def get_strategy(key):
    """获取指定 key 的合并策略, 未知字段返回 None"""
    return _MERGE_STRATEGIES.get(key, None)


for _k in [
    "raw_x", "denoised",
    "noise_initial", "image_initial",
    "noise_bongflow",
    "y0_bongflow", "y0_bongflow_orig",
    "y0_standard_guide", "y0_inv_standard_guide",
    "guide_inversion_y0", "guide_inversion_y0_inv",
    "y0", "data_cached",
]:
    register_strategy(_k, "cat0")

for _k in [
    "data_prev_", "data_prev_y_", "data_prev_x_", "data_x_prev_",
]:
    register_strategy(_k, "cat1")

for _k in [
    "sigmas", "sigma_next",
    "end_step",
    "sampler_mode",
    "completed",
    "FLOW_STARTED", "FLOW_STOPPED",
    "model_call_counts",
]:
    register_strategy(_k, "shared")

for _k in [
    "last_rng", "last_rng_substep",
]:
    register_strategy(_k, "warn")



def _detect_channel_dim(tensor):
    """
    检测 4D 张量的通道维度位置。
    返回 'first' 表示 [B, C, H, W] (通道在前, latent 格式),
    返回 'last'  表示 [B, H, W, C] (通道在后, image 格式)。
    基于典型通道数 (1/3/4) 做启发式判断。
    """
    if tensor.ndim != 4:
        return None
    c_first = tensor.shape[1]
    c_last = tensor.shape[3]
    channel_sizes = {1, 3, 4}
    if c_first in channel_sizes and c_last not in channel_sizes:
        return "first"
    if c_last in channel_sizes and c_first not in channel_sizes:
        return "last"
    if c_first in channel_sizes and c_last in channel_sizes:
        return "first"
    return "first"


def _upscale_to_ref(t, ref):
    """
    将张量 t 的空间维度缩放到与 ref 一致。
    自动检测 4D 张量的通道格式 (通道在前/在后), 支持 5D [N, B, C, H, W]。
    返回缩放后的张量, 若无法缩放则返回 None。
    """
    if t.ndim == 4 and ref.ndim == 4:
        fmt = _detect_channel_dim(ref)
        if fmt == "first":
            return comfy.utils.common_upscale(
                t, ref.shape[3], ref.shape[2], "bilinear", "center"
            )
        else:
            t_chw = t.movedim(-1, 1)
            ref_chw = ref.movedim(-1, 1)
            result = comfy.utils.common_upscale(
                t_chw, ref_chw.shape[3], ref_chw.shape[2], "bilinear", "center"
            )
            return result.movedim(1, -1)
    if t.ndim == 5 and ref.ndim == 5:
        n, b, c = t.shape[0], t.shape[1], t.shape[2]
        t_4d = t.reshape(n * b, c, t.shape[3], t.shape[4])
        t_4d = comfy.utils.common_upscale(
            t_4d, ref.shape[4], ref.shape[3], "bilinear", "center"
        )
        return t_4d.reshape(n, b, c, ref.shape[3], ref.shape[4])
    return None



def _merge_cat0(values, key):
    """沿 dim=0 拼接张量, 空间维度不一致时自动缩放到第一个输入的分辨率"""
    tensors = [v for v in values if v is not None]
    if not tensors:
        return None
    ref = tensors[0]
    result = [ref]
    for i, t in enumerate(tensors[1:], 1):
        if t.shape[1:] == ref.shape[1:]:
            result.append(t)
            continue
        upscaled = _upscale_to_ref(t, ref)
        if upscaled is not None:
            print(
                f"[BatchAnyMerge] 提示: state_info['{key}'] "
                f"空间维度不匹配 ({t.shape} → {ref.shape}), 已自动缩放"
            )
            result.append(upscaled)
        else:
            print(
                f"[BatchAnyMerge] 警告: state_info['{key}'] "
                f"形状不兼容且无法缩放 ({t.shape} vs {ref.shape}), 取第一份"
            )
            return ref
    return torch.cat(result, dim=0)


def _merge_cat1(values, key):
    """沿 dim=1 拼接张量 (如 [4, B, C, H, W]), 空间维度不一致时自动缩放"""
    tensors = [v for v in values if v is not None]
    if not tensors:
        return None
    ref = tensors[0]
    ref_shape = list(ref.shape)
    result = [ref]
    for i, t in enumerate(tensors[1:], 1):
        s1 = list(t.shape)
        if len(s1) != len(ref_shape):
            print(
                f"[BatchAnyMerge] 警告: state_info['{key}'] 维度数不一致 "
                f"(输入 0 为 {len(ref_shape)}D, 输入 {i} 为 {len(s1)}D), 取第一份"
            )
            return ref
        need_scale = False
        for d in range(len(s1)):
            if d != 1 and s1[d] != ref_shape[d]:
                need_scale = True
                break
        if not need_scale:
            result.append(t)
            continue
        upscaled = _upscale_to_ref(t, ref)
        if upscaled is not None:
            print(
                f"[BatchAnyMerge] 提示: state_info['{key}'] "
                f"空间维度不匹配, 已自动缩放"
            )
            result.append(upscaled)
        else:
            print(
                f"[BatchAnyMerge] 警告: state_info['{key}'] "
                f"形状不兼容且无法缩放, 取第一份"
            )
            return ref
    return torch.cat(result, dim=1)


def _merge_shared(values, key):
    """取第一个值, 校验其余是否一致"""
    vals = [v for v in values if v is not None]
    if not vals:
        return None
    ref = vals[0]
    for i, v in enumerate(vals[1:], 1):
        if isinstance(ref, torch.Tensor) and isinstance(v, torch.Tensor):
            if ref.shape != v.shape or not torch.equal(ref, v):
                print(f"[BatchAnyMerge] 警告: state_info['{key}'] 在不同输入中不一致, 取第一份的值 (可能影响续跑结果)")
                break
        elif ref != v:
            print(f"[BatchAnyMerge] 警告: state_info['{key}'] 在不同输入中不一致, 取第一份的值 (可能影响续跑结果)")
            break
    return ref


def _merge_warn(values, key):
    """取第一个值 + 警告 (用于 RNG 状态)"""
    vals = [v for v in values if v is not None]
    if not vals:
        return None
    if len(vals) > 1:
        print(
            f"[BatchAnyMerge] 警告: state_info['{key}'] 为 RNG 状态, 无法跨 batch 合并, "
            f"已保留第一份的值。如果各输入种子不同, 后续续跑节点的噪声随机性可能仅对第一个样本正确。"
        )
    return vals[0]


_STRATEGY_FN = {
    "cat0": _merge_cat0,
    "cat1": _merge_cat1,
    "shared": _merge_shared,
    "warn": _merge_warn,
}


def merge_state_info(state_infos):
    """
    合并多个 state_info dict。

    Args:
        state_infos: list[dict], 每个元素是一个 state_info

    Returns:
        合并后的 state_info dict
    """
    if not state_infos:
        return {}
    if len(state_infos) == 1:
        return state_infos[0].copy()

    all_keys = set()
    for si in state_infos:
        all_keys.update(si.keys())

    result = {}
    for key in all_keys:
        values = [si.get(key, None) for si in state_infos]

        if all(v is None for v in values):
            continue

        strategy = get_strategy(key)

        if strategy is not None:
            fn = _STRATEGY_FN.get(strategy)
            if fn:
                result[key] = fn(values, key)
            else:
                pass
        else:
            result[key] = _auto_merge_unknown(values, key)

    return result


def _auto_merge_unknown(values, key):
    """
    未知字段的自动合并策略:
      - 全为 torch.Tensor 且形状非空 → 尝试 dim=0 cat
      - 全为 torch.Tensor 但形状不同 → 取第一份 + 警告
      - 全为同类型标量/字符串 → 取第一份 + 一致性检查
      - 混合类型 → 取第一份 + 警告
    """
    vals = [v for v in values if v is not None]
    if not vals:
        return None
    if len(vals) == 1:
        return vals[0]

    if all(isinstance(v, torch.Tensor) for v in vals):
        ref = vals[0]
        can_cat0 = all(v.ndim == ref.ndim and v.shape[1:] == ref.shape[1:] for v in vals[1:])
        if can_cat0 and ref.ndim >= 1:
            print(f"[BatchAnyMerge] 提示: 未知字段 '{key}' 自动按 dim=0 合并 (张量)")
            return torch.cat(vals, dim=0)
        result = [ref]
        all_scaled = True
        for v in vals[1:]:
            upscaled = _upscale_to_ref(v, ref)
            if upscaled is not None:
                result.append(upscaled)
            else:
                all_scaled = False
                break
        if all_scaled:
            print(f"[BatchAnyMerge] 提示: 未知字段 '{key}' 形状不一致, 已自动缩放后合并")
            return torch.cat(result, dim=0)
        print(f"[BatchAnyMerge] 警告: 未知张量字段 '{key}' 形状不一致且无法缩放, 取第一份的值")
        return vals[0]

    if all(isinstance(v, dict) for v in vals):
        try:
            return merge_state_info(vals)
        except Exception as e:
            print(f"[BatchAnyMerge] 警告: 未知 dict 字段 '{key}' 合并失败 ({e}), 取第一份的值")
            return vals[0]

    if all(isinstance(v, list) for v in vals):
        result = []
        for v in vals:
            result.extend(v)
        return result

    if all(isinstance(v, tuple) for v in vals):
        result = ()
        for v in vals:
            result = result + v
        return result

    ref = vals[0]
    for i, v in enumerate(vals[1:], 1):
        if v != ref:
            print(f"[BatchAnyMerge] 警告: 未知字段 '{key}' 值不一致, 取第一份的值")
            break
    return ref



def merge_latents(latents):
    """
    合并多个 latent dict。

    处理内容:
      - samples : 沿 dim=0 拼接, 空间尺寸不同时自动 upscale 对齐
      - state_info : 智能合并 (见 merge_state_info)
      - batch_index : 拼接 (如果存在)
      - noise_mask / 其他张量字段 : 沿 dim=0 拼接 (形状兼容时)
      - 其他非张量字段 : 取第一份
    """
    if not latents:
        return {}
    if len(latents) == 1:
        return latents[0].copy()

    first = latents[0]
    result = first.copy()

    samples_list = [l["samples"] for l in latents]
    ref_h, ref_w = samples_list[0].shape[2], samples_list[0].shape[3]
    for i in range(1, len(samples_list)):
        s = samples_list[i]
        if s.shape[2] != ref_h or s.shape[3] != ref_w:
            samples_list[i] = comfy.utils.common_upscale(
                s, ref_w, ref_h, "bilinear", "center"
            )
    result["samples"] = torch.cat(samples_list, dim=0)

    if "batch_index" in first:
        all_bi = []
        for i, l in enumerate(latents):
            bi = l.get("batch_index")
            if bi is None:
                n = l["samples"].shape[0]
                bi = list(range(n))
            all_bi.extend(bi)
        result["batch_index"] = all_bi

    all_si = [l.get("state_info") for l in latents if l.get("state_info") is not None]
    if all_si:
        result["state_info"] = merge_state_info(all_si)
    elif "state_info" in result:
        pass

    all_keys = set()
    for l in latents:
        all_keys.update(l.keys())
    handled = {"samples", "batch_index", "state_info"}

    for key in all_keys - handled:
        vals = [l.get(key) for l in latents]
        non_none = [v for v in vals if v is not None]
        if not non_none:
            continue
        if len(non_none) == 1:
            result[key] = non_none[0]
            continue

        result[key] = _auto_merge_unknown(vals, key)

    return result



def merge_two(any_1, any_2):
    """合并两个任意类型的对象, 返回合并结果"""

    if any_1 is None:
        return any_2
    if any_2 is None:
        return any_1

    if isinstance(any_1, torch.Tensor) and isinstance(any_2, torch.Tensor):
        if any_1.shape[1:] != any_2.shape[1:]:
            upscaled = _upscale_to_ref(any_2, any_1)
            if upscaled is not None:
                print(
                    f"[BatchAnyMerge] 提示: 张量空间维度不匹配 "
                    f"({any_2.shape} → {any_1.shape}), 已自动缩放"
                )
                any_2 = upscaled
            else:
                print(
                    f"[BatchAnyMerge] 警告: 张量形状不兼容且无法缩放 "
                    f"({any_1.shape} vs {any_2.shape}), 取第一份"
                )
                return any_1
        return torch.cat((any_1, any_2), dim=0)

    if (isinstance(any_1, dict) and "samples" in any_1 and
            isinstance(any_2, dict) and "samples" in any_2):
        return merge_latents([any_1, any_2])

    if isinstance(any_1, dict) and "samples" in any_1:
        return any_1
    if isinstance(any_2, dict) and "samples" in any_2:
        return any_2

    if isinstance(any_1, list) and isinstance(any_2, list):
        return any_1 + any_2

    if isinstance(any_1, tuple) and isinstance(any_2, tuple):
        return any_1 + any_2

    if isinstance(any_1, (str, int, float, bool)) and isinstance(any_2, (str, int, float, bool)):
        return [any_1, any_2]

    if isinstance(any_1, list) and isinstance(any_2, (str, int, float, bool)):
        return any_1 + [any_2]
    if isinstance(any_2, list) and isinstance(any_1, (str, int, float, bool)):
        return [any_1] + any_2
    if isinstance(any_1, tuple) and isinstance(any_2, (str, int, float, bool)):
        return any_1 + (any_2,)
    if isinstance(any_2, tuple) and isinstance(any_1, (str, int, float, bool)):
        return (any_1,) + any_2

    try:
        return any_1 + any_2
    except Exception:
        return any_1 if any_1 is not None else any_2



class BatchAnyMerge:
    """
    将 N 个同类型对象合并为一个 batch。

    支持类型:
      - torch.Tensor    : 沿 dim=0 拼接, 空间尺寸不同时自动缩放到第一个输入的分辨率
      - latent dict     : 合并 samples + state_info + 其他附加数据
      - list / tuple    : 直接拼接
      - str / int / float : 组合为 list
      - 其他类型        : 尝试 + 运算符

    特别优化:
      - 正确合并 RES4LYF ClownsharK 的 state_info (per-batch 张量 cat, 共享字段保留)
      - 未知字段自动探测合并策略, 便于后续扩展
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "any_1": ("*", {}),
                "inputcount": ("INT", {"default": 2, "min": 2, "max": 50, "step": 1}),
            },
            "optional": {
                "any_2": ("*", {}),
            },
        }

    RETURN_TYPES = ("*",)
    RETURN_NAMES = ("batch",)
    FUNCTION = "execute"
    CATEGORY = "utils"
    DESCRIPTION = """
合并多个同类型对象为一个 batch。
支持 latent / Tensor / list / tuple / 基础类型。
正确处理 ClownsharK 等采样器的 state_info 数据。
修改 inputcount 后点击 Update inputs 按钮刷新输入槽数量。
"""

    def execute(self, inputcount, **kwargs):
        inputs = []
        for i in range(1, inputcount + 1):
            key = f"any_{i}"
            val = kwargs.get(key, None)
            if val is not None:
                inputs.append(val)

        if not inputs:
            return (None,)

        if len(inputs) == 1:
            return (inputs[0],)

        result = inputs[0]
        for i in range(1, len(inputs)):
            result = merge_two(result, inputs[i])

        return (result,)
