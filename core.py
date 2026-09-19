"""
ComfyUI-Common-toolbox — 核心算法
============================================

包含:
  - analyze_subject       : 主体分析 (BBox / Visual Center / 面积)
  - compute_crop_box      : 构图参数 → crop box
  - check_subject_visibility: 主体可见度检查
  - deduplicate           : 构图去重
  - rank_candidates       : 启发式打分排序
  - build_contact_sheet   : 拼图预览
  - get_templates_for_mode: 模式 → 模板列表
  - expand_with_aspects   : 模板 → (模板, 画幅) 列表
"""

import math
import random
import json
import numpy as np
import torch
from PIL import Image, ImageDraw, ImageFont

try:
    import cv2
    _HAS_CV2 = True
except ImportError:
    _HAS_CV2 = False

from .templates import TEMPLATES_V1, COMPOSITION_MODES


# ═══════════════════════════════════════════════════════════════
#  ① Subject Analyzer
# ═══════════════════════════════════════════════════════════════

def analyze_subject(subject_mask, head_hint=None, head_bias=0.70):
    """
    主体分析: 提取 BBox / 几何中心 / 视觉中心 / 主体面积 / 相对位置

    参数:
        subject_mask: np.ndarray [H, W] uint8 (0~255)
        head_hint:    np.ndarray [H, W] uint8 可选, 头部 mask
        head_bias:    float 0~1, 头部权重 (0=纯几何中心, 1=纯头部)
    返回:
        dict
    """
    bin_mask = (subject_mask > 127).astype(np.uint8)
    if bin_mask.sum() == 0:
        raise ValueError("Subject mask is empty — please provide a valid mask.")

    H, W = bin_mask.shape

    # BBox
    ys, xs = np.where(bin_mask > 0)
    bbox = (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))
    bw = max(bbox[2] - bbox[0], 1)
    bh = max(bbox[3] - bbox[1], 1)
    bbox_area = bw * bh

    # 几何中心 (mask 重心)
    if _HAS_CV2:
        moments = cv2.moments(bin_mask)
        m00 = max(moments["m00"], 1e-6)
        geo_cx = moments["m10"] / m00
        geo_cy = moments["m01"] / m00
    else:
        total = max(bin_mask.sum(), 1)
        geo_cx = float(xs.mean())
        geo_cy = float(ys.mean())

    # 视觉中心 (有头部 mask 就偏向头部)
    if head_hint is not None and (head_hint > 127).sum() > 0:
        ys_h, xs_h = np.where(head_hint > 127)
        head_cx = float(xs_h.mean())
        head_cy = float(ys_h.mean())
        visual_cx = head_bias * head_cx + (1 - head_bias) * geo_cx
        visual_cy = head_bias * head_cy + (1 - head_bias) * geo_cy
    else:
        visual_cx, visual_cy = float(geo_cx), float(geo_cy)

    subject_area = int(bin_mask.sum())
    fill_ratio = subject_area / bbox_area
    rel_pos = (visual_cx / W, visual_cy / H)

    return {
        "bbox": bbox,
        "bbox_w": bw,
        "bbox_h": bh,
        "bbox_area": bbox_area,
        "geometric_center": (float(geo_cx), float(geo_cy)),
        "visual_center": (float(visual_cx), float(visual_cy)),
        "rel_pos": rel_pos,
        "subject_area": subject_area,
        "fill_ratio": float(fill_ratio),
    }


# ═══════════════════════════════════════════════════════════════
#  ①b Subject Estimators (subject_mask 未连接时的自动主体估算)
# ═══════════════════════════════════════════════════════════════

def _center_prior(h, w):
    """中心高斯先验权重图 (AI 生图主体多居中, 越靠边权重越低)."""
    ys = (np.arange(h, dtype=np.float32) - h / 2) / (h / 2)
    xs = (np.arange(w, dtype=np.float32) - w / 2) / (w / 2)
    gy = np.exp(-ys ** 2 / 0.55)
    gx = np.exp(-xs ** 2 / 0.55)
    return np.outer(gy, gx).astype(np.float32)


def _box3(m):
    """3x3 均值滤波的 numpy 实现 (无 cv2 时的 fallback)."""
    s = np.zeros_like(m)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            s += np.roll(np.roll(m, dy, axis=0), dx, axis=1)
    return s / 9.0


