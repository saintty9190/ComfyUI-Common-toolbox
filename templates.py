# ─── Scale 档位 ───
SCALE_S  = 0.30   # 25~35%  小主体, 环境丰富
SCALE_M  = 0.45   # 35~50%  中主体, 最自然的 Lifestyle
SCALE_L  = 0.60   # 50~65%  大主体, 产品/人物突出
SCALE_XL = 0.75   # 65~85%  超大主体, 允许局部出画

# ─── Padding 档位 ───
PAD_SMALL  = 0.04
PAD_MEDIUM = 0.10
PAD_LARGE  = 0.20
PAD_XLARGE = 0.40

TEMPLATES_V1 = {
    # ═══ Standard / 商业安全 (5) ═══
    "T01_Center_Standard": {
        "position": (0.50, 0.50), "scale": SCALE_M, "padding": PAD_MEDIUM,
        "aspect_pool": [1.0, 1.33, 0.75], "allow_crop": False,
        "desc": "Center Standard - safest commercial composition",
    },
    "T02_Left_Standard": {
        "position": (0.35, 0.50), "scale": SCALE_M, "padding": PAD_MEDIUM,
        "aspect_pool": [1.0, 1.33, 0.75], "allow_crop": False,
        "desc": "Left Standard - text on right side",
    },
    "T03_Right_Standard": {
        "position": (0.65, 0.50), "scale": SCALE_M, "padding": PAD_MEDIUM,
        "aspect_pool": [1.0, 1.33, 0.75], "allow_crop": False,
        "desc": "Right Standard - lifestyle product",
    },
    "T04_Center_Tight": {
        "position": (0.50, 0.50), "scale": SCALE_L, "padding": PAD_SMALL,
        "aspect_pool": [1.0, 0.75], "allow_crop": False,
        "desc": "Center Tight - product closeup",
    },
    "T05_Center_Loose": {
        "position": (0.50, 0.50), "scale": SCALE_S, "padding": PAD_LARGE,
        "aspect_pool": [1.0, 1.33, 1.5], "allow_crop": False,
        "desc": "Center Loose - environmental portrait",
    },

    # ═══ Lifestyle / 自然 (6) ═══
    "T06_TopLeft_Thirds": {
        "position": (0.333, 0.333), "scale": SCALE_M, "padding": PAD_MEDIUM,
        "aspect_pool": [1.0, 1.33, 0.75], "allow_crop": False,
        "desc": "Top-Left Thirds - classic lifestyle",
    },
    "T07_BottomRight_Thirds": {
        "position": (0.667, 0.667), "scale": SCALE_M, "padding": PAD_MEDIUM,
        "aspect_pool": [1.0, 1.33, 0.75], "allow_crop": False,
        "desc": "Bottom-Right Thirds - mirror classic",
    },
    "T08_TopRight_Thirds": {
        "position": (0.667, 0.333), "scale": SCALE_M, "padding": PAD_MEDIUM,
        "aspect_pool": [1.0, 1.33], "allow_crop": False,
        "desc": "Top-Right Thirds - landscape",
    },
    "T09_BottomLeft_Thirds": {
        "position": (0.333, 0.667), "scale": SCALE_M, "padding": PAD_MEDIUM,
        "aspect_pool": [1.0, 1.33], "allow_crop": False,
        "desc": "Bottom-Left Thirds - mirror landscape",
    },
    "T10_Left_Banner": {
        "position": (0.30, 0.50), "scale": SCALE_S, "padding": PAD_XLARGE,
        "aspect_pool": [1.5, 1.78, 2.0], "allow_crop": False,
        "desc": "Left Banner - large negative space on right",
    },
    "T11_Right_Banner": {
        "position": (0.70, 0.50), "scale": SCALE_S, "padding": PAD_XLARGE,
        "aspect_pool": [1.5, 1.78, 2.0], "allow_crop": False,
        "desc": "Right Banner - mirror banner",
    },

    # ═══ Cinematic / 电影感 (4) ═══
    "T12_Cinema_LowCenter": {
        "position": (0.50, 0.60), "scale": SCALE_M, "padding": PAD_MEDIUM,
        "aspect_pool": [2.39, 2.0, 1.78], "allow_crop": False,
        "desc": "Cinema Low-Center - 2.39:1 wide",
    },
    "T13_Cinema_HighCenter": {
        "position": (0.50, 0.40), "scale": SCALE_M, "padding": PAD_MEDIUM,
        "aspect_pool": [2.39, 2.0, 1.78], "allow_crop": False,
        "desc": "Cinema High-Center - top space",
    },
    "T14_Cinema_SideEdge": {
        "position": (0.80, 0.50), "scale": SCALE_M, "padding": PAD_MEDIUM,
        "aspect_pool": [2.39, 2.0], "allow_crop": False,
        "desc": "Cinema Side-Edge - 21:9 subject right",
    },
    "T15_Diagonal": {
        "position": (0.30, 0.70), "scale": SCALE_M, "padding": PAD_MEDIUM,
        "aspect_pool": [1.0, 1.33, 1.5], "allow_crop": False,
        "desc": "Diagonal - dynamic tension",
    },

    # ═══ Documentary / 纪实 (4) ═══
    "T16_RightEdge_Crop": {
        "position": (0.80, 0.50), "scale": SCALE_M, "padding": PAD_SMALL,
        "aspect_pool": [1.0, 1.33, 1.5], "allow_crop": True,
        "desc": "Right-Edge Crop - subject entering frame",
    },
    "T17_LeftEdge_Crop": {
        "position": (0.20, 0.50), "scale": SCALE_M, "padding": PAD_SMALL,
        "aspect_pool": [1.0, 1.33, 1.5], "allow_crop": True,
        "desc": "Left-Edge Crop - subject exiting frame",
    },
    "T18_Extreme_Closeup": {
        "position": (0.50, 0.50), "scale": SCALE_XL, "padding": PAD_SMALL,
        "aspect_pool": [1.0, 0.75, 1.33], "allow_crop": True,
        "desc": "Extreme Closeup - head fills frame",
    },
    "T19_Bottom_Enter": {
        "position": (0.50, 0.85), "scale": SCALE_M, "padding": PAD_MEDIUM,
        "aspect_pool": [1.0, 1.33], "allow_crop": True,
        "desc": "Bottom Enter - lower body / steps",
    },

    # ═══ Banner (1) ═══
    "T20_Horizontal_Banner": {
        "position": (0.25, 0.50), "scale": SCALE_S, "padding": PAD_XLARGE,
        "aspect_pool": [1.78, 2.0, 2.39], "allow_crop": False,
        "desc": "Horizontal Banner - text overlay space",
    },
}

