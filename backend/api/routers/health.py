"""
健康檢查與測試路由

提供 API 健康狀態檢查和測試端點
"""

from fastapi import APIRouter
from datetime import datetime
import platform
import sys

router = APIRouter()


@router.get("/test")
async def test():
    """
    測試 API 端點

    用於驗證 API 服務是否正常運行

    Returns:
        dict: 包含測試狀態和基本系統資訊
    """
    return {
        "status": "ok",
        "message": "API 服務正常運行中",
        "timestamp": datetime.now().isoformat(),
        "python_version": sys.version,
        "platform": platform.system()
    }


@router.get("/health")
async def health_check():
    """
    健康檢查端點

    用於監控系統和負載平衡器檢查服務狀態

    Returns:
        dict: 服務健康狀態
    """
    return {
        "status": "healthy",
        "service": "img_convert_api",
        "version": "0.8.0",
        "timestamp": datetime.now().isoformat()
    }


@router.get("/info")
async def api_info():
    """
    API 資訊端點

    返回 API 服務的詳細資訊

    Returns:
        dict: API 服務資訊
    """
    # 檢查可用的圖片處理功能
    features = {
        "format_conversion": True,
        "batch_conversion": True,
        "compression": True,
        "crop": True,
        "resize": True,
        "rotate": True,
        "flip": True,
        "svg_support": True
    }

    # 支援的格式
    supported_formats = {
        "read_write": [
            "png", "jpg", "jpeg", "bmp", "gif", "webp", "tiff", "tif",
            "avif", "heif", "heic", "ico", "jp2", "j2k", "tga", "qoi"
        ],
        "read_only": ["svg"]
    }

    return {
        "name": "圖片處理 API",
        "version": "0.8.0",
        "description": "提供圖片格式轉換、壓縮、裁切、縮放、旋轉、翻轉等功能",
        "features": features,
        "supported_formats": supported_formats,
        "documentation": {
            "swagger": "/docs",
            "redoc": "/redoc"
        }
    }