def estimate_subject_saliency(img_np, down_size=256, keep_ratio=0.10):
    """谱残差显著性检测 (Hou & Zhang 2007) + 中心先验 → 主体 mask.

    纯 numpy FFT 实现, ~20-50ms; cv2 可用时用于加速缩放/形态学.
    返回 [H, W] uint8 (0/255); 失败抛 RuntimeError.
    """
    H, W = img_np.shape[:2]
    work = img_np[:, :, :3] if (img_np.ndim == 3 and img_np.shape[2] >= 3) else img_np

    scale = min(down_size / H, down_size / W)
    if scale < 1.0:
        if not _HAS_CV2:
            raise RuntimeError("saliency 缩放需要 opencv")
        sw, sh = max(int(W * scale), 16), max(int(H * scale), 16)
        work = cv2.resize(work, (sw, sh), interpolation=cv2.INTER_AREA)

    if _HAS_CV2 and work.ndim == 3:
        gray = cv2.cvtColor(work, cv2.COLOR_RGB2GRAY).astype(np.float32)
    elif work.ndim == 3:
        gray = work.mean(axis=2).astype(np.float32)
    else:
        gray = work.astype(np.float32)

    f = np.fft.fft2(gray)
    log_amp = np.log(np.abs(f) + 1e-8)
    avg_amp = cv2.blur(log_amp, (3, 3)) if _HAS_CV2 else _box3(log_amp)
    residual = log_amp - avg_amp
    sal = np.abs(np.fft.ifft2(np.exp(residual + 1j * np.angle(f)))) ** 2

    h, w = sal.shape
    sal = sal / (sal.max() + 1e-12)
    sal = sal * _center_prior(h, w)
    sal = sal / (sal.max() + 1e-12)

    # 大核模糊聚块, 弱化高频噪声导致的散点
    if _HAS_CV2:
        sal = cv2.GaussianBlur(sal, (0, 0), sigmaX=max(h, w) / 16.0)
        sal = sal / (sal.max() + 1e-12)

    # 双阈值: 绝对阈值 (0.35*max, 收紧 bbox) 与分位阈值取较大者
    thresh = max(0.35 * float(sal.max()),
                 float(np.quantile(sal, 1.0 - keep_ratio)))
    bin_sal = (sal >= max(thresh, 1e-6)).astype(np.uint8)
    if bin_sal.sum() == 0:
        raise RuntimeError("saliency 结果为空")

    # 形态学闭运算聚块 + 只保留最大连通域 (去零散高光点);
    # 若最大连通域过散 (占比 <1%) 视为检测失败, 交由上层 fallback.
    if _HAS_CV2:
        bin_sal = cv2.morphologyEx(bin_sal, cv2.MORPH_CLOSE,
                                   np.ones((5, 5), np.uint8))
        n, labels, stats, _ = cv2.connectedComponentsWithStats(bin_sal)
        if n > 1:
            keep = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
            if stats[keep, cv2.CC_STAT_AREA] < 0.01 * h * w:
                raise RuntimeError("saliency 最大连通域过小, 结果不可信")
            bin_sal = (labels == keep).astype(np.uint8)
    else:
        # numpy fallback: 粗去噪 — 只保留面积占比 ≥1/1000 的块不可行, 直接用整体
        pass

    if bin_sal.shape != (H, W):
        bin_sal = cv2.resize(bin_sal, (W, H), interpolation=cv2.INTER_NEAREST)
    if bin_sal.sum() == 0:
        raise RuntimeError("saliency 结果为空")
    return (bin_sal * 255).astype(np.uint8)


def estimate_subject_grabcut(img_np, seed_rect=None):
    """GrabCut 迭代分割 → 主体 mask (需 opencv, 1~3s).

    seed_rect: (x, y, w, h) 初始前景矩形; 默认画面中央 70% 区域.
    内部压到长边 512 加速, 结果上采样回原尺寸. 失败抛 RuntimeError.
    """
    if not _HAS_CV2:
        raise RuntimeError("GrabCut 需要 opencv (cv2)")
    H, W = img_np.shape[:2]

    scale = min(512.0 / max(H, W), 1.0)
    sw, sh = max(int(W * scale), 16), max(int(H * scale), 16)
    small = cv2.resize(img_np[:, :, :3], (sw, sh),
                       interpolation=cv2.INTER_AREA)
    if seed_rect is None:
        rx, ry = int(sw * 0.15), int(sh * 0.15)
        rw, rh = sw - 2 * rx, sh - 2 * ry
    else:
        x, y, w0, h0 = seed_rect
        rx, ry = int(x * scale), int(y * scale)
        rw, rh = max(int(w0 * scale), 8), max(int(h0 * scale), 8)
        rx = min(max(rx, 0), sw - 8)
        ry = min(max(ry, 0), sh - 8)
        rw = min(rw, sw - rx)
        rh = min(rh, sh - ry)

    bgr = cv2.cvtColor(small, cv2.COLOR_RGB2BGR)
    gc_mask = np.full((sh, sw), cv2.GC_BGD, np.uint8)
    gc_mask[ry:ry + rh, rx:rx + rw] = cv2.GC_PR_FGD
    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    cv2.grabCut(bgr, gc_mask, (rx, ry, rw, rh), bgd, fgd, 5,
                cv2.GC_INIT_WITH_RECT)
    out = np.where((gc_mask == cv2.GC_FGD) | (gc_mask == cv2.GC_PR_FGD),
                   1, 0).astype(np.uint8)
    if out.sum() < 0.005 * sw * sh:
        raise RuntimeError("GrabCut 结果面积过小")

    if out.shape != (H, W):
        out = cv2.resize(out, (W, H), interpolation=cv2.INTER_NEAREST)
    return (out * 255).astype(np.uint8)


