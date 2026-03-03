import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { VideoItem } from "../types";
import { getVideoInfo, estimateVideo } from "../api/videoApi";
import type { VideoInfoResult, BitrateEstimateResult } from "../api/videoApi";
import { useVideoTransform } from "../hooks/useVideoTransform";
import type { VideoTransformState } from "../hooks/useVideoTransform";
import vicLogo from "../assets/vic_logo.png";

interface VideoEditorPageProps {
  video: VideoItem;
  onReset: () => void;
}

/** 秒數格式化為 mm:ss.x */
function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

// ─────────────────────────────────────────────
// ExportConfig — 統一輸出配置
// ─────────────────────────────────────────────

export interface ClipExportConfig {
  start_t: number;
  end_t: number;
  crop_x: number;
  crop_y: number;
  crop_w: number;   // 偶數修正
  crop_h: number;   // 偶數修正
  include_audio: boolean;
}

// ─────────────────────────────────────────────
// getFinalVideoCropArea — UI 座標→原始像素座標 (含偶數修正)
// ─────────────────────────────────────────────

function getFinalVideoCropArea(
  state: VideoTransformState,
  M: number,
  containerW: number,
  containerH: number,
  originalW: number,
  originalH: number,
): { x: number; y: number; width: number; height: number } {
  const { scale, translateX: tx, translateY: ty, cropX, cropY, cropW, cropH } = state;

  const vw = originalW * M * scale;
  const vh = originalH * M * scale;

  const vx = (containerW - vw) / 2 + tx;
  const vy = (containerH - vh) / 2 + ty;

  const relX = cropX - vx;
  const relY = cropY - vy;

  const pixelScale = M * scale;
  let x = Math.max(0, Math.min(originalW, Math.round(relX / pixelScale)));
  let y = Math.max(0, Math.min(originalH, Math.round(relY / pixelScale)));
  let w = Math.max(2, Math.min(originalW - x, Math.round(cropW / pixelScale)));
  let h = Math.max(2, Math.min(originalH - y, Math.round(cropH / pixelScale)));

  // 偶數修正 — 符合影片編碼規範
  w = Math.floor(w / 2) * 2;
  h = Math.floor(h / 2) * 2;
  x = Math.floor(x / 2) * 2;
  y = Math.floor(y / 2) * 2;

  // 修正後邊界安全檢查
  if (x + w > originalW) x = originalW - w;
  if (y + h > originalH) y = originalH - h;
  if (x < 0) x = 0;
  if (y < 0) y = 0;

  return { x, y, width: w, height: h };
}

// ─────────────────────────────────────────────
// TrimSlider — 雙向滑桿元件
// ─────────────────────────────────────────────

interface TrimSliderProps {
  duration: number;
  startT: number;
  endT: number;
  currentTime: number;
  onStartChange: (v: number) => void;
  onEndChange: (v: number) => void;
  onSeek: (v: number) => void;
}

function TrimSlider({
  duration,
  startT,
  endT,
  currentTime,
  onStartChange,
  onEndChange,
  onSeek,
}: TrimSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<"start" | "end" | "seek" | null>(null);

  const toPercent = (v: number) => (duration > 0 ? (v / duration) * 100 : 0);

  const posFromEvent = useCallback(
    (e: MouseEvent | React.MouseEvent) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || duration <= 0) return 0;
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      return ratio * duration;
    },
    [duration],
  );

  const handleMouseDown = useCallback(
    (target: "start" | "end") => (e: React.MouseEvent) => {
      e.preventDefault();
      draggingRef.current = target;
    },
    [],
  );

  const handleTrackMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).classList.contains("trim-slider__track")) {
        const pos = posFromEvent(e);
        onSeek(Math.max(startT, Math.min(endT, pos)));
        draggingRef.current = "seek";
      }
    },
    [posFromEvent, onSeek, startT, endT],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const d = draggingRef.current;
      if (!d) return;
      const pos = Math.round(posFromEvent(e) * 10) / 10;
      if (d === "start") {
        onStartChange(Math.max(0, Math.min(pos, endT - 0.1)));
      } else if (d === "end") {
        onEndChange(Math.max(startT + 0.1, Math.min(pos, duration)));
      } else if (d === "seek") {
        onSeek(Math.max(startT, Math.min(endT, pos)));
      }
    };

    const handleMouseUp = () => {
      draggingRef.current = null;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [duration, startT, endT, posFromEvent, onStartChange, onEndChange, onSeek]);

  return (
    <div className="trim-slider" ref={trackRef} onMouseDown={handleTrackMouseDown}>
      <div className="trim-slider__track" />
      <div
        className="trim-slider__range"
        style={{
          left: `${toPercent(startT)}%`,
          width: `${toPercent(endT - startT)}%`,
        }}
      />
      <div
        className="trim-slider__playhead"
        style={{ left: `${toPercent(currentTime)}%` }}
      />
      <div
        className="trim-slider__thumb"
        style={{ left: `${toPercent(startT)}%` }}
        onMouseDown={handleMouseDown("start")}
      />
      <div
        className="trim-slider__thumb"
        style={{ left: `${toPercent(endT)}%` }}
        onMouseDown={handleMouseDown("end")}
      />
    </div>
  );
}

