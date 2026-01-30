import { useState } from 'react';
import {
  Crop,
  RotateCw,
  RotateCcw,
  Sliders,
  FileImage,
  FlipHorizontal,
  FlipVertical,
  X,
  Download,
  Loader2,
  Minus,
  Plus,
  ChevronLeft,
} from 'lucide-react';
import { ToolButton, Slider } from './ui';
import type { CropCoordinates } from './ImageViewer';

export type ActiveTool = 'none' | 'crop' | 'rotate' | 'quality' | 'format';

interface ToolPanelProps {
  // 狀態
  rotation: number;
  quality: number;
  outputFormat: string;
  cropCoordinates: CropCoordinates | null;
  activeTool: ActiveTool;

  // 回調
  onRotationChange: (angle: number) => void;
  onQualityChange: (quality: number) => void;
  onFormatChange: (format: string) => void;
  onToolChange: (tool: ActiveTool) => void;
  onFlipHorizontal: () => void;
  onFlipVertical: () => void;

  // 處理
  onProcess: () => void;
  onDownload: () => void;
  onCancel: () => void;
  isProcessing: boolean;
  hasProcessedImage: boolean;
  progress: number;
  processingStatus: string;

  disabled?: boolean;
}

const OUTPUT_FORMATS = [
  { value: '', label: '維持原格式' },
  { value: 'png', label: 'PNG' },
  { value: 'jpg', label: 'JPEG' },
  { value: 'webp', label: 'WebP' },
  { value: 'avif', label: 'AVIF' },
];

