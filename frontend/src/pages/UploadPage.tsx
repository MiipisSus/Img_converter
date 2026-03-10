import { useState, useCallback, useRef } from "react";
import type { ImageItem, VideoItem } from "../types";
import { loadImageFile } from "../utils/loadImageFile";
import picLogo from "../assets/pic_logo.png";
import vicLogo from "../assets/vic_logo.png";
import bmcLogo from "../assets/bmc-full-logo.png";

interface UploadPageProps {
  onImagesLoaded: (images: ImageItem[]) => void;
  onVideoLoaded: (video: VideoItem) => void;
}

/** 拖曳偵測到的檔案類型 */
type DragHint = "none" | "image" | "video" | "mixed";

/** 從 FileList 分離圖片與影片 (GIF 歸類為影片) */
function classifyFiles(files: FileList) {
  const images: File[] = [];
  const videos: File[] = [];
  for (const f of Array.from(files)) {
    if (f.type === "image/gif") videos.push(f);
    else if (f.type.startsWith("image/")) images.push(f);
    else if (f.type.startsWith("video/")) videos.push(f);
  }
  return { images, videos };
}

/** 根據拖曳中的 MIME 推斷檔案類型 (GIF 歸類為影片) */
function detectDragHint(e: React.DragEvent): DragHint {
  const items = e.dataTransfer.items;
  if (!items || items.length === 0) return "none";
  let hasImage = false;
  let hasVideo = false;
  for (let i = 0; i < items.length; i++) {
    const t = items[i].type;
    if (t === "image/gif") hasVideo = true;
    else if (t.startsWith("image/")) hasImage = true;
    else if (t.startsWith("video/")) hasVideo = true;
  }
  if (hasImage && hasVideo) return "mixed";
  if (hasImage) return "image";
  if (hasVideo) return "video";
  return "none";
}

