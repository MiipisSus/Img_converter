interface ActionBarProps {
  rotation: number;
  onRotate: (angle: number) => void;
  quality: number;
  onQualityChange: (quality: number) => void;
  disabled?: boolean;
}

export function ActionBar({
  rotation,
  onRotate,
  quality,
  onQualityChange,
  disabled,
}: ActionBarProps) {
  // 旋轉按鈕處理
  const handleRotateLeft = () => onRotate(rotation - 90);
  const handleRotateRight = () => onRotate(rotation + 90);

  return (
    <div className="bg-slate-800/50 rounded-2xl p-4 sm:p-6 space-y-4">
      <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider">
        編輯工具
      </h2>

      {/* 旋轉按鈕 */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">
          旋轉
          <span className="ml-2 text-blue-400 font-bold">{rotation}°</span>
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleRotateLeft}
            disabled={disabled}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3
                       bg-slate-700 hover:bg-slate-600 rounded-xl
                       text-slate-200 transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 10h10a5 5 0 015 5v2M3 10l4-4m-4 4l4 4"
              />
            </svg>
            <span>向左 90°</span>
          </button>
          <button
            type="button"
            onClick={handleRotateRight}
            disabled={disabled}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3
                       bg-slate-700 hover:bg-slate-600 rounded-xl
                       text-slate-200 transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 10H11a5 5 0 00-5 5v2m15-7l-4-4m4 4l-4 4"
              />
            </svg>
            <span>向右 90°</span>
          </button>
        </div>
      </div>

      {/* 壓縮品質滑桿 */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">
          壓縮品質
          <span className="ml-2 text-blue-400 font-bold">{quality}%</span>
        </label>
        <input
          type="range"
          min="1"
          max="100"
          value={quality}
          onChange={(e) => onQualityChange(Number(e.target.value))}
          disabled={disabled}
          className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer
                     disabled:opacity-50 disabled:cursor-not-allowed
                     [&::-webkit-slider-thumb]:appearance-none
                     [&::-webkit-slider-thumb]:w-5
                     [&::-webkit-slider-thumb]:h-5
                     [&::-webkit-slider-thumb]:rounded-full
                     [&::-webkit-slider-thumb]:bg-blue-500
                     [&::-webkit-slider-thumb]:cursor-pointer
                     [&::-webkit-slider-thumb]:transition-transform
                     [&::-webkit-slider-thumb]:hover:scale-110"
        />
        <div className="flex justify-between text-xs text-slate-500 mt-1">
          <span>低品質 / 小檔案</span>
          <span>高品質 / 大檔案</span>
        </div>
      </div>
    </div>
  );
}

export default ActionBar;
