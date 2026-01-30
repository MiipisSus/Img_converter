"""
圖片處理 API 路由

提供圖片上傳、處理和下載功能
採用 Memory First 模式：全程在記憶體處理，不產生臨時檔案
"""

import io
import asyncio
from pathlib import Path
from typing import Optional
from functools import partial
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, File, UploadFile, Form, HTTPException
from fastapi.responses import StreamingResponse

from ..schemas.images import (
    ImageInfoResponse,
    ProcessingResultResponse,
    ErrorResponse
)
from ...services.image_service import ImageService

router = APIRouter(prefix="/images", tags=["圖片處理"])

# 建立執行緒池用於 CPU 密集型任務
executor = ThreadPoolExecutor(max_workers=4)

# Magic Bytes 特徵碼對照表
MAGIC_BYTES = {
    b'\x89PNG\r\n\x1a\n': 'png',
    b'\xff\xd8\xff': 'jpg',
    b'GIF87a': 'gif',
    b'GIF89a': 'gif',
    b'BM': 'bmp',
    b'RIFF': 'webp',  # WebP 開頭是 RIFF，需進一步檢查
    b'II*\x00': 'tiff',  # Little-endian TIFF
    b'MM\x00*': 'tiff',  # Big-endian TIFF
    b'\x00\x00\x01\x00': 'ico',
    b'\x00\x00\x02\x00': 'ico',  # CUR format (similar to ICO)
    b'qoif': 'qoi',
}

# SVG 特徵（文字型）
SVG_SIGNATURES = [b'<?xml', b'<svg', b'<!DOCTYPE svg']

# 允許的副檔名
ALLOWED_EXTENSIONS = {
    'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp',
    'tiff', 'tif', 'avif', 'heic', 'heif', 'ico',
    'jp2', 'j2k', 'tga', 'qoi', 'svg'
}

# 支援的輸出格式
SUPPORTED_OUTPUT_FORMATS = {
    'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp',
    'tiff', 'tif', 'avif', 'heic', 'heif', 'ico',
    'jp2', 'j2k', 'tga', 'qoi'
}

# MIME 類型對照
FORMAT_TO_MIME = {
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'bmp': 'image/bmp',
    'webp': 'image/webp',
    'tiff': 'image/tiff',
    'tif': 'image/tiff',
    'avif': 'image/avif',
    'heic': 'image/heic',
    'heif': 'image/heif',
    'ico': 'image/x-icon',
    'jp2': 'image/jp2',
    'j2k': 'image/jp2',
    'tga': 'image/x-tga',
    'qoi': 'image/x-qoi',
}


def detect_format_from_magic_bytes(data: bytes) -> Optional[str]:
    """
    透過 Magic Bytes 偵測圖片格式

    Args:
        data: 圖片二進位資料（至少需要前 12 bytes）

    Returns:
        偵測到的格式，或 None
    """
    # 檢查 SVG（文字格式）
    for sig in SVG_SIGNATURES:
        if data.lstrip()[:len(sig)].lower().startswith(sig.lower()):
            return 'svg'

    # 檢查二進位格式
    for magic, fmt in MAGIC_BYTES.items():
        if data.startswith(magic):
            # WebP 需要額外檢查
            if magic == b'RIFF' and len(data) >= 12:
                if data[8:12] == b'WEBP':
                    return 'webp'
                continue
            return fmt

    # AVIF/HEIF 檢查 (ftyp box)
    if len(data) >= 12 and data[4:8] == b'ftyp':
        ftyp_brand = data[8:12]
        if ftyp_brand in [b'avif', b'avis']:
            return 'avif'
        if ftyp_brand in [b'heic', b'heix', b'hevc', b'mif1']:
            return 'heic'

    # JPEG2000 檢查
    if data.startswith(b'\x00\x00\x00\x0cjP  \r\n\x87\n'):
        return 'jp2'

    return None


def validate_image_file(data: bytes, filename: str) -> str:
    """
    驗證上傳的圖片檔案

    Args:
        data: 圖片二進位資料
        filename: 檔案名稱

    Returns:
        驗證後的格式

    Raises:
        HTTPException: 檔案類型不允許或格式不符
    """
    # 從副檔名取得宣稱的格式
    ext = Path(filename).suffix.lower().lstrip('.') if filename else ''

    if ext and ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail=f"不支援的副檔名: .{ext}。支援的格式: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        )

    # 透過 Magic Bytes 偵測實際格式
    detected_format = detect_format_from_magic_bytes(data)

    # TGA 沒有明確的 magic bytes，依賴副檔名
    if detected_format is None and ext in ['tga']:
        return ext

    # 對於無法偵測的格式，檢查是否為允許的副檔名
    if detected_format is None:
        if ext in ALLOWED_EXTENSIONS:
            # 信任副檔名（某些格式如 HEIF 變體可能無法偵測）
            return ext
        raise HTTPException(
            status_code=415,
            detail="無法識別的圖片格式。請確認檔案是有效的圖片。"
        )

    # 檢查 Magic Bytes 與副檔名是否一致（可選的嚴格模式）
    # 這裡我們允許 jpg/jpeg 的差異
    if ext:
        ext_normalized = 'jpg' if ext == 'jpeg' else ext
        detected_normalized = 'jpg' if detected_format == 'jpeg' else detected_format
        if ext_normalized != detected_normalized and ext not in ['heif', 'heic', 'avif']:
            # 不一致時，以 Magic Bytes 為準但發出警告
            pass

    return detected_format