export function UploadPage({ onImagesLoaded, onVideoLoaded }: UploadPageProps) {
  const [dragHint, setDragHint] = useState<DragHint>("none");
  const [alert, setAlert] = useState<string | null>(null);
  const dragCounterRef = useRef(0);
  const alertTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const isDragging = dragHint !== "none";

  // ── 顯示警告 (3.5 秒自動消失) ──
  const showAlert = useCallback((msg: string) => {
    setAlert(msg);
    if (alertTimerRef.current) clearTimeout(alertTimerRef.current);
    alertTimerRef.current = setTimeout(() => setAlert(null), 3500);
  }, []);

  // ── 智能檔案處理 ──
  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
  const ALLOWED_EXTENSIONS = new Set([
    ".mp4", ".mov", ".avi", ".gif",
    ".jpg", ".jpeg", ".png", ".webp",
  ]);

  const handleFiles = useCallback(
    async (files: FileList) => {
      // 副檔名白名單 + 大小檢查
      for (const f of Array.from(files)) {
        const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
        if (!ALLOWED_EXTENSIONS.has(ext)) {
          showAlert(`不支援的檔案格式：${ext}。僅允許 ${[...ALLOWED_EXTENSIONS].join(", ")}。`);
          return;
        }
        if (f.size > MAX_FILE_SIZE) {
          showAlert(`檔案「${f.name}」超出上傳限制（上限 50MB）。`);
          return;
        }
      }

      const { images, videos } = classifyFiles(files);

      // 混合檔案
      if (images.length > 0 && videos.length > 0) {
        showAlert("無法同時處理圖片與影片，請分別上傳。");
        return;
      }

      // 不支援的格式
      if (images.length === 0 && videos.length === 0) {
        showAlert("不支援的檔案格式，請上傳圖片或影片。");
        return;
      }

      // 圖片模式 — 支援批次
      if (images.length > 0) {
        const items = await Promise.all(images.map(loadImageFile));
        onImagesLoaded(items);
        return;
      }

      // 影片模式 — 僅支援單一檔案
      if (videos.length > 1) {
        showAlert("影片模式目前僅支援單一檔案，請一次選擇一個影片。");
        return;
      }

      const vf = videos[0];
      onVideoLoaded({
        id: Math.random().toString(36).slice(2) + Date.now().toString(36),
        file: vf,
        name: vf.name,
        size: vf.size,
      });
    },
    [onImagesLoaded, onVideoLoaded, showAlert],
  );

  // ── <input> onChange ──
  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) handleFiles(e.target.files);
      e.target.value = "";
    },
    [handleFiles],
  );

  // ── 拖放事件 ──
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setDragHint(detectDragHint(e));
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setDragHint("none");
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragHint("none");
      dragCounterRef.current = 0;
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles],
  );

  // ── 拖曳視覺提示 ──
  const hintText =
    dragHint === "image" ? "放開以上傳圖片"
    : dragHint === "video" ? "放開以上傳影片"
    : dragHint === "mixed" ? "無法同時處理圖片與影片"
    : null;

  const hintLogo =
    dragHint === "image" ? picLogo
    : dragHint === "video" ? vicLogo
    : null;

  return (
    <div className="min-h-screen bg-sidebar flex flex-col items-center justify-center select-none">
      {/* 警告 Toast */}
      {alert && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50">
          <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-red-500/90 text-white text-sm font-medium shadow-lg backdrop-blur">
            <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
            <span>{alert}</span>
            <button onClick={() => setAlert(null)} className="ml-2 hover:text-white/70 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col items-center gap-6">
        {/* Logo 區域：拖曳時切換對應 Logo */}
        {isDragging && hintLogo ? (
          <img src={hintLogo} alt="" className="h-28 transition-all duration-200 scale-110" />
        ) : (
          <div className="flex items-center gap-4">
            <img src={picLogo} alt="picgopic!" className="h-24" />
            <span className="text-white/20 text-2xl font-light">||</span>
            <img src={vicLogo} alt="vicgovic!" className="h-24" />
          </div>
        )}

        {/* 統一拖放區 */}
        <label
          htmlFor="file-upload"
          className="relative flex flex-col items-center cursor-pointer"
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <div
            className={`w-[60vw] min-w-[320px] max-w-[800px] h-[50vh] min-h-[200px] max-h-[600px] rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-4 transition-all duration-200 ${
              dragHint === "image"
                ? "border-highlight bg-highlight/10 scale-[1.02]"
                : dragHint === "video"
                  ? "border-[#00B4FF] bg-[#00B4FF]/10 scale-[1.02]"
                  : dragHint === "mixed"
                    ? "border-red-400 bg-red-400/10 scale-[1.02]"
                    : "border-gray-400 hover:border-gray-50 hover:bg-preview/10"
            }`}
          >
            {isDragging ? (
              /* 拖曳中：顯示檔案類型提示 */
              <span
                className={`text-lg font-bold animate-pulse ${
                  dragHint === "image"
                    ? "text-highlight"
                    : dragHint === "video"
                      ? "text-[#00B4FF]"
                      : "text-red-400"
                }`}
              >
                {hintText}
              </span>
            ) : (
              /* 預設狀態 */
              <>
                <svg
                  className="w-12 h-12 text-gray-400 transition-colors"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13"
                  />
                </svg>
                <span className="text-base text-gray-500">
                  拖放圖片或影片至此
                </span>
                <div className="px-8 py-3 bg-white text-black font-bold rounded-[10px] transition-all btn-white hover:brightness-110 text-lg">
                  選擇檔案
                </div>
                <p className="text-sm text-gray-500">
                  圖片：JPG, PNG, WebP 等（可多選）
                </p>
                <p className="text-sm text-gray-500">
                  影片 / GIF：MP4, WebM, AVI, MOV, GIF（單一檔案）
                </p>
              </>
            )}
          </div>
        </label>
        <input
          id="file-upload"
          type="file"
          accept="image/*,video/*"
          multiple
          onChange={handleFileChange}
          className="hidden"
        />
      </div>
      {/* Buy Me a Coffee */}
      <a
        href="https://www.buymeacoffee.com/miipissus"
        target="_blank"
        rel="noopener noreferrer"
        className="fixed left-4 bottom-4 z-40 px-4 py-2 rounded-lg hover:scale-105 transition-transform"
        style={{
          animation: "bmc-color 10s ease-in-out infinite",
        }}
      >
        <img src={bmcLogo} alt="Buy Me A Coffee" className="h-7" />
        <style>{`
          @keyframes bmc-color {
            0%, 100% { background-color: #D4FF3F; }
            50% { background-color: #00B4FF; }
          }
        `}</style>
      </a>
    </div>
  );
}
