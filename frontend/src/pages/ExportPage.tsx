import { useState, useMemo } from "react";
import { PreviewWorkspace } from "../components/PreviewWorkspace";
import { DarkEditableNumber } from "../components/DarkEditableNumber";
import { generateCroppedImage } from "../utils/generateCroppedImage";
import { getCroppedOriginalSize } from "../utils/containerParams";
import type { PipelineState, OutputSettings } from "../types";

interface ExportPageProps {
  imageSrc: string;
  imageRef: React.MutableRefObject<HTMLImageElement | null>;
  pipelineState: PipelineState;
  setPipelineState: React.Dispatch<
    React.SetStateAction<PipelineState | null>
  >;
  onReturn: () => void;
}

export function ExportPage({
  imageSrc,
  imageRef,
  pipelineState,
  setPipelineState,
  onReturn,
}: ExportPageProps) {
  const [isExporting, setIsExporting] = useState(false);

  // 初始化輸出設定 (進入時計算一次)
  const initialSettings = useMemo<OutputSettings>(() => {
    const { editorState, imageInfo } = pipelineState;
    const croppedSize = getCroppedOriginalSize(editorState, imageInfo);

    return {
      targetWidth: croppedSize.width,
      targetHeight: croppedSize.height,
      lockAspectRatio: true,
      format: "png",
      baseWidth: croppedSize.width,
      baseHeight: croppedSize.height,
      quality: 92,
      targetKB: null,
      enableTargetKB: false,
      lastExportSize: pipelineState.previewBlob?.size ?? null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 只在 mount 時計算一次

  const [outputSettings, setOutputSettings] =
    useState<OutputSettings>(initialSettings);

  // 更新輸出設定
  const handleUpdateOutputSettings = (
    updates: Partial<OutputSettings>,
  ) => {
    setOutputSettings((prev) => ({ ...prev, ...updates }));
  };

  // 套用輸出設定並生成最終圖片
  const handleApplyOutput = async () => {
    if (!imageRef.current || isExporting) return;

    setIsExporting(true);
    try {
      const { editorState, imageInfo } = pipelineState;
      const {
        targetWidth,
        targetHeight,
        format,
        quality,
        enableTargetKB,
        targetKB,
      } = outputSettings;

      const mimeType =
        format === "png"
          ? "image/png"
          : format === "jpeg"
            ? "image/jpeg"
            : "image/webp";

      let result: Awaited<ReturnType<typeof generateCroppedImage>>;
      let finalQuality = quality / 100;

      if (enableTargetKB && targetKB && format !== "png") {
        const targetBytes = targetKB * 1024;
        let minQuality = 0.1;
        let maxQuality = 1.0;
        let attempts = 0;
        const maxAttempts = 10;

        result = await generateCroppedImage(
          imageRef.current,
          editorState,
          imageInfo,
          {
            targetWidth,
            targetHeight,
            format: mimeType,
            quality: maxQuality,
          },
        );

        if (result.blob.size <= targetBytes) {
          finalQuality = maxQuality;
        } else {
          while (
            attempts < maxAttempts &&
            maxQuality - minQuality > 0.02
          ) {
            const midQuality = (minQuality + maxQuality) / 2;
            result = await generateCroppedImage(
              imageRef.current,
              editorState,
              imageInfo,
              {
                targetWidth,
                targetHeight,
                format: mimeType,
                quality: midQuality,
              },
            );

            if (result.blob.size > targetBytes) {
              maxQuality = midQuality;
            } else {
              minQuality = midQuality;
            }
            attempts++;
          }
          finalQuality = minQuality;

          result = await generateCroppedImage(
            imageRef.current,
            editorState,
            imageInfo,
            {
              targetWidth,
              targetHeight,
              format: mimeType,
              quality: finalQuality,
            },
          );
        }
      } else {
        result = await generateCroppedImage(
          imageRef.current,
          editorState,
          imageInfo,
          {
            targetWidth,
            targetHeight,
            format: mimeType,
            quality: finalQuality,
          },
        );
      }

      setPipelineState((prev) => ({
        ...prev!,
        previewUrl: result.dataUrl,
        previewBlob: result.blob,
        outputWidth: result.width,
        outputHeight: result.height,
      }));

      setOutputSettings((prev) => ({
        ...prev,
        lastExportSize: result.blob.size,
      }));

      console.log(
        "輸出尺寸:",
        result.width,
        "×",
        result.height,
        "檔案大小:",
        (result.blob.size / 1024).toFixed(1),
        "KB",
      );
    } catch (error) {
      console.error("套用輸出設定失敗:", error);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="h-screen flex overflow-hidden bg-sidebar">
      {/* ===== 左側 Sidebar ===== */}
      <aside className="w-[30%] min-w-[240px] max-w-[320px] flex flex-col h-screen sticky top-0 sidebar-scroll overflow-y-auto bg-sidebar">
        {/* 頂部: 標題 */}
        <div className="p-4 pb-2">
          <h1 className="text-lg font-bold text-white">圖片處理工具</h1>
          <p className="text-xs text-white/70 mt-1 font-mono">
            {pipelineState.imageInfo.naturalWidth} ×{" "}
            {pipelineState.imageInfo.naturalHeight} px
          </p>
        </div>

        {/* 中部: 輸出設定面板 */}
        <div className="flex-1 p-4 pt-2 flex flex-col gap-3">
          <OutputSettingsPanel
            settings={outputSettings}
            onUpdateSettings={handleUpdateOutputSettings}
            onApply={handleApplyOutput}
            onReturn={onReturn}
            isExporting={isExporting}
            previewUrl={pipelineState.previewUrl}
            previewBlob={pipelineState.previewBlob}
          />
        </div>
      </aside>

      {/* ===== 右側預覽區 ===== */}
      <main className="flex-1 bg-preview flex items-center justify-center m-4 rounded-lg">
        <PreviewWorkspace
          editorState={null}
          imageInfo={null}
          originalSrc={imageSrc}
          previewUrl={pipelineState.previewUrl}
          isProcessing={isExporting}
          mode="output"
          outputWidth={pipelineState.outputWidth}
          outputHeight={pipelineState.outputHeight}
          visualBaseRotate={0}
        />
      </main>
    </div>
  );
}

// ============================================================
// Sub-component
// ============================================================

/** 輸出設定面板 (Output mode) */
function OutputSettingsPanel({
  settings,
  onUpdateSettings,
  onApply,
  onReturn,
  isExporting,
  previewUrl,
  previewBlob,
}: {
  settings: OutputSettings;
  onUpdateSettings: (updates: Partial<OutputSettings>) => void;
  onApply: () => void;
  onReturn: () => void;
  isExporting: boolean;
  previewUrl: string | null;
  previewBlob: Blob | null;
}) {
  const [widthInput, setWidthInput] = useState(
    String(settings.targetWidth),
  );
  const [heightInput, setHeightInput] = useState(
    String(settings.targetHeight),
  );
  const [widthError, setWidthError] = useState(false);
  const [heightError, setHeightError] = useState(false);

  const [isPdfExporting, setIsPdfExporting] = useState(false);
  const [downloadFormat, setDownloadFormat] = useState<"image" | "pdf">(
    "image",
  );

  const { baseWidth, baseHeight, lockAspectRatio, format } = settings;

  // 下載處理 (圖片 or PDF)
  const handleDownload = async () => {
    if (downloadFormat === "pdf") {
      if (!previewBlob || isPdfExporting) return;
      setIsPdfExporting(true);
      try {
        const { exportPdf } = await import("../api/exportPdf");
        const pdfBlob = await exportPdf([previewBlob], "export.pdf");
        const url = URL.createObjectURL(pdfBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "export.pdf";
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error("PDF 匯出失敗:", err);
      } finally {
        setIsPdfExporting(false);
      }
    } else {
      if (!previewUrl) return;
      const a = document.createElement("a");
      a.href = previewUrl;
      a.download = `processed-image.${format}`;
      a.click();
    }
  };

  // 處理寬度輸入變更
  const handleWidthInputChange = (value: string) => {
    setWidthInput(value);
    setWidthError(false);

    const num = parseInt(value);
    if (!isNaN(num) && num >= 1) {
      if (lockAspectRatio) {
        const aspectRatio = baseHeight / baseWidth;
        const newHeight = Math.round(num * aspectRatio);
        setHeightInput(String(Math.max(1, newHeight)));
        onUpdateSettings({
          targetWidth: num,
          targetHeight: Math.max(1, newHeight),
        });
      } else {
        onUpdateSettings({ targetWidth: num });
      }
    }
  };

  // 處理高度輸入變更
  const handleHeightInputChange = (value: string) => {
    setHeightInput(value);
    setHeightError(false);

    const num = parseInt(value);
    if (!isNaN(num) && num >= 1) {
      if (lockAspectRatio) {
        const aspectRatio = baseWidth / baseHeight;
        const newWidth = Math.round(num * aspectRatio);
        setWidthInput(String(Math.max(1, newWidth)));
        onUpdateSettings({
          targetWidth: Math.max(1, newWidth),
          targetHeight: num,
        });
      } else {
        onUpdateSettings({ targetHeight: num });
      }
    }
  };

  // 寬度失焦驗證
  const handleWidthBlur = () => {
    const num = parseInt(widthInput);
    if (isNaN(num) || num < 1 || widthInput.trim() === "") {
      setWidthError(true);
      setWidthInput(String(settings.targetWidth));
    }
  };

  // 高度失焦驗證
  const handleHeightBlur = () => {
    const num = parseInt(heightInput);
    if (isNaN(num) || num < 1 || heightInput.trim() === "") {
      setHeightError(true);
      setHeightInput(String(settings.targetHeight));
    }
  };

  // 重設為原始尺寸
  const handleResetSize = () => {
    setWidthInput(String(baseWidth));
    setHeightInput(String(baseHeight));
    setWidthError(false);
    setHeightError(false);
    onUpdateSettings({
      targetWidth: baseWidth,
      targetHeight: baseHeight,
    });
  };

  const isModified =
    settings.targetWidth !== baseWidth ||
    settings.targetHeight !== baseHeight;
  const hasError = widthError || heightError;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-white font-medium">輸出設定</p>

      {/* 下載格式 */}
      <div className="bg-white/10 rounded-[10px] p-3">
        <p className="text-xs text-white/70 mb-3 font-medium">下載格式</p>
        <div className="flex gap-2">
          {(
            [
              ["image", "圖片"],
              ["pdf", "PDF"],
            ] as const
          ).map(([val, label]) => (
            <button
              key={val}
              onClick={() => setDownloadFormat(val)}
              className={`flex-1 px-2 py-1.5 text-sm rounded-[10px] transition-colors ${
                downloadFormat === val
                  ? "bg-highlight text-black font-medium"
                  : "bg-white/10 text-white/80 hover:bg-white/20"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 調整尺寸 */}
      <div className="bg-white/10 rounded-[10px] p-3">
        <p className="text-xs text-white/70 mb-3 font-medium">調整尺寸</p>

        {/* 寬度輸入 */}
        <div className="flex items-center gap-2 mb-2">
          <label className="text-sm text-white/80 w-8 shrink-0">寬</label>
          <input
            type="number"
            min={1}
            value={widthInput}
            onChange={(e) => handleWidthInputChange(e.target.value)}
            onBlur={handleWidthBlur}
            className={`w-20 min-w-0 px-2 py-1 rounded-lg text-sm focus:outline-none ${
              widthError
                ? "border border-red-500 bg-red-500/10 text-red-300"
                : "input-dark"
            }`}
          />
          <span className="text-xs text-white/60 shrink-0">px</span>
        </div>

        {/* 高度輸入 */}
        <div className="flex items-center gap-2 mb-1">
          <label className="text-sm text-white/80 w-8 shrink-0">高</label>
          <input
            type="number"
            min={1}
            value={heightInput}
            onChange={(e) => handleHeightInputChange(e.target.value)}
            onBlur={handleHeightBlur}
            className={`w-20 min-w-0 px-2 py-1 rounded-lg text-sm focus:outline-none ${
              heightError
                ? "border border-red-500 bg-red-500/10 text-red-300"
                : "input-dark"
            }`}
          />
          <span className="text-xs text-white/60 shrink-0">px</span>
        </div>

        {/* 錯誤訊息 */}
        {hasError && (
          <p className="text-xs text-red-400 mb-2">
            尺寸不得為空或小於 1
          </p>
        )}

        {/* 鎖定比例開關 */}
        <div className="flex items-center justify-between mb-3 mt-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-white/80">鎖定比例</span>
            {lockAspectRatio && (
              <span className="text-xs text-white/60">
                ({baseWidth}:{baseHeight})
              </span>
            )}
          </div>
          <button
            onClick={() =>
              onUpdateSettings({ lockAspectRatio: !lockAspectRatio })
            }
            className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
              lockAspectRatio ? "bg-highlight" : "bg-white/20"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full shadow transition-transform ${
                lockAspectRatio
                  ? "translate-x-4 bg-black"
                  : "translate-x-0 bg-white"
              }`}
            />
          </button>
        </div>

        {/* 重設按鈕 */}
        {isModified && (
          <button
            onClick={handleResetSize}
            className="w-full px-3 py-1.5 text-sm text-white/70 hover:text-white border border-white/20 rounded-[10px] transition-colors"
          >
            重設為原始尺寸
          </button>
        )}
      </div>

      {/* 匯出格式 */}
      <div
        className={`bg-white/10 rounded-[10px] p-3 transition-opacity ${downloadFormat === "pdf" ? "opacity-40 pointer-events-none" : ""}`}
      >
        <p className="text-xs text-white/70 mb-3 font-medium">匯出格式</p>

        <div className="flex gap-2 mb-3">
          {(["png", "jpeg", "webp"] as const).map((fmt) => (
            <button
              key={fmt}
              onClick={() => onUpdateSettings({ format: fmt })}
              className={`flex-1 px-2 py-1.5 text-sm rounded-[10px] transition-colors ${
                format === fmt
                  ? "bg-highlight text-black font-medium"
                  : "bg-white/10 text-white/80 hover:bg-white/20"
              }`}
            >
              {fmt.toUpperCase()}
            </button>
          ))}
        </div>

        {/* PNG 說明 */}
        {format === "png" && (
          <p className="text-xs text-white/60 mb-3">
            PNG 為無損格式，不支援品質調整
          </p>
        )}

        {/* 壓縮模式切換 (僅 JPEG/WebP) */}
        {format !== "png" && (
          <div className="pt-3 border-t border-white/10">
            {/* 模式選擇按鈕 */}
            <div className="flex gap-1 mb-3 bg-white/5 rounded-lg p-0.5">
              <button
                onClick={() =>
                  onUpdateSettings({ enableTargetKB: false })
                }
                className={`flex-1 px-2 py-1 text-xs rounded-md transition-colors ${
                  !settings.enableTargetKB
                    ? "bg-white/20 text-white font-medium"
                    : "text-white/70 hover:text-white"
                }`}
              >
                品質控制
              </button>
              <button
                onClick={() =>
                  onUpdateSettings({ enableTargetKB: true })
                }
                className={`flex-1 px-2 py-1 text-xs rounded-md transition-colors ${
                  settings.enableTargetKB
                    ? "bg-white/20 text-white font-medium"
                    : "text-white/70 hover:text-white"
                }`}
              >
                限制檔案大小
              </button>
            </div>

            {/* 品質滑桿 */}
            {!settings.enableTargetKB && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-white/70">品質</span>
                  <DarkEditableNumber
                    value={settings.quality}
                    min={10}
                    max={100}
                    suffix="%"
                    onChange={(val) =>
                      onUpdateSettings({ quality: val })
                    }
                  />
                </div>
                <input
                  type="range"
                  min={10}
                  max={100}
                  step={1}
                  value={settings.quality}
                  onChange={(e) =>
                    onUpdateSettings({
                      quality: parseInt(e.target.value),
                    })
                  }
                  className="w-full slider-dark"
                />
                <div className="flex justify-between text-[10px] text-white/60 mt-0.5">
                  <span>小檔案</span>
                  <span>高品質</span>
                </div>
              </div>
            )}

            {/* 目標 KB 輸入 */}
            {settings.enableTargetKB && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-white/70">目標</span>
                <input
                  type="number"
                  min={1}
                  max={10000}
                  value={settings.targetKB ?? ""}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    onUpdateSettings({
                      targetKB: isNaN(val)
                        ? null
                        : Math.max(1, val),
                    });
                  }}
                  placeholder="KB"
                  className="w-20 px-2 py-1 text-sm input-dark"
                />
                <span className="text-xs text-white/60">KB</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 狀態資訊 */}
      <div className="text-xs text-white/70 font-mono space-y-1 p-2">
        <div>
          原始尺寸: {baseWidth} × {baseHeight} px
        </div>
        {isModified && (
          <div className="text-highlight">
            輸出尺寸: {settings.targetWidth} × {settings.targetHeight}{" "}
            px
          </div>
        )}
        {settings.lastExportSize !== null && (
          <div className="text-highlight/70">
            檔案大小: {(settings.lastExportSize / 1024).toFixed(1)} KB
          </div>
        )}
      </div>

      {/* 操作按鈕 */}
      <div className="flex flex-col gap-2 mt-auto pt-4">
        <button
          onClick={onApply}
          disabled={isExporting}
          className="w-full px-4 py-2 bg-highlight text-black font-bold rounded-[10px] transition-all btn-highlight disabled:opacity-30"
        >
          {isExporting ? "處理中..." : "套用並預覽"}
        </button>
        {(previewUrl || previewBlob) && (
          <button
            onClick={handleDownload}
            disabled={isPdfExporting}
            className="w-full px-4 py-2 text-center text-white/80 hover:text-white border border-white/20 rounded-[10px] transition-colors disabled:opacity-30"
          >
            {isPdfExporting
              ? "匯出中..."
              : downloadFormat === "pdf"
                ? "下載 PDF"
                : "下載圖片"}
          </button>
        )}
        <button
          onClick={onReturn}
          disabled={isExporting}
          className="w-full px-4 py-2 text-white/80 hover:text-white transition-colors"
        >
          返回裁切
        </button>
      </div>
    </div>
  );
}
