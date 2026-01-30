import { useCallback, useState, useRef } from 'react';
import { ImagePlus, Upload } from 'lucide-react';

interface DropZoneProps {
  onFileSelect: (file: File) => void;
  accept?: string;
  disabled?: boolean;
}

const ACCEPTED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/tiff',
  'image/avif',
  'image/heic',
  'image/heif',
  'image/svg+xml',
];

export function DropZone({ onFileSelect, accept, disabled }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) {
      setIsDragging(true);
    }
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (disabled) return;

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (ACCEPTED_TYPES.includes(file.type) || file.type === '') {
        onFileSelect(file);
      }
    }
  }, [disabled, onFileSelect]);

  const handleClick = useCallback(() => {
    if (!disabled && inputRef.current) {
      inputRef.current.click();
    }
  }, [disabled]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      onFileSelect(files[0]);
    }
    e.target.value = '';
  }, [onFileSelect]);

  return (
    <div
      className={`
        drop-zone min-h-75 flex items-center justify-center
        ${isDragging ? 'active' : ''}
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      `}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept || ACCEPTED_TYPES.join(',')}
        onChange={handleFileChange}
        className="hidden"
        disabled={disabled}
      />

      <div className="flex flex-col items-center justify-center p-8 text-center">
        {/* 上傳圖示 */}
        <div
          className={`
            mb-6 p-5 rounded-full transition-all duration-300
            ${isDragging
              ? 'bg-blue-500/20 scale-110'
              : 'bg-slate-800/50'
            }
          `}
        >
          {isDragging ? (
            <Upload
              className="w-12 h-12 text-blue-400"
              strokeWidth={1.5}
            />
          ) : (
            <ImagePlus
              className="w-12 h-12 text-slate-500"
              strokeWidth={1.5}
            />
          )}
        </div>

        {/* 文字說明 */}
        <p className="text-slate-200 text-lg font-medium mb-2">
          {isDragging ? '放開以上傳圖片' : '拖放圖片到此處'}
        </p>
        <p className="text-slate-500 text-sm mb-6">
          或點擊選擇檔案
        </p>

        {/* 選擇按鈕 */}
        <button
          type="button"
          className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-xl transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            handleClick();
          }}
        >
          選擇圖片
        </button>

        {/* 支援格式提示 */}
        <p className="text-slate-600 text-xs mt-6">
          支援 PNG, JPEG, WebP, GIF, AVIF, HEIC 等格式
        </p>
      </div>
    </div>
  );
}

export default DropZone;
