import type { EditorState, ImageInfo } from "../hooks/useImageEditor";
import { calculatePreviewMultiplier } from "../utils/containerParams";

type AppMode = "preview" | "crop" | "output";

/** 預覽工作區 — preview 模式使用 CSS 即時預覽，output 模式使用點陣圖 */
export function PreviewWorkspace({
  editorState,
  imageInfo,
  originalSrc,
  previewUrl,
  isProcessing,
  mode,
  outputWidth,
  outputHeight,
  visualBaseRotate,
}: {
  editorState: EditorState | null;
  imageInfo: ImageInfo | null;
  originalSrc: string;
  previewUrl: string | null;
  isProcessing?: boolean;
  mode: AppMode;
  outputWidth: number;
  outputHeight: number;
  /** 累積旋轉角度 (不取模，避免 CSS 反向插值) */
  visualBaseRotate: number;
}) {
  const hasCropResult = previewUrl !== null;

  // ── CSS 即時預覽 (preview 模式 + 有編輯狀態) ──
  const useCssPreview =
    mode === "preview" && editorState !== null && imageInfo !== null;

  if (useCssPreview) {
    const {
      cropX, cropY, cropW, cropH,
      scale, rotate, flipX, flipY, imageX, imageY,
    } = editorState;
    const {
      naturalWidth, naturalHeight,
      displayMultiplier: M,
      containerWidth, containerHeight,
    } = imageInfo;

    // 裁切區域的實際像素尺寸
    const cropPxW = cropW / M;
    const cropPxH = cropH / M;

    // 預覽顯示倍率
    const PM = calculatePreviewMultiplier(cropPxW, cropPxH);
    const displayW = Math.round(cropPxW * PM);
    const displayH = Math.round(cropPxH * PM);

    // 編輯器座標 → 預覽座標的縮放因子
    const SP = cropW > 0 ? displayW / cropW : 1;

    // 預覽空間中的圖片尺寸
    const imgW = naturalWidth * M * SP;
    const imgH = naturalHeight * M * SP;

    // CSS transform (使用 visualBaseRotate 避免 270°→0° 反向動畫)
    const flipScaleX = (flipX ? -1 : 1) * scale;
    const flipScaleY = (flipY ? -1 : 1) * scale;
    const totalRotate = visualBaseRotate + rotate;

    const easing = "cubic-bezier(0.4, 0, 0.2, 1)";
    const dur = "0.4s";

    return (
      <div className="flex flex-col items-center gap-3 relative">
        {/* 外層容器：裁切視窗，overflow:hidden 實現裁切效果 */}
        <div
          className="relative rounded-lg overflow-hidden"
          style={{
            width: displayW,
            height: displayH,
            transition: `width ${dur} ${easing}, height ${dur} ${easing}`,
          }}
        >
          {/* 內層定位容器：模擬完整編輯器容器，偏移以對齊裁切區域 */}
          <div
            className="absolute flex items-center justify-center"
            style={{
              width: containerWidth * SP,
              height: containerHeight * SP,
              left: -cropX * SP,
              top: -cropY * SP,
              transition: `left ${dur} ${easing}, top ${dur} ${easing}, width ${dur} ${easing}, height ${dur} ${easing}`,
            }}
          >
            <img
              src={originalSrc}
              alt="Preview"
              draggable={false}
              className="max-w-none pointer-events-none"
              style={{
                width: imgW,
                height: imgH,
                transform: `translate(${imageX * SP}px, ${imageY * SP}px) scale(${flipScaleX}, ${flipScaleY}) rotate(${totalRotate}deg)`,
                transformOrigin: "center center",
                transition: `transform ${dur} ${easing}, width ${dur} ${easing}, height ${dur} ${easing}`,
              }}
            />
          </div>
        </div>

        {!hasCropResult && (
          <span className="mt-1 text-sm text-gray-400 cursor-not-allowed">
            使用左側工具進行編輯
          </span>
        )}
      </div>
    );
  }

  // ── 點陣圖預覽 (output 模式或無編輯狀態) ──
  const displayUrl = previewUrl ?? originalSrc;
  const M_out = calculatePreviewMultiplier(outputWidth, outputHeight);
  const displayWidth = Math.round(outputWidth * M_out);
  const displayHeight = Math.round(outputHeight * M_out);

  return (
    <div className="flex flex-col items-center gap-3 relative">
      {isProcessing && (
        <div className="absolute inset-0 bg-preview/70 flex items-center justify-center z-10 rounded-lg">
          <p className="text-gray-500">處理中...</p>
        </div>
      )}

      <div
        className="relative rounded-lg overflow-hidden"
        style={{
          backgroundImage: `
            linear-gradient(45deg, #c0c0c0 25%, transparent 25%),
            linear-gradient(-45deg, #c0c0c0 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #c0c0c0 75%),
            linear-gradient(-45deg, transparent 75%, #c0c0c0 75%)
          `,
          backgroundSize: "16px 16px",
          backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
          backgroundColor: "#d8d8d8",
          width: displayWidth,
          height: displayHeight,
        }}
      >
        <img
          src={displayUrl}
          alt={hasCropResult ? "Processed preview" : "Original"}
          style={{ width: displayWidth, height: displayHeight }}
        />
      </div>

      {!hasCropResult && (
        <span className="mt-1 text-sm text-gray-400 cursor-not-allowed">
          使用左側工具進行編輯
        </span>
      )}
    </div>
  );
}