def estimate_subject_center(img_np, ratio=0.70):
    """中心主体假设: 画面中央 ratio 比例矩形填充 mask (内部兜底, 不会失败)."""
    H, W = img_np.shape[:2]
    m = np.zeros((H, W), np.uint8)
    x1 = int(W * (1 - ratio) / 2)
    y1 = int(H * (1 - ratio) / 2)
    m[y1:H - y1, x1:W - x1] = 255
    return m


# ═══════════════════════════════════════════════════════════════
#  ② Crop Calculator
# ═══════════════════════════════════════════════════════════════

def compute_crop_box(
    img_w, img_h,
    bbox,
    visual_center,
    scale_target,
    position,
    padding,
    aspect_ratio,
    allow_crop_subject,
):
    """
    把构图模板参数翻译成 crop box (x1, y1, x2, y2)

    参数:
        scale_target      : 主体 bbox 面积占 crop 面积的目标比例 (0~1)
        position          : (px, py) 主体中心在 crop 内可用空间的相对位置
                            0.5=居中, <0.5=偏左/上, >0.5=偏右/下
        padding           : crop 相对主体的额外外扩比例
        aspect_ratio      : crop 的 W/H
        allow_crop_subject: 是否允许 crop 不完全包含主体
    返回:
        (x1, y1, x2, y2) int
    """
    bx1, by1, bx2, by2 = bbox
    sb_w = max(bx2 - bx1, 1)
    sb_h = max(by2 - by1, 1)
    sb_area = sb_w * sb_h

    # 1) 用 scale + aspect_ratio 确定 crop 尺寸
    #    sb_area / (crop_w * crop_h) = scale_target
    #    crop_w / crop_h = aspect_ratio
    crop_area = sb_area / max(scale_target, 0.01)
    crop_w = math.sqrt(crop_area * aspect_ratio)
    crop_h = crop_w / aspect_ratio

    # 2) 应用 padding (额外外扩)
    crop_w *= (1.0 + padding)
    crop_h *= (1.0 + padding)

    # 3) 计算 crop 中心
    #    position 是主体中心在 crop 内可用空间的相对位置
    #    可用空间 = crop 尺寸 - 主体尺寸
    #    px=0.5 → 居中 → crop 中心 = 主体中心
    #    px<0.5 → 主体偏左 → crop 中心在主体右侧
    usable_w = max(crop_w - sb_w, 0.0)
    usable_h = max(crop_h - sb_h, 0.0)
    offset_x = (0.5 - position[0]) * usable_w
    offset_y = (0.5 - position[1]) * usable_h
    crop_cx = visual_center[0] + offset_x
    crop_cy = visual_center[1] + offset_y

    x1 = crop_cx - crop_w / 2.0
    y1 = crop_cy - crop_h / 2.0
    x2 = crop_cx + crop_w / 2.0
    y2 = crop_cy + crop_h / 2.0

    # 4) 不允许裁主体时, 平移 crop 确保完全包含主体
    if not allow_crop_subject:
        if x1 > bx1:
            shift = x1 - bx1
            x1 -= shift; x2 -= shift
        if x2 < bx2:
            shift = bx2 - x2
            x1 += shift; x2 += shift
        if y1 > by1:
            shift = y1 - by1
            y1 -= shift; y2 -= shift
        if y2 < by2:
            shift = by2 - y2
            y1 += shift; y2 += shift

    # 5) clamp 到图片边界
    x1 = max(0.0, min(x1, img_w - 1))
    y1 = max(0.0, min(y1, img_h - 1))
    x2 = max(1.0, min(x2, img_w))
    y2 = max(1.0, min(y2, img_h))

    # 6) 保证最小尺寸
    if x2 - x1 < 8:
        cx = (x1 + x2) / 2
        x1 = max(0, cx - 4)
        x2 = min(img_w, cx + 4)
    if y2 - y1 < 8:
        cy = (y1 + y2) / 2
        y1 = max(0, cy - 4)
        y2 = min(img_h, cy + 4)

    return (int(x1), int(y1), int(x2), int(y2))


