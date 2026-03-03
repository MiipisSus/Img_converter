"""
影片處理服務模組

提供影片壓縮、位元率計算、裁剪、旋轉、翻轉與格式轉換功能
使用 MoviePy + FFmpeg 進行影片處理
"""

import os
import tempfile
from typing import Optional, Tuple, Callable
from dataclasses import dataclass, field
from concurrent.futures import ThreadPoolExecutor


# ── 位元率計算結果 ──

@dataclass
class BitrateConfig:
    """位元率計算結果"""
    video_bitrate_kbps: int
    audio_bitrate_kbps: int
    total_bitrate_kbps: int
    target_kb: int
    duration_sec: float
    warning: Optional[str] = None


# ── 影片處理參數 ──

@dataclass
class VideoProcessParams:
    """影片處理管線參數"""
    # 時間裁剪
    start_t: Optional[float] = None
    end_t: Optional[float] = None
    # 旋轉 (0, 90, 180, 270)
    rotate: int = 0
    # 翻轉
    flip_h: bool = False
    flip_v: bool = False
    # 目標寬度 (高度按比例縮放，自動對齊偶數)
    target_w: Optional[int] = None
    # 空間裁切 (原始像素座標)
    crop_x: Optional[int] = None
    crop_y: Optional[int] = None
    crop_w: Optional[int] = None
    crop_h: Optional[int] = None


# ── 解析度對應位元率上限 (kbps) ──
RESOLUTION_BITRATE_CAP = {
    360: 2_000,
    480: 5_000,
    720: 10_000,
    1080: 20_000,
    1440: 40_000,
    2160: 80_000,
}


def _get_bitrate_cap(height: int) -> int:
    """根據影片高度取得合理的位元率上限 (kbps)"""
    for res, cap in sorted(RESOLUTION_BITRATE_CAP.items()):
        if height <= res:
            return cap
    return 100_000


def calculate_bitrate(
    target_kb: int,
    duration_sec: float,
    include_audio: bool = True,
    video_height: Optional[int] = None,
) -> BitrateConfig:
    """
    位元率預算精確計算

    公式：
    - 總位元 = target_kb × 1024 × 8 × 0.98 (扣除 2% MP4 封裝損耗)
    - 音訊位元 = 128,000 × duration_sec (AAC 128kbps)
    - 影像位元率 = (總位元 - 音訊位元) / duration_sec
    """
    if duration_sec <= 0:
        raise ValueError("影片時長必須大於 0 秒")
    if target_kb <= 0:
        raise ValueError("目標檔案大小必須大於 0 KB")

    audio_bitrate_kbps = 128 if include_audio else 0
    audio_bits = audio_bitrate_kbps * 1000 * duration_sec
    total_bits = target_kb * 1024 * 8 * 0.98
    video_bits = total_bits - audio_bits
    video_bitrate_kbps = int(video_bits / duration_sec / 1000)

    warning: Optional[str] = None

    if video_bitrate_kbps < 200:
        video_bitrate_kbps = 200
        warning = "目標體積過小，已觸發最低畫質保護 (200kbps)"

    if video_height is not None:
        cap = _get_bitrate_cap(video_height)
        if video_bitrate_kbps > cap:
            video_bitrate_kbps = cap
            warning = f"位元率已限制為 {cap}kbps (適合 {video_height}p 解析度)"

    total_kbps = video_bitrate_kbps + audio_bitrate_kbps

    return BitrateConfig(
        video_bitrate_kbps=video_bitrate_kbps,
        audio_bitrate_kbps=audio_bitrate_kbps,
        total_bitrate_kbps=total_kbps,
        target_kb=target_kb,
        duration_sec=duration_sec,
        warning=warning,
    )


def _ensure_even(n: int) -> int:
    """確保數值為偶數 (H.264 要求)"""
    return n if n % 2 == 0 else n + 1


# ── 進度追蹤 Logger ──

