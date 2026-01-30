interface ProcessingOptionsProps {
  outputFormat: string;
  setOutputFormat: (format: string) => void;
  quality: number;
  setQuality: (quality: number) => void;
  disabled?: boolean;
}

const OUTPUT_FORMATS = [
  { value: '', label: '維持原格式' },
  { value: 'png', label: 'PNG' },
  { value: 'jpg', label: 'JPEG' },
  { value: 'webp', label: 'WebP' },
  { value: 'avif', label: 'AVIF' },
  { value: 'gif', label: 'GIF' },
  { value: 'bmp', label: 'BMP' },
  { value: 'tiff', label: 'TIFF' },
  { value: 'ico', label: 'ICO' },
];

export function ProcessingOptions({
  outputFormat,
  setOutputFormat,
  quality,
  setQuality,
  disabled,
}: ProcessingOptionsProps) {
  return (
    <div className="space-y-4">
      {/* 輸出格式 */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">
          輸出格式
        </label>
        <select
          value={outputFormat}
          onChange={(e) => setOutputFormat(e.target.value)}
          disabled={disabled}
          className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl
                     text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500
                     disabled:opacity-50 disabled:cursor-not-allowed
                     appearance-none cursor-pointer"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2394a3b8'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 12px center',
            backgroundSize: '20px',
          }}
        >
          {OUTPUT_FORMATS.map((format) => (
            <option key={format.value} value={format.value}>
              {format.label}
            </option>
          ))}
        </select>
      </div>

      {/* 品質滑桿 */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">
          輸出品質
          <span className="ml-2 text-blue-400 font-bold">{quality}%</span>
        </label>
        <input
          type="range"
          min="1"
          max="100"
          value={quality}
          onChange={(e) => setQuality(Number(e.target.value))}
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

export default ProcessingOptions;