def check_subject_visibility(crop_box, bbox, min_visibility=0.80):
    """检查主体在 crop 内的可见度, 返回 (ratio, ok)"""
    x1, y1, x2, y2 = crop_box
    bx1, by1, bx2, by2 = bbox

    vis_x1 = max(x1, bx1)
    vis_y1 = max(y1, by1)
    vis_x2 = min(x2, bx2)
    vis_y2 = min(y2, by2)

    vis = max(0, vis_x2 - vis_x1) * max(0, vis_y2 - vis_y1)
    sub = max((bx2 - bx1) * (by2 - by1), 1)
    ratio = vis / sub

    return float(ratio), ratio >= min_visibility


# ═══════════════════════════════════════════════════════════════
#  ③ Deduper
# ═══════════════════════════════════════════════════════════════

def deduplicate(compositions, threshold=0.85):
    """
    去除高度重复的构图
    compositions: list of dict, 每个含 'center', 'scale', 'aspect'
    """
    kept = []
    for c in compositions:
        is_dup = False
        for k in kept:
            dx = c["center"][0] - k["center"][0]
            dy = c["center"][1] - k["center"][1]
            dist = math.hypot(dx, dy)
            scale_sim = min(c["scale"], k["scale"]) / max(c["scale"], k["scale"], 1e-6)
            aspect_sim = min(c["aspect"], k["aspect"]) / max(c["aspect"], k["aspect"], 1e-6)
            if dist < 0.08 and scale_sim > threshold and aspect_sim > threshold:
                is_dup = True
                break
        if not is_dup:
            kept.append(c)
    return kept


# ═══════════════════════════════════════════════════════════════
#  ④ Ranker
# ═══════════════════════════════════════════════════════════════

def _score_sharpness(img_np):
    """Laplacian 方差, 越大越锐利"""
    if not _HAS_CV2:
        return 0.5
    if img_np.ndim == 3:
        gray = cv2.cvtColor(img_np, cv2.COLOR_RGB2GRAY)
    else:
        gray = img_np
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def _score_balance(crop_box, img_w, img_h):
    """主体距画面 4 角距离的标准差 (越小越平衡)"""
    x1, y1, x2, y2 = crop_box
    cx = (x1 + x2) / 2.0
    cy = (y1 + y2) / 2.0
    corners = [
        math.hypot(cx, cy),
        math.hypot(cx - img_w, cy),
        math.hypot(cx, cy - img_h),
        math.hypot(cx - img_w, cy - img_h),
    ]
    std = float(np.std(corners)) / max(img_w, img_h, 1)
    return float(1.0 / (1.0 + std))


def _score_information(img_np):
    """高频能量 (Sobel)"""
    if not _HAS_CV2:
        return 0.5
    if img_np.ndim == 3:
        gray = cv2.cvtColor(img_np, cv2.COLOR_RGB2GRAY)
    else:
        gray = img_np
    sx = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
    sy = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
    return float((sx.std() + sy.std()) / 2.0)


def rank_candidates(crops_np, crop_boxes, img_w, img_h, top_k=3):
    """
    启发式打分: 0.5*sharpness + 0.3*balance + 0.2*information
    返回排序后的索引列表 (长度 = min(top_k, len))
    """
    if len(crops_np) == 0:
        return []
    scores = []
    for i, (img, box) in enumerate(zip(crops_np, crop_boxes)):
        s1 = _score_sharpness(img)
        s2 = _score_balance(box, img_w, img_h)
        s3 = _score_information(img)
        s1_n = min(s1 / 500.0, 1.0)
        s3_n = min(s3 / 50.0, 1.0)
        final = 0.5 * s1_n + 0.3 * s2 + 0.2 * s3_n
        scores.append((i, final))
    scores.sort(key=lambda x: -x[1])
    return [s[0] for s in scores[:top_k]]


# ═══════════════════════════════════════════════════════════════
#  ⑤ Contact Sheet Builder
# ═══════════════════════════════════════════════════════════════