class _ProgressLogger:
    """
    自訂 proglog logger，攔截 MoviePy 的進度更新。
    覆寫 bars_callback 來追蹤 t (已處理秒數)。
    """

    def __init__(self, duration: float, on_progress: Optional[Callable[[int], None]] = None):
        from proglog import ProgressBarLogger

        self._duration = max(duration, 0.01)
        self._on_progress = on_progress
        self._last_pct = 0

        outer = self

        class _Inner(ProgressBarLogger):
            def bars_callback(self, bar, attr, value, old_value=None):
                if bar == "t" and attr == "index":
                    pct = min(int(value / outer._duration * 100), 99)
                    if pct != outer._last_pct:
                        outer._last_pct = pct
                        if outer._on_progress:
                            outer._on_progress(pct)

        self.logger = _Inner()


class VideoService:
    """影片處理服務類別"""

    SUPPORTED_FORMATS = {'mp4', 'webm', 'avi', 'mov', 'mkv'}
    SUPPORTED_OUTPUT_FORMATS = {'mp4', 'webm'}

    def __init__(self):
        self._executor = ThreadPoolExecutor(max_workers=2)

    def get_video_info(self, video_bytes: bytes) -> dict:
        """取得影片基本資訊"""
        from moviepy import VideoFileClip

        tmp_path = self._write_temp(video_bytes, suffix=".mp4")
        try:
            clip = VideoFileClip(tmp_path)
            info = {
                "duration": round(clip.duration, 2),
                "width": clip.size[0],
                "height": clip.size[1],
                "fps": round(clip.fps, 2),
                "has_audio": clip.audio is not None,
                "file_size": len(video_bytes),
            }
            clip.close()
            return info
        finally:
            os.unlink(tmp_path)

    def process_video(
        self,
        video_bytes: bytes,
        params: Optional[VideoProcessParams] = None,
        target_kb: Optional[int] = None,
        output_format: str = "mp4",
        include_audio: bool = True,
        quality_preset: str = "medium",
        on_progress: Optional[Callable[[int], None]] = None,
    ) -> Tuple[bytes, dict]:
        """
        影片處理管線：裁剪 → 旋轉 → 翻轉 → 縮放 → 編碼

        處理順序嚴格遵循：
        1. subclip (裁剪時間) — 先做以減少後續處理量
        2. rotate (旋轉) — 含 expand=True 自動調整畫布
        3. mirror_x (水平翻轉)
        4. resize (縮放) — 最後做，確保最終尺寸正確
        5. even_size — H.264 要求偶數解析度

        Args:
            video_bytes: 原始影片位元組
            params: 處理參數 (裁剪/旋轉/翻轉/縮放)
            target_kb: 目標檔案大小 (KB)，None 表示不限制
            output_format: 輸出格式 (mp4/webm)
            include_audio: 是否保留音軌
            quality_preset: FFmpeg preset (ultrafast/fast/medium/slow)
            on_progress: 進度回調 fn(percent: int)
        """
        from moviepy import VideoFileClip
        from moviepy.video.fx import Crop, Rotate, MirrorX, MirrorY, Resize, EvenSize

        if params is None:
            params = VideoProcessParams()

        tmp_input = self._write_temp(video_bytes, suffix=".mp4")
        tmp_output = tempfile.mktemp(suffix=f".{output_format}")

        try:
            clip = VideoFileClip(tmp_input)
            original_duration = clip.duration
            warnings: list[str] = []

            # ── 步驟 1: 時間裁剪 (最先執行以節省後續處理時間) ──
            start_t = params.start_t
            end_t = params.end_t

            if end_t is not None and end_t > original_duration:
                end_t = original_duration
                warnings.append(f"end_t 已自動修正為影片總時長 {original_duration}s")

            if start_t is not None or end_t is not None:
                clip = clip.subclipped(
                    start_time=start_t or 0,
                    end_time=end_t,
                )

            # ── 步驟 2: 空間裁切 (在旋轉前，座標基於原始影片) ──
            if params.crop_x is not None and params.crop_w is not None:
                clip = clip.with_effects([Crop(
                    x1=params.crop_x, y1=params.crop_y or 0,
                    x2=params.crop_x + params.crop_w,
                    y2=(params.crop_y or 0) + (params.crop_h or clip.size[1]),
                )])

            # ── 步驟 3: 旋轉 (expand=True 避免黑邊) ──
            if params.rotate and params.rotate != 0:
                clip = clip.with_effects([
                    Rotate(angle=params.rotate, expand=True),
                ])

            # ── 步驟 4: 水平翻轉 ──
            if params.flip_h:
                clip = clip.with_effects([MirrorX()])

            # ── 步驟 4b: 垂直翻轉 ──
            if params.flip_v:
                clip = clip.with_effects([MirrorY()])

            # ── 步驟 5: 縮放 ──
            if params.target_w is not None:
                tw = _ensure_even(params.target_w)
                clip = clip.with_effects([Resize(width=tw)])

            # ── 步驟 6: 確保偶數解析度 (H.264 硬性要求) ──
            clip = clip.with_effects([EvenSize()])

            # 處理後的資訊
            duration = clip.duration
            width = clip.size[0]
            height = clip.size[1]
            has_audio = clip.audio is not None and include_audio

            # ── 計算位元率 ──
            bitrate_config: Optional[BitrateConfig] = None
            ffmpeg_params = ["-preset", quality_preset]

            if target_kb is not None:
                bitrate_config = calculate_bitrate(
                    target_kb=target_kb,
                    duration_sec=duration,
                    include_audio=has_audio,
                    video_height=height,
                )
                video_br = f"{bitrate_config.video_bitrate_kbps}k"
                audio_br = f"{bitrate_config.audio_bitrate_kbps}k" if has_audio else None
                ffmpeg_params.extend([
                    "-b:v", video_br,
                    "-maxrate", video_br,
                    "-bufsize", f"{bitrate_config.video_bitrate_kbps * 2}k",
                ])
                if bitrate_config.warning:
                    warnings.append(bitrate_config.warning)
            else:
                video_br = None
                audio_br = "128k" if has_audio else None
                ffmpeg_params.extend(["-crf", "23"])

            # ── 建立進度 logger ──
            progress_logger = _ProgressLogger(duration, on_progress)

            # ── 寫出影片 ──
            codec = "libx264" if output_format == "mp4" else "libvpx-vp9"
            write_kwargs = {
                "codec": codec,
                "audio": has_audio,
                "audio_codec": "aac" if has_audio else None,
                "ffmpeg_params": ffmpeg_params,
                "logger": progress_logger.logger,
                "threads": 4,
            }
            if audio_br and has_audio:
                write_kwargs["audio_bitrate"] = audio_br
            if video_br:
                write_kwargs["bitrate"] = video_br

            clip.write_videofile(tmp_output, **write_kwargs)
            clip.close()

            # ── 讀取結果 ──
            with open(tmp_output, "rb") as f:
                result_bytes = f.read()

            result_size_kb = len(result_bytes) / 1024

            # ── 二次壓制 (若超出目標) ──
            if target_kb is not None and result_size_kb > target_kb:
                result_bytes, result_size_kb = self._second_pass(
                    tmp_input, params, output_format,
                    target_kb, duration, height, has_audio,
                    quality_preset, on_progress,
                )

            if on_progress:
                on_progress(100)

            warning_str = "；".join(warnings) if warnings else None
            info = {
                "original_size_kb": round(len(video_bytes) / 1024, 1),
                "output_size_kb": round(result_size_kb, 1),
                "duration": round(duration, 2),
                "width": width,
                "height": height,
                "video_bitrate_kbps": bitrate_config.video_bitrate_kbps if bitrate_config else None,
                "audio_bitrate_kbps": bitrate_config.audio_bitrate_kbps if bitrate_config else None,
                "warning": warning_str,
            }

            return result_bytes, info

        finally:
            for p in [tmp_input, tmp_output]:
                if os.path.exists(p):
                    os.unlink(p)

    def estimate_config(
        self,
        video_bytes: bytes,
        target_kb: Optional[int] = None,
        include_audio: bool = True,
    ) -> dict:
        """處理前先回傳預估配置，不實際壓縮"""
        from moviepy import VideoFileClip

        tmp_path = self._write_temp(video_bytes, suffix=".mp4")
        try:
            clip = VideoFileClip(tmp_path)
            duration = clip.duration
            height = clip.size[1]
            width = clip.size[0]
            has_audio = clip.audio is not None and include_audio
            clip.close()

            result: dict = {
                "duration": round(duration, 2),
                "width": width,
                "height": height,
                "has_audio": has_audio,
                "original_size_kb": round(len(video_bytes) / 1024, 1),
            }

            if target_kb is not None:
                config = calculate_bitrate(
                    target_kb=target_kb,
                    duration_sec=duration,
                    include_audio=has_audio,
                    video_height=height,
                )
                result["estimated_video_bitrate_kbps"] = config.video_bitrate_kbps
                result["estimated_audio_bitrate_kbps"] = config.audio_bitrate_kbps
                result["estimated_total_bitrate_kbps"] = config.total_bitrate_kbps
                result["warning"] = config.warning
            else:
                result["estimated_video_bitrate_kbps"] = None
                result["estimated_audio_bitrate_kbps"] = 128 if has_audio else 0
                result["estimated_total_bitrate_kbps"] = None
                result["warning"] = None

            return result
        finally:
            os.unlink(tmp_path)

    # ── 私有方法 ──

    def _second_pass(
        self,
        tmp_input: str,
        params: VideoProcessParams,
        output_format: str,
        target_kb: int,
        duration: float,
        height: int,
        has_audio: bool,
        quality_preset: str,
        on_progress: Optional[Callable[[int], None]] = None,
    ) -> Tuple[bytes, float]:
        """二次壓制：以 0.9 係數降低位元率重新壓縮 (含完整處理管線)"""
        from moviepy import VideoFileClip
        from moviepy.video.fx import Crop, Rotate, MirrorX, MirrorY, Resize, EvenSize

        reduced_target = int(target_kb * 0.9)
        config = calculate_bitrate(
            target_kb=reduced_target,
            duration_sec=duration,
            include_audio=has_audio,
            video_height=height,
        )

        video_br = f"{config.video_bitrate_kbps}k"
        audio_br = f"{config.audio_bitrate_kbps}k" if has_audio else None

        ffmpeg_params = [
            "-preset", quality_preset,
            "-b:v", video_br,
            "-maxrate", video_br,
            "-bufsize", f"{config.video_bitrate_kbps * 2}k",
        ]

        codec = "libx264" if output_format == "mp4" else "libvpx-vp9"
        progress_logger = _ProgressLogger(duration, on_progress)

        tmp_output_2 = tempfile.mktemp(suffix=f".{output_format}")
        try:
            clip = VideoFileClip(tmp_input)

            # 重新套用處理管線
            if params.start_t is not None or params.end_t is not None:
                clip = clip.subclipped(
                    start_time=params.start_t or 0,
                    end_time=params.end_t,
                )
            if params.crop_x is not None and params.crop_w is not None:
                clip = clip.with_effects([Crop(
                    x1=params.crop_x, y1=params.crop_y or 0,
                    x2=params.crop_x + params.crop_w,
                    y2=(params.crop_y or 0) + (params.crop_h or clip.size[1]),
                )])
            if params.rotate and params.rotate != 0:
                clip = clip.with_effects([Rotate(angle=params.rotate, expand=True)])
            if params.flip_h:
                clip = clip.with_effects([MirrorX()])
            if params.flip_v:
                clip = clip.with_effects([MirrorY()])
            if params.target_w is not None:
                tw = _ensure_even(params.target_w)
                clip = clip.with_effects([Resize(width=tw)])
            clip = clip.with_effects([EvenSize()])

            write_kwargs = {
                "codec": codec,
                "audio": has_audio,
                "audio_codec": "aac" if has_audio else None,
                "ffmpeg_params": ffmpeg_params,
                "logger": progress_logger.logger,
                "bitrate": video_br,
                "threads": 4,
            }
            if audio_br and has_audio:
                write_kwargs["audio_bitrate"] = audio_br

            clip.write_videofile(tmp_output_2, **write_kwargs)
            clip.close()

            with open(tmp_output_2, "rb") as f:
                result_bytes = f.read()

            return result_bytes, len(result_bytes) / 1024
        finally:
            if os.path.exists(tmp_output_2):
                os.unlink(tmp_output_2)

    @staticmethod
    def _write_temp(data: bytes, suffix: str = ".mp4") -> str:
        """將位元組寫入暫存檔，回傳路徑"""
        fd, path = tempfile.mkstemp(suffix=suffix)
        try:
            os.write(fd, data)
        finally:
            os.close(fd)
        return path
