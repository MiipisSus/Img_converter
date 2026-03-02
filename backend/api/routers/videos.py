"""
影片處理 API 路由

提供影片上傳、資訊查詢、位元率預估與非同步處理功能
處理採用 BackgroundTasks 非同步處理，前端透過 polling 查詢進度
"""

import asyncio
import uuid
import os
import tempfile
import traceback
from typing import Optional, Dict, Any
from functools import partial
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, File, UploadFile, Form, HTTPException
from fastapi.responses import FileResponse

from ..schemas.videos import (
    VideoInfoResponse,
    BitrateEstimateResponse,
    TaskSubmitResponse,
    TaskStatusResponse,
)
from backend.services.video_service import (
    VideoService,
    VideoProcessParams,
    calculate_bitrate,
)

router = APIRouter(prefix="/videos", tags=["影片處理"])

# 建立執行緒池用於 CPU 密集型任務
executor = ThreadPoolExecutor(max_workers=2)

# 允許的影片副檔名
ALLOWED_EXTENSIONS = {'mp4', 'webm', 'avi', 'mov', 'mkv'}

# 影片 MIME 類型對照
FORMAT_TO_MIME = {
    'mp4': 'video/mp4',
    'webm': 'video/webm',
}

# 最大上傳限制 (500MB)
MAX_VIDEO_SIZE = 500 * 1024 * 1024

# ── 全域任務狀態管理 (In-Memory Store) ──
video_tasks: Dict[str, Dict[str, Any]] = {}


def _validate_video_extension(filename: str) -> str:
    """驗證影片副檔名，回傳格式名稱"""
    if not filename:
        raise HTTPException(status_code=400, detail="缺少檔案名稱")
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"不支援的影片格式：{ext}。支援格式：{', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )
    return ext


async def _run_in_executor(fn, *args):
    """在執行緒池中執行同步函數"""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(executor, partial(fn, *args))


# ── 背景處理任務 ──

def _process_task(
    task_id: str,
    input_path: str,
    params: VideoProcessParams,
    target_kb: Optional[int],
    output_format: str,
    include_audio: bool,
    quality_preset: str,
):
    """
    在背景執行緒中執行影片處理。
    結果寫入暫存檔，路徑記錄在 video_tasks[task_id]。
    """
    task = video_tasks[task_id]

    def on_progress(pct: int):
        task["progress"] = pct
        if pct < 100:
            task["status"] = "processing"

    try:
        task["status"] = "processing"

        with open(input_path, "rb") as f:
            video_bytes = f.read()

        service = VideoService()
        result_bytes, info = service.process_video(
            video_bytes=video_bytes,
            params=params,
            target_kb=target_kb,
            output_format=output_format,
            include_audio=include_audio,
            quality_preset=quality_preset,
            on_progress=on_progress,
        )

        # 寫入暫存輸出檔
        fd, output_path = tempfile.mkstemp(suffix=f".{output_format}")
        try:
            os.write(fd, result_bytes)
        finally:
            os.close(fd)

        task["status"] = "completed"
        task["progress"] = 100
        task["output_path"] = output_path
        task["output_format"] = output_format
        task["info"] = info

    except Exception as e:
        task["status"] = "failed"
        task["error"] = str(e)
        task["traceback"] = traceback.format_exc()

    finally:
        # 清理上傳暫存檔
        if os.path.exists(input_path):
            os.unlink(input_path)


# ── 取得影片資訊 ──

@router.post(
    "/info",
    response_model=VideoInfoResponse,
    summary="取得影片資訊",
    description="上傳影片並取得基本資訊（時長、解析度、FPS 等）",
)
async def get_video_info(
    video: UploadFile = File(..., description="影片檔案"),
):
    _validate_video_extension(video.filename or "")
    video_bytes = await video.read()

    if len(video_bytes) > MAX_VIDEO_SIZE:
        raise HTTPException(status_code=413, detail="影片檔案超過 500MB 限制")

    try:
        service = VideoService()
        info = await _run_in_executor(service.get_video_info, video_bytes)
        return VideoInfoResponse(**info)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"影片資訊讀取失敗：{str(e)}")


# ── 位元率預估 (不壓縮) ──

