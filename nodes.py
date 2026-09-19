import math
import json
import random
import os
import re
import time as _time_module
from typing import Dict, Optional
import numpy as np
import torch

try:
    import cv2
    _HAS_CV2 = True
except ImportError:
    _HAS_CV2 = False

try:
    from PIL import Image as _PILImage
    _HAS_PIL = True
except ImportError:
    _HAS_PIL = False
    _PILImage = None

from .core import (
    analyze_subject,
    estimate_subject_saliency,
    estimate_subject_grabcut,
    estimate_subject_center,
    compute_crop_box,
    check_subject_visibility,
    deduplicate,
    rank_candidates,
    build_contact_sheet,
    get_templates_for_modes,
)
from .templates import TEMPLATES_V1

try:
    from comfy.model_management import InterruptProcessingException as _IPE
    _HAS_INTERRUPT = True
except ImportError:
    _IPE = None
    _HAS_INTERRUPT = False


def _raise_interrupt(msg: str):
    """统一中断入口 — 新版 ComfyUI 用 InterruptProcessingException,
    老版本退回 RuntimeError 阻断执行."""
    if _HAS_INTERRUPT:
        raise _IPE(msg)
    raise RuntimeError(msg)


LATEST_REFS_BY_NODE_ID: Dict[str, Dict] = {}

def _extract_pure_node_id(s) -> Optional[str]:
    """提取纯数字 node_id (复合 unique_id 的末段)."""
    if s is None:
        return None
    s = str(s).strip()
    last = re.split(r"[.:_\-]+", s)[-1] if s else ""
    return last if last.isdigit() else None

def _find_cache_entry(nid: str) -> tuple:
    if not nid:
        return ({}, "")
    nid_str = str(nid)
    base_nid = _chooser_base_id(nid_str) or nid_str
    entry = LATEST_REFS_BY_NODE_ID.get(nid_str)
    if entry:
        return (entry, f"exact:{nid_str}")
    if base_nid != nid_str:
        entry = LATEST_REFS_BY_NODE_ID.get(base_nid)
        if entry:
            return (entry, f"base-exact:{base_nid}")
    match_nid = base_nid
    for stored_key in list(LATEST_REFS_BY_NODE_ID.keys()):
        if stored_key == nid_str or stored_key == base_nid:
            continue
        if stored_key.endswith(f".{match_nid}") or stored_key.endswith(f":{match_nid}"):
            return (LATEST_REFS_BY_NODE_ID[stored_key], f"endswith:{stored_key}")
        tail = re.split(r"[.:_\-]+", stored_key)[-1]
        if tail == match_nid:
            return (LATEST_REFS_BY_NODE_ID[stored_key], f"tail-match:{stored_key}")
    return ({}, "")


CHOOSER_SESSIONS: Dict[str, Dict] = {}
CHOOSER_LAST_SELECTION: Dict[str, int] = {}


class _ChooserCancelled(Exception):
    """用户主动取消选择 — 转 InterruptProcessingException."""
    pass


class _ChooserRegen(Exception):
    def __init__(self, modes=None):
        super().__init__("regen requested")
        self.modes = modes


def _find_latest_generator_cache():
    best_key = None
    best_entry = None
    best_ts = -1.0
    for k, v in list(LATEST_REFS_BY_NODE_ID.items()):
        if not isinstance(v, dict):
            continue
        if not v.get("gen_inputs"):
            continue
        ts = float(v.get("gen_ts", 0) or 0)
        if ts > best_ts:
            best_ts = ts
            best_key = k
            best_entry = v
    return best_key, best_entry


