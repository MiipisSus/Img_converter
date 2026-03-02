import type { VideoItem } from "../types";
import vicLogo from "../assets/vic_logo.png";

interface VideoEditorPageProps {
  video: VideoItem;
  onReset: () => void;
}

export function VideoEditorPage({ video, onReset }: VideoEditorPageProps) {
  const sizeKB = Math.round(video.size / 1024);
  const sizeMB = (video.size / 1024 / 1024).toFixed(1);

  return (
    <div className="min-h-screen bg-sidebar flex flex-col">
      {/* 頂部工具列 */}
      <header className="h-14 shrink-0 flex items-center justify-between px-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <img src={vicLogo} alt="VicgoVic!" className="h-8" />
          <span className="text-white/60 text-sm truncate max-w-[300px]">{video.name}</span>
          <span className="text-white/40 text-xs">
            {sizeKB > 1024 ? `${sizeMB} MB` : `${sizeKB} KB`}
          </span>
        </div>
        <button
          onClick={onReset}
          className="px-4 py-1.5 text-sm text-white/70 hover:text-white border border-white/20 hover:border-white/40 rounded-lg transition-colors"
        >
          返回首頁
        </button>
      </header>

      {/* 主要內容區 */}
      <main className="flex-1 flex items-center justify-center">
        <div className="text-center text-white/50">
          <div className="text-6xl mb-4">🎬</div>
          <h2 className="text-xl font-bold text-white mb-2">影片編輯器</h2>
          <p className="text-sm mb-1">裁剪 / 旋轉 / 翻轉 / 縮放 / 壓縮</p>
          <p className="text-xs text-white/30 mt-4">開發中，敬請期待</p>
        </div>
      </main>
    </div>
  );
}
