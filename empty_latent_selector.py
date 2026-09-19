
import torch
import comfy.model_management


VAE_PRESETS = {
    "z_image_ae":    {"channels": 16, "latent_dim": 2},
    "qwen_image_vae": {"channels": 16, "latent_dim": 3},
    "Wan2.1_VAE":    {"channels": 16, "latent_dim": 3},
}

ASPECT_RATIOS = {
    "1:1 (square)":      (1024.0, 1024.0),
    "4:3 (retro tv)":    (1182.4,  886.8),
    "3:2 (photo)":       (1252.8,  837.0),
    "16:10 (monitor)":   (1295.3,  809.5),
    "16:9 (widescreen)": (1365.3,  768.0),
    "2:1 (univisium)":   (1448.2,  724.0),
    "21:9 (ultrawide)":  (1564.2,  670.4),
    "12:5 (anamorphic)": (1586.4,  661.0),
    "70:27 (cinerama)":  (1648.8,  636.0),
    "32:9 (super wide)": (1930.9,  543.0),
}

SIZE_SCALES = {
    "small 1.0MP":  1.0,
    "medium 1.7MP": 1.3,
    "large 2.6MP":  1.6,
}

SPATIAL_DOWNSCALE = 8
GRID_SIZE = 32


class EmptyLatentSelector:
    """通用空 latent 生成器, 支持 z_image / qwen / Wan VAE, 自动适配维度."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "vae_type": (
                    list(VAE_PRESETS.keys()),
                    {"default": "z_image_ae"},
                ),
                "orientation": (
                    "BOOLEAN",
                    {"default": True, "label_on": "horizontal", "label_off": "vertical"},
                ),
                "ratio": (
                    list(ASPECT_RATIOS.keys()),
                    {"default": "3:2 (photo)"},
                ),
                "size": (
                    list(SIZE_SCALES.keys()),
                    {"default": "medium 1.7MP"},
                ),
                "batch_size": (
                    "INT",
                    {"default": 1, "min": 1, "max": 4096},
                ),
            },
            "optional": {
                "vae": ("VAE",),
            },
        }

    RETURN_TYPES = ("LATENT", "INT", "INT", "INT", "INT")
    RETURN_NAMES = ("latent", "width", "height", "long_side", "count")
    FUNCTION = "generate"
    CATEGORY = "latent"

    def generate(self, vae_type, orientation, ratio, size, batch_size, vae=None):
        if vae is not None and hasattr(vae, "latent_channels"):
            channels = int(vae.latent_channels)
            latent_dim = int(getattr(vae, "latent_dim", 2))
        else:
            preset = VAE_PRESETS.get(vae_type, VAE_PRESETS["z_image_ae"])
            channels = preset["channels"]
            latent_dim = preset["latent_dim"]

        base_w, base_h = ASPECT_RATIOS.get(ratio, (1024.0, 1024.0))
        if not orientation:
            base_w, base_h = base_h, base_w
        scale = SIZE_SCALES.get(size, 1.0)
        desired_w = base_w * scale
        desired_h = base_h * scale
        image_width = max(GRID_SIZE, int((desired_w // GRID_SIZE) * GRID_SIZE))
        image_height = max(GRID_SIZE, int((desired_h // GRID_SIZE) * GRID_SIZE))

        latent_w = image_width // SPATIAL_DOWNSCALE
        latent_h = image_height // SPATIAL_DOWNSCALE

        device = comfy.model_management.intermediate_device()
        if latent_dim >= 3:
            latent = torch.zeros(
                (batch_size, channels, 1, latent_h, latent_w),
                device=device,
            )
        else:
            latent = torch.zeros(
                (batch_size, channels, latent_h, latent_w),
                device=device,
            )

        long_side = max(image_width, image_height)
        count = batch_size

        return ({"samples": latent}, image_width, image_height, long_side, count)
