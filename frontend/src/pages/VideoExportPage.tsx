import { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import type { VideoItem } from "../types";
import type { VideoExportState } from "../App";
import {
  getVideoInfo,
  submitCompress,
  getTaskStatus,
  downloadVideo,
  cleanupTask,
} from "../api/videoApi";
import type { VideoInfoResult, TaskStatusResult } from "../api/videoApi";
import vicLogo from "../assets/vic_logo.png";
import { ConfirmModal } from "../components/ConfirmModal";

interface VideoExportPageProps {
  video: VideoItem;
  exportState: VideoExportState;
  onReturn: () => void;
  onReset: () => void;
}

/** 秒數格式化為 mm:ss */
function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** 格式化檔案大小 */
function fmtSize(kb: number): string {
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${Math.round(kb)} KB`;
}

export function VideoExportPage({
  video,
  exportState,
  onReturn,
  onReset,
}: VideoExportPageProps) {
  const { clipConfig, rotate, flipH, flipV } = exportState;
  const isGifSource = video.file.type === "image/gif";

  // ── 影片資訊 (API，用於 sidebar 顯示) ──
  const [videoInfo, setVideoInfo] = useState<VideoInfoResult | null>(null);
  const [loading, setLoading] = useState(true);

  // ── 影片原生尺寸 (onLoadedMetadata，用於預覽計算) ──
  const [nativeSize, setNativeSize] = useState<{ w: number; h: number } | null>(null);

  // ── 影片 URL ──
  const [videoUrl, setVideoUrl] = useState("");
  const [gifPreviewUrl, setGifPreviewUrl] = useState<string | null>(null);
  const [showResetModal, setShowResetModal] = useState(false);

  // ── 目標大小 ──
  const [targetInput, setTargetInput] = useState("");
  const [targetUnit, setTargetUnit] = useState<"KB" | "MB" | "GB">("MB");
  const [targetKB, setTargetKB] = useState<number | null>(null);

  // ── 輸出格式 ──
  const [outputFormat, setOutputFormat] = useState<"mp4" | "gif">("mp4");

  // ── 輸出解析度 ──
  const [resolution, setResolution] = useState<"original" | "720p" | "480p" | "360p">("original");

  // ── 編碼強度 ──
  const [encodingPreset, setEncodingPreset] = useState<"fast" | "medium" | "veryslow">("medium");

  // ── 當前啟用的預設 (用於聯動與提示) ──
  const [activePreset, setActivePreset] = useState<"social" | "compress" | "quality" | null>(null);

  // ── 解析度切換提示 ──
  const [resolutionHint, setResolutionHint] = useState("");

  // ── 匯出狀態 ──
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stepLabel, setStepLabel] = useState("");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [outputInfo, setOutputInfo] = useState<TaskStatusResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hasAutoSwitchedUnit = useRef(false);

  // ── 預覽區域尺寸測量 ──
  const previewRef = useRef<HTMLDivElement>(null);
  const [previewSize, setPreviewSize] = useState({ w: 0, h: 0 });

  // ── 衍生資料 ──
  const trimDuration =
    videoInfo
      ? (clipConfig?.end_t ?? videoInfo.duration) -
        (clipConfig?.start_t ?? 0)
      : 0;
  const includeAudio = outputFormat === "gif" ? false : (clipConfig?.include_audio ?? true);
  const originalSizeKB = videoInfo ? Math.round(videoInfo.file_size / 1024) : 0;
  const estimatedSizeKB = videoInfo && videoInfo.duration > 0
    ? Math.round(originalSizeKB * (trimDuration / videoInfo.duration))
    : originalSizeKB;

  // 裁切後尺寸
  const cropW = clipConfig?.crop_w ?? videoInfo?.width ?? 0;
  const cropH = clipConfig?.crop_h ?? videoInfo?.height ?? 0;

  // ── 旋轉判定 ──
  const isRotated90 = rotate === 90 || rotate === 270;

  // 旋轉後的有效尺寸 (用於解析度計算)
  const effectiveW = isRotated90 ? cropH : cropW;
  const effectiveH = isRotated90 ? cropW : cropH;

  // 解析度面積係數 (低解析度 → 預設值自動縮小)
  const resolutionCoeff = useMemo(() => {
    if (resolution === "original") return 1.0;
    const heightMap: Record<string, number> = { "720p": 720, "480p": 480, "360p": 360 };
    const targetH = heightMap[resolution];
    if (!targetH || effectiveH <= 0) return 1.0;
    const ratio = targetH / effectiveH;
    return Math.min(ratio * ratio, 1.0); // 面積比例
  }, [resolution, effectiveH]);

  // 動態預設值 (KB) — 乘以解析度係數
  const presetSocialKB = estimatedSizeKB > 0
    ? Math.round(Math.min(estimatedSizeKB * 0.8 * resolutionCoeff, 24.5 * 1024))
    : 0;
  const presetCompressKB = estimatedSizeKB > 0
    ? Math.round(estimatedSizeKB * 0.4 * resolutionCoeff)
    : 0;

  // 解析度選項 (僅顯示比原始小的選項)
  const resolutionOptions = useMemo(() => {
    const all: { key: "original" | "720p" | "480p" | "360p"; label: string; height: number | null }[] = [
      { key: "original", label: `原始 (${effectiveH}p)`, height: null },
      { key: "720p", label: "720p", height: 720 },
      { key: "480p", label: "480p", height: 480 },
      { key: "360p", label: "360p", height: 360 },
    ];
    return all.filter(r => r.height === null || (effectiveH > r.height));
  }, [effectiveH]);

  // 計算目標寬度 (傳給後端 target_w)
  const targetWidth = useMemo(() => {
    if (resolution === "original" || effectiveH === 0) return undefined;
    const heightMap = { "720p": 720, "480p": 480, "360p": 360 };
    const targetH = heightMap[resolution];
    if (effectiveH <= targetH) return undefined; // 不放大
    return Math.round(targetH * effectiveW / effectiveH);
  }, [resolution, effectiveW, effectiveH]);

  // 輸出尺寸 (供顯示)
  const outputW = targetWidth ?? effectiveW;
  const outputH = targetWidth ? Math.round(targetWidth * effectiveH / effectiveW) : effectiveH;

  // GIF 目標大小上限 (15MB)
  const GIF_MAX_KB = 15 * 1024;

  // 畫質計算
  const videoBitrateKbps = (() => {
    if (!targetKB || trimDuration <= 0) return null;
    const totalBits = targetKB * 1024 * 8 * 0.98;
    const audioBits = includeAudio ? 128 * 1000 * trimDuration : 0;
    const videoBits = totalBits - audioBits;
    let kbps = Math.round(videoBits / trimDuration / 1000);
    // GIF 壓縮效率低，預估位元率需乘以 4 倍
    if (outputFormat === "gif") kbps = kbps * 4;
    return kbps;
  })();

  const qualityTier = (() => {
    if (videoBitrateKbps === null) return null;
    if (videoBitrateKbps < 100) return "danger";
    if (videoBitrateKbps < 500) return "low";
    if (videoBitrateKbps < 2000) return "mid";
    return "high";
  })();

  const qualityLabel: Record<string, string> = {
    danger: "極低",
    low: "低",
    mid: "中",
    high: "高",
  };

  const qualityColor: Record<string, string> = {
    danger: "#FF4444",
    low: "#FF9500",
    mid: "#00B4FF",
    high: "#34C759",
  };

  // ── 計算裁切容器尺寸 (依賴 nativeSize，確保 onLoadedMetadata 後才計算) ──
  const cropContainerSize = useMemo(() => {
    if (!clipConfig || previewSize.w === 0 || !nativeSize) return null;

    const cw = clipConfig.crop_w;
    const ch = clipConfig.crop_h;

    // CSS rotate 後視覺維度互換
    const visualW = isRotated90 ? ch : cw;
    const visualH = isRotated90 ? cw : ch;
    const visualAspect = visualW / visualH;

    // 預覽區域留 margin
    const areaW = previewSize.w - 32;
    const areaH = previewSize.h - 32;
    const areaAspect = areaW / areaH;

    // 將旋轉後的視覺尺寸 fit 進預覽區域
    let fitW: number, fitH: number;
    if (visualAspect > areaAspect) {
      fitW = areaW;
      fitH = areaW / visualAspect;
    } else {
      fitH = areaH;
      fitW = areaH * visualAspect;
    }

    // 解析度縮放
    const rScale = resolution === "original" ? 1.0 : (outputH / effectiveH);
    fitW *= rScale;
    fitH *= rScale;

    // 容器使用旋轉前的座標，CSS transform 負責旋轉
    return {
      w: isRotated90 ? fitH : fitW,
      h: isRotated90 ? fitW : fitH,
    };
  }, [clipConfig, previewSize, isRotated90, nativeSize, resolution, outputH, effectiveH]);

  // ── 是否啟用裁切預覽 ──
  const hasCrop = !!(clipConfig && nativeSize && cropContainerSize);

  // ── 解析度預覽縮放比 ──
  const resolutionScale = resolution === "original" ? 1.0 : (outputH / effectiveH);

  // ── GIF 預覽 MP4 優先 ──
  const effectiveVideoSrc = (isGifSource && gifPreviewUrl) ? gifPreviewUrl : videoUrl;

  // ── 載入影片資訊 (API，用於 sidebar) ──
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getVideoInfo(video.file)
      .then((info) => {
        if (cancelled) return;
        setVideoInfo(info);
        if (info.preview_url) setGifPreviewUrl(info.preview_url);
      })
      .catch((err) => console.error("取得影片資訊失敗:", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [video.file]);

  // ── 根據檔案大小自動選擇初始單位 ──
  useEffect(() => {
    if (estimatedSizeKB > 0 && !hasAutoSwitchedUnit.current) {
      hasAutoSwitchedUnit.current = true;
      setTargetUnit(estimatedSizeKB < 1024 ? "KB" : "MB");
    }
  }, [estimatedSizeKB]);

  // ── 解析度切換時，自動更新已啟用的預設目標大小 ──
  useEffect(() => {
    if (!activePreset || activePreset === "quality") return;
    if (activePreset === "social" && presetSocialKB > 0) setTargetFromKB(presetSocialKB);
    if (activePreset === "compress" && presetCompressKB > 0) setTargetFromKB(presetCompressKB);
    if (resolution !== "original") {
      setResolutionHint("已根據解析度自動調整建議大小");
      const t = setTimeout(() => setResolutionHint(""), 3000);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolution]);

  // ── ObjectURL ──
  useEffect(() => {
    const url = URL.createObjectURL(video.file);
    setVideoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [video.file]);

  // ── 測量預覽區域 (previewRef 永遠在 DOM，deps 為 []) ──
  useLayoutEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const update = () => {
      const { clientWidth: w, clientHeight: h } = el;
      if (w > 0 && h > 0) setPreviewSize({ w, h });
    };
    update();
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── 清理 polling ──
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ── 影片 trim 循環播放 ──
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;

    if (!clipConfig) {
      vid.loop = true;
      return;
    }

    vid.loop = false;
    vid.currentTime = clipConfig.start_t;

    const handleTimeUpdate = () => {
      if (vid.currentTime >= clipConfig.end_t || vid.currentTime < clipConfig.start_t) {
        vid.currentTime = clipConfig.start_t;
      }
    };
    const handleEnded = () => {
      vid.currentTime = clipConfig.start_t;
      vid.play();
    };

    vid.addEventListener("timeupdate", handleTimeUpdate);
    vid.addEventListener("ended", handleEnded);
    return () => {
      vid.removeEventListener("timeupdate", handleTimeUpdate);
      vid.removeEventListener("ended", handleEnded);
    };
  }, [clipConfig]);

  // ── onLoadedMetadata：確認原生尺寸後才開始 CSS 變換 ──
  const handleLoadedMetadata = useCallback(() => {
    const vid = videoRef.current;
    if (vid && vid.videoWidth > 0) {
      setNativeSize({ w: vid.videoWidth, h: vid.videoHeight });
    }
  }, []);

  // ── 單位→KB 轉換倍率 ──
  const unitToKB = { KB: 1, MB: 1024, GB: 1024 * 1024 };

  // ── 目標大小 commit ──
  const commitTarget = useCallback(() => {
    const val = parseFloat(targetInput);
    if (!isNaN(val) && val > 0) {
      let kb = Math.round(val * unitToKB[targetUnit]);
      // Sanity check: 不超過估計大小的 1.2 倍
      if (estimatedSizeKB > 0) {
        const maxKB = Math.round(estimatedSizeKB * 1.2);
        if (kb > maxKB) kb = maxKB;
      }
      // GIF 上限 15MB
      if (outputFormat === "gif" && kb > GIF_MAX_KB) kb = GIF_MAX_KB;
      if (kb !== Math.round(val * unitToKB[targetUnit])) {
        const displayVal = kb / unitToKB[targetUnit];
        setTargetInput(displayVal >= 10 ? String(Math.round(displayVal)) : displayVal.toFixed(1));
      }
      setTargetKB(kb);
    } else {
      setTargetKB(null);
    }
  }, [targetInput, targetUnit, estimatedSizeKB, outputFormat]);

  const handleTargetKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") commitTarget();
    },
    [commitTarget],
  );

  // ── 設定目標 KB 並自動選擇最佳單位 ──
  const setTargetFromKB = useCallback((kb: number) => {
    const rounded = Math.round(kb);
    setTargetKB(rounded);
    if (kb >= 1024 * 1024) {
      setTargetUnit("GB");
      setTargetInput((kb / (1024 * 1024)).toFixed(1));
    } else if (kb >= 1024) {
      setTargetUnit("MB");
      setTargetInput((kb / 1024).toFixed(1));
    } else {
      setTargetUnit("KB");
      setTargetInput(String(rounded));
    }
  }, []);

  // ── 導出預設 (含編碼強度聯動) ──
  const applyPreset = useCallback((id: "social" | "compress" | "quality") => {
    setActivePreset(id);
    if (id === "social") {
      if (presetSocialKB > 0) setTargetFromKB(presetSocialKB);
      setEncodingPreset("medium");
    } else if (id === "compress") {
      if (presetCompressKB > 0) setTargetFromKB(presetCompressKB);
      setEncodingPreset("veryslow");
    } else {
      setTargetInput("");
      setTargetKB(null);
      setEncodingPreset("fast");
    }
  }, [presetSocialKB, presetCompressKB, setTargetFromKB]);

  // ── 匯出 ──
  const handleExport = useCallback(async () => {
    if (!videoInfo) return;
    setExporting(true);
    setProgress(0);
    setStepLabel("Step 1/3: 裁剪與旋轉...");
    setError(null);
    setOutputInfo(null);

    try {
      const result = await submitCompress(video.file, {
        target_kb: targetKB ?? undefined,
        output_format: outputFormat,
        start_t: clipConfig?.start_t,
        end_t: clipConfig?.end_t,
        crop_x: clipConfig?.crop_x,
        crop_y: clipConfig?.crop_y,
        crop_w: clipConfig?.crop_w,
        crop_h: clipConfig?.crop_h,
        rotate,
        flip_h: flipH,
        flip_v: flipV,
        target_w: targetWidth,
        include_audio: includeAudio,
        quality_preset: encodingPreset,
      });

      setTaskId(result.task_id);

      pollRef.current = setInterval(async () => {
        try {
          const status = await getTaskStatus(result.task_id);
          setProgress(status.progress);

          if (status.progress < 10) {
            setStepLabel("Step 1/3: 裁剪與旋轉...");
          } else if (status.progress < 90) {
            setStepLabel("Step 2/3: 影像壓縮中...");
          } else {
            setStepLabel("Step 3/3: 封裝檔案...");
          }

          if (status.status === "completed") {
            clearInterval(pollRef.current);
            pollRef.current = undefined;
            setOutputInfo(status);
            setExporting(false);
            setProgress(100);
            setStepLabel("完成");
          }
          if (status.status === "failed") {
            clearInterval(pollRef.current);
            pollRef.current = undefined;
            setError(status.error ?? "處理失敗");
            setExporting(false);
          }
        } catch {
          // 單次 poll 失敗不中斷
        }
      }, 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交任務失敗");
      setExporting(false);
    }
  }, [videoInfo, video.file, targetKB, outputFormat, targetWidth, clipConfig, rotate, flipH, flipV, includeAudio, encodingPreset]);

  // ── 下載 ──
  const handleDownload = useCallback(async () => {
    if (!taskId) return;
    setDownloading(true);
    try {
      const blob = await downloadVideo(taskId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ext = outputFormat === "gif" ? "gif" : "mp4";
      a.download = `${video.name.replace(/\.[^.]+$/, "")}_export.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      await cleanupTask(taskId);
    } catch (err) {
      console.error("下載失敗:", err);
    } finally {
      setDownloading(false);
    }
  }, [taskId, video.name, outputFormat]);

  // ── CSS 旋轉/翻轉 (預覽用) ──
  const previewTransform = [
    `rotate(${rotate}deg)`,
    flipH ? "scaleX(-1)" : "",
    flipV ? "scaleY(-1)" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // ── 永遠渲染完整佈局 (不因 loading 而 early return) ──
  return (
    <div className="h-screen flex overflow-hidden bg-sidebar layout-editor">
      {/* 手機版 Header (Logo) */}
      <header className="hidden max-md:flex items-center justify-center bg-sidebar px-4 py-2">
        <button onClick={() => setShowResetModal(true)} className="cursor-pointer">
          <img src={vicLogo} alt="VicgoVic!" className="h-10" />
        </button>
      </header>

      {/* ===== 左側設定面板 ===== */}
      <aside className="w-[30%] min-w-[240px] max-w-[320px] flex flex-col h-screen sidebar-scroll overflow-y-auto bg-sidebar max-md:h-auto">
        {/* Logo (桌面版) */}
        <div className="p-4 pb-2 mx-auto mb-6 max-md:hidden">
          <button onClick={() => setShowResetModal(true)} className="cursor-pointer">
            <img src={vicLogo} alt="VicgoVic!" className="h-16" />
          </button>
        </div>

        {/* 設定區 */}
        <div className="flex-1 p-4 pt-2 flex flex-col gap-3">
          {loading ? (
            /* API 載入中 — sidebar 顯示 spinner */
            <div className="flex-1 flex items-center justify-center">
              <div
                className="w-8 h-8 rounded-full animate-spin"
                style={{
                  border: "3px solid rgba(255,255,255,0.15)",
                  borderTopColor: "#00B4FF",
                }}
              />
            </div>
          ) : (
            <>
              {/* ── 影片資訊 (手機版隱藏) ── */}
              <div className="bg-white/10 rounded-[10px] p-3 max-md:hidden">
                <p className="text-xs text-white/70 mb-2 font-medium">影片資訊</p>
                <div className="flex flex-col gap-1 text-xs text-white/50">
                  <div className="flex justify-between">
                    <span>檔案大小</span>
                    <span className="text-white/80">≈ {fmtSize(estimatedSizeKB)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>尺寸</span>
                    <span className="text-white/80">
                      {resolution !== "original"
                        ? `${outputW} × ${outputH}`
                        : `${cropW} × ${cropH}`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>長度</span>
                    <span className="text-white/80">{fmtTime(trimDuration)}</span>
                  </div>
                  {outputFormat !== "gif" && (
                    <div className="flex justify-between">
                      <span>音軌</span>
                      <span className="text-white/80">{includeAudio ? "有" : "無"}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* ── 輸出格式 ── */}
              <div className="bg-white/10 rounded-[10px] p-3">
                <p className="text-xs text-white/70 mb-3 font-medium">輸出格式</p>
                <div className="flex gap-2">
                  {([
                    ["mp4", "MP4 (影片)"],
                    ["gif", "GIF (動圖)"],
                  ] as const).map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() => {
                        setOutputFormat(val);
                        setActivePreset(null);
                        // 切換到 GIF 時，自動降低解析度
                        if (val === "gif" && (resolution === "original" || resolution === "720p") && effectiveH > 480) {
                          setResolution("480p");
                        }
                        // 切換到 GIF 時，若目標大小超過上限則截斷
                        if (val === "gif" && targetKB !== null && targetKB > GIF_MAX_KB) {
                          setTargetKB(GIF_MAX_KB);
                          const displayVal = GIF_MAX_KB / unitToKB[targetUnit];
                          setTargetInput(displayVal >= 10 ? String(Math.round(displayVal)) : displayVal.toFixed(1));
                        }
                      }}
                      disabled={exporting}
                      className={`flex-1 px-2 py-1.5 text-sm rounded-[10px] transition-colors disabled:opacity-40 ${
                        outputFormat === val
                          ? "bg-[#00B4FF] text-white font-medium"
                          : "bg-white/10 text-white/80 hover:bg-white/20"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {outputFormat === "gif" && (
                  <p className="text-[11px] text-yellow-400/80 mt-2">
                    注意：GIF 不支援聲音，且相同畫質下體積會比影片大很多。
                  </p>
                )}
              </div>

              {/* ── 輸出解析度 ── */}
              <div className="bg-white/10 rounded-[10px] p-3">
                <p className="text-xs text-white/70 mb-2 font-medium">輸出解析度</p>
                <div className="flex rounded-lg overflow-hidden border border-white/10">
                  {resolutionOptions.map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => setResolution(key)}
                      disabled={exporting}
                      className={`flex-1 py-2 text-xs font-medium transition-colors disabled:opacity-40 ${
                        resolution === key
                          ? "bg-[#00B4FF] text-white"
                          : "bg-white/5 text-white/60 hover:bg-white/10"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {resolution !== "original" && (
                  <p className="text-[10px] text-white/40 mt-2">
                    輸出尺寸：{outputW} × {outputH}
                  </p>
                )}
                {outputFormat === "gif" && resolution === "original" && effectiveH > 480 && (
                  <p className="text-[11px] text-yellow-400/80 mt-2">
                    降低解析度可顯著減少 GIF 體積
                  </p>
                )}
              </div>

              {/* ── 導出預設 ── */}
              <div className="bg-white/10 rounded-[10px] p-3">
                <p className="text-xs text-white/70 font-medium mb-2">導出預設</p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: "social" as const, label: "社群媒體", desc: `≈ ${fmtSize(presetSocialKB)}` },
                    { id: "compress" as const, label: "極致壓縮", desc: `≈ ${fmtSize(presetCompressKB)}` },
                    { id: "quality" as const, label: "不壓縮", desc: "原始畫質" },
                  ].map(({ id, label, desc }) => (
                    <button
                      key={id}
                      onClick={() => applyPreset(id)}
                      disabled={exporting}
                      className={`px-1 py-2 text-[11px] font-medium rounded-lg transition-colors disabled:opacity-40 ${
                        activePreset === id
                          ? "bg-[#00B4FF] text-white"
                          : "bg-white/5 text-white/60 hover:bg-white/10 border border-white/10"
                      }`}
                    >
                      <div>{label}</div>
                      <div className="text-[9px] opacity-60 mt-0.5">{desc}</div>
                    </button>
                  ))}
                </div>
                {activePreset && (
                  <p className="text-[10px] text-white/40 mt-2">
                    {{ social: "適合上傳社群平台，兼顧畫質與檔案大小", compress: "正在全力壓縮體積並保留細節，轉檔將耗時較長", quality: "保留原始畫質，快速轉檔不壓縮" }[activePreset]}
                  </p>
                )}
              </div>

              {/* ── 目標檔案大小 ── */}
              <div className="bg-white/10 rounded-[10px] p-3">
                <p className="text-xs text-white/70 font-medium mb-3">
                  {outputFormat === "gif" ? "預期目標（僅供參考）" : "目標檔案大小"}
                </p>
                {outputFormat === "gif" && (
                  <p className="text-[10px] text-white/30 mb-2">
                    GIF 體積主要由尺寸與幀率決定，若無法達成目標，系統將自動縮小尺寸。
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0.1}
                    step={0.1}
                    placeholder={targetUnit}
                    value={targetInput}
                    onChange={(e) => { setTargetInput(e.target.value); setActivePreset(null); }}
                    onBlur={commitTarget}
                    onKeyDown={handleTargetKeyDown}
                    disabled={exporting}
                    className="flex-1 min-w-0 px-2 py-1 text-sm input-vic disabled:opacity-40"
                  />
                  <div className="flex rounded-md overflow-hidden border border-white/10 shrink-0">
                    {(["KB", "MB", "GB"] as const).map((u) => (
                      <button
                        key={u}
                        onClick={() => { setTargetUnit(u); setTargetInput(""); setTargetKB(null); setActivePreset(null); }}
                        disabled={exporting}
                        className={`px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-40 ${
                          targetUnit === u
                            ? "bg-[#00B4FF] text-white"
                            : "bg-white/5 text-white/50 hover:bg-white/10"
                        }`}
                      >
                        {u}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 解析度調整提示 */}
                {resolutionHint && (
                  <p className="text-[11px] text-[#00B4FF] mt-1.5 transition-opacity">{resolutionHint}</p>
                )}

                {/* 比例快捷 */}
                <div className="flex gap-1.5 mt-2">
                  {[50, 75, 100].map((pct) => {
                    const pctKB = estimatedSizeKB > 0 ? Math.round(estimatedSizeKB * pct / 100) : 0;
                    return (
                      <button
                        key={pct}
                        onClick={() => { setTargetFromKB(pctKB); setActivePreset(null); }}
                        disabled={exporting || pctKB <= 0}
                        className={`flex-1 py-1.5 text-[11px] font-medium rounded-md transition-colors disabled:opacity-40 ${
                          targetKB === pctKB && pctKB > 0
                            ? "bg-[#00B4FF]/20 text-[#00B4FF] border border-[#00B4FF]/30"
                            : "bg-white/5 text-white/40 hover:bg-white/10 border border-white/5"
                        }`}
                      >
                        {pct}%
                      </button>
                    );
                  })}
                </div>

                {/* 目標大於原片警告 */}
                {targetKB !== null && estimatedSizeKB > 0 && targetKB > estimatedSizeKB && (
                  <div className="flex items-start gap-2 mt-2 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                    <svg className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-xs text-yellow-300">
                      目標體積大於原片，建議調低以節省空間
                    </span>
                  </div>
                )}

                {/* 畫質分級 */}
                {qualityTier && (
                  <div className="mt-3 pt-3 border-t border-white/10 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-white/70">畫質分級</span>
                      <span
                        className="text-sm font-bold"
                        style={{ color: qualityColor[qualityTier] }}
                      >
                        {qualityLabel[qualityTier]}
                      </span>
                    </div>

                    {/* 分級條 */}
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.min(100, Math.max(5, (videoBitrateKbps ?? 0) / 40))}%`,
                          background: qualityColor[qualityTier],
                        }}
                      />
                    </div>

                    <div className="flex justify-between text-xs font-mono text-white/40">
                      <span>影像位元率</span>
                      <span>{videoBitrateKbps} kbps</span>
                    </div>

                    {qualityTier === "danger" && (
                      <div className="flex items-start gap-2 mt-1 p-2 bg-red-500/10 border border-red-500/30 rounded-lg">
                        <svg className="w-4 h-4 text-red-400 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-xs text-red-300">
                          檔案體積過小，畫質可能會嚴重受損
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ── 編碼強度 (GIF 不需要) ── */}
              {outputFormat !== "gif" && (
                <div className="bg-white/10 rounded-[10px] p-3">
                  <p className="text-xs text-white/70 font-medium mb-2">編碼強度</p>
                  <div className="flex rounded-lg overflow-hidden border border-white/10">
                    {([
                      { key: "fast", label: "快速" },
                      { key: "medium", label: "均衡" },
                      { key: "veryslow", label: "高品質" },
                    ] as const).map(({ key, label }) => (
                      <button
                        key={key}
                        onClick={() => { setEncodingPreset(key); setActivePreset(null); }}
                        disabled={exporting}
                        className={`flex-1 py-2 text-xs font-medium transition-colors disabled:opacity-40 ${
                          encodingPreset === key
                            ? "bg-[#00B4FF] text-white"
                            : "bg-white/5 text-white/60 hover:bg-white/10"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-white/30 mt-2">
                    {{ fast: "編碼速度快，適合快速預覽", medium: "速度與畫質均衡", veryslow: "最佳畫質，編碼時間較長" }[encodingPreset]}
                  </p>
                </div>
              )}

              {/* ── 匯出結果 ── */}
              {outputInfo && (
                <section className="flex flex-col gap-2">
                  <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider">
                    匯出結果
                  </h3>
                  <div className="bg-white/5 rounded-[10px] p-3 flex flex-col gap-1.5 text-sm font-mono">
                    <div className="flex justify-between">
                      <span className="text-white/50">輸出大小</span>
                      <span className="text-[#00B4FF] font-bold">
                        {fmtSize(outputInfo.output_size_kb ?? 0)}
                      </span>
                    </div>
                    {outputInfo.video_bitrate_kbps && (
                      <div className="flex justify-between">
                        <span className="text-white/50">實際影像位元率</span>
                        <span className="text-white">{outputInfo.video_bitrate_kbps} kbps</span>
                      </div>
                    )}
                    {outputInfo.warning && (
                      <p className="text-xs text-yellow-400 mt-1">{outputInfo.warning}</p>
                    )}
                  </div>
                </section>
              )}

              {/* ── 錯誤訊息 ── */}
              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-[10px]">
                  <p className="text-sm text-red-300">{error}</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* 底部按鈕 */}
        <div className="p-4 pt-0 flex flex-col gap-2">
          <button
            onClick={handleExport}
            disabled={exporting || !videoInfo}
            className="w-full px-4 py-3 bg-[#00B4FF] text-white font-bold rounded-[10px] transition-all btn-vic disabled:opacity-40"
          >
            {exporting ? "匯出中..." : "開始匯出"}
          </button>
          <button
            onClick={handleDownload}
            disabled={!outputInfo || downloading}
            className="w-full px-4 py-3 bg-white/10 text-white font-bold rounded-[10px] transition-all disabled:opacity-30"
          >
            {downloading ? "下載中..." : outputFormat === "gif" ? "下載 GIF" : "下載影片"}
          </button>
          <button
            onClick={onReturn}
            disabled={exporting}
            className="w-full px-4 py-2 text-white/70 hover:text-white text-md transition-colors disabled:opacity-40"
          >
            返回裁切
          </button>
        </div>
      </aside>

      {/* ===== 右側預覽區 (永遠渲染，previewRef 永遠在 DOM) ===== */}
      <main className="flex-1 flex flex-col h-screen">
        <div
          ref={previewRef}
          className="flex-1 flex items-center justify-center m-4 rounded-lg overflow-hidden relative"
          style={{ background: "#1a1a1a" }}
        >
          {/* 裁切容器 — hasCrop 時顯示 overflow:hidden + 精確尺寸，否則 display:contents 穿透 */}
          <div
            style={
              hasCrop
                ? {
                    position: "relative" as const,
                    overflow: "hidden" as const,
                    width: cropContainerSize!.w,
                    height: cropContainerSize!.h,
                    flexShrink: 0,
                    transform: previewTransform || undefined,
                    transition: "width 0.3s ease, height 0.3s ease",
                  }
                : { display: "contents" as const }
            }
          >
            {/* 預覽元素 — 統一使用 video (GIF 透過後端 MP4 預覽) */}
            <video
              ref={videoRef}
              src={effectiveVideoSrc}
              onLoadedMetadata={handleLoadedMetadata}
              style={
                hasCrop
                  ? {
                      position: "absolute" as const,
                      width: `${(nativeSize!.w / clipConfig!.crop_w) * 100}%`,
                      height: `${(nativeSize!.h / clipConfig!.crop_h) * 100}%`,
                      left: `${-(clipConfig!.crop_x / clipConfig!.crop_w) * 100}%`,
                      top: `${-(clipConfig!.crop_y / clipConfig!.crop_h) * 100}%`,
                      maxWidth: "none",
                    }
                  : {
                      maxWidth: "100%",
                      maxHeight: "100%",
                      transform: [previewTransform, resolutionScale < 1 ? `scale(${resolutionScale})` : ""].filter(Boolean).join(" ") || undefined,
                      transition: "transform 0.3s ease",
                    }
              }
              muted
              autoPlay
              playsInline
            />
          </div>

          {/* 解析度標籤 */}
          {resolution !== "original" && (
            <span
              className="absolute bottom-3 right-3 px-2 py-0.5 text-[11px] font-bold text-white/90 bg-black/50 backdrop-blur-sm rounded-md transition-opacity duration-300"
            >
              {resolution}
            </span>
          )}

          {/* 影片載入中 spinner overlay */}
          {!nativeSize && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div
                className="w-10 h-10 rounded-full animate-spin"
                style={{
                  border: "3px solid rgba(255,255,255,0.15)",
                  borderTopColor: "#00B4FF",
                }}
              />
            </div>
          )}
        </div>

        {/* 進度條 (匯出中 / 完成) */}
        {(exporting || outputInfo) && (
          <div className="shrink-0 mx-4 mb-4 p-4 bg-white/5 rounded-lg flex flex-col gap-3">
            {/* 進度條 */}
            <div className="h-2 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${progress}%`,
                  background: "#00B4FF",
                  boxShadow: exporting
                    ? "0 0 12px rgba(0,180,255,0.6), 0 0 24px rgba(0,180,255,0.3)"
                    : "none",
                }}
              />
            </div>

            {/* 步驟文字 */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-white/70">
                {exporting ? stepLabel : "匯出完成"}
              </span>
              <span className="text-sm font-mono text-white/50">
                {progress}%
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