@router.post(
    "/estimate",
    response_model=BitrateEstimateResponse,
    summary="預估壓縮配置",
    description="上傳影片並取得位元率預估配置，不進行實際壓縮",
)
async def estimate_config(
    video: UploadFile = File(..., description="影片檔案"),
    target_kb: Optional[int] = Form(default=None, ge=1, description="目標檔案大小 (KB)"),
    include_audio: bool = Form(default=True, description="是否包含音軌"),
):
    _validate_video_extension(video.filename or "")
    video_bytes = await video.read()

    if len(video_bytes) > MAX_VIDEO_SIZE:
        raise HTTPException(status_code=413, detail="影片檔案超過 500MB 限制")

    try:
        service = VideoService()
        config = await _run_in_executor(
            service.estimate_config, video_bytes, target_kb, include_audio,
        )
        return BitrateEstimateResponse(**config)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"預估配置失敗：{str(e)}")


# ── 提交處理任務 (非同步) ──

@router.post(
    "/compress",
    response_model=TaskSubmitResponse,
    summary="提交影片處理任務",
    description=(
        "上傳影片並提交處理任務 (裁剪/旋轉/翻轉/縮放/壓縮)。\n"
        "立即回傳 task_id，透過 GET /videos/status/{task_id} 查詢進度。"
    ),
)
async def submit_compress(
    video: UploadFile = File(..., description="影片檔案"),
    target_kb: Optional[int] = Form(default=None, ge=1, description="目標檔案大小 (KB)"),
    output_format: str = Form(default="mp4", description="輸出格式 (mp4/webm)"),
    include_audio: bool = Form(default=True, description="是否保留音軌"),
    quality_preset: str = Form(default="medium", description="編碼品質 (ultrafast/fast/medium/slow/veryslow)"),
    # 處理管線參數
    start_t: Optional[float] = Form(default=None, ge=0, description="起始時間 (秒)"),
    end_t: Optional[float] = Form(default=None, ge=0, description="結束時間 (秒)"),
    rotate: int = Form(default=0, description="旋轉角度 (0/90/180/270)"),
    flip_h: bool = Form(default=False, description="是否水平翻轉"),
    target_w: Optional[int] = Form(default=None, gt=0, description="目標寬度 (高度按比例縮放)"),
):
    _validate_video_extension(video.filename or "")
    video_bytes = await video.read()

    if len(video_bytes) > MAX_VIDEO_SIZE:
        raise HTTPException(status_code=413, detail="影片檔案超過 500MB 限制")

    if output_format not in VideoService.SUPPORTED_OUTPUT_FORMATS:
        raise HTTPException(
            status_code=400,
            detail=f"不支援的輸出格式：{output_format}。支援格式：{', '.join(sorted(VideoService.SUPPORTED_OUTPUT_FORMATS))}",
        )

    valid_presets = {"ultrafast", "superfast", "fast", "medium", "slow", "veryslow"}
    if quality_preset not in valid_presets:
        raise HTTPException(
            status_code=400,
            detail=f"不支援的品質預設：{quality_preset}。支援：{', '.join(sorted(valid_presets))}",
        )

    if rotate not in (0, 90, 180, 270):
        raise HTTPException(
            status_code=400,
            detail=f"旋轉角度必須為 0、90、180 或 270，收到：{rotate}",
        )

    if start_t is not None and end_t is not None and start_t >= end_t:
        raise HTTPException(
            status_code=400,
            detail=f"start_t ({start_t}) 必須小於 end_t ({end_t})",
        )

    # ── 組裝處理參數 ──
    params = VideoProcessParams(
        start_t=start_t,
        end_t=end_t,
        rotate=rotate,
        flip_h=flip_h,
        target_w=target_w,
    )

    # ── 建立任務 ──
    task_id = uuid.uuid4().hex[:12]

    # 先取得預估配置
    estimated_config: Dict[str, Any] = {}
    try:
        service = VideoService()
        info = await _run_in_executor(service.get_video_info, video_bytes)
        duration = info["duration"]
        height = info["height"]
        has_audio = info["has_audio"] and include_audio

        # 如果有裁剪，用裁剪後時長計算位元率
        effective_duration = duration
        if start_t is not None or end_t is not None:
            t0 = start_t or 0
            t1 = min(end_t, duration) if end_t is not None else duration
            effective_duration = max(t1 - t0, 0.01)

        if target_kb is not None:
            bc = calculate_bitrate(
                target_kb=target_kb,
                duration_sec=effective_duration,
                include_audio=has_audio,
                video_height=height,
            )
            estimated_config["estimated_video_bitrate_kbps"] = bc.video_bitrate_kbps
            estimated_config["estimated_audio_bitrate_kbps"] = bc.audio_bitrate_kbps
            estimated_config["warning"] = bc.warning
    except Exception:
        pass

    # 將上傳內容寫入暫存檔
    fd, input_path = tempfile.mkstemp(suffix=".mp4")
    try:
        os.write(fd, video_bytes)
    finally:
        os.close(fd)
    del video_bytes

    # 註冊任務
    video_tasks[task_id] = {
        "status": "pending",
        "progress": 0,
        "output_path": None,
        "output_format": output_format,
        "info": None,
        "error": None,
    }

    # 在執行緒池中啟動背景處理
    loop = asyncio.get_event_loop()
    loop.run_in_executor(
        executor,
        _process_task,
        task_id, input_path, params, target_kb,
        output_format, include_audio, quality_preset,
    )

    return TaskSubmitResponse(
        task_id=task_id,
        status="pending",
        estimated_video_bitrate_kbps=estimated_config.get("estimated_video_bitrate_kbps"),
        estimated_audio_bitrate_kbps=estimated_config.get("estimated_audio_bitrate_kbps"),
        warning=estimated_config.get("warning"),
    )