def validate_output_format(output_format: Optional[str]) -> None:
    """
    驗證輸出格式

    Args:
        output_format: 輸出格式

    Raises:
        HTTPException: 輸出格式不支援
    """
    if output_format and output_format.lower() not in SUPPORTED_OUTPUT_FORMATS:
        raise HTTPException(
            status_code=400,
            detail=f"不支援的輸出格式: {output_format}。支援的格式: {', '.join(sorted(SUPPORTED_OUTPUT_FORMATS))}"
        )


async def run_in_executor_async(func, *args, **kwargs):
    """
    在執行緒池中執行 CPU 密集型函式

    避免阻塞 FastAPI 的 Event Loop
    """
    loop = asyncio.get_event_loop()
    partial_func = partial(func, *args, **kwargs)
    return await loop.run_in_executor(executor, partial_func)


@router.post(
    "/upload",
    responses={
        200: {"content": {"image/*": {}}, "description": "處理後的圖片"},
        400: {"model": ErrorResponse, "description": "參數錯誤"},
        415: {"model": ErrorResponse, "description": "不支援的檔案類型"},
        500: {"model": ErrorResponse, "description": "處理錯誤"}
    },
    summary="上傳並處理圖片（返回圖片）",
    description="""
上傳圖片並進行處理，直接返回處理後的圖片二進位流。

**Memory First 模式**：全程在記憶體處理，不產生伺服器端臨時檔案。

支援的操作（依序執行）：
1. **旋轉**: `rotate_angle` 指定角度
2. **翻轉**: `flip_direction` 指定方向
3. **裁切**: `crop_x`, `crop_y`, `crop_width`, `crop_height`
4. **縮放**: `resize_width`, `resize_height` 或 `resize_scale`

**安全性**：使用 Magic Bytes 驗證檔案真實格式。
    """
)
async def upload_and_process(
    file: UploadFile = File(..., description="要處理的圖片檔案"),
    output_format: Optional[str] = Form(default=None, description="輸出格式（如 png, jpg, webp）"),
    quality: int = Form(default=95, ge=1, le=100, description="輸出品質 (1-100)"),
    # 旋轉參數
    rotate_angle: Optional[float] = Form(default=None, description="旋轉角度"),
    rotate_expand: bool = Form(default=True, description="旋轉時是否擴展畫布"),
    # 翻轉參數
    flip_direction: Optional[str] = Form(default=None, description="翻轉方向: horizontal 或 vertical"),
    # 裁切參數
    crop_x: Optional[int] = Form(default=None, ge=0, description="裁切起始 X"),
    crop_y: Optional[int] = Form(default=None, ge=0, description="裁切起始 Y"),
    crop_width: Optional[int] = Form(default=None, gt=0, description="裁切寬度"),
    crop_height: Optional[int] = Form(default=None, gt=0, description="裁切高度"),
    # 縮放參數
    resize_width: Optional[int] = Form(default=None, gt=0, description="目標寬度"),
    resize_height: Optional[int] = Form(default=None, gt=0, description="目標高度"),
    resize_scale: Optional[float] = Form(default=None, gt=0, description="縮放百分比"),
    resize_keep_ratio: bool = Form(default=True, description="是否保持長寬比"),
):
    """
    上傳並處理圖片，返回圖片二進位流
    """
    # 讀取上傳檔案到記憶體
    try:
        image_bytes = await file.read()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"檔案讀取失敗: {str(e)}")

    if len(image_bytes) == 0:
        raise HTTPException(status_code=400, detail="上傳的檔案為空")

    # 驗證檔案類型（Magic Bytes 檢查）
    input_format = validate_image_file(image_bytes, file.filename or "")
    validate_output_format(output_format)

    # 建立 ImageService 實例
    service = ImageService()

    try:
        # 在執行緒池中執行圖片處理（避免阻塞 Event Loop）
        result = await run_in_executor_async(
            service.process_image_bytes,
            image_bytes,
            input_format,
            output_format=output_format,
            quality=quality,
            rotate_angle=rotate_angle,
            rotate_expand=rotate_expand,
            flip_direction=flip_direction,
            crop_x=crop_x,
            crop_y=crop_y,
            crop_width=crop_width,
            crop_height=crop_height,
            resize_width=resize_width,
            resize_height=resize_height,
            resize_scale=resize_scale,
            resize_keep_ratio=resize_keep_ratio
        )

        if not result['success']:
            raise HTTPException(status_code=500, detail="圖片處理失敗")

        # 決定輸出的 MIME 類型和檔名
        out_format = result['output_format']
        mime_type = FORMAT_TO_MIME.get(out_format, 'application/octet-stream')
        original_stem = Path(file.filename or 'image').stem
        # 確保檔名只包含 ASCII 字元
        safe_stem = original_stem.encode('ascii', 'ignore').decode('ascii') or 'image'
        output_filename = f"processed_{safe_stem}.{out_format}"

        # 使用 StreamingResponse 返回圖片
        # 注意：HTTP headers 必須是 ASCII 相容的
        return StreamingResponse(
            io.BytesIO(result['output_bytes']),
            media_type=mime_type,
            headers={
                "Content-Disposition": f'attachment; filename="{output_filename}"',
                "X-Original-Size": f"{result['original_size'][0]}x{result['original_size'][1]}",
                "X-Output-Size": f"{result['output_size'][0]}x{result['output_size'][1]}",
                "X-Operations-Count": str(len(result['operations_applied']))
            }
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"圖片處理錯誤: {str(e)}")


