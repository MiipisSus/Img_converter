"""
圖片處理 API 的 Pydantic 模型定義

包含請求參數和回應格式的資料模型
"""

from pydantic import BaseModel, Field
from typing import Optional, Literal, Tuple
from enum import Enum


class OperationType(str, Enum):
    """圖片處理操作類型"""
    CONVERT = "convert"
    COMPRESS = "compress"
    CROP = "crop"
    RESIZE = "resize"
    ROTATE = "rotate"
    FLIP = "flip"


class FlipDirection(str, Enum):
    """翻轉方向"""
    HORIZONTAL = "horizontal"
    VERTICAL = "vertical"


class ImageOperationParams(BaseModel):
    """圖片處理操作參數"""

    # 通用參數
    output_format: Optional[str] = Field(
        default=None,
        description="輸出格式（如 png, jpg, webp）。若不指定則使用原格式"
    )
    quality: int = Field(
        default=95,
        ge=1,
        le=100,
        description="輸出品質 (1-100)，適用於 JPEG/WEBP/AVIF/HEIC"
    )

    # 旋轉參數
    rotate_angle: Optional[float] = Field(
        default=None,
        description="旋轉角度（正值逆時針，負值順時針）"
    )
    rotate_expand: bool = Field(
        default=True,
        description="旋轉時是否擴展畫布以容納完整圖片"
    )

    # 翻轉參數
    flip_direction: Optional[FlipDirection] = Field(
        default=None,
        description="翻轉方向：horizontal（水平）或 vertical（垂直）"
    )

    # 裁切參數
    crop_x: Optional[int] = Field(
        default=None,
        ge=0,
        description="裁切起始點 X 座標"
    )
    crop_y: Optional[int] = Field(
        default=None,
        ge=0,
        description="裁切起始點 Y 座標"
    )
    crop_width: Optional[int] = Field(
        default=None,
        gt=0,
        description="裁切寬度"
    )
    crop_height: Optional[int] = Field(
        default=None,
        gt=0,
        description="裁切高度"
    )

    # 縮放參數
    resize_width: Optional[int] = Field(
        default=None,
        gt=0,
        description="目標寬度（px）"
    )
    resize_height: Optional[int] = Field(
        default=None,
        gt=0,
        description="目標高度（px）"
    )
    resize_scale: Optional[float] = Field(
        default=None,
        gt=0,
        description="縮放百分比（如 50 表示縮小為 50%）"
    )
    resize_keep_ratio: bool = Field(
        default=True,
        description="是否保持長寬比"
    )

    # 壓縮參數
    compress_target_size_kb: Optional[int] = Field(
        default=None,
        gt=0,
        description="目標檔案大小（KB）"
    )
    compress_max_dimension: Optional[int] = Field(
        default=None,
        gt=0,
        description="最大邊長限制（px）"
    )


class ImageInfoResponse(BaseModel):
    """圖片資訊回應"""
    format: str = Field(description="圖片格式")
    mode: str = Field(description="色彩模式")
    width: int = Field(description="寬度（px）")
    height: int = Field(description="高度（px）")
    file_size: int = Field(description="檔案大小（bytes）")
    is_vector: bool = Field(default=False, description="是否為向量格式")


class ProcessingResultResponse(BaseModel):
    """圖片處理結果回應"""
    success: bool = Field(description="處理是否成功")
    message: str = Field(description="處理結果訊息")
    original_filename: str = Field(description="原始檔案名稱")
    original_size: Tuple[int, int] = Field(description="原始尺寸 (寬, 高)")
    output_size: Tuple[int, int] = Field(description="輸出尺寸 (寬, 高)")
    input_file_size: int = Field(description="輸入檔案大小（bytes）")
    output_file_size: int = Field(description="輸出檔案大小（bytes）")
    operations_applied: list[str] = Field(description="已套用的操作列表")


class ErrorResponse(BaseModel):
    """錯誤回應"""
    error: str = Field(description="錯誤類型")
    detail: str = Field(description="錯誤詳情")
