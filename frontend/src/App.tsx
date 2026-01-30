import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { DropZone } from './components/DropZone';
import { ImageViewer } from './components/ImageViewer';
import type { CropCoordinates, ViewMode } from './components/ImageViewer';
import { ToolPanel } from './components/ToolPanel';
import type { ActiveTool } from './components/ToolPanel';
import { processImage, downloadBlob, getImageInfo } from './api/imageApi';
import type { ImageInfoResponse } from './api/imageApi';

type ProcessingStatus = 'idle' | 'uploading' | 'processing' | 'done' | 'error';

function App() {
  // 原始檔案狀態
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [originalInfo, setOriginalInfo] = useState<ImageInfoResponse | null>(null);

  // 處理後狀態
  const [processedBlob, setProcessedBlob] = useState<Blob | null>(null);
  const [processedFilename, setProcessedFilename] = useState<string>('');

  // 處理選項
  const [outputFormat, setOutputFormat] = useState<string>('');
  const [quality, setQuality] = useState<number>(95);

  // 編輯狀態
  const [cropCoordinates, setCropCoordinates] = useState<CropCoordinates | null>(null);
  const [rotation, setRotation] = useState<number>(0);
  const [flipH, setFlipH] = useState<boolean>(false);
  const [flipV, setFlipV] = useState<boolean>(false);

  // 儲存進入工具時的狀態，用於取消時恢復
  const savedStateRef = useRef<{
    rotation: number;
    quality: number;
    outputFormat: string;
    cropCoordinates: CropCoordinates | null;
  } | null>(null);

  // UI 狀態
  const [activeTool, setActiveTool] = useState<ActiveTool>('none');
  const [status, setStatus] = useState<ProcessingStatus>('idle');
  const [progress, setProgress] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string>('');

  // 將原始檔案轉換為 URL
  const originalImageSrc = useMemo(() => {
    if (originalFile) {
      return URL.createObjectURL(originalFile);
    }
    return '';
  }, [originalFile]);

  // 將處理後的 Blob 轉換為 URL
  const processedImageSrc = useMemo(() => {
    if (processedBlob) {
      return URL.createObjectURL(processedBlob);
    }
    return '';
  }, [processedBlob]);

  // 清理 Object URL
  useEffect(() => {
    return () => {
      if (originalImageSrc) {
        URL.revokeObjectURL(originalImageSrc);
      }
    };
  }, [originalImageSrc]);

  useEffect(() => {
    return () => {
      if (processedImageSrc) {
        URL.revokeObjectURL(processedImageSrc);
      }
    };
  }, [processedImageSrc]);

  // 監聽編輯狀態變化並輸出到 console (測試用)
  useEffect(() => {
    console.log('[編輯狀態變更]', {
      cropCoordinates,
      rotation,
      flipH,
      flipV,
      quality,
      outputFormat,
    });
  }, [cropCoordinates, rotation, flipH, flipV, quality, outputFormat]);

  // 處理檔案選擇
  const handleFileSelect = useCallback(async (file: File) => {
    setOriginalFile(file);
    setProcessedBlob(null);
    setErrorMessage('');
    setStatus('idle');
    setActiveTool('none');
    // 重置編輯狀態
    setCropCoordinates(null);
    setRotation(0);
    setFlipH(false);
    setFlipV(false);

    // 取得原始圖片資訊
    try {
      const info = await getImageInfo(file);
      setOriginalInfo(info);
    } catch {
      setOriginalInfo(null);
    }
  }, []);

  // 處理裁切座標變更
  const handleCropChange = useCallback((coordinates: CropCoordinates | null) => {
    setCropCoordinates(coordinates);
  }, []);

  // 處理旋轉角度變更 (支援任意角度，不標準化)
  const handleRotationChange = useCallback((angle: number) => {
    // 限制在 -180 到 180 之間
    let normalized = angle;
    while (normalized > 180) normalized -= 360;
    while (normalized < -180) normalized += 360;
    setRotation(normalized);
  }, []);

  // 處理翻轉
  const handleFlipHorizontal = useCallback(() => {
    setFlipH((prev) => !prev);
  }, []);

  const handleFlipVertical = useCallback(() => {
    setFlipV((prev) => !prev);
  }, []);

  // 處理工具切換 - 進入工具時儲存狀態
  const handleToolChange = useCallback((tool: ActiveTool) => {
    if (tool !== 'none' && activeTool === 'none') {
      // 進入工具模式時，儲存當前狀態
      savedStateRef.current = {
        rotation,
        quality,
        outputFormat,
        cropCoordinates,
      };
    }
    setActiveTool(tool);
  }, [activeTool, rotation, quality, outputFormat, cropCoordinates]);

  // 取消變更 - 恢復到進入工具時的狀態
  const handleCancel = useCallback(() => {
    if (savedStateRef.current) {
      setRotation(savedStateRef.current.rotation);
      setQuality(savedStateRef.current.quality);
      setOutputFormat(savedStateRef.current.outputFormat);
      setCropCoordinates(savedStateRef.current.cropCoordinates);
      savedStateRef.current = null;
    }
    setActiveTool('none');
  }, []);

  // 處理圖片 - 傳送裁切和旋轉參數到後端
  const handleProcess = useCallback(async () => {
    if (!originalFile) return;

    setStatus('uploading');
    setProgress(0);
    setErrorMessage('');

    try {
      const result = await processImage(
        {
          file: originalFile,
          outputFormat: outputFormat || undefined,
          quality,
          // 旋轉參數 - 需要 expand 以避免裁切
          rotateAngle: rotation !== 0 ? rotation : undefined,
          rotateExpand: rotation !== 0 ? true : undefined,
          // 裁切參數
          cropX: cropCoordinates?.x,
          cropY: cropCoordinates?.y,
          cropWidth: cropCoordinates?.width,
          cropHeight: cropCoordinates?.height,
        },
        (p) => {
          setProgress(p);
          if (p >= 100) {
            setStatus('processing');
          }
        }
      );

      setProcessedBlob(result.blob);
      setProcessedFilename(result.filename);
      setStatus('done');
      // 處理完成後關閉工具面板並清除儲存的狀態
      setActiveTool('none');
      savedStateRef.current = null;
      // 保留編輯參數，以便下次進入裁切模式時套用
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : '處理失敗，請稍後再試');
    }
  }, [originalFile, outputFormat, quality, rotation, cropCoordinates]);

  // 下載處理後的圖片
  const handleDownload = useCallback(() => {
    if (processedBlob && processedFilename) {
      downloadBlob(processedBlob, processedFilename);
    }
  }, [processedBlob, processedFilename]);

  // 重置
  const handleReset = useCallback(() => {
    setOriginalFile(null);
    setOriginalInfo(null);
    setProcessedBlob(null);
    setStatus('idle');
    setProgress(0);
    setErrorMessage('');
    setCropCoordinates(null);
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    setActiveTool('none');
    savedStateRef.current = null;
  }, []);

  const isProcessing = status === 'uploading' || status === 'processing';

  // 根據當前工具決定 ImageViewer 模式
  const viewMode: ViewMode = activeTool === 'crop' ? 'crop' : 'view';

  // 決定要顯示的圖片
  // 裁切模式下始終使用原始圖片，以便重新編輯
  // 非裁切模式下，如果有處理過的圖片且沒有進行新的編輯，顯示處理後的圖片
  const isEditing = activeTool !== 'none';
  const displayImageSrc = isEditing ? originalImageSrc : (processedBlob ? processedImageSrc : originalImageSrc);
  // 編輯中顯示旋轉預覽，處理完成後不顯示（因為已經套用）
  const displayRotation = isEditing ? rotation : 0;

  return (
    <div className="h-dvh flex flex-col bg-slate-950 overflow-hidden">
      {/* 頂部導航列 */}
      <header
        className="shrink-0 bg-slate-900/80 backdrop-blur-xl border-b border-slate-800/50"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="h-12 px-4 flex items-center justify-between">
          <h1 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <ImagePlus className="w-5 h-5 text-blue-500" strokeWidth={1.5} />
            <span className="hidden sm:inline">圖片處理工具</span>
          </h1>

          <div className="flex items-center gap-3">
            {originalInfo && (
              <span className="text-xs text-slate-500 hidden sm:block">
                {originalInfo.width} x {originalInfo.height} | {originalInfo.format}
              </span>
            )}

            {originalFile && (
              <button
                onClick={handleReset}
                className="min-w-11 min-h-11 flex items-center justify-center text-slate-400 hover:text-slate-200 transition-colors"
                aria-label="重新選擇"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* 主要內容區 */}
      <div className="flex-1 flex overflow-hidden">
        {!originalFile ? (
          // 上傳區 - 全屏居中
          <div className="flex-1 flex items-center justify-center p-4 lg:p-8">
            <div className="w-full max-w-xl">
              <DropZone onFileSelect={handleFileSelect} disabled={isProcessing} />
            </div>
          </div>
        ) : (
          <>
            {/* 工具面板 - 左側邊欄(桌面) / 底部抽屜(手機) */}
            <ToolPanel
              rotation={rotation}
              quality={quality}
              outputFormat={outputFormat}
              cropCoordinates={cropCoordinates}
              activeTool={activeTool}
              onRotationChange={handleRotationChange}
              onQualityChange={setQuality}
              onFormatChange={setOutputFormat}
              onToolChange={handleToolChange}
              onFlipHorizontal={handleFlipHorizontal}
              onFlipVertical={handleFlipVertical}
              onProcess={handleProcess}
              onDownload={handleDownload}
              onCancel={handleCancel}
              isProcessing={isProcessing}
              hasProcessedImage={!!processedBlob}
              progress={progress}
              processingStatus={status}
              disabled={isProcessing}
            />

            {/* 圖片預覽區 - 無圓角 */}
            <main className="flex-1 relative overflow-hidden lg:pb-0 pb-45">
              <ImageViewer
                imageSrc={displayImageSrc}
                rotation={displayRotation}
                mode={viewMode}
                initialCropCoordinates={cropCoordinates}
                onCropChange={handleCropChange}
              />

              {/* 處理完成提示 */}
              {status === 'done' && processedBlob && activeTool === 'none' && (
                <div className="absolute top-3 right-3 bg-green-500/90 backdrop-blur-sm rounded-lg px-3 py-1.5">
                  <span className="text-xs text-white font-medium">
                    已套用變更
                  </span>
                </div>
              )}

              {/* 錯誤訊息覆蓋層 */}
              {status === 'error' && (
                <div className="absolute bottom-4 left-4 right-4 lg:right-auto lg:max-w-md">
                  <div className="bg-red-500/90 backdrop-blur-sm rounded-xl p-4 text-white text-sm shadow-xl">
                    {errorMessage}
                  </div>
                </div>
              )}

              {/* 圖片資訊 (手機端) */}
              {originalInfo && (
                <div className="lg:hidden absolute top-3 left-3 bg-slate-900/70 backdrop-blur-sm rounded-lg px-2.5 py-1.5">
                  <span className="text-xs text-slate-300 font-mono">
                    {originalInfo.width} x {originalInfo.height}
                  </span>
                </div>
              )}
            </main>
          </>
        )}
      </div>
    </div>
  );
}

export default App;