// ─────────────────────────────────────────────
// VideoEditorPage — 主頁面
// ─────────────────────────────────────────────

type EditorMode = "default" | "clip";
type CropResizeHandle = "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";

export function VideoEditorPage({ video, onReset }: VideoEditorPageProps) {
  // ── 影片資訊 ──
  const [videoInfo, setVideoInfo] = useState<VideoInfoResult | null>(null);
  const [loading, setLoading] = useState(true);

  // ── 編輯模式 ──
  const [mode, setMode] = useState<EditorMode>("default");

  // ── 旋轉/翻轉 ──
  const [baseRotate, setBaseRotate] = useState(0);
  const visualRotateRef = useRef(0);
  const [visualRotate, setVisualRotate] = useState(0);
  const [flipX, setFlipX] = useState(false);
  const [flipY, setFlipY] = useState(false);

  // ── 時間裁剪參數 ──
  const [startT, setStartT] = useState(0);
  const [endT, setEndT] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // ── 音訊開關 ──
  const [includeAudio, setIncludeAudio] = useState(true);
  const handleToggleAudio = useCallback(() => setIncludeAudio((prev) => !prev), []);

  // ── 預估結果 ──
  const [estimate, setEstimate] = useState<BitrateEstimateResult | null>(null);
  const [estimating, setEstimating] = useState(false);

  // ── 空間裁切 (clip 模式共用) ──
  const [cropContainerSize, setCropContainerSize] = useState({ width: 800, height: 600 });
  const [isDraggingVideo, setIsDraggingVideo] = useState(false);
  const [isResizingCrop, setIsResizingCrop] = useState<CropResizeHandle | null>(null);
  const [isCropAnimating, setIsCropAnimating] = useState(false);
  const [isSnappingBack, setIsSnappingBack] = useState(false);

  // ── 已套用的剪輯配置 ──
  const [exportConfig, setExportConfig] = useState<ClipExportConfig | null>(null);

  // ── Refs ──
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoUrlRef = useRef<string>("");
  const estimateTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const clipAreaRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef({ x: 0, y: 0, translateX: 0, translateY: 0, cropX: 0, cropY: 0, cropW: 0, cropH: 0 });

  // ── useVideoTransform Hook ──
  const transform = useVideoTransform({
    videoWidth: videoInfo?.width ?? 1,
    videoHeight: videoInfo?.height ?? 1,
    containerWidth: cropContainerSize.width,
    containerHeight: cropContainerSize.height,
  });

  // ── 衍生資料 ──
  const duration = videoInfo?.duration ?? 0;
  const trimDuration = useMemo(() => Math.max(0, endT - startT), [startT, endT]);

  const sizeKB = Math.round(video.size / 1024);
  const sizeMB = (video.size / 1024 / 1024).toFixed(1);
  const sizeDisplay = sizeKB > 1024 ? `${sizeMB} MB` : `${sizeKB} KB`;

  // ── 建立 ObjectURL ──
  useEffect(() => {
    const url = URL.createObjectURL(video.file);
    videoUrlRef.current = url;
    return () => URL.revokeObjectURL(url);
  }, [video.file]);

  // ── 載入影片資訊 ──
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getVideoInfo(video.file)
      .then((info) => {
        if (cancelled) return;
        setVideoInfo(info);
        setEndT(info.duration);
        setIncludeAudio(info.has_audio);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("取得影片資訊失敗:", err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [video.file]);

  // ── 播放區間限制 (clip 模式)：到達 endT 時回到 startT ──
  useEffect(() => {
    const el = videoRef.current;
    if (!el || mode !== "clip") return;

    const handleTimeUpdate = () => {
      setCurrentTime(el.currentTime);
      if (el.currentTime >= endT) {
        el.currentTime = startT;
        setCurrentTime(startT);
      }
    };

    el.addEventListener("timeupdate", handleTimeUpdate);
    return () => el.removeEventListener("timeupdate", handleTimeUpdate);
  }, [mode, startT, endT]);

  // ── 監聽播放/暫停事件同步狀態 ──
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
    };
  }, []);

  // ── 預估觸發 (debounce 800ms) ──
  useEffect(() => {
    if (mode !== "clip" || !videoInfo) return;

    if (estimateTimerRef.current) clearTimeout(estimateTimerRef.current);

    estimateTimerRef.current = setTimeout(async () => {
      setEstimating(true);
      try {
        const result = await estimateVideo(video.file, {
          include_audio: includeAudio,
        });
        setEstimate(result);
      } catch (err) {
        console.error("預估失敗:", err);
      } finally {
        setEstimating(false);
      }
    }, 800);

    return () => {
      if (estimateTimerRef.current) clearTimeout(estimateTimerRef.current);
    };
  }, [mode, trimDuration, includeAudio, video.file, videoInfo]);

  // ── 預估檔案大小 (根據裁剪比例) ──
  const estimatedSizeKB = useMemo(() => {
    if (!estimate || !duration) return null;
    const ratio = trimDuration / duration;
    return Math.round(estimate.original_size_kb * ratio);
  }, [estimate, duration, trimDuration]);

  // ── 旋轉 ──
  const handleRotate = useCallback((direction: "left" | "right") => {
    visualRotateRef.current += direction === "right" ? 90 : -90;
    setVisualRotate(visualRotateRef.current);
    setBaseRotate((prev) => (direction === "right" ? (prev + 90) % 360 : (prev - 90 + 360) % 360));
  }, []);

  const handleRotateLeft = useCallback(() => handleRotate("left"), [handleRotate]);
  const handleRotateRight = useCallback(() => handleRotate("right"), [handleRotate]);

  // ── 翻轉 ──
  const handleFlipX = useCallback(() => setFlipX((prev) => !prev), []);
  const handleFlipY = useCallback(() => setFlipY((prev) => !prev), []);

  // ── 影片 CSS transform (預設模式用) ──
  const defaultVideoTransform = useMemo(() => {
    const sx = flipX ? -1 : 1;
    const sy = flipY ? -1 : 1;
    return `scale(${sx}, ${sy}) rotate(${visualRotate}deg)`;
  }, [flipX, flipY, visualRotate]);

  const isRotated90 = baseRotate % 180 !== 0;

  // ─────────────────────────────────────────────
  // 剪輯模式 — 統一的時間 + 空間操作
  // ─────────────────────────────────────────────

  // ── 進入剪輯模式 ──
  const handleEnterClip = useCallback(() => {
    if (!videoInfo) return;
    const el = clipAreaRef.current;
    if (!el) return;

    // 測量可用空間（扣除底部時間軸約 100px）
    const rect = el.getBoundingClientRect();
    const availW = rect.width;
    const availH = rect.height - 100;

    const M = Math.min(availW / videoInfo.width, availH / videoInfo.height);
    const cW = Math.round(videoInfo.width * M);
    const cH = Math.round(videoInfo.height * M);

    setCropContainerSize({ width: cW, height: cH });
    setMode("clip");

    // 從 startT 開始播放
    const vid = videoRef.current;
    if (vid) {
      vid.loop = false;
      vid.currentTime = startT;
      setCurrentTime(startT);
    }
  }, [videoInfo, startT]);

  // 進入 clip 模式後重置 transform 並開始播放
  const prevModeRef = useRef<EditorMode>("default");
  useEffect(() => {
    if (mode === "clip" && prevModeRef.current !== "clip") {
      transform.reset();
      // 在下一幀開始播放 (確保 video ref 已掛載)
      requestAnimationFrame(() => {
        const vid = videoRef.current;
        if (vid) vid.play();
      });
    }
    prevModeRef.current = mode;
  }, [mode, transform.reset]);

  // ── 套用剪輯 — 同時輸出時間 + 空間參數 ──
  const handleConfirmClip = useCallback(() => {
    if (!videoInfo) return;

    const area = getFinalVideoCropArea(
      transform.state,
      transform.displayMultiplier,
      cropContainerSize.width,
      cropContainerSize.height,
      videoInfo.width,
      videoInfo.height,
    );

    const config: ClipExportConfig = {
      start_t: Math.round(startT * 100) / 100,
      end_t: Math.round(endT * 100) / 100,
      crop_x: area.x,
      crop_y: area.y,
      crop_w: area.width,
      crop_h: area.height,
      include_audio: includeAudio,
    };

    setExportConfig(config);
    console.log("剪輯配置:", config);

    setMode("default");
    const vid = videoRef.current;
    if (vid) {
      vid.loop = true;
      vid.play();
    }
  }, [videoInfo, transform.state, transform.displayMultiplier, cropContainerSize, startT, endT, includeAudio]);

  // ── 取消剪輯 ──
  const handleCancelClip = useCallback(() => {
    setStartT(0);
    setEndT(duration);
    setMode("default");
    const vid = videoRef.current;
    if (vid) {
      vid.loop = true;
      vid.currentTime = 0;
      vid.play();
    }
  }, [duration]);

  // ── 播放/暫停切換 ──
  const handlePlayPause = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (isPlaying) {
      el.pause();
    } else {
      if (el.currentTime >= endT || el.currentTime < startT) {
        el.currentTime = startT;
        setCurrentTime(startT);
      }
      el.play();
    }
  }, [isPlaying, startT, endT]);

  // ── 滑桿回調 ──
  const handleStartChange = useCallback(
    (v: number) => {
      setStartT(v);
      const el = videoRef.current;
      if (el) {
        el.currentTime = v;
        setCurrentTime(v);
      }
    },
    [],
  );

  const handleEndChange = useCallback(
    (v: number) => {
      setEndT(v);
      const el = videoRef.current;
      if (el && el.currentTime > v) {
        el.currentTime = v;
        setCurrentTime(v);
      }
    },
    [],
  );

  const handleSeek = useCallback((v: number) => {
    const el = videoRef.current;
    if (el) {
      el.currentTime = v;
      setCurrentTime(v);
    }
  }, []);

  // ─────────────────────────────────────────────
  // 裁切交互
  // ─────────────────────────────────────────────

  // ── 滾輪縮放 ──
  const handleCropWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = -e.deltaY * 0.001;
      transform.setScale(transform.state.scale + delta);
    },
    [transform.state.scale, transform.setScale],
  );

  // ── 容器 mousedown (拖曳影片) ──
  const handleCropContainerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      setIsDraggingVideo(true);
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        translateX: transform.state.translateX,
        translateY: transform.state.translateY,
        cropX: 0, cropY: 0, cropW: 0, cropH: 0,
      };
    },
    [transform.state.translateX, transform.state.translateY],
  );

  // ── Handle mousedown (調整裁切框) ──
  const handleCropResizeMouseDown = useCallback(
    (handle: CropResizeHandle) => (e: React.MouseEvent) => {
      e.stopPropagation();
      setIsResizingCrop(handle);
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        translateX: 0,
        translateY: 0,
        cropX: transform.state.cropX,
        cropY: transform.state.cropY,
        cropW: transform.state.cropW,
        cropH: transform.state.cropH,
      };
    },
    [transform.state.cropX, transform.state.cropY, transform.state.cropW, transform.state.cropH],
  );

  // ── 全域滑鼠事件 (拖曳 / 調整) ──
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragStartRef.current.x;
      const deltaY = e.clientY - dragStartRef.current.y;

      if (isResizingCrop) {
        transform.setCropBox({
          cropX: dragStartRef.current.cropX,
          cropY: dragStartRef.current.cropY,
          cropW: dragStartRef.current.cropW,
          cropH: dragStartRef.current.cropH,
        });
        transform.resizeCropBox(isResizingCrop, deltaX, deltaY);
      } else if (isDraggingVideo) {
        transform.setTranslate(
          dragStartRef.current.translateX + deltaX,
          dragStartRef.current.translateY + deltaY,
        );
      }
    };

    const handleMouseUp = () => {
      setIsResizingCrop(null);
      setIsDraggingVideo(false);
      setIsSnappingBack(true);
      transform.clampPosition();
    };

    if (isResizingCrop || isDraggingVideo) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isResizingCrop, isDraggingVideo, transform]);

  // ── 回彈動畫結束後重置 ──
  useEffect(() => {
    if (isSnappingBack) {
      const timer = setTimeout(() => setIsSnappingBack(false), 250);
      return () => clearTimeout(timer);
    }
  }, [isSnappingBack]);

  // ── 裁切比例預設 ──
  const handleSetCropRatio = useCallback(
    (ratioW: number, ratioH: number) => {
      const cW = cropContainerSize.width;
      const cH = cropContainerSize.height;
      const ratio = ratioW / ratioH;

      let newW: number, newH: number;
      if (ratio >= cW / cH) {
        newW = cW;
        newH = cW / ratio;
      } else {
        newH = cH;
        newW = cH * ratio;
      }

      const newX = (cW - newW) / 2;
      const newY = (cH - newH) / 2;

      setIsCropAnimating(true);
      transform.setCropBox({ cropX: newX, cropY: newY, cropW: newW, cropH: newH });
      transform.setTranslate(0, 0);
      transform.setScale(1);
      setTimeout(() => setIsCropAnimating(false), 450);
    },
    [cropContainerSize, transform],
  );

  // ── 裁切框動畫過渡 ──
  const cropTransition = isCropAnimating && !isResizingCrop && !isDraggingVideo
    ? "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)"
    : "none";

  // ── Loading ──
  if (loading) {
    return (
      <div className="min-h-screen bg-sidebar flex items-center justify-center">
        <div className="text-white/50 text-sm">正在載入影片資訊...</div>
      </div>
    );
  }

  // ── 裁切框 UI 資料 ──
  const { cropX, cropY, cropW, cropH } = transform.state;

  return (
    <div className="h-screen flex overflow-hidden bg-sidebar">
      {/* ── 左側面板 ── */}
      <aside className="w-[30%] min-w-[240px] max-w-[320px] flex flex-col h-screen sidebar-scroll overflow-y-auto bg-sidebar">
        {/* Logo */}
        <div className="p-4 pb-2 mx-auto mb-6">
          <img src={vicLogo} alt="VicgoVic!" className="h-16" />
        </div>

        {/* 控制面板 */}
        <div className="flex-1 p-4 pt-2 flex flex-col gap-3">
          {/* 影片資訊 */}
          <div className="bg-white/10 rounded-[10px] p-3">
            <p className="text-xs text-white/70 mb-2 font-medium">影片資訊</p>
            <div className="flex flex-col gap-1 text-xs text-white/50">
              <div className="flex justify-between">
                <span>檔案名稱</span>
                <span className="text-white/80 truncate max-w-[140px]">{video.name}</span>
              </div>
              <div className="flex justify-between">
                <span>檔案大小</span>
                <span className="text-white/80">{sizeDisplay}</span>
              </div>
              {videoInfo && (
                <>
                  <div className="flex justify-between">
                    <span>長度</span>
                    <span className="text-white/80">{formatTime(videoInfo.duration)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>解析度</span>
                    <span className="text-white/80">{videoInfo.width} x {videoInfo.height}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>FPS</span>
                    <span className="text-white/80">{videoInfo.fps.toFixed(1)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>音軌</span>
                    <span className="text-white/80">{videoInfo.has_audio ? "有" : "無"}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ── 預設模式 ── */}
          {mode === "default" && (
            <div className="flex flex-col gap-3">
              {/* 進入剪輯模式 */}
              <button
                onClick={handleEnterClip}
                className="w-full px-4 py-3 bg-[#00B4FF] text-white font-bold rounded-[10px] transition-all btn-vic"
              >
                剪輯模式
              </button>

              {/* 旋轉區塊 */}
              <div className="bg-white/10 rounded-[10px] p-3">
                <p className="text-xs text-white/70 mb-2 font-medium">旋轉</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={handleRotateLeft}
                    className="px-2 py-2 text-sm bg-white/10 hover:bg-white/20 text-white rounded-[10px] transition-colors"
                    title="左轉 90°"
                  >
                    ↺ 左轉
                  </button>
                  <button
                    onClick={handleRotateRight}
                    className="px-2 py-2 text-sm bg-white/10 hover:bg-white/20 text-white rounded-[10px] transition-colors"
                    title="右轉 90°"
                  >
                    ↻ 右轉
                  </button>
                </div>
              </div>

              {/* 翻轉區塊 */}
              <div className="bg-white/10 rounded-[10px] p-3">
                <p className="text-xs text-white/70 mb-2 font-medium">翻轉</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={handleFlipX}
                    className={`px-2 py-2 text-sm rounded-[10px] transition-colors ${
                      flipX
                        ? "bg-[#00B4FF] text-white font-medium"
                        : "bg-white/10 hover:bg-white/20 text-white"
                    }`}
                    title="水平翻轉"
                  >
                    ⇆ 水平
                  </button>
                  <button
                    onClick={handleFlipY}
                    className={`px-2 py-2 text-sm rounded-[10px] transition-colors ${
                      flipY
                        ? "bg-[#00B4FF] text-white font-medium"
                        : "bg-white/10 hover:bg-white/20 text-white"
                    }`}
                    title="垂直翻轉"
                  >
                    ⇅ 垂直
                  </button>
                </div>
              </div>

              {/* 狀態資訊 */}
              <div className="text-xs text-white/70 font-mono space-y-1 p-2">
                {videoInfo && (
                  <>
                    <div>解析度: {videoInfo.width} x {videoInfo.height}</div>
                    <div>長度: {formatTime(videoInfo.duration)}</div>
                  </>
                )}
                <div>旋轉: {((baseRotate % 360) + 360) % 360}°</div>
                {exportConfig && (
                  <>
                    <div>時間: {formatTime(exportConfig.start_t)} – {formatTime(exportConfig.end_t)}</div>
                    <div>裁切: {exportConfig.crop_w} x {exportConfig.crop_h} @ ({exportConfig.crop_x}, {exportConfig.crop_y})</div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── 剪輯模式面板 ── */}
          {mode === "clip" && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-[#00B4FF] font-medium">剪輯模式</p>

              {/* 時間區段 */}
              <div className="bg-white/10 rounded-[10px] p-3">
                <p className="text-xs text-white/70 mb-2 font-medium">時間範圍</p>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="bg-white/5 rounded-lg p-2 text-center">
                    <p className="text-[10px] text-white/40 mb-0.5">起點</p>
                    <p className="text-sm font-mono text-[#00B4FF]">{formatTime(startT)}</p>
                  </div>
                  <div className="bg-white/5 rounded-lg p-2 text-center">
                    <p className="text-[10px] text-white/40 mb-0.5">終點</p>
                    <p className="text-sm font-mono text-[#00B4FF]">{formatTime(endT)}</p>
                  </div>
                </div>

                <div className="bg-white/5 rounded-lg p-2 mb-3">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-white/50">輸出長度</span>
                    <span className="text-sm font-mono font-bold text-white">
                      {formatTime(trimDuration)}
                    </span>
                  </div>
                </div>

                <div className="bg-white/5 rounded-lg p-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-white/50">預估大小</span>
                    <span className="text-sm font-mono text-white/80">
                      {estimating
                        ? "計算中..."
                        : estimatedSizeKB != null
                          ? estimatedSizeKB > 1024
                            ? `${(estimatedSizeKB / 1024).toFixed(1)} MB`
                            : `${estimatedSizeKB} KB`
                          : "—"}
                    </span>
                  </div>
                </div>
              </div>

              {/* 音訊開關 */}
              <div className="bg-white/10 rounded-[10px] p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/70 font-medium">保留音軌</span>
                  <button
                    onClick={handleToggleAudio}
                    className={`relative w-10 h-[22px] rounded-full transition-colors duration-200 ${
                      includeAudio ? "bg-[#00B4FF]" : "bg-white/20"
                    }`}
                  >
                    <span
                      className={`absolute top-[3px] left-[3px] w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${
                        includeAudio ? "translate-x-[18px]" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
                {!videoInfo?.has_audio && (
                  <p className="text-[10px] text-white/30 mt-1">此影片無音軌</p>
                )}
              </div>

              {/* 裁切比例 */}
              <div className="bg-white/10 rounded-[10px] p-3">
                <p className="text-xs text-white/70 font-medium mb-2">裁切比例</p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: "1:1", w: 1, h: 1 },
                    { label: "4:5", w: 4, h: 5 },
                    { label: "5:4", w: 5, h: 4 },
                    { label: "16:9", w: 16, h: 9 },
                    { label: "9:16", w: 9, h: 16 },
                    { label: "3:2", w: 3, h: 2 },
                    { label: "2:3", w: 2, h: 3 },
                    { label: "4:3", w: 4, h: 3 },
                    { label: "3:4", w: 3, h: 4 },
                  ].map(({ label, w, h }) => (
                    <button
                      key={label}
                      onClick={() => handleSetCropRatio(w, h)}
                      className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 transition-all
                        hover:bg-[#00B4FF]/15 hover:border-[#00B4FF]/60 active:scale-95"
                      style={{ aspectRatio: "1 / 1" }}
                    >
                      <div
                        className="rounded-[2px]"
                        style={{
                          border: "1px solid rgba(0, 180, 255, 0.7)",
                          width: w > h ? 20 : Math.round(20 * w / h),
                          height: h > w ? 20 : Math.round(20 * h / w),
                        }}
                      />
                      <span className="text-[10px] font-medium text-white/80">{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* 縮放滑桿 */}
              <div className="bg-white/10 rounded-[10px] p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-white/70 font-medium">縮放</p>
                  <span className="text-xs font-mono text-white/60">{Math.round(transform.state.scale * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={5}
                  step={0.01}
                  value={transform.state.scale}
                  onChange={(e) => transform.setScale(parseFloat(e.target.value))}
                  className="w-full slider-dark"
                />
              </div>

              {/* 裁切尺寸資訊 */}
              {videoInfo && (
                <div className="text-xs text-white/70 font-mono space-y-1 p-2">
                  <div>
                    裁切: {Math.round(cropW / transform.displayMultiplier / transform.state.scale)} x{" "}
                    {Math.round(cropH / transform.displayMultiplier / transform.state.scale)} px
                  </div>
                  <div>原始: {videoInfo.width} x {videoInfo.height}</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 底部按鈕 */}
        <div className="p-4 pt-0 flex flex-col gap-2">
          {mode === "clip" && (
            <button
              onClick={handleConfirmClip}
              className="w-full px-4 py-3 bg-[#00B4FF] text-white font-bold rounded-[10px] transition-all btn-vic"
            >
              套用剪輯
            </button>
          )}
          {mode === "clip" && (
            <button
              onClick={handleCancelClip}
              className="w-full px-4 py-2 text-white/80 hover:text-white text-md transition-colors"
            >
              返回
            </button>
          )}
          {mode === "default" && (
            <button
              onClick={onReset}
              className="w-full px-4 py-2 text-white/70 hover:text-white text-md transition-colors"
            >
              返回
            </button>
          )}
        </div>
      </aside>

      {/* ── 右側主要內容 ── */}
      <main className="flex-1 flex flex-col h-screen">
        <div ref={clipAreaRef} className="flex-1 bg-preview/5 flex flex-col items-center justify-center m-4 mb-0 rounded-lg overflow-hidden relative">
          {mode === "clip" && videoInfo ? (
            /* ── 剪輯工作區：上方裁切預覽 + 下方時間軸 ── */
            <>
              {/* 裁切預覽區 */}
              <div
                className="relative select-none flex-shrink-0"
                style={{
                  width: cropContainerSize.width,
                  height: cropContainerSize.height,
                  cursor: isDraggingVideo ? "grabbing" : "grab",
                }}
                onWheel={handleCropWheel}
                onMouseDown={handleCropContainerMouseDown}
              >
                {/* overflow-hidden 裁剪層 */}
                <div className="absolute inset-0 overflow-hidden">
                  {/* 影片層 — 播放中裁切效果持續生效 */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <video
                      ref={videoRef}
                      src={videoUrlRef.current}
                      className="max-w-none pointer-events-none"
                      style={{
                        width: videoInfo.width * transform.displayMultiplier,
                        height: videoInfo.height * transform.displayMultiplier,
                        transform: transform.videoTransform,
                        transformOrigin: "center center",
                        transition: isSnappingBack ? "transform 200ms ease-out" : "none",
                        willChange: "transform",
                      }}
                      muted
                      playsInline
                    />
                  </div>

                  {/* 遮罩層 */}
                  <div className="absolute inset-0 pointer-events-none">
                    <div
                      className="absolute bg-black/50"
                      style={{ top: 0, left: 0, right: 0, height: cropY, transition: cropTransition }}
                    />
                    <div
                      className="absolute bg-black/50"
                      style={{ top: cropY + cropH, left: 0, right: 0, bottom: 0, transition: cropTransition }}
                    />
                    <div
                      className="absolute bg-black/50"
                      style={{ top: cropY, left: 0, width: cropX, height: cropH, transition: cropTransition }}
                    />
                    <div
                      className="absolute bg-black/50"
                      style={{
                        top: cropY,
                        left: cropX + cropW,
                        right: 0,
                        height: cropH,
                        transition: cropTransition,
                      }}
                    />
                  </div>
                </div>

                {/* 裁切框 + 手把 */}
                <div
                  className="absolute border-2 pointer-events-none"
                  style={{
                    left: cropX,
                    top: cropY,
                    width: cropW,
                    height: cropH,
                    borderColor: "#00B4FF",
                    transition: cropTransition,
                  }}
                >
                  {/* 九宮格 */}
                  <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none">
                    {[...Array(9)].map((_, i) => (
                      <div
                        key={i}
                        className="border"
                        style={{ borderColor: "rgba(0, 180, 255, 0.3)" }}
                      />
                    ))}
                  </div>

                  {/* 四角 Handles */}
                  {(["nw", "ne", "sw", "se"] as const).map((handle) => (
                    <div
                      key={handle}
                      className="absolute w-4 h-4 pointer-events-auto"
                      style={{
                        top: handle.includes("n") ? -8 : "auto",
                        bottom: handle.includes("s") ? -8 : "auto",
                        left: handle.includes("w") ? -8 : "auto",
                        right: handle.includes("e") ? -8 : "auto",
                        cursor:
                          handle === "nw" || handle === "se"
                            ? "nwse-resize"
                            : "nesw-resize",
                        backgroundColor: "#00B4FF",
                        borderRadius: 2,
                      }}
                      onMouseDown={handleCropResizeMouseDown(handle)}
                    />
                  ))}

                  {/* 四邊 Handles */}
                  {(["n", "s", "e", "w"] as const).map((handle) => (
                    <div
                      key={handle}
                      className="absolute pointer-events-auto"
                      style={{
                        backgroundColor: "#00B4FF",
                        borderRadius: 3,
                        ...(handle === "n" && {
                          top: -3,
                          left: "50%",
                          transform: "translateX(-50%)",
                          width: 30,
                          height: 6,
                          cursor: "ns-resize",
                        }),
                        ...(handle === "s" && {
                          bottom: -3,
                          left: "50%",
                          transform: "translateX(-50%)",
                          width: 30,
                          height: 6,
                          cursor: "ns-resize",
                        }),
                        ...(handle === "w" && {
                          left: -3,
                          top: "50%",
                          transform: "translateY(-50%)",
                          width: 6,
                          height: 30,
                          cursor: "ew-resize",
                        }),
                        ...(handle === "e" && {
                          right: -3,
                          top: "50%",
                          transform: "translateY(-50%)",
                          width: 6,
                          height: 30,
                          cursor: "ew-resize",
                        }),
                      }}
                      onMouseDown={handleCropResizeMouseDown(handle)}
                    />
                  ))}
                </div>
              </div>

              {/* 時間軸 — 緊接在裁切預覽下方 */}
              {duration > 0 && (
                <div className="w-full shrink-0 px-6 pt-4 pb-2 flex flex-col gap-3">
                  <TrimSlider
                    duration={duration}
                    startT={startT}
                    endT={endT}
                    currentTime={currentTime}
                    onStartChange={handleStartChange}
                    onEndChange={handleEndChange}
                    onSeek={handleSeek}
                  />

                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/40 font-mono">
                      {formatTime(startT)}
                    </span>

                    <button
                      onClick={handlePlayPause}
                      className="w-9 h-9 flex items-center justify-center rounded-full bg-[#00B4FF] text-white hover:brightness-110 btn-vic transition-all"
                    >
                      {isPlaying ? (
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      )}
                    </button>

                    <span className="text-xs text-white/40 font-mono">
                      {formatTime(endT)}
                    </span>
                  </div>
                </div>
              )}
            </>
          ) : (
            /* ── 一般影片播放器 ── */
            <video
              ref={videoRef}
              src={videoUrlRef.current}
              className={isRotated90 ? "max-w-full max-h-full" : "max-w-full max-h-full"}
              style={{
                transform: defaultVideoTransform,
                transition: "transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
                ...(isRotated90 ? { maxWidth: "100vh", maxHeight: "100vw" } : {}),
              }}
              muted
              autoPlay
              loop
              playsInline
            />
          )}
        </div>

        {/* 底部控制區 (僅預設模式) */}
        {mode === "default" && (
          <div className="shrink-0 px-6 py-4">
            <div className="flex items-center justify-center py-2">
              <span className="text-xs text-white/30">
                選擇左側工具開始編輯
              </span>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
