import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { VideoItem, ClipExportConfig, SavedClipState } from "../types";
import type { VideoExportState } from "../App";
import { getVideoInfo } from "../api/videoApi";
import type { VideoInfoResult } from "../api/videoApi";
import { useVideoTransform } from "../hooks/useVideoTransform";
import { generateFilmstrip } from "../utils/filmstrip";
import { reconstructTransformFromCrop, getFinalVideoCropArea } from "../utils/videoCropMath";
import { TrimSlider } from "../components/TrimSlider";
import { CropOverlay } from "../components/CropOverlay";
import vicLogo from "../assets/vic_logo.png";
import { ConfirmModal } from "../components/ConfirmModal";

interface VideoEditorPageProps {
  video: VideoItem;
  onExport: (state: VideoExportState) => void;
  onReset: () => void;
  initialState?: VideoExportState | null;
}

/** 秒數格式化為 mm:ss.x */
function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

// Re-export types for consumers that previously imported from this file
export type { ClipExportConfig, SavedClipState } from "../types";

// ─────────────────────────────────────────────
// VideoEditorPage — 主頁面
// ─────────────────────────────────────────────

type EditorMode = "default" | "clip";
type CropResizeHandle = "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";

export function VideoEditorPage({ video, onExport, onReset, initialState }: VideoEditorPageProps) {
  // ── GIF 來源偵測 ──
  const isGifSource = video.file.type === "image/gif";

  // ── 影片資訊 ──
  const [videoInfo, setVideoInfo] = useState<VideoInfoResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [showResetModal, setShowResetModal] = useState(false);

  // ── 編輯模式 ──
  const [mode, setMode] = useState<EditorMode>("default");

  // ── 旋轉/翻轉 ──
  const [baseRotate, setBaseRotate] = useState(initialState?.rotate ?? 0);
  const visualRotateRef = useRef(initialState?.rotate ?? 0);
  const [visualRotate, setVisualRotate] = useState(initialState?.rotate ?? 0);
  const [flipX, setFlipX] = useState(initialState?.flipH ?? false);
  const [flipY, setFlipY] = useState(initialState?.flipV ?? false);

  // ── 時間裁剪參數 ──
  const [startT, setStartT] = useState(initialState?.clipConfig?.start_t ?? 0);
  const [endT, setEndT] = useState(initialState?.clipConfig?.end_t ?? 0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // ── Trim ref (同步更新，避免 timeupdate 閉包讀到舊值) ──
  const trimRef = useRef({ startT: 0, endT: 0 });
  trimRef.current.startT = startT;
  trimRef.current.endT = endT;
  const isTrimDraggingRef = useRef(false);

  // ── 音訊開關 ──
  const [includeAudio, setIncludeAudio] = useState(isGifSource ? false : (initialState?.clipConfig?.include_audio ?? true));
  const handleToggleAudio = useCallback(() => setIncludeAudio((prev) => !prev), []);


  // ── 空間裁切 (clip 模式共用) ──
  const [cropContainerSize, setCropContainerSize] = useState({ width: 800, height: 600 });
  const [isDraggingVideo, setIsDraggingVideo] = useState(false);
  const [isResizingCrop, setIsResizingCrop] = useState<CropResizeHandle | null>(null);
  const [isCropAnimating, setIsCropAnimating] = useState(false);
  const [isSnappingBack, setIsSnappingBack] = useState(false);

  // ── 已套用的剪輯配置 ──
  const [exportConfig, setExportConfig] = useState<ClipExportConfig | null>(initialState?.clipConfig ?? null);

  // ── 剪輯狀態持久化 (重新進入時恢復) ──
  const [savedClipState, setSavedClipState] = useState<SavedClipState | null>(initialState?.savedClipState ?? null);
  const [selectedCropRatio, setSelectedCropRatio] = useState<string | null>(initialState?.savedClipState?.cropRatio ?? null);

  // ── 膠捲縮圖 (Filmstrip) ──
  const [filmstrip, setFilmstrip] = useState<string[]>([]);
  const filmstripCacheRef = useRef<{ fileId: string; frames: string[] } | null>(null);

  // ── 預覽區域尺寸 (用於裁切預覽計算) ──
  const [previewAreaSize, setPreviewAreaSize] = useState({ width: 800, height: 600 });

  // ── 瀏覽器實際解碼的影片解析度 (video.videoWidth/Height) ──
  const [intrinsicVideoSize, setIntrinsicVideoSize] = useState<{ w: number; h: number } | null>(null);

  // ── GIF 預覽 MP4 URL (後端代理) ──
  const [gifPreviewUrl, setGifPreviewUrl] = useState<string | null>(null);
  const seekTimerRef = useRef<number | null>(null);

  // ── Refs ──
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoUrlRef = useRef<string>("");
  const clipAreaRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef({ x: 0, y: 0, translateX: 0, translateY: 0, cropX: 0, cropY: 0, cropW: 0, cropH: 0 });

  // ── 統一的影片尺寸來源：優先使用瀏覽器 intrinsic，fallback 到 backend ──
  const effectiveVideoW = intrinsicVideoSize?.w ?? videoInfo?.width ?? 1;
  const effectiveVideoH = intrinsicVideoSize?.h ?? videoInfo?.height ?? 1;

  // ── useVideoTransform Hook (使用統一尺寸) ──
  const transform = useVideoTransform({
    videoWidth: effectiveVideoW,
    videoHeight: effectiveVideoH,
    containerWidth: cropContainerSize.width,
    containerHeight: cropContainerSize.height,
  });

  // ── 衍生資料 ──
  const duration = videoInfo?.duration ?? 0;
  const trimDuration = useMemo(() => Math.max(0, endT - startT), [startT, endT]);

  // ── GIF 預覽 MP4 優先，fallback 到 ObjectURL ──
  const effectiveVideoSrc = (isGifSource && gifPreviewUrl) ? gifPreviewUrl : videoUrlRef.current;

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
        // GIF 預覽 URL
        if (info.preview_url) setGifPreviewUrl(info.preview_url);
        if (initialState?.clipConfig) {
          // 從匯出頁返回：保留已有的剪輯狀態
          setStartT(initialState.clipConfig.start_t);
          setEndT(initialState.clipConfig.end_t);
          setIncludeAudio(initialState.clipConfig.include_audio);
        } else {
          // 新影片：重置所有剪輯狀態
          setEndT(info.duration);
          setStartT(0);
          setIncludeAudio(isGifSource ? false : info.has_audio);
          setSavedClipState(null);
          setSelectedCropRatio(null);
          setExportConfig(null);
          setIntrinsicVideoSize(null);
        }
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

  // ── 產生膠捲縮圖 (帶快取) ──
  // GIF 需等 gifPreviewUrl 就緒後用 MP4 預覽產生
  const filmstripSrc = isGifSource ? gifPreviewUrl : video.file;
  useEffect(() => {
    if (!filmstripSrc) return;
    const cache = filmstripCacheRef.current;
    if (cache && cache.fileId === video.id) {
      setFilmstrip(cache.frames);
      return;
    }
    let cancelled = false;
    setFilmstrip([]);
    generateFilmstrip(filmstripSrc, 12).then((frames: string[]) => {
      if (cancelled) return;
      filmstripCacheRef.current = { fileId: video.id, frames };
      setFilmstrip(frames);
    }).catch((err: unknown) => {
      if (!cancelled) console.error("膠捲產生失敗:", err);
    });
    return () => { cancelled = true; };
  }, [video.id, filmstripSrc]);

  // ── 追蹤預覽區域尺寸 (ResizeObserver) ──
  useEffect(() => {
    const el = clipAreaRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setPreviewAreaSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── 播放區間限制 (clip 模式)：到達 endT 時回到 startT ──
  // 使用 trimRef 避免閉包捕獲舊值；拖曳中暫停循環邏輯
  useEffect(() => {
    const el = videoRef.current;
    if (!el || mode !== "clip") return;

    const handleTimeUpdate = () => {
      setCurrentTime(el.currentTime);
      if (isTrimDraggingRef.current) return;
      if (el.currentTime >= trimRef.current.endT) {
        el.currentTime = trimRef.current.startT;
        setCurrentTime(trimRef.current.startT);
      }
    };

    el.addEventListener("timeupdate", handleTimeUpdate);
    return () => el.removeEventListener("timeupdate", handleTimeUpdate);
  }, [mode]);

  // ── 播放區間限制 (default 模式含 exportConfig)：到達 end_t 時回到 start_t ──
  useEffect(() => {
    const el = videoRef.current;
    if (!el || mode !== "default" || !exportConfig) return;

    // 初始 seek 到起點
    if (el.currentTime < exportConfig.start_t || el.currentTime >= exportConfig.end_t) {
      el.currentTime = exportConfig.start_t;
    }

    const handleTimeUpdate = () => {
      if (el.currentTime >= exportConfig.end_t || el.currentTime < exportConfig.start_t) {
        el.currentTime = exportConfig.start_t;
      }
    };
    const handleEnded = () => {
      el.currentTime = exportConfig.start_t;
      el.play();
    };

    el.addEventListener("timeupdate", handleTimeUpdate);
    el.addEventListener("ended", handleEnded);
    return () => {
      el.removeEventListener("timeupdate", handleTimeUpdate);
      el.removeEventListener("ended", handleEnded);
    };
  }, [mode, exportConfig]);

  // ── 監聽播放/暫停事件同步狀態 ──
  // mode 切換時 video 元素會重建，需重新綁定事件
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    // 同步初始狀態 (新掛載的 video 可能已在播放)
    setIsPlaying(!el.paused);
    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
    };
  }, [mode, exportConfig]);


  // ── 預估檔案大小 (直接從 videoInfo.file_size 按時長比例計算) ──
  const estimatedSizeKB = useMemo(() => {
    if (!videoInfo || !duration || duration <= 0) return null;
    const originalKB = Math.round(videoInfo.file_size / 1024);
    const ratio = trimDuration / duration;
    return Math.round(originalKB * ratio);
  }, [videoInfo, duration, trimDuration]);

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

  // ── 裁切預覽容器尺寸 (fit within preview area) ──
  const cropPreviewDims = useMemo(() => {
    if (!exportConfig) return null;
    const cropAR = exportConfig.crop_w / exportConfig.crop_h;
    const pad = 0.92;
    // 旋轉 90° 時視覺上寬高互換，需以互換後的空間來 fit
    const aW = (isRotated90 ? previewAreaSize.height : previewAreaSize.width) * pad;
    const aH = (isRotated90 ? previewAreaSize.width : previewAreaSize.height) * pad;
    let w: number, h: number;
    if (cropAR >= aW / aH) {
      w = aW;
      h = w / cropAR;
    } else {
      h = aH;
      w = h * cropAR;
    }
    return { width: Math.round(w), height: Math.round(h) };
  }, [exportConfig, previewAreaSize, isRotated90]);

  // ─────────────────────────────────────────────
  // 剪輯模式 — 統一的時間 + 空間操作
  // ─────────────────────────────────────────────

  // ── 進入剪輯模式 ──
  const handleEnterClip = useCallback(() => {
    if (!videoInfo) return;
    const el = clipAreaRef.current;
    if (!el) return;

    // 擷取瀏覽器實際解碼的影片解析度 (在模式切換前，video 元素仍掛載)
    const vid = videoRef.current;
    const vW = (vid && vid.videoWidth > 0) ? vid.videoWidth : videoInfo.width;
    const vH = (vid && vid.videoHeight > 0) ? vid.videoHeight : videoInfo.height;
    setIntrinsicVideoSize({ w: vW, h: vH });

    // 測量可用空間（扣除底部時間軸約 100px）
    // 使用 intrinsic 尺寸計算，確保與 hook 的 displayMultiplier 一致
    const rect = el.getBoundingClientRect();
    const availW = rect.width;
    const availH = rect.height - 100;

    const M = Math.min(availW / vW, availH / vH);
    const cW = Math.round(vW * M);
    const cH = Math.round(vH * M);

    setCropContainerSize({ width: cW, height: cH });
    setMode("clip");
    // 注意：不在此處 seek — 因為 setMode 會觸發 video 元素重建，
    // seek 和 play 在 mode-change useEffect 中處理（新元素已掛載）
  }, [videoInfo]);

  // 進入 clip 模式後：恢復已儲存的狀態 或 完整重置
  const prevModeRef = useRef<EditorMode>("default");
  useEffect(() => {
    if (mode === "clip" && prevModeRef.current !== "clip") {
      if (savedClipState && exportConfig) {
        // 從已確認的配置恢復 — 重新計算 UI 座標以適應可能改變的容器尺寸
        const restored = reconstructTransformFromCrop(
          { x: exportConfig.crop_x, y: exportConfig.crop_y,
            width: exportConfig.crop_w, height: exportConfig.crop_h },
          savedClipState.scale,
          effectiveVideoW,
          effectiveVideoH,
          cropContainerSize.width,
          cropContainerSize.height,
        );
        transform.restoreState(restored);
        setSelectedCropRatio(savedClipState.cropRatio);
        console.log("[Clip Restore] 從儲存狀態恢復:", JSON.stringify(restored));
      } else {
        // 首次進入，完整重置
        transform.reset();
        setSelectedCropRatio(null);
      }
      // 在下一幀 seek 到 startT 並開始播放 (確保 video ref 已掛載)
      requestAnimationFrame(() => {
        const vid = videoRef.current;
        if (vid) {
          vid.loop = false;
          vid.currentTime = startT;
          setCurrentTime(startT);
          vid.play();
        }
      });
    }
    prevModeRef.current = mode;
  }, [mode, savedClipState, exportConfig, effectiveVideoW, effectiveVideoH, cropContainerSize, transform, startT]);

  // ── 套用剪輯 — 同時輸出時間 + 空間參數 ──
  const handleConfirmClip = useCallback(() => {
    if (!videoInfo) return;

    const vid = videoRef.current;

    // effectiveVideoW/H 已統一為 intrinsicVideoSize ?? videoInfo，
    // hook 的 M、CSS 尺寸、此處座標轉換全部使用同一來源
    const area = getFinalVideoCropArea(
      transform.state,
      transform.displayMultiplier,
      cropContainerSize.width,
      cropContainerSize.height,
      effectiveVideoW,
      effectiveVideoH,
    );

    console.log("[Clip Debug] effectiveVideo:", effectiveVideoW, "x", effectiveVideoH);
    console.log("[Clip Debug] displayMultiplier:", transform.displayMultiplier);
    console.log("[Clip Debug] container:", cropContainerSize.width, "x", cropContainerSize.height);
    console.log("[Clip Debug] transform state:", JSON.stringify(transform.state));
    console.log("[Clip Debug] area result:", JSON.stringify(area));

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

    // 持久化剪輯狀態 — 重新進入時可恢復
    setSavedClipState({
      scale: transform.state.scale,
      cropRatio: selectedCropRatio,
    });

    console.log("[Clip Debug] 剪輯配置:", config);

    setMode("default");
    if (vid) {
      vid.loop = true;
      vid.play();
    }
  }, [videoInfo, transform.state, transform.displayMultiplier, cropContainerSize, startT, endT, includeAudio, effectiveVideoW, effectiveVideoH, selectedCropRatio]);

  // ── 取消剪輯 — 僅退出模式，保留已儲存的設定 ──
  const handleCancelClip = useCallback(() => {
    setMode("default");
    const vid = videoRef.current;
    if (vid) {
      vid.loop = true;
      // 有已套用配置：從起始時間播放；否則從頭播放
      vid.currentTime = exportConfig?.start_t ?? 0;
      vid.play();
    }
  }, [exportConfig]);

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

  // ── Debounced seek (GIF 預覽 MP4 用 80ms 防抖) ──
  const doSeek = useCallback((v: number) => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = v;
    setCurrentTime(v);
  }, []);

  const debouncedSeek = useCallback((v: number) => {
    if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
    seekTimerRef.current = window.setTimeout(() => doSeek(v), 80);
  }, [doSeek]);

  const seekTo = isGifSource ? debouncedSeek : doSeek;

  // ── 滑桿回調 ──
  const handleStartChange = useCallback(
    (v: number) => {
      setStartT(v);
      const el = videoRef.current;
      if (el && !el.paused) el.pause();
      seekTo(v);
    },
    [seekTo],
  );

  const handleEndChange = useCallback(
    (v: number) => {
      setEndT(v);
      const el = videoRef.current;
      if (el && !el.paused) el.pause();
      seekTo(v);
    },
    [seekTo],
  );

  const handleSeek = useCallback((v: number) => {
    seekTo(v);
  }, [seekTo]);

  // ── 滑桿拖曳開始/結束 ──
  const wasPlayingBeforeDragRef = useRef(false);

  const handleTrimDragStart = useCallback(() => {
    isTrimDraggingRef.current = true;
    const el = videoRef.current;
    wasPlayingBeforeDragRef.current = !!el && !el.paused;
  }, []);

  const handleTrimDragEnd = useCallback((target: "start" | "end" | "seek") => {
    isTrimDraggingRef.current = false;
    const el = videoRef.current;
    if (!el) return;
    if (wasPlayingBeforeDragRef.current) {
      // 放手後從 startT 開始循環播放
      if (target === "start" || target === "end") {
        el.currentTime = trimRef.current.startT;
        setCurrentTime(trimRef.current.startT);
      }
      el.play();
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
      setSelectedCropRatio(`${ratioW}:${ratioH}`);

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
      // 保留當前縮放與位移，僅 clamp 確保影片仍覆蓋新裁切框
      transform.clampPosition();
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
    <div className="h-screen flex overflow-hidden bg-sidebar layout-editor">
      {/* ── 左側面板 ── */}
      <aside className="w-[30%] min-w-[240px] max-w-[320px] flex flex-col h-screen sidebar-scroll overflow-y-auto bg-sidebar max-md:h-auto">
        {/* Logo */}
        <div className="p-4 pb-2 mx-auto mb-6">
          <button onClick={() => setShowResetModal(true)} className="cursor-pointer">
            <img src={vicLogo} alt="VicgoVic!" className="h-16" />
          </button>
        </div>

        {/* 控制面板 */}
        <div className="flex-1 p-4 pt-2 flex flex-col gap-3">
          {/* 影片資訊 */}
          <div className="bg-white/10 rounded-[10px] p-3">
            <p className="text-xs text-white/70 mb-2 font-medium">影片資訊</p>
            <div className="flex flex-col gap-1 text-xs text-white/50">
              <div className="flex justify-between">
                <span>檔案大小</span>
                <span className="text-white/80">
                  {exportConfig && estimatedSizeKB != null
                    ? estimatedSizeKB > 1024
                      ? `≈ ${(estimatedSizeKB / 1024).toFixed(1)} MB`
                      : `≈ ${estimatedSizeKB} KB`
                    : sizeDisplay}
                </span>
              </div>
              <div className="flex justify-between">
                <span>尺寸</span>
                <span className="text-white/80">
                  {exportConfig
                    ? `${exportConfig.crop_w} x ${exportConfig.crop_h}`
                    : videoInfo
                      ? `${videoInfo.width} x ${videoInfo.height}`
                      : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span>長度</span>
                <span className="text-white/80">
                  {exportConfig
                    ? formatTime(exportConfig.end_t - exportConfig.start_t)
                    : videoInfo
                      ? formatTime(videoInfo.duration)
                      : "—"}
                </span>
              </div>
              {!isGifSource && (
                <div className="flex justify-between">
                  <span>音軌</span>
                  <span className="text-white/80">
                    {exportConfig
                      ? exportConfig.include_audio ? "有" : "無"
                      : videoInfo
                        ? videoInfo.has_audio ? "有" : "無"
                        : "—"}
                  </span>
                </div>
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
                      {estimatedSizeKB != null
                        ? estimatedSizeKB > 1024
                          ? `${(estimatedSizeKB / 1024).toFixed(1)} MB`
                          : `${estimatedSizeKB} KB`
                        : "—"}
                    </span>
                  </div>
                </div>
              </div>

              {/* 音訊開關 (GIF 無音軌，隱藏) */}
              {!isGifSource && (
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
              )}

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
                      className={`crop-ratio-btn flex flex-col items-center justify-center gap-1.5 rounded-lg border transition-all active:scale-95
                        ${selectedCropRatio === label
                          ? "border-[#00B4FF] bg-[#00B4FF]/20"
                          : "border-white/10 bg-white/5 hover:bg-[#00B4FF]/15 hover:border-[#00B4FF]/60"
                        }`}
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
              onClick={() => onExport({
                clipConfig: exportConfig,
                rotate: baseRotate,
                flipH: flipX,
                flipV: flipY,
                savedClipState,
              })}
              className="w-full px-4 py-3 bg-[#00B4FF] text-white font-bold rounded-[10px] transition-all btn-vic"
            >
              匯出影片
            </button>
          )}
          {mode === "default" && (
            <button
              onClick={() => setShowResetModal(true)}
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
                      src={effectiveVideoSrc}
                      className="max-w-none pointer-events-none"
                      style={{
                        width: effectiveVideoW * transform.displayMultiplier,
                        height: effectiveVideoH * transform.displayMultiplier,
                        transform: transform.videoTransform,
                        transformOrigin: "center center",
                        transition: isSnappingBack ? "transform 200ms ease-out" : "none",
                        willChange: "transform",
                      }}
                      muted
                      playsInline
                    />
                  </div>

                  <CropOverlay
                    cropX={cropX}
                    cropY={cropY}
                    cropW={cropW}
                    cropH={cropH}
                    transition={cropTransition}
                    onResizeMouseDown={handleCropResizeMouseDown}
                  />
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
                    filmstrip={filmstrip}
                    onStartChange={handleStartChange}
                    onEndChange={handleEndChange}
                    onSeek={handleSeek}
                    onDragStart={handleTrimDragStart}
                    onDragEnd={handleTrimDragEnd}
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
          ) : exportConfig && videoInfo && cropPreviewDims ? (
            /* ── 裁切預覽播放器 ── */
            <div
              className="relative overflow-hidden"
              style={{
                width: cropPreviewDims.width,
                height: cropPreviewDims.height,
                transform: defaultVideoTransform,
                transition: "transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
              }}
            >
              <video
                ref={videoRef}
                src={effectiveVideoSrc}
                className="absolute pointer-events-none max-w-none max-h-none"
                style={{
                  width: `${(effectiveVideoW / exportConfig.crop_w) * 100}%`,
                  height: `${(effectiveVideoH / exportConfig.crop_h) * 100}%`,
                  left: `${(-exportConfig.crop_x / exportConfig.crop_w) * 100}%`,
                  top: `${(-exportConfig.crop_y / exportConfig.crop_h) * 100}%`,
                }}
                muted
                autoPlay
                playsInline
              />
            </div>
          ) : (
            /* ── 影片播放器 (含 GIF MP4 預覽) ── */
            <video
              ref={videoRef}
              src={effectiveVideoSrc}
              className="max-w-full max-h-full"
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

      <ConfirmModal
        open={showResetModal}
        title="返回首頁"
        message="確定要放棄目前的編輯內容並返回首頁嗎？"
        confirmLabel="返回首頁"
        cancelLabel="繼續編輯"
        onConfirm={onReset}
        onCancel={() => setShowResetModal(false)}
      />
    </div>
  );
}