def _load_font(size=14):
    """跨平台字体加载"""
    candidates = [
        "arial.ttf",
        "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/segoeui.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for p in candidates:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default()


def build_contact_sheet(crops_np, labels, cols=4, cell_size=256,
                        padding=8, bg_color=(32, 32, 32)):
    """
    拼图预览
    crops_np: list of np.ndarray [H, W, 3] uint8
    labels:   list of str
    返回: np.ndarray [H, W, 3] uint8
    """
    n = len(crops_np)
    if n == 0:
        return np.zeros((64, 64, 3), dtype=np.uint8)

    rows = (n + cols - 1) // cols
    cell_w = cell_size
    cell_h = cell_size + 28  # 给 label 留 28px

    sheet_w = cols * cell_w + (cols + 1) * padding
    sheet_h = rows * cell_h + (rows + 1) * padding

    sheet = Image.new("RGB", (sheet_w, sheet_h), bg_color)
    draw = ImageDraw.Draw(sheet)
    font = _load_font(14)

    for i, (img, label) in enumerate(zip(crops_np, labels)):
        r, c = i // cols, i % cols
        x = padding + c * (cell_w + padding)
        y = padding + r * (cell_h + padding)

        if img.dtype != np.uint8:
            img = (img * 255).clip(0, 255).astype(np.uint8)
        pil_img = Image.fromarray(img)
        pil_img.thumbnail((cell_w, cell_size), Image.LANCZOS)

        ix = x + (cell_w - pil_img.width) // 2
        iy = y + (cell_size - pil_img.height) // 2
        sheet.paste(pil_img, (ix, iy))

        text = f"{i+1:02d}. {label}"
        draw.text((x + 4, y + cell_size + 4), text,
                  fill=(255, 255, 255), font=font)

    return np.array(sheet)


# ═══════════════════════════════════════════════════════════════
#  ⑥ Template Engine
# ═══════════════════════════════════════════════════════════════

def get_templates_for_mode(mode, num_candidates, seed=0):
    """根据 composition_mode 返回要使用的模板 ID 列表"""
    if mode == "random":
        rng = random.Random(seed)
        all_ids = list(TEMPLATES_V1.keys())
        if num_candidates >= len(all_ids):
            return all_ids
        return rng.sample(all_ids, num_candidates)

    template_ids = COMPOSITION_MODES.get(mode, COMPOSITION_MODES["all"])
    if template_ids is None:
        template_ids = list(TEMPLATES_V1.keys())

    if num_candidates <= len(template_ids):
        return template_ids[:num_candidates]
    return template_ids


def expand_with_aspects(template_ids, max_aspect_variants=2):
    """为每个模板拓展多种 aspect ratio 候选"""
    result = []
    for tid in template_ids:
        tpl = TEMPLATES_V1[tid]
        aspects = tpl["aspect_pool"][:max_aspect_variants]
        for ar in aspects:
            result.append((tid, ar))
    return result


def get_templates_for_modes(modes_str, num_candidates, seed=0,
                             custom_aspect_ratios=None):
    """
    支持多模式合并 (逗号分隔), 可选附加自定义画幅比

    参数:
        modes_str: "lifestyle,cinematic" 或单个 mode
        custom_aspect_ratios: list of float, 用户上传参考图提取的画幅比
    返回:
        list of (template_id, aspect_ratio)
    """
    if not modes_str or not modes_str.strip():
        modes = ["lifestyle"]
    else:
        modes = [m.strip() for m in modes_str.split(",") if m.strip()]

    # 收集所有模板 ID (去重, 保序)
    all_template_ids = []
    seen = set()
    for mode in modes:
        if mode == "random":
            rng = random.Random(seed)
            all_ids = list(TEMPLATES_V1.keys())
            tids = rng.sample(all_ids, min(num_candidates, len(all_ids)))
        else:
            tids = COMPOSITION_MODES.get(mode, [])
        for tid in tids:
            if tid not in seen:
                all_template_ids.append(tid)
                seen.add(tid)

    if not all_template_ids:
        all_template_ids = list(COMPOSITION_MODES["lifestyle"])

    # 拓展画幅
    pairs = expand_with_aspects(all_template_ids, max_aspect_variants=2)

    # 附加自定义画幅 (用户上传参考图)
    if custom_aspect_ratios:
        for tid in all_template_ids:
            for ar in custom_aspect_ratios:
                pair = (tid, float(ar))
                if pair not in pairs:
                    pairs.append(pair)

    return pairs
