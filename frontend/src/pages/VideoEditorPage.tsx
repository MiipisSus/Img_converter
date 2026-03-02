import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { VideoItem } from "../types";
import { getVideoInfo, estimateVideo } from "../api/videoApi";
import type { VideoInfoResult, BitrateEstimateResult } from "../api/videoApi";
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

type EditorMode = "default" | "trim";

export function VideoEditorPage({ video, onReset }: VideoEditorPageProps) {
  // ── 影片資訊 ──
  const [videoInfo, setVideoInfo] = useState<VideoInfoResult | null>(null);
  const [loading, setLoading] = useState(true);

  // ── 編輯模式 ──
  const [mode, setMode] = useState<EditorMode>("default");

  // ── 旋轉/翻轉 ──
  const [baseRotate, setBaseRotate] = useState(0);       // 0, 90, 180, 270
  const visualRotateRef = useRef(0);                      // 累積角度 (不取模，避免 270°→0° 反向插值)
  const [visualRotate, setVisualRotate] = useState(0);    // 驅動 CSS 動畫的值
  const [flipX, setFlipX] = useState(false);
  const [flipY, setFlipY] = useState(false);

  // ── 裁剪參數 ──
  const [startT, setStartT] = useState(0);
  const [endT, setEndT] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // ── 預估結果 ──
  const [estimate, setEstimate] = useState<BitrateEstimateResult | null>(null);
  const [estimating, setEstimating] = useState(false);

  // ── Refs ──
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoUrlRef = useRef<string>("");
  const estimateTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

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

  // ── 播放區間限制：到達 endT 時暫停 ──
  useEffect(() => {
    const el = videoRef.current;
    if (!el || mode !== "trim") return;

    const handleTimeUpdate = () => {
      setCurrentTime(el.currentTime);
      if (el.currentTime >= endT) {
        el.pause();
        el.currentTime = startT;
        setCurrentTime(startT);
        setIsPlaying(false);
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
    if (mode !== "trim" || !videoInfo) return;

    if (estimateTimerRef.current) clearTimeout(estimateTimerRef.current);

    estimateTimerRef.current = setTimeout(async () => {
      setEstimating(true);
      try {
        const result = await estimateVideo(video.file, {
          include_audio: videoInfo.has_audio,
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
  }, [mode, trimDuration, video.file, videoInfo]);

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

  // ── 影片 CSS transform ──
  const videoTransform = useMemo(() => {
    const sx = flipX ? -1 : 1;
    const sy = flipY ? -1 : 1;
    return `scale(${sx}, ${sy}) rotate(${visualRotate}deg)`;
  }, [flipX, flipY, visualRotate]);

  // 90° 旋轉時需要縮放影片以適應容器 (寬高互換)
  const isRotated90 = baseRotate % 180 !== 0;

  // ── 進入裁剪模式 ──
  const handleEnterTrim = useCallback(() => {
    setMode("trim");
    const el = videoRef.current;
    if (el) {
      el.pause();
      el.loop = false;
      el.currentTime = startT;
      setCurrentTime(startT);
      setIsPlaying(false);
    }
  }, [startT]);

  // ── 確認裁剪 (套用) ──
  const handleConfirmTrim = useCallback(() => {
    setMode("default");
    const el = videoRef.current;
    if (el) {
      el.loop = true;
      el.currentTime = startT;
      el.play();
    }
  }, [startT]);

  // ── 取消裁剪 (還原) ──
  const handleExitTrim = useCallback(() => {
    setStartT(0);
    setEndT(duration);
    setMode("default");
    const el = videoRef.current;
    if (el) {
      el.loop = true;
      el.currentTime = 0;
      el.play();
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

  // ── Loading state ──
  if (loading) {
    return (
      <div className="min-h-screen bg-sidebar flex items-center justify-center">
        <div className="text-white/50 text-sm">正在載入影片資訊...</div>
      </div>
    );
  }

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

          {/* 預設模式：工具面板 (參考 EditorPage CropToolPanel 風格) */}
          {mode === "default" && (
            <div className="flex flex-col gap-3">
              {/* 主要動作按鈕 */}
              <button
                onClick={handleEnterTrim}
                className="w-full px-4 py-3 bg-[#00B4FF] text-white font-bold rounded-[10px] transition-all btn-vic"
              >
                編輯模式
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
              </div>
            </div>
          )}

          {/* 裁剪模式面板 */}
          {mode === "trim" && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-[#00B4FF] font-medium">時間裁剪</p>

              <div className="bg-white/10 rounded-[10px] p-3">
                {/* 起點/終點顯示 */}
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

                {/* 預計輸出長度 */}
                <div className="bg-white/5 rounded-lg p-2 mb-3">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-white/50">預計輸出長度</span>
                    <span className="text-sm font-mono font-bold text-white">
                      {formatTime(trimDuration)}
                    </span>
                  </div>
                </div>

                {/* 預估檔案大小 */}
                <div className="bg-white/5 rounded-lg p-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-white/50">預估輸出大小</span>
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
            </div>
          )}
        </div>

        {/* 底部按鈕 */}
        <div className="p-4 pt-0 flex flex-col gap-2">
          {mode === "trim" && (
            <button
              onClick={handleConfirmTrim}
              className="w-full px-4 py-3 bg-[#00B4FF] text-white font-bold rounded-[10px] transition-all btn-vic"
            >
              套用裁剪
            </button>
          )}
          {mode === "trim" && (
            <button
              onClick={handleExitTrim}
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
        {/* 影片播放器 */}
        <div className="flex-1 bg-preview/5 flex items-center justify-center m-4 mb-0 rounded-lg overflow-hidden">
          <video
            ref={videoRef}
            src={videoUrlRef.current}
            className={isRotated90 ? "max-w-full max-h-full" : "max-w-full max-h-full"}
            style={{
              transform: videoTransform,
              transition: "transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
              ...(isRotated90 ? { maxWidth: "100vh", maxHeight: "100vw" } : {}),
            }}
            muted
            autoPlay
            loop
            playsInline
          />
        </div>

        {/* 底部控制區 */}
        <div className="shrink-0 px-6 py-4 flex flex-col gap-3">
          {/* 裁剪模式：雙向滑桿 */}
          {mode === "trim" && duration > 0 && (
            <>
              <TrimSlider
                duration={duration}
                startT={startT}
                endT={endT}
                currentTime={currentTime}
                onStartChange={handleStartChange}
                onEndChange={handleEndChange}
                onSeek={handleSeek}
              />

              {/* 時間軸標記 + 播放按鈕 */}
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
            </>
          )}

          {/* 預設模式：提示 */}
          {mode === "default" && (
            <div className="flex items-center justify-center py-2">
              <span className="text-xs text-white/30">
                選擇左側工具開始編輯
              </span>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