# ─── 构图模式 → 模板子集映射 ───
COMPOSITION_MODES = {
    "standard":          ["T01_Center_Standard", "T02_Left_Standard",
                          "T03_Right_Standard", "T04_Center_Tight",
                          "T05_Center_Loose"],
    "lifestyle":         ["T06_TopLeft_Thirds", "T07_BottomRight_Thirds",
                          "T08_TopRight_Thirds", "T09_BottomLeft_Thirds",
                          "T10_Left_Banner", "T11_Right_Banner",
                          "T18_Extreme_Closeup"],
    "cinematic":         ["T12_Cinema_LowCenter", "T13_Cinema_HighCenter",
                          "T14_Cinema_SideEdge", "T15_Diagonal"],
    "documentary":       ["T16_RightEdge_Crop", "T17_LeftEdge_Crop",
                          "T19_Bottom_Enter"],
    "dynamic":           ["T15_Diagonal", "T16_RightEdge_Crop",
                          "T17_LeftEdge_Crop", "T19_Bottom_Enter"],
    "extreme_closeup":   ["T18_Extreme_Closeup", "T16_RightEdge_Crop"],
    "environmental":     ["T05_Center_Loose", "T10_Left_Banner",
                          "T11_Right_Banner"],
    "banner":            ["T10_Left_Banner", "T11_Right_Banner",
                          "T20_Horizontal_Banner"],
    "all":               list(TEMPLATES_V1.keys()),
    "random":            None,  # 走随机模式
}