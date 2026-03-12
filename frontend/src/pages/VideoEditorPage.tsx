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
  const [videoReady, setVideoReady] = useState(false);
  const seekTimerRef = useRef<number | null>(null);

  // ── Refs ──
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoUrlRef = useRef<string>("");
  const clipAreaRef = useRef<HTMLDivElement>(null);
  const cropWrapperRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef({ x: 0, y: 0, translateX: 0, translateY: 0, cropX: 0, cropY: 0, cropW: 0, cropH: 0 });
  const pinchRef = useRef({ active: false, startDist: 0, startScale: 1 });

  // ── 統一的影片尺寸來源 ──
  // GIF 來源：必須使用 videoInfo（後端裁切原始 GIF，MP4 預覽可能有偶數修正偏差）
  // 一般影片：優先使用瀏覽器 intrinsic（最準確），fallback 到 backend
  const effectiveVideoW = isGifSource
    ? (videoInfo?.width ?? 1)
    : (intrinsicVideoSize?.w ?? videoInfo?.width ?? 1);
  const effectiveVideoH = isGifSource
    ? (videoInfo?.height ?? 1)
    : (intrinsicVideoSize?.h ?? videoInfo?.height ?? 1);

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

  // ── 影片源切換時重置 ready 狀態 ──
  useEffect(() => {
    setVideoReady(false);
  }, [effectiveVideoSrc]);

  const handleVideoReady = useCallback(() => {
    setVideoReady(true);
  }, []);

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
  // loading 作為依賴：初始 loading=true 時 clipAreaRef 未掛載（顯示載入畫面），
  // loading→false 後才有 DOM 元素可觀察
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
  }, [loading]);

  // ── 播放區間循環 (clip 模式)：到達 endT 時回到 startT 繼續播放 ──
  // 使用 trimRef 避免閉包捕獲舊值；拖曳中暫停循環邏輯
  useEffect(() => {
    const el = videoRef.current;
    if (!el || mode !== "clip") return;

    const loopBack = () => {
      if (isTrimDraggingRef.current) return;
      el.currentTime = trimRef.current.startT;
      setCurrentTime(trimRef.current.startT);
      el.play();
    };

    const handleTimeUpdate = () => {
      setCurrentTime(el.currentTime);
      if (isTrimDraggingRef.current) return;
      if (el.currentTime >= trimRef.current.endT) {
        loopBack();
      }
    };

    // ended 事件：影片播到尾端（endT 超過影片長度時 timeupdate 來不及攔截）
    const handleEnded = () => loopBack();

    el.addEventListener("timeupdate", handleTimeUpdate);
    el.addEventListener("ended", handleEnded);
    return () => {
      el.removeEventListener("timeupdate", handleTimeUpdate);
      el.removeEventListener("ended", handleEnded);
    };
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

  // ── 測量裁切可用空間並計算容器尺寸 ──
  // 優先用 cropWrapperRef（精確），fallback 到 clipAreaRef - timelineReserve
  // 回傳計算值供呼叫方同步使用，同時寫入 state
  const measureCropContainer = useCallback((vW: number, vH: number): { width: number; height: number } | null => {
    let availW: number, availH: number;
    const wrapper = cropWrapperRef.current;
    if (wrapper) {
      const rect = wrapper.getBoundingClientRect();
      availW = rect.width;
      availH = rect.height;
    } else {
      const el = clipAreaRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const isMobileView = window.innerWidth < 768;
      const timelineReserve = isMobileView ? 110 : 120;
      availW = rect.width - (isMobileView ? 16 : 0);
      availH = rect.height - timelineReserve;
    }
    const M = Math.min(availW / vW, availH / vH);
    // 不做 Math.round — 保持浮點精度，確保 displayMultiplier === M
    const dims = { width: vW * M, height: vH * M };
    setCropContainerSize(dims);
    return dims;
  }, []);

  // ── 進入剪輯模式 ──
  const handleEnterClip = useCallback(() => {
    if (!videoInfo) return;
    if (!clipAreaRef.current) return;

    // 擷取影片解析度
    const vid = videoRef.current;
    const vW = isGifSource
      ? videoInfo.width
      : ((vid && vid.videoWidth > 0) ? vid.videoWidth : videoInfo.width);
    const vH = isGifSource
      ? videoInfo.height
      : ((vid && vid.videoHeight > 0) ? vid.videoHeight : videoInfo.height);
    setIntrinsicVideoSize({ w: vW, h: vH });

    // 粗估初始尺寸（CSS class 尚未生效，RAF 後會用精確值覆蓋）
    measureCropContainer(vW, vH);
    setMode("clip");
  }, [videoInfo, measureCropContainer, isGifSource]);

  // ── mode 變為 clip 後：等 CSS 生效 → 精確測量 → 初始化裁切框 ──
  // 全部在 RAF 回調內一次完成，用計算出的精確尺寸直接設定，
  // 徹底消除「setState→re-render→effect 讀到舊值」的時序問題
  useEffect(() => {
    if (mode !== "clip" || !intrinsicVideoSize) return;

    const raf = requestAnimationFrame(() => {
      const vW = intrinsicVideoSize.w;
      const vH = intrinsicVideoSize.h;

      // 1. 精確測量（clip-mode CSS 已生效，cropWrapperRef 已掛載）
      const dims = measureCropContainer(vW, vH);
      if (!dims) return;
      const cW = dims.width;
      const cH = dims.height;

      // 2. 用精確尺寸直接初始化裁切框
      //    使用 forceState（不做 clamp）— 此時 optsRef 尚未更新，
      //    clamp 會用舊的 containerWidth/Height 導致 translate 偏移
      if (savedClipState && exportConfig) {
        const restored = reconstructTransformFromCrop(
          { x: exportConfig.crop_x, y: exportConfig.crop_y,
            width: exportConfig.crop_w, height: exportConfig.crop_h },
          savedClipState.scale,
          vW, vH, cW, cH,
        );
        transform.forceState(restored);
        setSelectedCropRatio(savedClipState.cropRatio);
      } else {
        // 首次進入：裁切框 = 容器全域 (cropX=0, cropY=0, cropW=cW, cropH=cH)
        transform.forceState({
          scale: 1, translateX: 0, translateY: 0,
          cropX: 0, cropY: 0, cropW: cW, cropH: cH,
        });
        setSelectedCropRatio(null);
      }

      // 3. 下一幀 seek + play
      requestAnimationFrame(() => {
        const vid = videoRef.current;
        if (vid) {
          vid.loop = false;
          vid.currentTime = startT;
          setCurrentTime(startT);
          vid.play();
        }
      });
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

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
    // 放手後一律從 startT 開始循環播放
    if (target === "start" || target === "end") {
      el.currentTime = trimRef.current.startT;
      setCurrentTime(trimRef.current.startT);
    }
    el.play();
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

  // ── 觸控：調整裁切框大小 ──
  const handleCropResizeTouchStart = useCallback(
    (handle: CropResizeHandle) => (e: React.TouchEvent) => {
      e.stopPropagation();
      const touch = e.touches[0];
      setIsResizingCrop(handle);
      dragStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
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

  // ── 觸控：拖動影片 / 雙指縮放 ──
  const handleCropContainerTouchStart = useCallback(
    (e: React.TouchEvent) => {
      e.stopPropagation();
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchRef.current = {
          active: true,
          startDist: Math.hypot(dx, dy),
          startScale: transform.state.scale,
        };
      } else if (e.touches.length === 1) {
        const touch = e.touches[0];
        setIsDraggingVideo(true);
        dragStartRef.current = {
          x: touch.clientX,
          y: touch.clientY,
          translateX: transform.state.translateX,
          translateY: transform.state.translateY,
          cropX: 0, cropY: 0, cropW: 0, cropH: 0,
        };
      }
    },
    [transform.state.scale, transform.state.translateX, transform.state.translateY],
  );

  // ── 全域滑鼠 + 觸控事件 (拖曳 / 調整 / 雙指縮放) ──
  useEffect(() => {
    const handleMove = (clientX: number, clientY: number) => {
      const deltaX = clientX - dragStartRef.current.x;
      const deltaY = clientY - dragStartRef.current.y;

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

    const handleMouseMove = (e: MouseEvent) => handleMove(e.clientX, e.clientY);

    const handleTouchMove = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
      if (e.touches.length === 2 && pinchRef.current.active) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const ratio = dist / pinchRef.current.startDist;
        transform.setScale(pinchRef.current.startScale * ratio);
        return;
      }
      if (e.touches.length === 1) {
        handleMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    const handleEnd = () => {
      setIsResizingCrop(null);
      setIsDraggingVideo(false);
      pinchRef.current.active = false;
      setIsSnappingBack(true);
      transform.clampPosition();
    };

    if (isResizingCrop || isDraggingVideo || pinchRef.current.active) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleEnd);
      window.addEventListener("touchmove", handleTouchMove, { passive: false });
      window.addEventListener("touchend", handleEnd);
      window.addEventListener("touchcancel", handleEnd);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleEnd);
        window.removeEventListener("touchmove", handleTouchMove);
        window.removeEventListener("touchend", handleEnd);
        window.removeEventListener("touchcancel", handleEnd);
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
      <div className="min-h-[100dvh] bg-sidebar flex items-center justify-center">
        <div className="text-white/50 text-sm">正在載入影片資訊...</div>
      </div>
    );
  }

  // ── 裁切框 UI 資料 ──
  const { cropX, cropY, cropW, cropH } = transform.state;

  return (
    <div className={`h-[100dvh] flex overflow-hidden bg-sidebar layout-editor${mode === "clip" ? " clip-mode" : ""}`}>
      {/* 手機版 Header (Logo) */}
      <header className="hidden max-md:flex items-center justify-center bg-sidebar px-4 py-2">
        <button onClick={() => setShowResetModal(true)} className="cursor-pointer">
          <img src={vicLogo} alt="VicgoVic!" className="h-10" />
        </button>
      </header>

      {/* ── 左側面板 ── */}
      <aside className="w-[30%] min-w-[240px] max-w-[320px] flex flex-col h-[100dvh] sidebar-scroll overflow-y-auto bg-sidebar max-md:h-auto">
        {/* Logo (桌面版) */}
        <div className="p-4 pb-2 mx-auto mb-6 max-md:hidden">
          <button onClick={() => setShowResetModal(true)} className="cursor-pointer">
            <img src={vicLogo} alt="VicgoVic!" className="h-16" />
          </button>
        </div>

        {/* 控制面板 */}
        <div className="flex-1 p-4 pt-2 flex flex-col gap-3">
          {/* 影片資訊 (手機版隱藏) */}
          <div className="bg-white/10 rounded-[10px] p-3 max-md:hidden">
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
                      className={`toggle-switch relative shrink-0 w-10 h-[22px] rounded-full transition-colors duration-200 ${
                        includeAudio ? "bg-[#00B4FF]" : "bg-white/20"
                      }`}
                      style={{ minWidth: 40, minHeight: 22 }}
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
                  className="w-full slider-vic"
                />
              </div>

            </div>
          )}
        </div>

        {/* 底部按鈕 */}
        <div className="p-4 pt-0 flex flex-col gap-2" style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>
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
      <main className="flex-1 flex flex-col h-[100dvh]">
        <div ref={clipAreaRef} className={`flex-1 bg-preview/5 flex ${mode === "clip" ? "flex-col" : ""} items-center justify-center m-4 max-md:m-2 mb-0 rounded-lg overflow-hidden relative`}>
          {mode === "clip" && videoInfo ? (
            /* ── 剪輯工作區：上方裁切預覽 + 下方時間軸 ── */
            <>
              {/* 裁切預覽區 — flex-1 佔滿剩餘空間，內部置中 */}
              <div ref={cropWrapperRef} className="flex-1 min-h-0 flex items-center justify-center w-full">
              <div
                className="relative select-none flex-shrink-0"
                style={{
                  width: cropContainerSize.width,
                  height: cropContainerSize.height,
                  cursor: isDraggingVideo ? "grabbing" : "grab",
                  touchAction: "none",
                }}
                onWheel={handleCropWheel}
                onMouseDown={handleCropContainerMouseDown}
                onTouchStart={handleCropContainerTouchStart}
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
                      onLoadedData={handleVideoReady}
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
                    onResizeTouchStart={handleCropResizeTouchStart}
                  />
                </div>
              </div>
              </div>

              {/* 時間軸 — 緊接在裁切預覽下方 */}
              {duration > 0 && (
                <div className="w-full shrink-0 px-6 max-md:px-3 pt-4 max-md:pt-2 pb-2 max-md:pb-1 flex flex-col gap-3 max-md:gap-2">
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
              className="relative overflow-hidden shrink-0"
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
                onLoadedData={handleVideoReady}
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
                objectFit: "contain",
                transform: defaultVideoTransform,
                transition: "transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
                ...(isRotated90 ? { maxWidth: "100vh", maxHeight: "100vw" } : {}),
              }}
              onLoadedData={handleVideoReady}
              muted
              autoPlay
              loop
              playsInline
            />
          )}

          {/* GIF 處理中 / 影片載入中 — 轉圈提示 */}
          {isGifSource && !videoReady && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 z-10">
              <svg className="w-10 h-10 text-[#00B4FF] animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-white/70 text-sm mt-3">正在處理 GIF...</span>
            </div>
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
