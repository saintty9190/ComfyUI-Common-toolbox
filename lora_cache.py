"""
LoRA Cache Manager — LoRA 加载缓存管理
========================================

功能:
  - 全局 LoRA 缓存，节点级隔离
  - 相同 (model_id, lora_name, strength) 组合复用结果
  - 支持节点级 unload（清空单个节点的所有缓存）
  - 常驻内存，直到 ComfyUI 重启

缓存结构:
  _CACHE = {
      node_id: {
          "model_id;lora_name;model_str;clip_str": (cached_model, cached_clip),
          ...
      },
      ...
  }
"""

import hashlib

# 全局缓存字典: node_id -> { cache_key -> (model, clip) }
_CACHE = {}


def _model_id(model):
    """生成 model 的唯一标识 (基于对象 id + 状态哈希)"""
    if model is None:
        return "None"
    # 使用 id(model) 作为标识，因为 model 对象加载后是稳定的
    return str(id(model))


def _cache_key(lora_name, model_strength, clip_strength, model_id_str):
    """生成缓存 key"""
    return f"{model_id_str};{lora_name};{model_strength};{clip_strength}"


def get_cached(node_id, lora_name, model_strength, clip_strength, model):
    """
    获取缓存的 LoRA 加载结果。
    
    Args:
        node_id: 节点实例 ID
        lora_name: LoRA 文件名
        model_strength: model 强度
        clip_strength: clip 强度
        model: model 对象（用于生成标识）
    
    Returns:
        (cached_model, cached_clip) 或 None（未命中）
    """
    if node_id not in _CACHE:
        return None
    mid = _model_id(model)
    key = _cache_key(lora_name, model_strength, clip_strength, mid)
    return _CACHE[node_id].get(key, None)


def set_cached(node_id, lora_name, model_strength, clip_strength, model, result_model, result_clip):
    """
    存入缓存。
    
    Args:
        node_id: 节点实例 ID
        lora_name: LoRA 文件名
        model_strength: model 强度
        clip_strength: clip 强度
        model: 原始 model 对象（用于生成标识）
        result_model: 加载 LoRA 后的 model
        result_clip: 加载 LoRA 后的 clip
    """
    if node_id not in _CACHE:
        _CACHE[node_id] = {}
    mid = _model_id(model)
    key = _cache_key(lora_name, model_strength, clip_strength, mid)
    _CACHE[node_id][key] = (result_model, result_clip)


def unload_node_cache(node_id):
    """
    清空指定节点的所有 LoRA 缓存。
    
    Args:
        node_id: 节点实例 ID
    
    Returns:
        清除的缓存条目数量
    """
    if node_id in _CACHE:
        count = len(_CACHE[node_id])
        del _CACHE[node_id]
        return count
    return 0


def get_cache_stats(node_id=None):
    """
    获取缓存统计信息。
    
    Args:
        node_id: 指定节点，为 None 则返回全部
    
    Returns:
        dict: { "node_count": ..., "total_entries": ..., "node_entries": {...} }
    """
    if node_id is not None:
        return {
            "node_entries": len(_CACHE.get(node_id, {})),
        }
    total = sum(len(v) for v in _CACHE.values())
    return {
        "node_count": len(_CACHE),
        "total_entries": total,
    }