# ── 查詢任務狀態 ──

@router.get(
    "/status/{task_id}",
    response_model=TaskStatusResponse,
    summary="查詢處理任務狀態",
    description="透過 task_id 查詢處理進度，completed 時會附帶 download_url",
)
async def get_task_status(task_id: str):
    task = video_tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"找不到任務：{task_id}")

    result = TaskStatusResponse(
        task_id=task_id,
        status=task["status"],
        progress=task["progress"],
    )

    if task["status"] == "completed" and task["info"]:
        result.download_url = f"/videos/download/{task_id}"
        info = task["info"]
        result.original_size_kb = info.get("original_size_kb")
        result.output_size_kb = info.get("output_size_kb")
        result.duration = info.get("duration")
        result.video_bitrate_kbps = info.get("video_bitrate_kbps")
        result.audio_bitrate_kbps = info.get("audio_bitrate_kbps")
        result.warning = info.get("warning")

    if task["status"] == "failed":
        result.error = task.get("error", "未知錯誤")

    return result


# ── 下載處理結果 ──

@router.get(
    "/download/{task_id}",
    summary="下載處理後的影片",
    description="任務完成後，透過此端點下載處理後的影片檔案",
    responses={
        200: {"content": {"video/mp4": {}, "video/webm": {}}},
        404: {"description": "任務不存在或尚未完成"},
    },
)
async def download_result(task_id: str):
    task = video_tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"找不到任務：{task_id}")

    if task["status"] != "completed":
        raise HTTPException(
            status_code=404,
            detail=f"任務尚未完成，目前狀態：{task['status']}",
        )

    output_path = task.get("output_path")
    if not output_path or not os.path.exists(output_path):
        raise HTTPException(status_code=404, detail="輸出檔案已過期或不存在")

    fmt = task.get("output_format", "mp4")
    mime = FORMAT_TO_MIME.get(fmt, "video/mp4")
    filename = f"processed.{fmt}"

    return FileResponse(
        path=output_path,
        media_type=mime,
        filename=filename,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── 清理已完成的任務 ──

@router.delete(
    "/tasks/{task_id}",
    summary="清理任務",
    description="刪除已完成或失敗的任務及其暫存檔案",
)
async def cleanup_task(task_id: str):
    task = video_tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"找不到任務：{task_id}")

    if task["status"] == "processing":
        raise HTTPException(status_code=400, detail="無法刪除正在處理中的任務")

    output_path = task.get("output_path")
    if output_path and os.path.exists(output_path):
        os.unlink(output_path)

    del video_tasks[task_id]
    return {"message": f"任務 {task_id} 已清理"}
