"""
影片處理 API 的 Pydantic 模型定義

包含請求參數和回應格式的資料模型
"""

from pydantic import BaseModel, Field
from typing import Optional, Literal


class VideoInfoResponse(BaseModel):
    """影片資訊回應"""
    duration: float = Field(description="影片時長 (秒)")
    width: int = Field(description="寬度 (px)")
    height: int = Field(description="高度 (px)")
    fps: float = Field(description="每秒幀數")
    has_audio: bool = Field(description="是否包含音軌")
    file_size: int = Field(description="檔案大小 (bytes)")


class BitrateEstimateResponse(BaseModel):
    """位元率預估回應"""
    duration: float = Field(description="影片時長 (秒)")
    width: int = Field(description="寬度 (px)")
    height: int = Field(description="高度 (px)")
    has_audio: bool = Field(description="是否包含音軌")
    original_size_kb: float = Field(description="原始檔案大小 (KB)")
    estimated_video_bitrate_kbps: Optional[int] = Field(description="預估影像位元率 (kbps)")
    estimated_audio_bitrate_kbps: Optional[int] = Field(description="預估音訊位元率 (kbps)")
    estimated_total_bitrate_kbps: Optional[int] = Field(description="預估總位元率 (kbps)")
    warning: Optional[str] = Field(default=None, description="警告訊息")


class TaskSubmitResponse(BaseModel):
    """任務提交回應"""
    task_id: str = Field(description="任務唯一識別碼")
    status: Literal["pending"] = Field(description="任務狀態")
    estimated_video_bitrate_kbps: Optional[int] = Field(default=None, description="預估影像位元率 (kbps)")
    estimated_audio_bitrate_kbps: Optional[int] = Field(default=None, description="預估音訊位元率 (kbps)")
    warning: Optional[str] = Field(default=None, description="警告訊息")


class TaskStatusResponse(BaseModel):
    """任務狀態查詢回應"""
    task_id: str = Field(description="任務唯一識別碼")
    status: Literal["pending", "processing", "completed", "failed"] = Field(description="任務狀態")
    progress: int = Field(description="進度百分比 (0-100)")
    download_url: Optional[str] = Field(default=None, description="完成後的下載 URL")
    # 完成後的結果資訊
    original_size_kb: Optional[float] = Field(default=None, description="原始檔案大小 (KB)")
    output_size_kb: Optional[float] = Field(default=None, description="輸出檔案大小 (KB)")
    duration: Optional[float] = Field(default=None, description="影片時長 (秒)")
    video_bitrate_kbps: Optional[int] = Field(default=None, description="使用的影像位元率 (kbps)")
    audio_bitrate_kbps: Optional[int] = Field(default=None, description="使用的音訊位元率 (kbps)")
    warning: Optional[str] = Field(default=None, description="警告訊息")
    error: Optional[str] = Field(default=None, description="錯誤訊息 (僅 failed 狀態)")