@router.post(
    "/upload/info",
    response_model=ProcessingResultResponse,
    summary="上傳並處理圖片（返回 JSON）",
    description="上傳並處理圖片，只返回處理結果的 JSON 資訊，不返回圖片本身"
)
async def upload_and_get_info(
    file: UploadFile = File(..., description="要處理的圖片檔案"),
    output_format: Optional[str] = Form(default=None, description="輸出格式"),
    quality: int = Form(default=95, ge=1, le=100, description="輸出品質"),
    rotate_angle: Optional[float] = Form(default=None, description="旋轉角度"),
    rotate_expand: bool = Form(default=True, description="旋轉時是否擴展畫布"),
    flip_direction: Optional[str] = Form(default=None, description="翻轉方向"),
    crop_x: Optional[int] = Form(default=None, ge=0),
    crop_y: Optional[int] = Form(default=None, ge=0),
    crop_width: Optional[int] = Form(default=None, gt=0),
    crop_height: Optional[int] = Form(default=None, gt=0),
    resize_width: Optional[int] = Form(default=None, gt=0),
    resize_height: Optional[int] = Form(default=None, gt=0),
    resize_scale: Optional[float] = Form(default=None, gt=0),
    resize_keep_ratio: bool = Form(default=True),
):
    """
    上傳並處理圖片，返回處理資訊
    """
    try:
        image_bytes = await file.read()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"檔案讀取失敗: {str(e)}")

    if len(image_bytes) == 0:
        raise HTTPException(status_code=400, detail="上傳的檔案為空")

    input_format = validate_image_file(image_bytes, file.filename or "")
    validate_output_format(output_format)

    service = ImageService()

    try:
        result = await run_in_executor_async(
            service.process_image_bytes,
            image_bytes,
            input_format,
            output_format=output_format,
            quality=quality,
            rotate_angle=rotate_angle,
            rotate_expand=rotate_expand,
            flip_direction=flip_direction,
            crop_x=crop_x,
            crop_y=crop_y,
            crop_width=crop_width,
            crop_height=crop_height,
            resize_width=resize_width,
            resize_height=resize_height,
            resize_scale=resize_scale,
            resize_keep_ratio=resize_keep_ratio
        )

        return ProcessingResultResponse(
            success=True,
            message="圖片處理成功",
            original_filename=file.filename or "unknown",
            original_size=result['original_size'],
            output_size=result['output_size'],
            input_file_size=result['input_bytes_size'],
            output_file_size=result['output_bytes_size'],
            operations_applied=result['operations_applied']
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"圖片處理錯誤: {str(e)}")


@router.post(
    "/info",
    response_model=ImageInfoResponse,
    summary="取得圖片資訊",
    description="上傳圖片並返回其基本資訊（尺寸、格式、檔案大小等）"
)
async def get_image_info(
    file: UploadFile = File(..., description="要查詢資訊的圖片檔案")
):
    """
    取得上傳圖片的資訊
    """
    try:
        image_bytes = await file.read()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"檔案讀取失敗: {str(e)}")

    if len(image_bytes) == 0:
        raise HTTPException(status_code=400, detail="上傳的檔案為空")

    input_format = validate_image_file(image_bytes, file.filename or "")

    service = ImageService()

    try:
        info = await run_in_executor_async(
            service.get_image_info_from_bytes,
            image_bytes,
            input_format
        )

        return ImageInfoResponse(
            format=info['format'],
            mode=info['mode'],
            width=info['width'],
            height=info['height'],
            file_size=info['file_size'],
            is_vector=info.get('is_vector', False)
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"無法讀取圖片資訊: {str(e)}")
