import { useMemo } from 'react';

interface ImagePreviewProps {
  file?: File | null;
  blob?: Blob | null;
  label?: string;
  info?: {
    width?: number;
    height?: number;
    size?: number;
    format?: string;
  };
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function ImagePreview({ file, blob, label, info }: ImagePreviewProps) {
  const previewUrl = useMemo(() => {
    if (blob) {
      return URL.createObjectURL(blob);
    }
    if (file) {
      return URL.createObjectURL(file);
    }
    return null;
  }, [file, blob]);

  if (!previewUrl) {
    return (
      <div className="preview-container flex items-center justify-center h-48 sm:h-64">
        <div className="text-center text-slate-500">
          <svg
            className="w-12 h-12 mx-auto mb-2 opacity-50"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <p className="text-sm">{label || '尚未選擇圖片'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="preview-container">
      {/* 標籤 */}
      {label && (
        <div className="absolute top-3 left-3 px-3 py-1 bg-slate-900/80 rounded-full text-xs text-slate-300 backdrop-blur-sm">
          {label}
        </div>
      )}

      {/* 圖片 */}
      <div className="flex items-center justify-center p-4 min-h-48 sm:min-h-64 max-h-80 sm:max-h-96">
        <img
          src={previewUrl}
          alt={label || '預覽圖片'}
          className="max-w-full max-h-72 sm:max-h-88 object-contain rounded-lg"
          onLoad={() => {
            // 當使用 blob 時，在圖片載入後清理 URL
            if (blob && previewUrl) {
              // 延遲清理，確保圖片已顯示
              // URL.revokeObjectURL(previewUrl);
            }
          }}
        />
      </div>

      {/* 資訊列 */}
      {info && (
        <div className="px-4 py-3 bg-slate-800/50 border-t border-slate-700/50 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
          {info.width && info.height && (
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
              {info.width} × {info.height}
            </span>
          )}
          {info.size !== undefined && (
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              {formatFileSize(info.size)}
            </span>
          )}
          {info.format && (
            <span className="flex items-center gap-1 uppercase">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              {info.format}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default ImagePreview;