def _rerun_generator_inline(gen_node_id, reference_image, chooser_node_key=None,
                            composition_modes=None):
    if not gen_node_id:
        located_key, located_entry = _find_latest_generator_cache()
        if located_key is None:
            raise RuntimeError(
                "[comp_crop] REGEN FAIL: 缓存中无任何 gen_inputs 条目 — "
                "无法定位 Generator, 请先正常跑一次 Generator"
            )
        gen_node_id = located_key
        cached = located_entry
    else:
        cached, _ = _find_cache_entry(gen_node_id)

    if not cached:
        raise RuntimeError(
            f"[comp_crop] REGEN FAIL: gen_node_id={gen_node_id} 缓存缺失, "
            f"无法重跑 Generator"
        )
    inputs = cached.get("gen_inputs") or {}
    if not inputs:
        raise RuntimeError(
            f"[comp_crop] REGEN FAIL: gen_node_id={gen_node_id} 缓存中无 "
            f"gen_inputs (缓存内容不完整), 无法重跑"
        )

    if reference_image is None:
        raise RuntimeError(
            "[comp_crop] REGEN FAIL: Chooser.reference_image 未连接, "
            "无法获取原图进行重跑"
        )

    seed = int(_time_module.time() * 1000) & 0x7FFFFFFF
    if composition_modes:
        modes_used = str(composition_modes)
    else:
        modes_used = inputs.get("composition_modes", "lifestyle")


    try:
        gen_instance = CropGenerator()
        result_dict = gen_instance.generate(
            image=reference_image,
            composition_modes=modes_used,
            auto_mask_method=inputs.get("auto_mask_method", "grabcut"),
            num_candidates=inputs.get("num_candidates", 20),
            max_aspect_variants=inputs.get("max_aspect_variants", 3),
            allow_crop_subject=inputs.get("allow_crop_subject", True),
            min_subject_visibility=inputs.get("min_subject_visibility", 0.6),
            head_bias=inputs.get("head_bias", 0.0),
            dedup_threshold=inputs.get("dedup_threshold", 0.85),
            top_k=inputs.get("top_k", 4),
            seed=seed,
            subject_mask=inputs.get("subject_mask"),
            head_hint=inputs.get("head_hint"),
            unique_id=gen_node_id,
            prompt_id=None,
        )
    except Exception as e:
        raise RuntimeError(
            f"[comp_crop] REGEN FAIL: Generator 重跑异常 "
            f"({type(e).__name__}: {e})"
        ) from e

    result = result_dict.get("result")
    if not result or len(result) < 3:
        raise RuntimeError(
            "[comp_crop] REGEN FAIL: Generator 返回值格式异常, "
            f"result={type(result).__name__}"
        )

    new_crops = result[0]
    new_bboxes = result[2]

    if new_crops is None:
        raise RuntimeError("[comp_crop] REGEN FAIL: Generator 返回 crops 为空")

    n = new_crops.shape[0] if hasattr(new_crops, "shape") else 0

    if chooser_node_key:
        gen_entry = LATEST_REFS_BY_NODE_ID.get(str(gen_node_id))
        if gen_entry:
            ck = str(chooser_node_key)
            LATEST_REFS_BY_NODE_ID[ck] = gen_entry
            c_alias = _chooser_base_id(chooser_node_key)
            alias_note = ""
            if c_alias and c_alias != ck:
                LATEST_REFS_BY_NODE_ID[c_alias] = gen_entry
                alias_note = f"+alias={c_alias}"

    return new_crops, new_bboxes
def _chooser_base_id(k) -> Optional[str]:
    if k is None:
        return None
    base = str(k).strip()
    if not base:
        return None
    if ":" in base:
        base = base.split(":", 1)[0]
    if "." in base:
        base = base.rsplit(".", 1)[-1]
    return base if base.isdigit() else None


def _find_chooser_session_key(nid) -> Optional[str]:
    if not nid:
        return None
    s = str(nid).strip()
    if not s:
        return None
    if s in CHOOSER_SESSIONS:
        return s
    for k in list(CHOOSER_SESSIONS.keys()):
        if _chooser_base_id(k) == s:
            return k
    return None


LATEST_REFIMG_BY_NODE_ID: Dict[str, Dict] = {}


