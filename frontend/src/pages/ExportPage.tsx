import { useState, useMemo, useRef, useCallback, useEffect, useLayoutEffect } from "react";
import { PreviewWorkspace } from "../components/PreviewWorkspace";
import { DarkEditableNumber } from "../components/DarkEditableNumber";
import { generateCroppedImage } from "../utils/generateCroppedImage";
import { getCroppedOriginalSize } from "../utils/containerParams";
import type { OutputSettings, ImageItem, ExportFormat } from "../types";
import logoImg from "../assets/pic_logo.png";
import { ConfirmModal } from "../components/ConfirmModal";

interface ExportPageProps {
  images: ImageItem[];
  activeImageId: string;
  onSelectImage: (id: string) => void;
  setImages: React.Dispatch<React.SetStateAction<ImageItem[]>>;
  onReturn: () => void;
  onReset: () => void;
}

export function ExportPage({
  images,
  activeImageId,
  onSelectImage,
  setImages,
  onReturn,
  onReset,
}: ExportPageProps) {
  const [unifiedOutput, setUnifiedOutput] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const unifiedOutputRef = useRef(unifiedOutput);
  unifiedOutputRef.current = unifiedOutput;

  // ── 限制檔案大小的範圍：單張 / 全部 ──
  const [targetKBScope, setTargetKBScope] = useState<"single" | "all">("single");
  const targetKBScopeRef = useRef(targetKBScope);
  targetKBScopeRef.current = targetKBScope;
  const handleSetTargetKBScope = useCallback((scope: "single" | "all") => {
    targetKBScopeRef.current = scope;
    setTargetKBScope(scope);
  }, []);


  // ── 預覽區域容器尺寸追蹤 ──
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 800, height: 600 });

  useLayoutEffect(() => {
    const el = previewContainerRef.current;
    if (!el) return;
    const { offsetWidth, offsetHeight } = el;
    if (offsetWidth > 0 && offsetHeight > 0) {
      setViewportSize({ width: offsetWidth, height: offsetHeight });
    }
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setViewportSize({ width: Math.round(width), height: Math.round(height) });
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── 衍生當前圖片資料 ──
  const activeImage = useMemo(
    () => images.find((i) => i.id === activeImageId)!,
    [images, activeImageId],
  );
  const { pipelineState } = activeImage;
  const imageSrc = activeImage.src;

  // ── refs (供 callback 中即時讀取，避免 stale closure) ──
  const activeImageIdRef = useRef(activeImageId);
  activeImageIdRef.current = activeImageId;
  const imagesRef = useRef(images);
  imagesRef.current = images;

  // ── 輸出設定 (local state) ──
  const [outputSettings, setOutputSettings] = useState<OutputSettings>(() => {
    const croppedSize = getCroppedOriginalSize(pipelineState.editorState, pipelineState.imageInfo);
    return {
      targetWidth: croppedSize.width,
      targetHeight: croppedSize.height,
      lockAspectRatio: true,
      format: activeImage.originalFormat,
      baseWidth: croppedSize.width,
      baseHeight: croppedSize.height,
      quality: 92,
      targetKB: null,
      enableTargetKB: false,
      lastExportSize: pipelineState.previewBlob?.size ?? null,
    };
  });
  const outputSettingsRef = useRef(outputSettings);
  outputSettingsRef.current = outputSettings;

  // ── 進入頁面初始化：將每張圖的 exportFormat 設為其 originalFormat ──
  useEffect(() => {
    setImages((prev) =>
      prev.map((img) => ({
        ...img,
        exportFormat: img.originalFormat,
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentional: only on mount

  // ── 切換 activeImage 時同步 local settings ──
  const prevActiveIdRef = useRef(activeImageId);
  useEffect(() => {
    if (prevActiveIdRef.current === activeImageId) return;
    prevActiveIdRef.current = activeImageId;
    const img = images.find((i) => i.id === activeImageId);
    if (!img) return;
    const croppedSize = getCroppedOriginalSize(
      img.pipelineState.editorState,
      img.pipelineState.imageInfo,
    );
    setOutputSettings((prev) => ({
      ...prev,
      baseWidth: croppedSize.width,
      baseHeight: croppedSize.height,
      targetWidth: img.pipelineState.resize.targetWidth || croppedSize.width,
      targetHeight: img.pipelineState.resize.targetHeight || croppedSize.height,
      lastExportSize: img.pipelineState.previewBlob?.size ?? null,
      // 統一輸出 OFF 時，跟隨該圖片的 format/quality
      ...(!unifiedOutputRef.current && img.exportFormat
        ? { format: img.exportFormat }
        : {}),
      ...(!unifiedOutputRef.current && img.exportQuality !== undefined
        ? { quality: img.exportQuality }
        : {}),
    }));
  }, [activeImageId, images]);

  // ── 廣播格式/品質到所有圖片 ──
  const broadcastFormatQuality = useCallback(
    (updates: { exportFormat?: ExportFormat; exportQuality?: number }) => {
      setImages((prev) =>
        prev.map((img) => ({
          ...img,
          ...(updates.exportFormat !== undefined && { exportFormat: updates.exportFormat }),
          ...(updates.exportQuality !== undefined && { exportQuality: updates.exportQuality }),
        })),
      );
    },
    [setImages],
  );

  // ── 更新輸出設定 (format/quality 同步到圖片) ──
  const handleUpdateOutputSettings = useCallback(
    (updates: Partial<OutputSettings>) => {
      setOutputSettings((prev) => ({ ...prev, ...updates }));
      if (unifiedOutputRef.current) {
        // 統一輸出 ON：廣播到所有圖片
        if (updates.format !== undefined) {
          broadcastFormatQuality({ exportFormat: updates.format });
        }
        if (updates.quality !== undefined) {
          broadcastFormatQuality({ exportQuality: updates.quality });
        }
      } else {
        // 統一輸出 OFF：僅更新當前圖片
        const imgUpdates: Partial<ImageItem> = {};
        if (updates.format !== undefined) imgUpdates.exportFormat = updates.format;
        if (updates.quality !== undefined) imgUpdates.exportQuality = updates.quality;
        if (Object.keys(imgUpdates).length > 0) {
          setImages((prev) =>
            prev.map((img) =>
              img.id === activeImageIdRef.current
                ? { ...img, ...imgUpdates }
                : img,
            ),
          );
        }
      }
    },
    [broadcastFormatQuality, setImages],
  );

  // ── 統一輸出開關 ──
  const handleToggleUnified = useCallback(() => {
    setUnifiedOutput((prev) => {
      if (!prev) {
        // 開啟時：將當前格式/品質廣播到所有圖片
        const s = outputSettingsRef.current;
        broadcastFormatQuality({ exportFormat: s.format, exportQuality: s.quality });
      } else {
        // 關閉時：強制 scope 為單張
        handleSetTargetKBScope("single");
      }
      return !prev;
    });
    // 統一輸出切換會改變所有圖片的格式/品質，重新估算
    setTimeout(() => handleBatchEstimateRef.current(), 0);
  }, [broadcastFormatQuality, handleSetTargetKBScope]);

  // ── 重置匯出格式 ──
  const handleResetFormat = useCallback(() => {
    if (unifiedOutputRef.current) {
      // 統一輸出 ON：重置所有圖片回各自原始格式
      setImages((prev) =>
        prev.map((img) => ({
          ...img,
          exportFormat: img.originalFormat,
          exportQuality: undefined,
        })),
      );
      // UI 格式跟隨當前活動圖片
      const activeImg = images.find((i) => i.id === activeImageIdRef.current);
      setOutputSettings((prev) => ({
        ...prev,
        format: activeImg?.originalFormat ?? "png",
        quality: 92,
        enableTargetKB: false,
        targetKB: null,
      }));
    } else {
      // 統一輸出 OFF：僅重置當前圖片
      const activeImg = images.find((i) => i.id === activeImageIdRef.current);
      setImages((prev) =>
        prev.map((img) =>
          img.id === activeImageIdRef.current
            ? { ...img, exportFormat: img.originalFormat, exportQuality: undefined }
            : img,
        ),
      );
      setOutputSettings((prev) => ({
        ...prev,
        format: activeImg?.originalFormat ?? "png",
        quality: 92,
        enableTargetKB: false,
        targetKB: null,
      }));
    }
  }, [setImages, images]);

  // ── 下載格式 + PDF 模式 (放在 mathEstimates 之前，供估算使用) ──
  const [downloadFormat, setDownloadFormat] = useState<"image" | "pdf">("image");
  const downloadFormatRef = useRef(downloadFormat);
  downloadFormatRef.current = downloadFormat;
  const [pdfMode, setPdfMode] = useState<"high" | "standard">("high");
  const pdfModeRef = useRef(pdfMode);
  pdfModeRef.current = pdfMode;

  // ── 檔案大小預估 ──
  const mathEstimates = useMemo(() => {
    const sizes: Record<string, number> = {};
    for (const img of images) {
      const cs = getCroppedOriginalSize(img.pipelineState.editorState, img.pipelineState.imageInfo);
      const w = img.pipelineState.resize.targetWidth || cs.width;
      const h = img.pipelineState.resize.targetHeight || cs.height;
      const fmt = downloadFormat === "pdf"
        ? (pdfMode === "high" ? "png" : "jpeg")
        : resolveFormat(img.exportFormat ?? outputSettings.format).fmt;
      sizes[img.id] = estimateFileSize(
        w, h,
        fmt,
        img.exportQuality ?? outputSettings.quality,
      );
    }
    return sizes;
  }, [images, outputSettings.format, outputSettings.quality, downloadFormat, pdfMode]);

  const [realSizes, setRealSizes] = useState<Record<string, number>>({});
  const [isEstimating, setIsEstimating] = useState(false);

  // 當格式/品質變更時，清除過期的真實大小
  useEffect(() => {
    setRealSizes((prev) => (Object.keys(prev).length > 0 ? {} : prev));
  }, [outputSettings.format, outputSettings.quality]);

  // 合併：真實大小優先，否則使用數學估算
  const displaySizes = useMemo(
    () => ({ ...mathEstimates, ...realSizes }),
    [mathEstimates, realSizes],
  );
  const totalEstimatedSize = useMemo(
    () => images.reduce((sum, img) => sum + (displaySizes[img.id] ?? 0), 0),
    [images, displaySizes],
  );
  const hasRealSizes = Object.keys(realSizes).length === images.length;

  // 批量預估：為所有圖片生成 blob 以取得精確大小 (含 targetKB 二分搜尋)
  // 所有外部狀態皆從 ref 讀取，避免 setTimeout 觸發時的 stale closure
  const handleBatchEstimate = async () => {
    if (isEstimating) return;
    setIsEstimating(true);
    try {
      const os = outputSettingsRef.current;
      const imgs = imagesRef.current;
      const isPdf = downloadFormatRef.current === "pdf";
      const currentPdfMode = pdfModeRef.current;

      const hasLimit = os.enableTargetKB && os.targetKB;
      let targetBytes: number | null = null;
      if (hasLimit) {
        const totalBytes = os.targetKB! * 1024;
        if (isPdf) {
          // PDF: targetKB = 整個 PDF 大小，扣除 5% 結構開銷後平均分配
          const available = Math.max(1024, Math.floor(totalBytes * 0.95));
          targetBytes = Math.floor(available / imgs.length);
        } else {
          targetBytes =
            targetKBScopeRef.current === "all"
              ? Math.floor(totalBytes / imgs.length)
              : totalBytes;
        }
      }

      const newRealSizes: Record<string, number> = {};
      for (const img of imgs) {
        const cs = getCroppedOriginalSize(
          img.pipelineState.editorState,
          img.pipelineState.imageInfo,
        );
        const tw = img.pipelineState.resize.targetWidth || cs.width;
        const th = img.pipelineState.resize.targetHeight || cs.height;

        let mime: "image/png" | "image/jpeg" | "image/webp";
        let q: number;
        if (isPdf) {
          mime = currentPdfMode === "high" ? "image/png" : "image/jpeg";
          q = currentPdfMode === "high" ? 1.0 : (img.exportQuality ?? os.quality) / 100;
        } else {
          mime = resolveFormat(img.exportFormat ?? os.format).mime;
          q = (img.exportQuality ?? os.quality) / 100;
        }

        // 高品質 PDF 不限制單張大小 (PNG 無損)
        const effectiveTarget = (isPdf && currentPdfMode === "high") ? null : targetBytes;
        const blob = await generateImageBlobWithLimit(img, tw, th, mime, q, effectiveTarget);
        newRealSizes[img.id] = blob.size;
      }
      setRealSizes(newRealSizes);
    } catch (err) {
      console.error("批量預估失敗:", err);
    } finally {
      setIsEstimating(false);
    }
  };

  // ── 進入頁面自動估算 (deferred 確保 exportFormat 已初始化) ──
  const handleBatchEstimateRef = useRef(handleBatchEstimate);
  handleBatchEstimateRef.current = handleBatchEstimate;
  useEffect(() => {
    const timer = setTimeout(() => handleBatchEstimateRef.current(), 100);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentional: only on mount

  // ── 下載邏輯 (即時生成 blob，帶正確輸出格式) ──
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      const imgs = imagesRef.current;
      const isMulti = imgs.length > 1;
      const os = outputSettingsRef.current;
      const isPdf = downloadFormatRef.current === "pdf";
      const currentPdfMode = pdfModeRef.current;
      const hasLimit = os.enableTargetKB && os.targetKB;

      // 圖片格式才在前端做 per-image 限制，PDF 交給後端處理 total_target_kb
      let targetBytes: number | null = null;
      if (hasLimit && !isPdf) {
        const totalBytes = os.targetKB! * 1024;
        targetBytes =
          targetKBScopeRef.current === "all"
            ? Math.floor(totalBytes / imgs.length)
            : totalBytes;
      }

      // 為所有圖片即時生成 blob
      const allResults = await Promise.all(
        imgs.map(async (img) => {
          const cs = getCroppedOriginalSize(
            img.pipelineState.editorState,
            img.pipelineState.imageInfo,
          );
          const isActive = img.id === activeImageIdRef.current;
          const tw = isActive
            ? os.targetWidth
            : (img.pipelineState.resize.targetWidth || cs.width);
          const th = isActive
            ? os.targetHeight
            : (img.pipelineState.resize.targetHeight || cs.height);

          let fmt: string;
          let mime: "image/png" | "image/jpeg" | "image/webp";
          let q: number;
          if (isPdf) {
            fmt = currentPdfMode === "high" ? "png" : "jpeg";
            mime = currentPdfMode === "high" ? "image/png" : "image/jpeg";
            q = currentPdfMode === "high" ? 1.0 : (img.exportQuality ?? os.quality) / 100;
          } else {
            const resolved = resolveFormat(img.exportFormat ?? os.format);
            fmt = resolved.fmt;
            mime = resolved.mime;
            q = (img.exportQuality ?? os.quality) / 100;
          }

          const blob = await generateImageBlobWithLimit(img, tw, th, mime, q, targetBytes);
          return { blob, ext: fmt };
        }),
      );

      if (!isMulti && !isPdf) {
        // 單圖直接下載
        const { blob, ext } = allResults[0];
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `processed-image.${ext}`;
        a.click();
        URL.revokeObjectURL(url);
      } else if (!isPdf) {
        // 多圖 ZIP
        const JSZip = (await import("jszip")).default;
        const zip = new JSZip();
        allResults.forEach(({ blob, ext }, i) => {
          zip.file(`image-${i + 1}.${ext}`, blob);
        });
        const zipBlob = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "images.zip";
        a.click();
        URL.revokeObjectURL(url);
      } else {
        // PDF — 傳送 pdfMode/品質/總限制給後端
        const { exportPdf } = await import("../api/exportPdf");
        const pdfBlob = await exportPdf({
          images: allResults.map((r) => r.blob),
          filename: "export.pdf",
          pdfMode: currentPdfMode,
          quality: currentPdfMode === "standard" ? os.quality : undefined,
          totalTargetKB: (hasLimit && currentPdfMode === "standard")
            ? os.targetKB
            : null,
        });
        const url = URL.createObjectURL(pdfBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "export.pdf";
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error("匯出失敗:", err);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="h-screen flex overflow-hidden bg-sidebar layout-editor">
      {/* ===== 左側 Sidebar ===== */}
      <aside className="w-[30%] min-w-[240px] max-w-[320px] flex flex-col h-screen sticky top-0 sidebar-scroll overflow-y-auto bg-sidebar max-md:h-auto">
        {/* 頂部: 標題 */}
        <div className="p-4 pb-2 mx-auto mb-6">
          <button onClick={() => setShowResetModal(true)} className="cursor-pointer">
            <img src={logoImg} alt="picgopic!" className="h-16" />
          </button>
        </div>

        {/* 中部: 輸出設定面板 */}
        <div className="flex-1 p-4 pt-2 flex flex-col gap-3">
          <OutputSettingsPanel
            images={images}
            settings={outputSettings}
            onUpdateSettings={handleUpdateOutputSettings}
            unifiedOutput={unifiedOutput}
            onToggleUnified={handleToggleUnified}
            totalEstimatedSize={totalEstimatedSize}
            hasRealSizes={hasRealSizes}
            isEstimating={isEstimating}
            onBatchEstimate={handleBatchEstimate}
            downloadFormat={downloadFormat}
            onDownloadFormatChange={setDownloadFormat}
            pdfMode={pdfMode}
            onPdfModeChange={(mode: "high" | "standard") => {
              setPdfMode(mode);
              setTimeout(() => handleBatchEstimateRef.current(), 0);
            }}
            targetKBScope={targetKBScope}
            onTargetKBScopeChange={handleSetTargetKBScope}
            onResetFormat={handleResetFormat}
            originalFormat={activeImage.originalFormat}
          />
        </div>

        {/* 底部: 下載 + 返回 */}
        <div className="p-4 pt-0 flex flex-col gap-2">
          <button
            onClick={handleDownload}
            disabled={isDownloading}
            className="w-full px-4 py-3 bg-highlight text-black font-bold rounded-[10px] transition-all btn-highlight disabled:opacity-30"
          >
            {isDownloading
              ? "匯出中..."
              : images.length > 1
                ? downloadFormat === "pdf"
                  ? "下載 PDF"
                  : "下載 ZIP"
                : "下載圖片"}
          </button>
          <button
            onClick={onReturn}
            className="w-full px-4 py-2 text-white/70 hover:text-white transition-colors"
          >
            返回裁切
          </button>
        </div>
      </aside>

      {/* ===== 右側預覽區 ===== */}
      <main className="flex-1 flex flex-col h-screen">
        <div
          ref={previewContainerRef}
          className={`flex-1 bg-preview flex items-center justify-center m-4 rounded-lg overflow-hidden ${
            images.length > 1 ? "mb-0" : ""
          }`}
        >
          <PreviewWorkspace
            key={activeImageId}
            editorState={null}
            imageInfo={null}
            originalSrc={imageSrc}
            previewUrl={pipelineState.previewUrl}
            isProcessing={false}
            mode="output"
            outputWidth={pipelineState.outputWidth}
            outputHeight={pipelineState.outputHeight}
            visualBaseRotate={0}
            maxPreviewWidth={viewportSize.width}
            maxPreviewHeight={viewportSize.height}
          />
        </div>

        {/* 縮圖列表 */}
        {images.length > 1 && (
          <div className="h-[120px] shrink-0 w-full overflow-x-auto thumbnail-scroll px-5 py-2.5 flex items-center gap-3">
            {images.map((item) => (
              <div key={item.id} className="flex flex-col items-center gap-1 shrink-0">
                <button
                  onClick={() => onSelectImage(item.id)}
                  className={`relative shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-colors ${
                    item.id === activeImageId
                      ? "border-highlight"
                      : "border-transparent hover:border-white/30"
                  }`}
                >
                  <img
                    src={item.pipelineState.previewUrl ?? item.src}
                    className="w-full h-full object-cover"
                    alt=""
                  />
                  {unifiedOutput && item.id !== activeImageId && (
                    <div className="absolute top-0.5 right-0.5 bg-black/50 rounded-full p-0.5">
                      <svg
                        className="w-3.5 h-3.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#D4FF3F"
                        strokeWidth={2.5}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                        />
                      </svg>
                    </div>
                  )}
                </button>
                <span className="text-[10px] text-white/50 font-mono whitespace-nowrap">
                  {isEstimating ? (
                    <span className="animate-pulse">...</span>
                  ) : (
                    formatFileSize(displaySizes[item.id] ?? 0)
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </main>

      <ConfirmModal
        open={showResetModal}
        title="返回首頁"
        message="確定要放棄目前的編輯內容並返回首頁嗎？"
        confirmLabel="返回首頁"
        cancelLabel="繼續編輯"
        onConfirm={onReset}
        onCancel={() => setShowResetModal(false)}
        accent="#FFD60A"
      />
    </div>
  );
}

// ============================================================
// Sub-component
// ============================================================

/** 輸出設定面板 (Output mode) */
function OutputSettingsPanel({
  images,
  settings,
  onUpdateSettings,
  unifiedOutput,
  onToggleUnified,
  totalEstimatedSize,
  hasRealSizes,
  isEstimating,
  onBatchEstimate,
  downloadFormat,
  onDownloadFormatChange,
  pdfMode,
  onPdfModeChange,
  targetKBScope,
  onTargetKBScopeChange,
  onResetFormat,
  originalFormat,
}: {
  images: ImageItem[];
  settings: OutputSettings;
  onUpdateSettings: (updates: Partial<OutputSettings>) => void;
  unifiedOutput: boolean;
  onToggleUnified: () => void;
  totalEstimatedSize: number;
  hasRealSizes: boolean;
  isEstimating: boolean;
  onBatchEstimate: () => void;
  downloadFormat: "image" | "pdf";
  onDownloadFormatChange: (format: "image" | "pdf") => void;
  pdfMode: "high" | "standard";
  onPdfModeChange: (mode: "high" | "standard") => void;
  targetKBScope: "single" | "all";
  onTargetKBScopeChange: (scope: "single" | "all") => void;
  onResetFormat: () => void;
  originalFormat: "png" | "jpeg" | "webp";
}) {
  const [widthInput, setWidthInput] = useState(String(settings.targetWidth));
  const [heightInput, setHeightInput] = useState(String(settings.targetHeight));
  const [widthError, setWidthError] = useState(false);
  const [heightError, setHeightError] = useState(false);
  const [targetSizeInput, setTargetSizeInput] = useState(String(settings.targetKB ?? ""));
  const [targetUnit, setTargetUnit] = useState<"KB" | "MB" | "GB">("KB");

  const unitToKB = { KB: 1, MB: 1024, GB: 1024 * 1024 };

  const { baseWidth, baseHeight, lockAspectRatio, format } = settings;

  // 同步外部 settings 變更到 input (切換圖片時)
  useEffect(() => {
    setWidthInput(String(settings.targetWidth));
    setHeightInput(String(settings.targetHeight));
  }, [settings.targetWidth, settings.targetHeight]);

  // 處理寬度輸入變更 (僅影響當前圖片)
  const handleWidthInputChange = (value: string) => {
    setWidthInput(value);
    setWidthError(false);
    const num = parseInt(value);
    if (!isNaN(num) && num >= 1) {
      if (lockAspectRatio) {
        const newHeight = Math.max(1, Math.round(num * (baseHeight / baseWidth)));
        setHeightInput(String(newHeight));
        onUpdateSettings({ targetWidth: num, targetHeight: newHeight });
      } else {
        onUpdateSettings({ targetWidth: num });
      }
    }
  };

  // 處理高度輸入變更 (僅影響當前圖片)
  const handleHeightInputChange = (value: string) => {
    setHeightInput(value);
    setHeightError(false);
    const num = parseInt(value);
    if (!isNaN(num) && num >= 1) {
      if (lockAspectRatio) {
        const newWidth = Math.max(1, Math.round(num * (baseWidth / baseHeight)));
        setWidthInput(String(newWidth));
        onUpdateSettings({ targetWidth: newWidth, targetHeight: num });
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

  // 重設為原始尺寸 (僅影響當前圖片)
  const handleResetSize = () => {
    setWidthInput(String(baseWidth));
    setHeightInput(String(baseHeight));
    setWidthError(false);
    setHeightError(false);
    onUpdateSettings({ targetWidth: baseWidth, targetHeight: baseHeight });
  };

  const isModified =
    settings.targetWidth !== baseWidth || settings.targetHeight !== baseHeight;
  const hasError = widthError || heightError;
  const showUnifiedToggle = images.length > 1;

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
              onClick={() => {
                onDownloadFormatChange(val);
                setTimeout(() => onBatchEstimate(), 0);
              }}
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

      {/* 調整尺寸 (始終獨立，不受統一輸出影響) */}
      <div className="bg-white/10 rounded-[10px] p-3">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-white/70 font-medium">調整尺寸</p>
          {isModified && (
            <button
              onClick={handleResetSize}
              className="text-[11px] text-white/50 hover:text-white transition-colors"
            >
              重置
            </button>
          )}
        </div>

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

        {hasError && (
          <p className="text-xs text-red-400 mb-2">尺寸不得為空或小於 1</p>
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
            onClick={() => onUpdateSettings({ lockAspectRatio: !lockAspectRatio })}
            className={`toggle-switch relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
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

        {/* 尺寸資訊 */}
        <div className="text-xs text-white/50 font-mono mt-2 space-y-0.5">
          <div>原始: {baseWidth} × {baseHeight} px</div>
          {isModified && (
            <div className="text-highlight/80">
              輸出: {settings.targetWidth} × {settings.targetHeight} px
            </div>
          )}
        </div>
      </div>

      {/* 統一輸出開關 (多圖時顯示，位於匯出格式上方) */}
      {showUnifiedToggle && (
        <div className="flex items-center justify-between bg-white/10 rounded-[10px] p-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-white/80">統一輸出</span>
            <span className="text-[10px] text-white/50">格式 / 品質</span>
          </div>
          <button
            onClick={onToggleUnified}
            className={`toggle-switch relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
              unifiedOutput ? "bg-highlight" : "bg-white/20"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full shadow transition-transform ${
                unifiedOutput ? "translate-x-4 bg-black" : "translate-x-0 bg-white"
              }`}
            />
          </button>
        </div>
      )}

      {/* 匯出格式 */}
      <div className="bg-white/10 rounded-[10px] p-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <p className="text-xs text-white/70 font-medium">
              {downloadFormat === "pdf" ? "PDF 模式" : "匯出格式"}
            </p>
            {downloadFormat !== "pdf" && (
              <span className="text-[10px] text-white/30">
                原始：{originalFormat.toUpperCase()}
              </span>
            )}
          </div>
          {downloadFormat !== "pdf" && (format !== originalFormat || settings.quality !== 92 || settings.enableTargetKB) && (
            <button
              onClick={onResetFormat}
              className="text-[11px] text-white/50 hover:text-white transition-colors"
            >
              重置
            </button>
          )}
        </div>

        {downloadFormat === "pdf" ? (
          <div className="flex gap-2 mb-3">
            {(
              [
                ["high", "高品質"],
                ["standard", "標準"],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => onPdfModeChange(mode)}
                className={`flex-1 px-2 py-1.5 text-sm rounded-[10px] transition-colors ${
                  pdfMode === mode
                    ? "bg-highlight text-black font-medium"
                    : "bg-white/10 text-white/80 hover:bg-white/20"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex gap-2 mb-3">
            {(["png", "jpeg", "webp"] as const).map((fmt) => {
              const label = fmt.toUpperCase();
              return (
                <button
                  key={fmt}
                  onClick={() => {
                    onUpdateSettings({ format: fmt });
                    setTimeout(() => onBatchEstimate(), 0);
                  }}
                  className={`flex-1 px-2 py-1.5 text-sm rounded-[10px] transition-colors ${
                    format === fmt
                      ? "bg-highlight text-black font-medium"
                      : "bg-white/10 text-white/80 hover:bg-white/20"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}

        {downloadFormat === "pdf" && pdfMode === "high" && (
          <p className="text-xs text-white/60">以 PNG 無損內嵌，檔案較大</p>
        )}

        {downloadFormat !== "pdf" && format === "png" && (
          <p className="text-xs text-white/60 mb-3">PNG 為無損格式，不支援品質調整</p>
        )}

        {((downloadFormat === "pdf" && pdfMode === "standard") || (downloadFormat !== "pdf" && format !== "png")) && (
          <div className="pt-3 border-t border-white/10">
            <div className="flex gap-1 mb-3 bg-white/5 rounded-lg p-0.5">
              <button
                onClick={() => onUpdateSettings({ enableTargetKB: false })}
                className={`flex-1 px-2 py-1 text-xs rounded-md transition-colors ${
                  !settings.enableTargetKB
                    ? "bg-white/20 text-white font-medium"
                    : "text-white/70 hover:text-white"
                }`}
              >
                品質控制
              </button>
              <button
                onClick={() => onUpdateSettings({ enableTargetKB: true })}
                className={`flex-1 px-2 py-1 text-xs rounded-md transition-colors ${
                  settings.enableTargetKB
                    ? "bg-white/20 text-white font-medium"
                    : "text-white/70 hover:text-white"
                }`}
              >
                限制檔案大小
              </button>
            </div>

            {!settings.enableTargetKB && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-white/70">品質</span>
                  <DarkEditableNumber
                    value={settings.quality}
                    min={10}
                    max={100}
                    suffix="%"
                    onChange={(val) => onUpdateSettings({ quality: val })}
                  />
                </div>
                <input
                  type="range"
                  min={10}
                  max={100}
                  step={1}
                  value={settings.quality}
                  onChange={(e) => onUpdateSettings({ quality: parseInt(e.target.value) })}
                  onMouseUp={() => setTimeout(() => onBatchEstimate(), 0)}
                  onTouchEnd={() => setTimeout(() => onBatchEstimate(), 0)}
                  className="w-full slider-dark"
                />
                <div className="flex justify-between text-[10px] text-white/60 mt-0.5">
                  <span>小檔案</span>
                  <span>高品質</span>
                </div>
              </div>
            )}

            {settings.enableTargetKB && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={targetSizeInput}
                    onChange={(e) => {
                      setTargetSizeInput(e.target.value);
                      const val = parseFloat(e.target.value);
                      onUpdateSettings({
                        targetKB: isNaN(val) || val <= 0 ? null : Math.round(val * unitToKB[targetUnit]),
                      });
                    }}
                    onBlur={() => {
                      if (settings.targetKB) onBatchEstimate();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                    placeholder={targetUnit}
                    className="flex-1 min-w-0 px-2 py-1 text-sm input-dark"
                  />
                  <div className="flex rounded-md overflow-hidden border border-white/10 shrink-0">
                    {(["KB", "MB", "GB"] as const).map((u) => (
                      <button
                        key={u}
                        onClick={() => {
                          setTargetUnit(u);
                          setTargetSizeInput("");
                          onUpdateSettings({ targetKB: null });
                        }}
                        className={`px-2 py-1 text-[11px] font-medium transition-colors ${
                          targetUnit === u
                            ? "bg-highlight text-black"
                            : "bg-white/5 text-white/50 hover:bg-white/10"
                        }`}
                      >
                        {u}
                      </button>
                    ))}
                  </div>

                  {/* 範圍切換：單張 / 全部 (PDF 模式隱藏) */}
                  {images.length > 1 && downloadFormat !== "pdf" && (
                    <div className={`flex gap-0.5 bg-white/5 rounded-md p-0.5 shrink-0 ml-auto ${
                      !unifiedOutput ? "opacity-40 pointer-events-none" : ""
                    }`}>
                      {(
                        [
                          ["single", "單張"],
                          ["all", "全部"],
                        ] as const
                      ).map(([val, label]) => (
                        <button
                          key={val}
                          onClick={() => {
                            onTargetKBScopeChange(val);
                            if (settings.targetKB) onBatchEstimate();
                          }}
                          className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                            targetKBScope === val
                              ? "bg-white/20 text-white font-medium"
                              : "text-white/70 hover:text-white"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* 說明文字 */}
                {(images.length > 1 || downloadFormat === "pdf") && (
                  <p className="text-[10px] text-white/50">
                    {downloadFormat === "pdf"
                      ? "PDF 總檔案 ≤ 限制大小"
                      : targetKBScope === "single"
                        ? "每張圖片各自 ≤ 限制大小"
                        : "ZIP 總檔案 ≤ 限制大小"}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 預估總檔案大小 */}
      <div className="text-sm text-center font-mono p-2 bg-white/5 rounded-[10px]">
        <span className="text-white/50">
          {hasRealSizes ? "總檔案大小：" : "預估總檔案大小："}
        </span>
        {isEstimating ? (
          <span className="text-highlight animate-pulse">計算中...</span>
        ) : (
          <span className="text-highlight font-medium">
            {formatFileSize(
              downloadFormat === "pdf"
                ? Math.round(totalEstimatedSize * 1.05)
                : totalEstimatedSize,
            )}
          </span>
        )}
      </div>

    </div>
  );
}

// ============================================================
// Helpers
// ============================================================

/** 將 ExportFormat 解析為圖片實際的 format/mime */
function resolveFormat(
  format: ExportFormat,
): { fmt: "png" | "jpeg" | "webp"; mime: "image/png" | "image/jpeg" | "image/webp" } {
  const mime = format === "png" ? "image/png" : format === "jpeg" ? "image/jpeg" : "image/webp";
  return { fmt: format, mime };
}

/** 數學公式估算檔案大小 (bytes) */
function estimateFileSize(
  w: number,
  h: number,
  format: string,
  quality: number,
): number {
  const pixels = w * h;
  switch (format) {
    case "png":
      return Math.round(pixels * 3);
    case "jpeg":
      return Math.round(pixels * (0.1 + (quality / 100) * 1.0));
    case "webp":
      return Math.round(pixels * (0.05 + (quality / 100) * 0.6));
    default:
      return Math.round(pixels * 3);
  }
}

/** 格式化檔案大小顯示 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * 生成圖片 blob，支援 targetKB 二分搜尋品質自動調整。
 * 當 targetBytes 不為 null 且格式非 PNG 時，使用二分搜尋
 * 尋找能使 blob 大小 <= targetBytes 的最高品質。
 */
async function generateImageBlobWithLimit(
  img: ImageItem,
  tw: number,
  th: number,
  mime: "image/png" | "image/jpeg" | "image/webp",
  quality: number,
  targetBytes: number | null,
): Promise<Blob> {
  const { editorState, imageInfo } = img.pipelineState;
  const baseOpts = { targetWidth: tw, targetHeight: th, format: mime };

  // 無限制或 PNG (無損) → 直接生成
  if (!targetBytes || mime === "image/png") {
    const r = await generateCroppedImage(img.imgElement, editorState, imageInfo, {
      ...baseOpts,
      quality,
    });
    return r.blob;
  }

  // 先以最高品質測試
  let minQ = 0.1;
  let maxQ = 1.0;
  let r = await generateCroppedImage(img.imgElement, editorState, imageInfo, {
    ...baseOpts,
    quality: maxQ,
  });

  // 最高品質已在限制內 → 直接回傳
  if (r.blob.size <= targetBytes) return r.blob;

  // 二分搜尋：找到能符合限制的最高品質
  let attempts = 0;
  while (attempts < 10 && maxQ - minQ > 0.02) {
    const midQ = (minQ + maxQ) / 2;
    r = await generateCroppedImage(img.imgElement, editorState, imageInfo, {
      ...baseOpts,
      quality: midQ,
    });
    if (r.blob.size > targetBytes) maxQ = midQ;
    else minQ = midQ;
    attempts++;
  }

  // 以找到的品質做最終生成
  r = await generateCroppedImage(img.imgElement, editorState, imageInfo, {
    ...baseOpts,
    quality: minQ,
  });
  return r.blob;
}