export function ToolPanel({
  rotation,
  quality,
  outputFormat,
  cropCoordinates,
  activeTool,
  onRotationChange,
  onQualityChange,
  onFormatChange,
  onToolChange,
  onFlipHorizontal,
  onFlipVertical,
  onProcess,
  onDownload,
  onCancel,
  isProcessing,
  hasProcessedImage,
  progress,
  processingStatus,
  disabled = false,
}: ToolPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const isToolActive = activeTool !== 'none';

  const handleToolSelect = (tool: ActiveTool) => {
    onToolChange(activeTool === tool ? 'none' : tool);
  };

  // 精細旋轉控制
  const handleFineRotation = (delta: number) => {
    onRotationChange(rotation + delta);
  };

  const renderToolSettings = () => {
    switch (activeTool) {
      case 'crop':
        return (
          <div className="space-y-5">
            <p className="text-sm text-slate-400">
              拖曳圖片上的選取框來裁切圖片
            </p>

            {/* 裁切座標顯示 */}
            {cropCoordinates && (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-slate-800/50 rounded-xl p-3">
                  <span className="text-slate-500">位置</span>
                  <p className="text-slate-300 font-mono">
                    {cropCoordinates.x}, {cropCoordinates.y}
                  </p>
                </div>
                <div className="bg-slate-800/50 rounded-xl p-3">
                  <span className="text-slate-500">尺寸</span>
                  <p className="text-slate-300 font-mono">
                    {cropCoordinates.width} x {cropCoordinates.height}
                  </p>
                </div>
              </div>
            )}

            {/* 旋轉控制 - 在裁切模式中 */}
            <div className="pt-4 border-t border-slate-800/50">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-slate-400">旋轉角度</span>
                <span className="text-sm font-semibold text-blue-400 tabular-nums">{rotation}°</span>
              </div>

              {/* 旋轉滑桿 */}
              <Slider
                value={rotation}
                min={-180}
                max={180}
                step={1}
                onChange={onRotationChange}
                disabled={disabled}
                showValue={false}
              />

              {/* 精細調整按鈕 */}
              <div className="flex items-center justify-center gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => handleFineRotation(-1)}
                  disabled={disabled}
                  className="w-10 h-10 flex items-center justify-center bg-slate-800/50 hover:bg-slate-700/50 rounded-lg text-slate-300 transition-colors disabled:opacity-50"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onRotationChange(rotation - 90)}
                  disabled={disabled}
                  className="flex items-center justify-center gap-1.5 h-10 px-3 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg text-slate-300 transition-colors disabled:opacity-50"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span className="text-xs">-90°</span>
                </button>
                <button
                  type="button"
                  onClick={() => onRotationChange(0)}
                  disabled={disabled}
                  className="h-10 px-3 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg text-slate-400 text-xs transition-colors disabled:opacity-50"
                >
                  重置
                </button>
                <button
                  type="button"
                  onClick={() => onRotationChange(rotation + 90)}
                  disabled={disabled}
                  className="flex items-center justify-center gap-1.5 h-10 px-3 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg text-slate-300 transition-colors disabled:opacity-50"
                >
                  <RotateCw className="w-4 h-4" />
                  <span className="text-xs">+90°</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleFineRotation(1)}
                  disabled={disabled}
                  className="w-10 h-10 flex items-center justify-center bg-slate-800/50 hover:bg-slate-700/50 rounded-lg text-slate-300 transition-colors disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        );

      case 'rotate':
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">目前角度</span>
              <span className="text-lg font-semibold text-blue-400">{rotation}°</span>
            </div>

            {/* 旋轉滑桿 */}
            <Slider
              value={rotation}
              min={-180}
              max={180}
              step={1}
              onChange={onRotationChange}
              disabled={disabled}
              showValue={false}
            />

            {/* 旋轉按鈕 */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => onRotationChange(rotation - 90)}
                disabled={disabled}
                className="flex items-center justify-center gap-2 h-12 bg-slate-800/50 hover:bg-slate-700/50 rounded-xl text-slate-300 transition-colors disabled:opacity-50"
              >
                <RotateCcw className="w-5 h-5" />
                <span className="text-sm">左轉 90°</span>
              </button>
              <button
                type="button"
                onClick={() => onRotationChange(rotation + 90)}
                disabled={disabled}
                className="flex items-center justify-center gap-2 h-12 bg-slate-800/50 hover:bg-slate-700/50 rounded-xl text-slate-300 transition-colors disabled:opacity-50"
              >
                <RotateCw className="w-5 h-5" />
                <span className="text-sm">右轉 90°</span>
              </button>
            </div>

            {/* 翻轉按鈕 */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={onFlipHorizontal}
                disabled={disabled}
                className="flex items-center justify-center gap-2 h-12 bg-slate-800/50 hover:bg-slate-700/50 rounded-xl text-slate-300 transition-colors disabled:opacity-50"
              >
                <FlipHorizontal className="w-5 h-5" />
                <span className="text-sm">水平翻轉</span>
              </button>
              <button
                type="button"
                onClick={onFlipVertical}
                disabled={disabled}
                className="flex items-center justify-center gap-2 h-12 bg-slate-800/50 hover:bg-slate-700/50 rounded-xl text-slate-300 transition-colors disabled:opacity-50"
              >
                <FlipVertical className="w-5 h-5" />
                <span className="text-sm">垂直翻轉</span>
              </button>
            </div>

            {/* 重置按鈕 */}
            <button
              type="button"
              onClick={() => onRotationChange(0)}
              disabled={disabled || rotation === 0}
              className="w-full h-10 flex items-center justify-center bg-slate-800/30 hover:bg-slate-700/30 rounded-xl text-slate-400 text-sm transition-colors disabled:opacity-50"
            >
              重置角度
            </button>
          </div>
        );

      case 'quality':
        return (
          <div className="space-y-4">
            <Slider
              label="壓縮品質"
              value={quality}
              min={1}
              max={100}
              onChange={onQualityChange}
              disabled={disabled}
              valueFormatter={(v) => `${v}%`}
            />
            <div className="flex justify-between text-xs text-slate-500">
              <span>小檔案</span>
              <span>高品質</span>
            </div>
          </div>
        );

      case 'format':
        return (
          <div className="space-y-3">
            <span className="text-sm text-slate-400">輸出格式</span>
            <div className="grid grid-cols-2 gap-2">
              {OUTPUT_FORMATS.map((format) => (
                <button
                  key={format.value}
                  type="button"
                  onClick={() => onFormatChange(format.value)}
                  disabled={disabled}
                  className={`
                    h-12 rounded-xl text-sm font-medium transition-all
                    ${outputFormat === format.value
                      ? 'bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/50'
                      : 'bg-slate-800/50 text-slate-300 hover:bg-slate-700/50'
                    }
                    disabled:opacity-50
                  `}
                >
                  {format.label}
                </button>
              ))}
            </div>
          </div>
        );

      default:
        return (
          <p className="text-sm text-slate-500 text-center py-4">
            選擇上方工具開始編輯
          </p>
        );
    }
  };

  return (
    <>
      {/* Desktop Sidebar - Left Side */}
      <aside className="hidden lg:flex flex-col w-80 bg-slate-900/50 backdrop-blur-xl border-r border-slate-800/50 order-first">
        {/* 工具按鈕列 */}
        <div className="p-4 border-b border-slate-800/50">
          <div className="flex justify-center gap-2">
            <ToolButton
              icon={Crop}
              label="裁切"
              active={activeTool === 'crop'}
              onClick={() => handleToolSelect('crop')}
              disabled={disabled}
            />
            <ToolButton
              icon={RotateCw}
              label="旋轉"
              active={activeTool === 'rotate'}
              onClick={() => handleToolSelect('rotate')}
              disabled={disabled}
            />
            <ToolButton
              icon={Sliders}
              label="品質"
              active={activeTool === 'quality'}
              onClick={() => handleToolSelect('quality')}
              disabled={disabled}
            />
            <ToolButton
              icon={FileImage}
              label="格式"
              active={activeTool === 'format'}
              onClick={() => handleToolSelect('format')}
              disabled={disabled}
            />
          </div>
        </div>

        {/* 工具設定區 */}
        <div className="flex-1 p-4 overflow-y-auto">
          {renderToolSettings()}
        </div>

        {/* 底部操作區 */}
        <div className="p-4 border-t border-slate-800/50 space-y-3">
          {/* 套用變更按鈕 - 只有在開啟工具時顯示 */}
          {isToolActive && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCancel}
                disabled={isProcessing}
                className="flex-1 h-12 flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-xl transition-colors disabled:opacity-50"
              >
                <ChevronLeft className="w-5 h-5" />
                <span>返回</span>
              </button>
              <button
                type="button"
                onClick={onProcess}
                disabled={isProcessing || disabled}
                className="flex-1 h-12 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>{processingStatus === 'uploading' ? `${progress}%` : '...'}</span>
                  </>
                ) : (
                  <span>套用</span>
                )}
              </button>
            </div>
          )}

          {/* 下載按鈕 - 總是顯示，但在沒有處理過的圖片時禁用 */}
          <button
            type="button"
            onClick={onDownload}
            disabled={!hasProcessedImage}
            className="w-full h-12 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 text-white font-medium rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-green-600"
          >
            <Download className="w-5 h-5" />
            <span>下載圖片</span>
          </button>
        </div>
      </aside>

      {/* Mobile Bottom Drawer */}
      <div className="lg:hidden fixed inset-x-0 bottom-0 z-50">
        {/* Backdrop when expanded */}
        {isExpanded && isToolActive && (
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setIsExpanded(false)}
          />
        )}

        <div
          className={`
            relative bg-slate-900/95 backdrop-blur-xl border-t border-slate-800/50
            rounded-t-3xl transition-all duration-300 ease-out
            ${isExpanded && isToolActive ? 'max-h-[70vh]' : 'max-h-50'}
          `}
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {/* Handle bar */}
          <div
            className="flex justify-center py-2 cursor-pointer"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <div className="w-10 h-1 bg-slate-600 rounded-full" />
          </div>

          {/* 工具按鈕列 */}
          <div className="px-4 pb-3">
            <div className="flex justify-center gap-2">
              <ToolButton
                icon={Crop}
                label="裁切"
                active={activeTool === 'crop'}
                onClick={() => {
                  handleToolSelect('crop');
                  setIsExpanded(true);
                }}
                disabled={disabled}
              />
              <ToolButton
                icon={RotateCw}
                label="旋轉"
                active={activeTool === 'rotate'}
                onClick={() => {
                  handleToolSelect('rotate');
                  setIsExpanded(true);
                }}
                disabled={disabled}
              />
              <ToolButton
                icon={Sliders}
                label="品質"
                active={activeTool === 'quality'}
                onClick={() => {
                  handleToolSelect('quality');
                  setIsExpanded(true);
                }}
                disabled={disabled}
              />
              <ToolButton
                icon={FileImage}
                label="格式"
                active={activeTool === 'format'}
                onClick={() => {
                  handleToolSelect('format');
                  setIsExpanded(true);
                }}
                disabled={disabled}
              />
            </div>
          </div>

          {/* 工具設定區 (展開時顯示) */}
          {isExpanded && isToolActive && (
            <div className="px-4 pb-4 overflow-y-auto max-h-[40vh]">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">
                  {activeTool === 'crop' && '裁切設定'}
                  {activeTool === 'rotate' && '旋轉設定'}
                  {activeTool === 'quality' && '品質設定'}
                  {activeTool === 'format' && '格式設定'}
                </h3>
                <button
                  type="button"
                  onClick={onCancel}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-800/50 text-slate-400"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {renderToolSettings()}
            </div>
          )}

          {/* 操作按鈕 */}
          <div className="px-4 pb-4 flex gap-3">
            {/* 套用按鈕 - 只有在開啟工具時顯示 */}
            {isToolActive && (
              <button
                type="button"
                onClick={onProcess}
                disabled={isProcessing || disabled}
                className="flex-1 h-12 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>{processingStatus === 'uploading' ? `${progress}%` : '...'}</span>
                  </>
                ) : (
                  <span>套用</span>
                )}
              </button>
            )}

            {/* 下載按鈕 - 總是顯示 */}
            <button
              type="button"
              onClick={onDownload}
              disabled={!hasProcessedImage}
              className={`
                h-12 flex items-center justify-center gap-2 bg-green-600 text-white font-medium rounded-xl transition-colors
                disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-green-600
                ${isToolActive ? 'px-6' : 'flex-1'}
                ${hasProcessedImage ? 'hover:bg-green-500' : ''}
              `}
            >
              <Download className="w-5 h-5" />
              {!isToolActive && <span>下載圖片</span>}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default ToolPanel;