def _save_reference_image(node_key: str, reference_image) -> None:
    ref_t = reference_image[0] if reference_image.dim() == 4 else reference_image
    ref_np = (ref_t.cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
    import folder_paths
    output_root = folder_paths.get_temp_directory()
    folder_name = f"comp_crop_ref_{int(_time_module.time())}"
    save_dir = os.path.join(output_root, folder_name)
    os.makedirs(save_dir, exist_ok=True)
    fname = "reference.png"
    fpath = os.path.join(save_dir, fname)
    ok = False
    if _HAS_CV2:
        ok = cv2.imwrite(fpath, cv2.cvtColor(ref_np, cv2.COLOR_RGB2BGR))
    elif _HAS_PIL:
        _PILImage.fromarray(ref_np).save(fpath)
        ok = True
    if not ok:
        raise RuntimeError("imwrite failed / no cv2/PIL available")
    payload = {
        "ref": {"filename": fname, "subfolder": folder_name, "type": "temp"},
        "ts": _time_module.time(),
    }
    LATEST_REFIMG_BY_NODE_ID[node_key] = payload
    alias = _chooser_base_id(node_key)
    if alias and alias != node_key:
        LATEST_REFIMG_BY_NODE_ID[alias] = payload


def _find_refimg_entry(nid) -> Optional[Dict]:
    if not nid:
        return None
    s = str(nid)
    if s in LATEST_REFIMG_BY_NODE_ID:
        return LATEST_REFIMG_BY_NODE_ID[s]
    for k in list(LATEST_REFIMG_BY_NODE_ID.keys()):
        if _chooser_base_id(k) == s:
            return LATEST_REFIMG_BY_NODE_ID[k]
    return None


def _resolve_interrupt_checker():
    import comfy.model_management as _mm
    fn = getattr(_mm, "throw_exception_if_processing_interrupted", None)
    if callable(fn):
        return fn

    _pi = getattr(_mm, "processing_interrupted", None)

    def _fallback_check():
        if callable(_pi) and _pi():
            _raise_interrupt("processing interrupted (fallback: processing_interrupted())")
        try:
            import nodes as _comfy_nodes
            if bool(getattr(_comfy_nodes, "interrupt_processing", False)):
                _raise_interrupt("processing interrupted (fallback: interrupt_processing flag)")
        except Exception:
            pass

    return _fallback_check


def _wait_for_choice(node_key: str, total_count: int,
                     period: float = 0.2, max_wait: float = 14400.0) -> int:
    _check_interrupt = _resolve_interrupt_checker()

    session = {"selected": None, "cancelled": False, "ts": _time_module.time(),
                "regen_requested": False}
    keys = {node_key}
    alias = _chooser_base_id(node_key)
    if alias and alias != node_key:
        keys.add(alias)
    for k in keys:
        CHOOSER_SESSIONS[k] = session
    print(
        f"[comp_crop] CHOOSE WAIT: node={node_key} "
        f"(+alias={alias if alias != node_key else '-'}) 候选={total_count} — "
        f"队列暂停在本节点, 等待用户点选缩略图 + [Progress]"
    )
    deadline = _time_module.time() + max_wait
    try:
        ticks = 0
        while _time_module.time() < deadline:
            if session.get("cancelled"):
                print(f"[comp_crop] CHOOSE CANCELLED: node={node_key}")
                raise _ChooserCancelled()

            if session.get("regen_requested"):
                regen_modes = session.get("regen_modes")
                print(
                    f"[comp_crop] CHOOSE REGEN: node={node_key} "
                    f"→ 同步重跑 Generator (auto-locate)"
                    + (f" modes={regen_modes!r}" if regen_modes else " (缓存 modes)")
                )
                session["regen_requested"] = False
                session["regen_modes"] = None
                raise _ChooserRegen(modes=regen_modes)

            sel = session.get("selected")
            if sel is not None:
                if isinstance(sel, int) and (sel == -2 or 0 <= sel < total_count):
                    print(
                        f"[comp_crop] CHOOSE PICK: node={node_key} "
                        f"index={sel}"
                        + (" (原图)" if sel == -2 else " — 唤醒, 同一条队列下游继续")
                    )
                    return sel
                session["selected"] = None
            _check_interrupt()
            _time_module.sleep(period)
            ticks += 1
        raise TimeoutError(f"等待用户选择超时 ({max_wait:.0f}s)")
    finally:
        for k in keys:
            CHOOSER_SESSIONS.pop(k, None)


def _store_last_selection(node_key: str, idx: int):
    """记住上次选择 (Once Pause 模式下次直接复用, 不再等待)."""
    CHOOSER_LAST_SELECTION[node_key] = idx
    alias = _chooser_base_id(node_key)
    if alias and alias != node_key:
        CHOOSER_LAST_SELECTION[alias] = idx


def _get_last_selection(node_key: str) -> Optional[int]:
    v = CHOOSER_LAST_SELECTION.get(node_key)
    if v is not None:
        return v
    alias = _chooser_base_id(node_key)
    if alias:
        return CHOOSER_LAST_SELECTION.get(alias)
    return None



def _clear_last_selection(node_key: str):
    CHOOSER_LAST_SELECTION.pop(node_key, None)
    alias = _chooser_base_id(node_key)
    if alias and alias != node_key:
        CHOOSER_LAST_SELECTION.pop(alias, None)



_ROUTES_REGISTERED = False


def _register_comp_crop_routes():
    global _ROUTES_REGISTERED
    if _ROUTES_REGISTERED:
        return
    try:
        from server import PromptServer as _PS
    except ImportError:
        print("[comp_crop] server.PromptServer 未找到, 自定义路由已禁用 "
              "(non-ComfyUI 环境下静默跳过)")
        return
    try:
        from aiohttp import web as _web
    except ImportError:
        print("[comp_crop] aiohttp.web 未找到, 自定义路由已禁用")
        return

    _ps_instance = getattr(_PS, "instance", None)
    if _ps_instance is None:
        print("[comp_crop] PromptServer.instance 暂未就绪, 路由注册延后/跳过")
        return

    try:
        @_ps_instance.routes.get("/comp_crop/refs/{node_id}")
        async def _comp_crop_get_refs(request):
            try:
                nid = request.match_info.get("node_id", "")
                cached, matched = _find_cache_entry(nid)
                refs = cached.get("refs", [])
                return _web.json_response({
                    "node_id": nid,
                    "refs": refs,
                    "count": len(refs),
                    "ts": cached.get("ts", 0),
                    "prompt_id": cached.get("prompt_id", "") or "",
                    "best_indices": cached.get("best_indices", []),
                    "crop_bboxes": cached.get("crop_bboxes", ""),
                })
            except Exception as _e:
                return _web.json_response(
                    {"error": str(_e), "refs": [], "count": 0}, status=500
                )

        print(
            "[comp_crop] \u2713 registered custom route "
            "GET /comp_crop/refs/{node_id} (cancel 三级兜底在 web 端)"
        )

        @_ps_instance.routes.post("/comp_crop/chooser_message")
        async def _comp_crop_chooser_message(request):
            try:
                data = await request.json()
            except Exception as _e:
                return _web.json_response(
                    {"code": -1, "waiting": False, "error": "bad json"},
                    status=400,
                )
            nid = data.get("node_id", "")
            action = str(data.get("action", ""))
            key = _find_chooser_session_key(nid)
            if key is None:
                return _web.json_response({
                    "code": -1,
                    "waiting": False,
                    "error": "no active chooser session for this node",
                })
            session = CHOOSER_SESSIONS[key]
            if action == "cancel":
                session["cancelled"] = True
                print(
                    f"[comp_crop] MESSAGE cancel: node={nid} "
                    f"(matched key={key})"
                )
            elif action == "regen":
                session["regen_requested"] = True
                regen_modes = data.get("composition_modes")
                if regen_modes:
                    session["regen_modes"] = str(regen_modes)
                print(
                    f"[comp_crop] MESSAGE regen: node={nid} "
                    f"(matched key={key}) → 标记同步重跑"
                    + (f" modes={regen_modes!r}" if regen_modes else "")
                )
            elif action == "select":
                try:
                    idx = int(data.get("index", -1))
                except (TypeError, ValueError):
                    idx = -1
                session["selected"] = idx
                print(
                    f"[comp_crop] MESSAGE select: node={nid} "
                    f"(matched key={key}) index={idx}"
                )
            else:
                return _web.json_response(
                    {"code": -1, "waiting": True, "error": "invalid action"},
                    status=400,
                )
            return _web.json_response({"code": 1, "waiting": True})

        print(
            "[comp_crop] \u2713 registered custom route "
            "POST /comp_crop/chooser_message (select/cancel/regen 唤醒阻塞等待)"
        )

        @_ps_instance.routes.get("/comp_crop/refimg/{node_id}")
        async def _comp_crop_get_refimg(request):
            try:
                nid = request.match_info.get("node_id", "")
                payload = _find_refimg_entry(nid)
                if not payload:
                    return _web.json_response(
                        {"node_id": nid, "ref": None, "ts": 0},
                        status=404,
                    )
                return _web.json_response({
                    "node_id": nid,
                    "ref": payload.get("ref"),
                    "ts": payload.get("ts", 0),
                })
            except Exception as _e:
                return _web.json_response(
                    {"error": str(_e), "ref": None}, status=500
                )

        print(
            "[comp_crop] \u2713 registered custom route "
            "GET /comp_crop/refimg/{node_id} (reference_image 对比 cell)"
        )
        _ROUTES_REGISTERED = True
    except Exception as _reg_e:
        print(f"[comp_crop] \u2717 route registration failed: {_reg_e}")


_register_comp_crop_routes()



class CropModeSelector:

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "modes_csv": ("STRING", {"default": "lifestyle", "multiline": False}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("composition_modes",)
    FUNCTION = "select"
    CATEGORY = "composition"

    def select(self, modes_csv="lifestyle"):
        valid = {"standard", "lifestyle", "cinematic", "documentary",
                 "dynamic", "extreme_closeup", "environmental", "banner"}
        picked = []
        for m in str(modes_csv or "").split(","):
            m = m.strip()
            if m in valid and m not in picked:
                picked.append(m)
        if not picked:
            picked = ["lifestyle"]
        return (",".join(picked),)



class CropGenerator:

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "composition_modes": ("STRING", {
                    "default": "lifestyle", "multiline": False
                }),
                "auto_mask_method": (["grabcut"], {
                    "default": "grabcut",
                }),
                "num_candidates": ("INT", {
                    "default": 12, "min": 1, "max": 60, "step": 1
                }),
                "max_aspect_variants": ("INT", {
                    "default": 2, "min": 1, "max": 4, "step": 1
                }),
                "allow_crop_subject": ("BOOLEAN", {"default": True}),
                "min_subject_visibility": ("FLOAT", {
                    "default": 0.80, "min": 0.10, "max": 1.0, "step": 0.05
                }),
                "head_bias": ("FLOAT", {
                    "default": 0.70, "min": 0.0, "max": 1.0, "step": 0.05
                }),
                "dedup_threshold": ("FLOAT", {
                    "default": 0.85, "min": 0.50, "max": 0.99, "step": 0.01
                }),
                "top_k": ("INT", {
                    "default": 3, "min": 1, "max": 20, "step": 1
                }),
                "seed": ("INT", {
                    "default": 0, "min": 0, "max": 0xFFFFFFFF
                }),
            },
            "optional": {
                "subject_mask": ("MASK",),
                "head_hint": ("MASK",),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
                "prompt_id": "PROMPT_ID",
            },
        }

    RETURN_TYPES = ("IMAGE", "STRING", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("crops", "crops_manifest", "crop_bboxes",
                    "composition_labels", "best_indices")
    FUNCTION = "generate"
    CATEGORY = "composition"

    def generate(self, image, composition_modes, auto_mask_method,
                 num_candidates, max_aspect_variants, allow_crop_subject,
                 min_subject_visibility, head_bias, dedup_threshold,
                 top_k, seed, subject_mask=None, head_hint=None,
                 unique_id=None, prompt_id=None):


        if image.dim() == 4:
            img_tensor = image[0]
        else:
            img_tensor = image
        img_np = (img_tensor.cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
        if img_np.ndim == 3 and img_np.shape[2] == 4:
            _alpha = img_np[:, :, 3]
            if int(_alpha.min()) < 255:
                _a = _alpha.astype(np.float32) / 255.0
                _rgb = img_np[:, :, :3].astype(np.float32)
                img_np = (_rgb * _a[..., None] + 255.0 * (1.0 - _a[..., None])) \
                    .clip(0, 255).astype(np.uint8)
            else:
                img_np = img_np[:, :, :3]
        H_img, W_img = img_np.shape[:2]

        mask_np = None
        if subject_mask is not None:
            if subject_mask.dim() == 3:
                mask_np = subject_mask[0].cpu().numpy()
            else:
                mask_np = subject_mask.cpu().numpy()
            mask_np = (mask_np * 255).clip(0, 255).astype(np.uint8)
            if (mask_np > 127).sum() == 0:
                mask_np = None

        head_np = None
        if head_hint is not None:
            if head_hint.dim() == 3:
                head_np = (head_hint[0].cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
            else:
                head_np = (head_hint.cpu().numpy() * 255).clip(0, 255).astype(np.uint8)

        mask_source = "subject_mask"
        if mask_np is None:
            method = str(auto_mask_method or "grabcut").strip().lower()
            _t0 = _time_module.time()
            est_chain = [
                ("grabcut", estimate_subject_grabcut),
                ("saliency", estimate_subject_saliency),
                ("center", estimate_subject_center),
            ]
            mask_np = None
            for est_name, est_fn in est_chain:
                try:
                    mask_np = est_fn(img_np)
                    mask_source = f"auto:{est_name}"
                    break
                except Exception as _est_e:
                    pass

        subject_info = None
        if mask_np is not None:
            try:
                subject_info = analyze_subject(mask_np, head_hint=head_np,
                                               head_bias=head_bias)
            except ValueError:
                subject_info = None
        if subject_info is None:
            subject_info = {
                "bbox": (0, 0, W_img, H_img),
                "bbox_w": W_img, "bbox_h": H_img,
                "bbox_area": W_img * H_img,
                "geometric_center": (W_img / 2, H_img / 2),
                "visual_center": (W_img / 2, H_img / 2),
                "rel_pos": (0.5, 0.5),
                "subject_area": W_img * H_img,
                "fill_ratio": 1.0,
            }

        template_aspect_pairs = get_templates_for_modes(
            composition_modes, num_candidates, seed=seed
        )

        candidates = []
        for tid, aspect in template_aspect_pairs:
            tpl = TEMPLATES_V1.get(tid)
            if tpl is None:
                continue
            allow_crop = allow_crop_subject and tpl["allow_crop"]

            crop_box = compute_crop_box(
                img_w=W_img, img_h=H_img,
                bbox=subject_info["bbox"],
                visual_center=subject_info["visual_center"],
                scale_target=tpl["scale"],
                position=tpl["position"],
                padding=tpl["padding"],
                aspect_ratio=aspect,
                allow_crop_subject=allow_crop,
            )

            vis_ratio, ok = check_subject_visibility(
                crop_box, subject_info["bbox"], min_subject_visibility
            )
            if not ok and not allow_crop:
                continue

            cx_norm = (crop_box[0] + crop_box[2]) / 2.0 / W_img
            cy_norm = (crop_box[1] + crop_box[3]) / 2.0 / H_img
            crop_w = crop_box[2] - crop_box[0]
            crop_h = crop_box[3] - crop_box[1]
            scale_eff = subject_info["bbox_area"] / max(crop_w * crop_h, 1)

            candidates.append({
                "template_id": tid,
                "aspect": float(aspect),
                "crop_box": crop_box,
                "scale": float(scale_eff),
                "center": (float(cx_norm), float(cy_norm)),
                "allow_crop": allow_crop,
                "vis_ratio": vis_ratio,
                "desc": tpl["desc"],
            })

        candidates = deduplicate(candidates, threshold=dedup_threshold)

        if len(candidates) > num_candidates:
            candidates = candidates[:num_candidates]

        if len(candidates) == 0:
            tpl = TEMPLATES_V1["T01_Center_Standard"]
            crop_box = compute_crop_box(
                W_img, H_img, subject_info["bbox"],
                subject_info["visual_center"],
                tpl["scale"], tpl["position"], tpl["padding"],
                1.0, False
            )
            candidates.append({
                "template_id": "T01_Center_Standard",
                "aspect": 1.0, "crop_box": crop_box,
                "scale": 0.45, "center": (0.5, 0.5),
                "allow_crop": False, "vis_ratio": 1.0,
                "desc": tpl["desc"],
            })

        crops_np = []
        crop_bboxes = []
        labels = []
        metas = []

        for c in candidates:
            x1, y1, x2, y2 = c["crop_box"]
            cropped = img_np[y1:y2, x1:x2]
            if cropped.size == 0:
                continue
            crops_np.append(cropped)
            crop_bboxes.append({
                "index": len(crops_np) - 1,
                "template_id": c["template_id"],
                "bbox": [x1, y1, x2, y2],
                "size": [int(x2 - x1), int(y2 - y1)],
                "aspect": round(c["aspect"], 4),
                "vis_ratio": round(c["vis_ratio"], 4),
                "desc": c["desc"],
            })
            labels.append(f"{c['template_id']}_{c['aspect']:.2f}")
            metas.append(c)

        if len(crops_np) > 0:
            best_idx = rank_candidates(
                crops_np, [c["crop_box"] for c in metas],
                W_img, H_img, top_k=top_k
            )
        else:
            best_idx = []

        if len(crops_np) > 0:
            target_h, target_w = crops_np[0].shape[0:2]
            batch = np.zeros((len(crops_np), target_h, target_w, 3),
                             dtype=np.uint8)
            for i, c in enumerate(crops_np):
                if c.shape[0] != target_h or c.shape[1] != target_w:
                    if _HAS_CV2:
                        resized = cv2.resize(c, (target_w, target_h),
                                             interpolation=cv2.INTER_AREA)
                    else:
                        if _HAS_PIL:
                            resized = np.array(
                                _PILImage.fromarray(c).resize(
                                    (target_w, target_h), _PILImage.NEAREST)
                            )
                        else:
                            resized = np.zeros((target_h, target_w, 3),
                                                dtype=np.uint8)
                            h = min(c.shape[0], target_h)
                            w = min(c.shape[1], target_w)
                            resized[0:h, 0:w] = c[0:h, 0:w]
                    batch[i] = resized
                else:
                    batch[i] = c
            crops_tensor = torch.from_numpy(batch).float() / 255.0
        else:
            crops_tensor = torch.zeros((1, 64, 64, 3))

        payload = {
            "best_indices": [int(i) for i in best_idx],
            "crops": crop_bboxes,
        }
        bboxes_json = json.dumps(payload, ensure_ascii=False, indent=2)
        labels_str = "\n".join(
            [f"{i+1:02d}. {l}  [{crop_bboxes[i]['size'][0]}x{crop_bboxes[i]['size'][1]}]"
             for i, l in enumerate(labels)]
        )
        best_str = ",".join([str(i) for i in best_idx])

        try:
            import folder_paths
            import time as _time
            output_root = folder_paths.get_temp_directory()
            folder_name = f"comp_crop_temp_{int(_time.time())}"
            save_dir = os.path.join(output_root, folder_name)
            os.makedirs(save_dir, exist_ok=True)
            manifest = []
            save_errors = []
            for i, c in enumerate(crops_np):
                fname = f"crop_{i+1:02d}.png"
                fpath = os.path.join(save_dir, fname)
                try:
                    if _HAS_CV2:
                        if (c is None or c.ndim != 3
                                or c.shape[-1] not in (3, 4)):
                            save_errors.append(
                                f"#{i+1} bad shape {getattr(c, 'shape', None)}")
                            manifest.append("")
                            continue
                        if c.dtype != np.uint8:
                            c_to_save = c.astype(np.uint8)
                        else:
                            c_to_save = c
                        _ok = cv2.imwrite(
                            fpath,
                            cv2.cvtColor(c_to_save, cv2.COLOR_RGB2BGR))
                        if not _ok:
                            save_errors.append(f"#{i+1} imwrite returned False")
                            manifest.append("")
                            continue
                    elif _HAS_PIL:
                        _PILImage.fromarray(c).save(fpath)
                    else:
                        save_errors.append(f"#{i+1} no cv2/PIL available")
                        manifest.append("")
                        continue
                    manifest.append(os.path.join(folder_name, fname))
                except Exception as _e:
                    save_errors.append(f"#{i+1} {type(_e).__name__}: {_e}")
                    manifest.append("")
            crops_manifest = json.dumps(manifest, ensure_ascii=False)
            image_refs = []
            for relpath in manifest:
                if not relpath:
                    continue
                norm = relpath.replace("\\", "/")
                parts = norm.split("/")
                fname = parts[-1]
                subdir = "/".join(parts[:-1]) if len(parts) > 1 else ""
                image_refs.append({
                    "filename": fname,
                    "subfolder": subdir,
                    "type": "temp",
                })
            _saved_n = sum(1 for p in manifest if p)
            _failed_n = sum(1 for p in manifest if not p)
            if _failed_n > 0:
                print(
                    f"[comp_crop] STEP 11 WARN: "
                    f"{_failed_n}/{len(manifest)} 张裁剪图保存未成功, "
                    f"请检查磁盘空间/路径权限. 前 3 条错误: {save_errors[:3]}"
                )
            try:
                _on_disk = sorted(os.listdir(save_dir))
            except Exception as _dir_e:
                print(
                    f"[comp_crop] STEP 11 ON-DISK FAIL: "
                    f"cannot listdir({save_dir}): "
                    f"{type(_dir_e).__name__}: {_dir_e}"
                )
        except Exception as _e:
            crops_manifest = "[]"
            image_refs = []
            print(
                f"[comp_crop] STEP 11 ERROR: 保存流程出现异常 — "
                f"{type(_e).__name__}: {_e}"
            )

        cache_key = None
        cache_key_origin = None
        if unique_id:
            cache_key = str(unique_id)
            cache_key_origin = "unique_id"
        elif prompt_id:
            cache_key = f"unscoped_{str(prompt_id)[:12]}"
            cache_key_origin = f"prompt_id-prefix:{cache_key}"
        if cache_key:
            cache_value = {
                "refs": list(image_refs or []),
                "crop_bboxes": bboxes_json,
                "best_indices": [int(i) for i in best_idx],
                "ts": _time_module.time(),
                "gen_ts": _time_module.time(),
                "prompt_id": prompt_id,
                "gen_inputs": {
                    "composition_modes": composition_modes,
                    "auto_mask_method": auto_mask_method,
                    "num_candidates": num_candidates,
                    "max_aspect_variants": max_aspect_variants,
                    "allow_crop_subject": allow_crop_subject,
                    "min_subject_visibility": min_subject_visibility,
                    "head_bias": head_bias,
                    "dedup_threshold": dedup_threshold,
                    "top_k": top_k,
                    "subject_mask": subject_mask,
                    "head_hint": head_hint,
                },
            }
            LATEST_REFS_BY_NODE_ID[cache_key] = cache_value
            alias_key = _extract_pure_node_id(cache_key)
            aliases_extra = ""
            if alias_key and alias_key != cache_key:
                LATEST_REFS_BY_NODE_ID[alias_key] = cache_value
                aliases_extra = f"+alias={alias_key}"
        return {
            "ui": {
                "images": [],
                "_comp_image_refs": image_refs,
            },
            "result": (crops_tensor, crops_manifest, bboxes_json, labels_str, best_str),
        }



class ContactSheetBuilder:

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "cols": ("INT", {"default": 4, "min": 1, "max": 12, "step": 1}),
                "cell_size": ("INT", {"default": 256, "min": 64, "max": 1024, "step": 32}),
            },
            "optional": {
                "labels": ("STRING", {"multiline": True, "default": ""}),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("contact_sheet",)
    FUNCTION = "build"
    CATEGORY = "composition"

    def build(self, images, cols, cell_size, labels=""):
        if images.dim() == 4:
            n = images.shape[0]
            crops_np = [
                (images[i].cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
                for i in range(n)
            ]
        else:
            crops_np = [
                (images.cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
            ]
            n = 1

        label_list = []
        if labels and labels.strip():
            label_list = [l.strip() for l in labels.split("\n") if l.strip()]
        if len(label_list) < n:
            label_list += [f"img_{i+1}" for i in range(n - len(label_list))]
        label_list = label_list[:n]

        sheet_np = build_contact_sheet(crops_np, label_list,
                                       cols=cols, cell_size=cell_size)
        sheet_tensor = torch.from_numpy(sheet_np).float() / 255.0
        sheet_tensor = sheet_tensor.unsqueeze(0)

        return (sheet_tensor,)



class CropChooser:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "crops": ("IMAGE",),
                "crop_bboxes": ("STRING", {"default": "[]"}),
                "mode": (["Always Pause", "Once Pause", "Never Pause"],),
                "preview_rescale": ("FLOAT", {
                    "default": 1.0, "min": 0.25, "max": 2.0, "step": 0.05
                }),
                "_selected_index": ("INT", {
                    "default": -1, "min": -2, "max": 999, "step": 1,
                }),
            },
            "optional": {
                "reference_image": ("IMAGE",),
                "crops_manifest": ("STRING", {"forceInput": True}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("selected_crop",)
    FUNCTION = "choose"
    CATEGORY = "composition"

    def choose(self, crops, crop_bboxes, mode, preview_rescale,
               _selected_index=-1, reference_image=None,
               crops_manifest=None, unique_id=None):
        if crops.dim() != 4:
            crops = crops.unsqueeze(0)
        n = crops.shape[0]

        try:
            selected_index = int(_selected_index)
        except (TypeError, ValueError):
            selected_index = -1

        node_key = str(unique_id) if unique_id else "chooser_no_uid"

        if reference_image is not None:
            try:
                _save_reference_image(node_key, reference_image)
            except Exception as _re:
                print(
                    f"[comp_crop] REFIMG SAVE FAIL: node={node_key} "
                    f"— {type(_re).__name__}: {_re}"
                )

        bbox_list = []
        if crop_bboxes and str(crop_bboxes).strip():
            try:
                parsed = json.loads(crop_bboxes)
                if isinstance(parsed, dict):
                    bbox_list = parsed.get("crops", [])
                elif isinstance(parsed, list):
                    bbox_list = parsed
            except json.JSONDecodeError:
                bbox_list = []

        if selected_index == -1:
            if mode == "Never Pause":
                best = []
                try:
                    bp = json.loads(crop_bboxes) if crop_bboxes and str(crop_bboxes).strip() else {}
                    if isinstance(bp, dict):
                        best = bp.get("best_indices", []) or []
                except Exception:
                    best = []
                try:
                    cand = int(best[0]) if best else 0
                except (TypeError, ValueError, IndexError):
                    cand = 0
                selected_index = cand if 0 <= cand < n else 0
            elif mode == "Once Pause":
                stored = _get_last_selection(node_key)
                if stored is not None and (
                    (stored == -2 and reference_image is not None)
                    or 0 <= stored < n
                ):
                    selected_index = stored

        if selected_index == -1:
            while True:
                try:
                    selected_index = _wait_for_choice(node_key, n)
                    break
                except _ChooserCancelled:
                    _raise_interrupt(
                        "Crop Chooser: 用户取消选择 — 本次队列已中断"
                    )
                except TimeoutError as _te:
                    print(
                        f"[comp_crop] CHOOSE TIMEOUT: node={node_key} — {_te}"
                    )
                    _raise_interrupt(
                        "Crop Chooser: 等待用户选择超时 (4h) — 本次队列已中断"
                    )
                except _ChooserRegen as _regen_exc:
                    try:
                        new_crops, new_bboxes = _rerun_generator_inline(
                            "", reference_image, chooser_node_key=node_key,
                            composition_modes=_regen_exc.modes
                        )
                    except RuntimeError as _regen_err:
                        print(
                            f"[comp_crop] CHOOSE REGEN FAIL: node={node_key} "
                            f"— {_regen_err}"
                        )
                        _raise_interrupt(str(_regen_err))
                        continue
                    crops = new_crops
                    if crops.dim() != 4:
                        crops = crops.unsqueeze(0)
                    n = crops.shape[0]
                    crop_bboxes = new_bboxes
                    bbox_list = []
                    if crop_bboxes and str(crop_bboxes).strip():
                        try:
                            parsed = json.loads(crop_bboxes)
                            if isinstance(parsed, dict):
                                bbox_list = parsed.get("crops", [])
                            elif isinstance(parsed, list):
                                bbox_list = parsed
                        except json.JSONDecodeError:
                            bbox_list = []
                    _clear_last_selection(node_key)
            _store_last_selection(node_key, selected_index)

        if selected_index == -2:
            if reference_image is not None:
                out_ref = (reference_image if reference_image.dim() == 4
                           else reference_image.unsqueeze(0))
                print(
                    f"[comp_crop] CHOOSE REFERENCE: node={node_key} "
                    f"— 输出整张原图 shape={tuple(out_ref.shape)}"
                )
                return (out_ref,)
            print(
                f"[comp_crop] CHOOSE REFERENCE invalid: node={node_key} "
                f"— reference_image 未连线, 回退 #0"
            )
            selected_index = 0

        ref_np = None
        H_ref = W_ref = None
        if reference_image is not None:
            if reference_image.dim() == 4:
                ref_t = reference_image[0]
            else:
                ref_t = reference_image
            ref_np = (ref_t.cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
            H_ref, W_ref = ref_np.shape[:2]


        if ref_np is not None and len(bbox_list) > selected_index:
            meta = bbox_list[selected_index]
            bbox = meta.get("bbox")
            if bbox and len(bbox) == 4:
                x1, y1, x2, y2 = bbox
                x1 = max(0, min(int(x1), W_ref))
                y1 = max(0, min(int(y1), H_ref))
                x2 = max(0, min(int(x2), W_ref))
                y2 = max(0, min(int(y2), H_ref))
                if x2 > x1 and y2 > y1:
                    cropped = ref_np[y1:y2, x1:x2]
                    if cropped.size > 0:
                        selected_tensor = torch.from_numpy(
                            cropped[np.newaxis]
                        ).float() / 255.0
                        return (selected_tensor,)

        if crops_manifest:
            try:
                paths = (json.loads(crops_manifest)
                         if isinstance(crops_manifest, str)
                         else crops_manifest)
                if isinstance(paths, list) and 0 <= selected_index < len(paths):
                    relpath = paths[selected_index]
                    if relpath:
                        import folder_paths
                        full_path = os.path.join(
                            folder_paths.get_temp_directory(),
                            relpath.replace("\\", "/"),
                        )
                        if os.path.isfile(full_path) and _HAS_PIL:
                            pil_img = _PILImage.open(full_path).convert("RGB")
                            arr = np.array(pil_img)
                            return (
                                torch.from_numpy(arr[np.newaxis]).float() / 255.0,
                            )
            except Exception:
                pass

        selected_tensor = crops[selected_index:selected_index + 1]
        return (selected_tensor,)
