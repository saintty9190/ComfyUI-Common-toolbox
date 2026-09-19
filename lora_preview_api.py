import os
import folder_paths
from aiohttp import web


_ROUTES_REGISTERED = False


def _register_preview_route(ps_instance, route_path, folder_name, model_exts):
    @ps_instance.routes.get(route_path)
    async def _preview_handler(request):
        try:
            model_name = request.rel_url.query.get("name", "")
            if not model_name:
                return web.Response(status=400, text="missing 'name' parameter")

            if ".." in model_name or model_name.startswith("/") or model_name.startswith("\\"):
                return web.Response(status=400, text="invalid path")

            base = model_name
            for ext in model_exts:
                if base.lower().endswith(ext):
                    base = base[:-len(ext)]
                    break

            if "/" in base:
                subfolder, filename = base.rsplit("/", 1)
            elif "\\" in base:
                subfolder, filename = base.rsplit("\\", 1)
            else:
                subfolder = ""
                filename = base

            dirs = folder_paths.folder_names_and_paths.get(folder_name, ([], set()))[0]
            if not dirs:
                return web.Response(status=500, text=f"{folder_name} folder not configured")

            exts = [".png", ".jpg", ".jpeg", ".webp"]
            for root_dir in dirs:
                target_dir = os.path.join(root_dir, subfolder) if subfolder else root_dir
                abs_target = os.path.abspath(target_dir)
                abs_root = os.path.abspath(root_dir)
                if not abs_target.startswith(abs_root):
                    continue

                for ext in exts:
                    img_path = os.path.join(target_dir, filename + ext)
                    if os.path.isfile(img_path):
                        return web.FileResponse(img_path)

            return web.Response(status=404, text="preview image not found")

        except Exception as e:
            return web.Response(status=500, text=str(e))


def register_routes():
    """注册所有预览图路由."""
    global _ROUTES_REGISTERED
    if _ROUTES_REGISTERED:
        return
    try:
        from server import PromptServer as _PS
    except ImportError:
        print("[CommonToolbox] server.PromptServer 未找到, 预览图路由已禁用")
        return

    _ps_instance = getattr(_PS, "instance", None)
    if _ps_instance is None:
        print("[CommonToolbox] PromptServer.instance 暂未就绪, 预览图路由延后")
        return

    try:
        model_exts = [".safetensors", ".pt", ".pth", ".ckpt", ".bin"]

        _register_preview_route(
            _ps_instance,
            "/common-toolbox/lora_preview",
            "loras",
            model_exts,
        )

        _register_preview_route(
            _ps_instance,
            "/common-toolbox/unet_preview",
            "diffusion_models",
            model_exts,
        )

        _ROUTES_REGISTERED = True
        print("[CommonToolbox] 预览图路由已注册: lora_preview, unet_preview")

    except Exception as e:
        print(f"[CommonToolbox] 预览图路由注册失败: {e}")
