"""
API 路由模組

包含所有 API 路由定義
"""

from . import health
from . import images
from . import videos

__all__ = ['health', 'images', 'videos']
