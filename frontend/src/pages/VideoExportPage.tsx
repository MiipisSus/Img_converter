import { useState, useCallback, useRef, useEffect } from "react";
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

  // ── 影片資訊 ──
  const [videoInfo, setVideoInfo] = useState<VideoInfoResult | null>(null);
  const [loading, setLoading] = useState(true);

  // ── 目標大小 ──
  const [targetInput, setTargetInput] = useState("");
  const [targetKB, setTargetKB] = useState<number | null>(null);

  // ── 匯出狀態 ──
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stepLabel, setStepLabel] = useState("");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [outputInfo, setOutputInfo] = useState<TaskStatusResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const videoUrlRef = useRef("");

  // ── 衍生資料 ──
  const trimDuration =
    videoInfo
      ? (clipConfig?.end_t ?? videoInfo.duration) -
        (clipConfig?.start_t ?? 0)
      : 0;
  const includeAudio = clipConfig?.include_audio ?? true;
  const originalSizeKB = videoInfo ? Math.round(videoInfo.file_size / 1024) : 0;

  // 裁切後尺寸
  const cropW = clipConfig?.crop_w ?? videoInfo?.width ?? 0;
  const cropH = clipConfig?.crop_h ?? videoInfo?.height ?? 0;

  // 畫質計算
  const videoBitrateKbps = (() => {
    if (!targetKB || trimDuration <= 0) return null;
    const totalBits = targetKB * 1024 * 8 * 0.98;
    const audioBits = includeAudio ? 128 * 1000 * trimDuration : 0;
    const videoBits = totalBits - audioBits;
    return Math.round(videoBits / trimDuration / 1000);
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

  // ── 載入影片資訊 ──
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getVideoInfo(video.file)
      .then((info) => {
        if (!cancelled) setVideoInfo(info);
      })
      .catch((err) => console.error("取得影片資訊失敗:", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [video.file]);

  // ── ObjectURL ──
  useEffect(() => {
    const url = URL.createObjectURL(video.file);
    videoUrlRef.current = url;
    return () => URL.revokeObjectURL(url);
  }, [video.file]);

  // ── 清理 polling ──
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ── 目標大小 commit ──
  const commitTarget = useCallback(() => {
    const val = parseFloat(targetInput);
    if (!isNaN(val) && val > 0) {
      setTargetKB(Math.round(val * 1024));
    } else {
      setTargetKB(null);
    }
  }, [targetInput]);

  const handleTargetKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") commitTarget();
    },
    [commitTarget],
  );

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
        start_t: clipConfig?.start_t,
        end_t: clipConfig?.end_t,
        crop_x: clipConfig?.crop_x,
        crop_y: clipConfig?.crop_y,
        crop_w: clipConfig?.crop_w,
        crop_h: clipConfig?.crop_h,
        rotate,
        flip_h: flipH,
        flip_v: flipV,
        include_audio: includeAudio,
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
  }, [videoInfo, video.file, targetKB, clipConfig, rotate, flipH, flipV, includeAudio]);

  // ── 下載 ──
  const handleDownload = useCallback(async () => {
    if (!taskId) return;
    setDownloading(true);
    try {
      const blob = await downloadVideo(taskId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${video.name.replace(/\.[^.]+$/, "")}_export.mp4`;
      a.click();
      URL.revokeObjectURL(url);
      await cleanupTask(taskId);
    } catch (err) {
      console.error("下載失敗:", err);
    } finally {
      setDownloading(false);
    }
  }, [taskId, video.name]);

  // ── CSS 旋轉/翻轉 (預覽用) ──
  const previewTransform = [
    `rotate(${rotate}deg)`,
    flipH ? "scaleX(-1)" : "",
    flipV ? "scaleY(-1)" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // ── Loading ──
  if (loading) {
    return (
      <div className="min-h-screen bg-sidebar flex items-center justify-center">
        <div className="animate-pulse text-white/50 text-lg">載入中...</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex overflow-hidden bg-sidebar">
      {/* ===== 左側設定面板 ===== */}
      <aside className="w-[30%] min-w-[240px] max-w-[320px] flex flex-col h-screen sidebar-scroll overflow-y-auto bg-sidebar">
        {/* Logo */}
        <div className="p-4 pb-2">
          <img src={vicLogo} alt="vicgovic!" className="h-8" />
        </div>

        {/* 設定區 */}
        <div className="flex-1 p-4 pt-2 flex flex-col gap-3">
          {/* ── 影片資訊 ── */}
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider">
              影片資訊
            </h3>
            <div className="bg-white/5 rounded-[10px] p-3 flex flex-col gap-1.5 text-sm font-mono">
              <div className="flex justify-between">
                <span className="text-white/50">檔案名稱</span>
                <span className="text-white truncate max-w-[140px]">{video.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/50">原始大小</span>
                <span className="text-white">{fmtSize(originalSizeKB)}</span>
              </div>
              {videoInfo && (
                <>
                  <div className="flex justify-between">
                    <span className="text-white/50">原始解析度</span>
                    <span className="text-white">
                      {videoInfo.width} x {videoInfo.height}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/50">總時長</span>
                    <span className="text-white">{fmtTime(videoInfo.duration)}</span>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* ── 剪輯摘要 ── */}
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider">
              剪輯摘要
            </h3>
            <div className="bg-white/5 rounded-[10px] p-3 flex flex-col gap-1.5 text-sm font-mono">
              <div className="flex justify-between">
                <span className="text-white/50">裁切後時長</span>
                <span className="text-white">{fmtTime(trimDuration)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/50">輸出尺寸</span>
                <span className="text-white">{cropW} x {cropH}</span>
              </div>
              {rotate !== 0 && (
                <div className="flex justify-between">
                  <span className="text-white/50">旋轉</span>
                  <span className="text-white">{rotate}°</span>
                </div>
              )}
              {(flipH || flipV) && (
                <div className="flex justify-between">
                  <span className="text-white/50">翻轉</span>
                  <span className="text-white">
                    {[flipH && "水平", flipV && "垂直"].filter(Boolean).join(" + ")}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-white/50">音訊</span>
                <span className="text-white">
                  {includeAudio ? "保留" : "移除"}
                </span>
              </div>
            </div>
          </section>

          {/* ── 目標檔案大小 ── */}
          <div className="bg-white/10 rounded-[10px] p-3">
            <p className="text-xs text-white/70 font-medium mb-3">目標檔案大小</p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/70 shrink-0">目標</span>
              <input
                type="number"
                min={1}
                step={1}
                placeholder="不限制"
                value={targetInput}
                onChange={(e) => setTargetInput(e.target.value)}
                onBlur={commitTarget}
                onKeyDown={handleTargetKeyDown}
                disabled={exporting}
                className="w-20 px-2 py-1 text-sm input-vic disabled:opacity-40"
              />
              <span className="text-xs text-white/60 shrink-0">MB</span>
            </div>

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
        </div>

        {/* 底部按鈕 */}
        <div className="p-4 pt-0 flex flex-col gap-2">
          {outputInfo ? (
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="w-full px-4 py-3 bg-[#00B4FF] text-white font-bold rounded-[10px] transition-all btn-vic disabled:opacity-40"
            >
              {downloading ? "下載中..." : "下載影片"}
            </button>
          ) : (
            <button
              onClick={handleExport}
              disabled={exporting || !videoInfo}
              className="w-full px-4 py-3 bg-[#00B4FF] text-white font-bold rounded-[10px] transition-all btn-vic disabled:opacity-40"
            >
              {exporting ? "匯出中..." : "開始匯出"}
            </button>
          )}
          <button
            onClick={onReturn}
            disabled={exporting}
            className="w-full px-4 py-2 text-white/70 hover:text-white text-md transition-colors disabled:opacity-40"
          >
            返回裁切
          </button>
          <button
            onClick={onReset}
            disabled={exporting}
            className="w-full px-4 py-2 text-white/50 hover:text-white text-sm transition-colors disabled:opacity-40"
          >
            返回首頁
          </button>
        </div>
      </aside>

      {/* ===== 右側預覽區 ===== */}
      <main className="flex-1 flex flex-col h-screen">
        <div className="flex-1 bg-preview/5 flex items-center justify-center m-4 rounded-lg overflow-hidden relative">
          <video
            src={videoUrlRef.current}
            className="max-w-full max-h-full"
            style={{
              transform: previewTransform || undefined,
              transition: "transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
            }}
            muted
            autoPlay
            loop
            playsInline
          />
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
    </div>
  );
}
