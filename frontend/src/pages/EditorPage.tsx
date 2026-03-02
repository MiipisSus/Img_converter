import { useState, useCallback, useRef, useMemo, useEffect, useLayoutEffect } from "react";
import { ImageEditor } from "../components/ImageEditor";
import { PreviewWorkspace } from "../components/PreviewWorkspace";
import { DarkEditableNumber } from "../components/DarkEditableNumber";
import {
  generateCroppedImage,
  type CropResult,
} from "../utils/generateCroppedImage";
import {
  calculateViewportContainerParams,
  getCroppedOriginalSize,
} from "../utils/containerParams";
import type { EditorState, ImageInfo } from "../hooks/useImageEditor";
import type { PipelineState, ImageItem } from "../types";
import { loadImageFile } from "../utils/loadImageFile";

type EditorMode = "preview" | "crop";

interface EditorPageProps {
  images: ImageItem[];
  activeImageId: string;
  onSelectImage: (id: string) => void;
  onUpdateImage: (id: string, updates: Partial<ImageItem>) => void;
  onAppendImages: (newImages: ImageItem[]) => void;
  imageRef: React.MutableRefObject<HTMLImageElement | null>;
  setPipelineState: React.Dispatch<
    React.SetStateAction<PipelineState | null>
  >;
  onExport: () => void;
  onReset: () => void;
}

export function EditorPage({
  images,
  activeImageId,
  onSelectImage,
  onUpdateImage,
  onAppendImages,
  imageRef,
  setPipelineState,
  onExport,
  onReset,
}: EditorPageProps) {
  const [mode, setMode] = useState<EditorMode>("preview");
  const [isExporting, setIsExporting] = useState(false);

  // ── 追加圖片 ──
  const appendInputRef = useRef<HTMLInputElement>(null);
  const handleAppendFiles = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      const imageFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
      if (imageFiles.length === 0) return;
      const items = await Promise.all(imageFiles.map(loadImageFile));
      onAppendImages(items);
      e.target.value = "";
    },
    [onAppendImages],
  );

  // ── 隔離渲染: 從 images + activeImageId 衍生當前圖片資料 ──
  const currentImageData = useMemo(() => {
    const img = images.find((i) => i.id === activeImageId);
    if (!img) return null;
    return {
      src: img.src,
      pipelineState: img.pipelineState,
      visualBaseRotate: img.visualBaseRotate,
    };
  }, [images, activeImageId]);

  // 當前編輯中的狀態 (裁切模式用)
  const currentEditorStateRef = useRef<{
    state: EditorState;
    imageInfo: ImageInfo;
  } | null>(null);
  const skipNextResizeSyncRef = useRef(false);

  // Crop mode: 外部控制 refs
  const editorControlRef = useRef<{
    setScale: (s: number) => void;
    setRotate: (r: number) => void;
    setCropBox: (
      crop: {
        cropX: number;
        cropY: number;
        cropW: number;
        cropH: number;
      },
      animated?: boolean,
    ) => void;
  } | null>(null);
  const [cropViewState, setCropViewState] = useState({ scale: 1, rotate: 0 });

  // 累積視覺旋轉角度 (不取模，用於 CSS 平滑動畫避免 270°→0° 反向插值)
  const visualBaseRotateRef = useRef(0);

  // ── 預覽區域容器尺寸追蹤 (ResizeObserver) ──
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 800, height: 600 });
  const viewportSizeRef = useRef(viewportSize);
  viewportSizeRef.current = viewportSize;

  // ── 切換圖片時：重置模式 + 同步 visualBaseRotate ──
  // 只在 activeImageId 切換時觸發，不依賴 images（避免 setPipelineState 更新圖片時重置 mode）
  useEffect(() => {
    setMode("preview");
    const active = images.find((i) => i.id === activeImageId);
    if (active) {
      visualBaseRotateRef.current = active.visualBaseRotate;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeImageId]);

  // ── 監聽預覽容器大小變化 (useLayoutEffect 確保首幀前就有正確尺寸) ──
  useLayoutEffect(() => {
    const el = previewContainerRef.current;
    if (!el) return;
    // 立即讀取初始尺寸，避免首次渲染使用預設值
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

  // 提前 return 必須在所有 hooks 之後
  if (!currentImageData) return null;
  const { pipelineState } = currentImageData;
  const imageSrc = currentImageData.src;

  // 接收編輯器狀態更新
  const handleStateChange = useCallback(
    (state: EditorState, imageInfo: ImageInfo | null) => {
      if (imageInfo) {
        currentEditorStateRef.current = { state, imageInfo };
        setCropViewState({ scale: state.scale, rotate: state.rotate });

        if (mode === "crop") {
          if (skipNextResizeSyncRef.current) {
            skipNextResizeSyncRef.current = false;
            return;
          }

          const croppedSize = getCroppedOriginalSize(state, imageInfo);
          setPipelineState((prev) => {
            if (!prev) return prev;

            const cropAspectRatio = croppedSize.width / croppedSize.height;
            const targetAspectRatio =
              prev.resize.targetWidth / prev.resize.targetHeight;

            if (Math.abs(cropAspectRatio - targetAspectRatio) > 0.01) {
              return {
                ...prev,
                resize: {
                  ...prev.resize,
                  targetWidth: croppedSize.width,
                  targetHeight: croppedSize.height,
                  croppedWidth: croppedSize.width,
                  croppedHeight: croppedSize.height,
                  active: false,
                },
              };
            }

            if (
              prev.resize.croppedWidth !== croppedSize.width ||
              prev.resize.croppedHeight !== croppedSize.height
            ) {
              return {
                ...prev,
                resize: {
                  ...prev.resize,
                  croppedWidth: croppedSize.width,
                  croppedHeight: croppedSize.height,
                },
              };
            }

            return prev;
          });
        }
      }
    },
    [mode, setPipelineState],
  );

  // 進入裁切模式
  const handleEnterCropMode = useCallback(() => {
    const { editorState, imageInfo, resize } = pipelineState;
    const targetAspectRatio = resize.targetWidth / resize.targetHeight;
    const currentAspectRatio = editorState.cropW / editorState.cropH;

    if (Math.abs(targetAspectRatio - currentAspectRatio) > 0.01) {
      const { containerWidth, containerHeight } = imageInfo;
      let newCropW: number, newCropH: number;

      if (targetAspectRatio > containerWidth / containerHeight) {
        newCropW = containerWidth;
        newCropH = containerWidth / targetAspectRatio;
      } else {
        newCropH = containerHeight;
        newCropW = containerHeight * targetAspectRatio;
      }

      const newCropX = (containerWidth - newCropW) / 2;
      const newCropY = (containerHeight - newCropH) / 2;

      skipNextResizeSyncRef.current = true;

      setPipelineState((prev) => ({
        ...prev!,
        editorState: {
          ...prev!.editorState,
          cropX: newCropX,
          cropY: newCropY,
          cropW: newCropW,
          cropH: newCropH,
        },
      }));
    }

    setCropViewState({
      scale: editorState.scale,
      rotate: editorState.rotate,
    });
    setMode("crop");
  }, [pipelineState, setPipelineState]);

  // 確定裁切
  const handleConfirmCrop = useCallback(async () => {
    if (!imageRef.current || !currentEditorStateRef.current || isExporting)
      return;

    setIsExporting(true);
    try {
      const { state, imageInfo } = currentEditorStateRef.current;
      const croppedSize = getCroppedOriginalSize(state, imageInfo);

      const prevResize = pipelineState.resize;
      const hasActiveResize = prevResize.active;
      const resizeOptions = hasActiveResize
        ? {
            targetWidth: prevResize.targetWidth,
            targetHeight: prevResize.targetHeight,
          }
        : {};

      const result: CropResult = await generateCroppedImage(
        imageRef.current,
        state,
        imageInfo,
        resizeOptions,
      );

      setPipelineState((prev) => {
        const prevResize = prev?.resize;
        const cropAspectRatio = croppedSize.width / croppedSize.height;
        const targetAspectRatio = prevResize
          ? prevResize.targetWidth / prevResize.targetHeight
          : cropAspectRatio;

        const ratioMatches =
          Math.abs(cropAspectRatio - targetAspectRatio) < 0.01;
        const keepActiveResize =
          ratioMatches && (prevResize?.active ?? false);

        return {
          editorState: { ...state },
          imageInfo: { ...imageInfo },
          previewUrl: result.dataUrl,
          previewBlob: result.blob,
          resize: {
            active: keepActiveResize,
            targetWidth: keepActiveResize
              ? prevResize!.targetWidth
              : croppedSize.width,
            targetHeight: keepActiveResize
              ? prevResize!.targetHeight
              : croppedSize.height,
            lockAspectRatio: prevResize?.lockAspectRatio ?? true,
            croppedWidth: croppedSize.width,
            croppedHeight: croppedSize.height,
          },
          outputWidth: result.width,
          outputHeight: result.height,
        };
      });

      console.log("導出尺寸:", result.width, "×", result.height);
      setMode("preview");
    } catch (error) {
      console.error("導出失敗:", error);
    } finally {
      setIsExporting(false);
    }
  }, [isExporting, pipelineState.resize, imageRef, setPipelineState]);

  // 返回 (從裁切模式)
  const handleCancelCrop = useCallback(() => {
    setMode("preview");
  }, []);

  // 裁切比例按鈕 — 使用編輯器的即時狀態 (currentEditorStateRef) 而非 pipelineState
  // 確保在 viewport-aware M 下座標系一致
  const handleSetCropRatio = useCallback(
    (ratioW: number, ratioH: number) => {
      if (!editorControlRef.current || !currentEditorStateRef.current) return;

      const { state: editorState, imageInfo } = currentEditorStateRef.current;
      const { cropX, cropY, cropW, cropH, scale } = editorState;
      const { displayMultiplier: M } = imageInfo;

      const isLeaning = Math.abs(editorState.baseRotate % 180) === 90;
      const effW = isLeaning
        ? imageInfo.naturalHeight
        : imageInfo.naturalWidth;
      const effH = isLeaning
        ? imageInfo.naturalWidth
        : imageInfo.naturalHeight;

      const visW = effW * M * scale;
      const visH = effH * M * scale;

      const minSide = Math.min(cropW, cropH);
      const ratio = ratioW / ratioH;
      let newW: number, newH: number;

      if (ratio >= 1) {
        newW = minSide * ratio;
        newH = minSide;
      } else {
        newW = minSide;
        newH = minSide / ratio;
      }

      if (newW > visW) {
        newH = newH * (visW / newW);
        newW = visW;
      }
      if (newH > visH) {
        newW = newW * (visH / newH);
        newH = visH;
      }

      const oldCenterX = cropX + cropW / 2;
      const oldCenterY = cropY + cropH / 2;
      let newX = oldCenterX - newW / 2;
      let newY = oldCenterY - newH / 2;

      const containerW = imageInfo.containerWidth;
      const containerH = imageInfo.containerHeight;
      const imgLeft =
        (containerW - visW) / 2 + editorState.imageX;
      const imgTop =
        (containerH - visH) / 2 + editorState.imageY;
      const imgRight = imgLeft + visW;
      const imgBottom = imgTop + visH;

      if (newX < imgLeft) newX = imgLeft;
      if (newY < imgTop) newY = imgTop;
      if (newX + newW > imgRight) newX = imgRight - newW;
      if (newY + newH > imgBottom) newY = imgBottom - newH;

      editorControlRef.current.setCropBox(
        { cropX: newX, cropY: newY, cropW: newW, cropH: newH },
        true,
      );
    },
    [],
  );

  // === 旋轉/翻轉 ===
  const applyTransformAndGenerate = useCallback(
    async (
      transformFn: (
        prev: EditorState,
        oldInfo: ImageInfo,
      ) => {
        newState: EditorState;
        newInfo: ImageInfo;
      },
      is90Rotation = false,
    ) => {
      if (!imageRef.current || isExporting) return;

      setIsExporting(true);

      try {
        const { newState, newInfo } = transformFn(
          pipelineState.editorState,
          pipelineState.imageInfo,
        );

        const croppedSize = getCroppedOriginalSize(newState, newInfo);
        const prevResize = pipelineState.resize;

        let newTargetWidth = croppedSize.width;
        let newTargetHeight = croppedSize.height;

        if (prevResize.active) {
          if (is90Rotation) {
            newTargetWidth = prevResize.targetHeight;
            newTargetHeight = prevResize.targetWidth;
          } else {
            newTargetWidth = prevResize.targetWidth;
            newTargetHeight = prevResize.targetHeight;
          }
        }

        // Phase 1: 立即更新狀態 → CSS 過渡動畫開始
        setPipelineState((prev) => ({
          editorState: newState,
          imageInfo: newInfo,
          previewUrl: prev!.previewUrl,
          previewBlob: prev!.previewBlob,
          resize: {
            ...prev!.resize,
            targetWidth: newTargetWidth,
            targetHeight: newTargetHeight,
            croppedWidth: croppedSize.width,
            croppedHeight: croppedSize.height,
          },
          outputWidth: prev!.outputWidth,
          outputHeight: prev!.outputHeight,
        }));

        // Phase 2: 背景生成點陣圖
        const resizeOptions = prevResize.active
          ? { targetWidth: newTargetWidth, targetHeight: newTargetHeight }
          : {};

        const result = await generateCroppedImage(
          imageRef.current,
          newState,
          newInfo,
          resizeOptions,
        );

        // Phase 3: 更新預覽圖和輸出尺寸
        setPipelineState((prev) =>
          prev
            ? {
                ...prev,
                previewUrl: result.dataUrl,
                previewBlob: result.blob,
                outputWidth: result.width,
                outputHeight: result.height,
              }
            : prev,
        );

        console.log("變換後尺寸:", result.width, "×", result.height);
      } catch (error) {
        console.error("變換失敗:", error);
      } finally {
        setIsExporting(false);
      }
    },
    [isExporting, pipelineState, imageRef, setPipelineState],
  );

  // 90° 旋轉
  const handleRotate = useCallback(
    (direction: "left" | "right") => {
      visualBaseRotateRef.current += direction === "right" ? 90 : -90;
      onUpdateImage(activeImageId, {
        visualBaseRotate: visualBaseRotateRef.current,
      });
      applyTransformAndGenerate((prevState, oldInfo) => {
        const oldM = oldInfo.displayMultiplier;
        const S = prevState.scale;

        const oldIsLeaning = Math.abs(prevState.baseRotate % 180) === 90;
        const oldEffW = oldIsLeaning
          ? oldInfo.naturalHeight
          : oldInfo.naturalWidth;
        const oldEffH = oldIsLeaning
          ? oldInfo.naturalWidth
          : oldInfo.naturalHeight;

        console.log("[Rotation Debug - BEFORE]", {
          naturalWidth: oldInfo.naturalWidth,
          naturalHeight: oldInfo.naturalHeight,
          baseRotate: prevState.baseRotate,
          oldEffW,
          oldEffH,
          oldM,
          S,
          imageOffset: { x: prevState.imageX, y: prevState.imageY },
          cropBox: {
            x: prevState.cropX,
            y: prevState.cropY,
            w: prevState.cropW,
            h: prevState.cropH,
          },
          container: {
            w: oldInfo.containerWidth,
            h: oldInfo.containerHeight,
          },
          exportWouldBe: {
            w: Math.round(prevState.cropW / oldM),
            h: Math.round(prevState.cropH / oldM),
          },
        });

        const newBaseRotate =
          direction === "right"
            ? (prevState.baseRotate + 90) % 360
            : (prevState.baseRotate - 90 + 360) % 360;

        const { width: viewW, height: viewH } = viewportSizeRef.current;
        const {
          M: newM,
          effW: newEffW,
          effH: newEffH,
          containerWidth: newContainerW,
          containerHeight: newContainerH,
        } = calculateViewportContainerParams(
          oldInfo.naturalWidth,
          oldInfo.naturalHeight,
          newBaseRotate,
          viewW,
          viewH,
        );

        // 座標歸一化：oldM → newM 的比例縮放 (旋轉後 effW/effH 互換導致 M 可能改變)
        const mScaleFactor = newM / oldM;
        let newImageX: number, newImageY: number;
        if (direction === "right") {
          newImageX = -prevState.imageY * mScaleFactor;
          newImageY = prevState.imageX * mScaleFactor;
        } else {
          newImageX = prevState.imageY * mScaleFactor;
          newImageY = -prevState.imageX * mScaleFactor;
        }

        const oldVisualLeft =
          (oldInfo.containerWidth * (1 - S)) / 2 + prevState.imageX;
        const oldVisualTop =
          (oldInfo.containerHeight * (1 - S)) / 2 + prevState.imageY;

        const pxX = (prevState.cropX - oldVisualLeft) / (oldM * S);
        const pxY = (prevState.cropY - oldVisualTop) / (oldM * S);
        const pxW = prevState.cropW / (oldM * S);
        const pxH = prevState.cropH / (oldM * S);

        let newPxX: number,
          newPxY: number,
          newPxW: number,
          newPxH: number;

        if (direction === "right") {
          newPxX = oldEffH - pxY - pxH;
          newPxY = pxX;
          newPxW = pxH;
          newPxH = pxW;
        } else {
          newPxX = pxY;
          newPxY = oldEffW - pxX - pxW;
          newPxW = pxH;
          newPxH = pxW;
        }

        const newVisualLeft =
          (newContainerW * (1 - S)) / 2 + newImageX;
        const newVisualTop =
          (newContainerH * (1 - S)) / 2 + newImageY;

        const rawCropX = newPxX * newM * S + newVisualLeft;
        const rawCropY = newPxY * newM * S + newVisualTop;
        const rawCropW = newPxW * newM * S;
        const rawCropH = newPxH * newM * S;

        const clampedCropX = Math.max(
          0,
          Math.min(newContainerW - 50, Math.round(rawCropX)),
        );
        const clampedCropY = Math.max(
          0,
          Math.min(newContainerH - 50, Math.round(rawCropY)),
        );
        const clampedCropW = Math.max(
          50,
          Math.min(newContainerW - clampedCropX, Math.round(rawCropW)),
        );
        const clampedCropH = Math.max(
          50,
          Math.min(newContainerH - clampedCropY, Math.round(rawCropH)),
        );

        const newState: EditorState = {
          ...prevState,
          baseRotate: newBaseRotate,
          imageX: newImageX,
          imageY: newImageY,
          cropX: clampedCropX,
          cropY: clampedCropY,
          cropW: clampedCropW,
          cropH: clampedCropH,
        };

        const newInfo: ImageInfo = {
          ...oldInfo,
          displayMultiplier: newM,
          containerWidth: newContainerW,
          containerHeight: newContainerH,
        };

        console.log("[Rotation Debug - AFTER]", {
          direction,
          newBaseRotate,
          newEffW,
          newEffH,
          oldM,
          newM,
          M_changed: oldM !== newM,
          imageOffset: { x: newImageX, y: newImageY },
          container: { w: newContainerW, h: newContainerH },
          pixelCrop: { x: newPxX, y: newPxY, w: newPxW, h: newPxH },
          rawUiCrop: {
            x: rawCropX,
            y: rawCropY,
            w: rawCropW,
            h: rawCropH,
          },
          clampedCrop: {
            x: clampedCropX,
            y: clampedCropY,
            w: clampedCropW,
            h: clampedCropH,
          },
          exportWillBe: {
            w: Math.round(clampedCropW / newM),
            h: Math.round(clampedCropH / newM),
          },
          effW_swapped: newEffW === oldEffH,
          natural_unchanged:
            newInfo.naturalWidth === oldInfo.naturalWidth &&
            newInfo.naturalHeight === oldInfo.naturalHeight,
          clamp_didnt_cut:
            Math.round(rawCropW) === clampedCropW &&
            Math.round(rawCropH) === clampedCropH,
        });

        return { newState, newInfo };
      }, true);
    },
    [applyTransformAndGenerate, activeImageId, onUpdateImage],
  );

  // 翻轉
  const handleFlip = useCallback(
    (axis: "x" | "y") => {
      applyTransformAndGenerate((prevState, oldInfo) => {
        let { cropX, cropY } = prevState;
        if (axis === "x") {
          const displayW = oldInfo.containerWidth * prevState.scale;
          const visualLeft =
            oldInfo.containerWidth / 2 +
            prevState.imageX -
            displayW / 2;
          cropX =
            visualLeft +
            (displayW - (cropX - visualLeft) - prevState.cropW);
        } else {
          const displayH = oldInfo.containerHeight * prevState.scale;
          const visualTop =
            oldInfo.containerHeight / 2 +
            prevState.imageY -
            displayH / 2;
          cropY =
            visualTop +
            (displayH - (cropY - visualTop) - prevState.cropH);
        }

        const newState: EditorState = {
          ...prevState,
          flipX: axis === "x" ? !prevState.flipX : prevState.flipX,
          flipY: axis === "y" ? !prevState.flipY : prevState.flipY,
          cropX,
          cropY,
        };
        return { newState, newInfo: oldInfo };
      });
    },
    [applyTransformAndGenerate],
  );

  const handleRotateLeft = useCallback(
    () => handleRotate("left"),
    [handleRotate],
  );
  const handleRotateRight = useCallback(
    () => handleRotate("right"),
    [handleRotate],
  );
  const handleFlipX = useCallback(() => handleFlip("x"), [handleFlip]);
  const handleFlipY = useCallback(() => handleFlip("y"), [handleFlip]);

  // 進入輸出模式
  const handleEnterOutputMode = useCallback(async () => {
    if (!imageRef.current || isExporting) return;

    setIsExporting(true);
    try {
      const { editorState, imageInfo } = pipelineState;

      const result = await generateCroppedImage(
        imageRef.current,
        editorState,
        imageInfo,
        {},
      );

      setPipelineState((prev) => ({
        ...prev!,
        previewUrl: result.dataUrl,
        previewBlob: result.blob,
        outputWidth: result.width,
        outputHeight: result.height,
      }));

      onExport();
    } catch (error) {
      console.error("進入輸出模式失敗:", error);
    } finally {
      setIsExporting(false);
    }
  }, [isExporting, pipelineState, imageRef, setPipelineState, onExport]);

  const currentFlipX = pipelineState.editorState.flipX;
  const currentFlipY = pipelineState.editorState.flipY;

  return (
    <div className="h-screen flex overflow-hidden bg-sidebar">
      {/* ===== 左側 Sidebar ===== */}
      <aside className="w-[30%] min-w-[240px] max-w-[320px] flex flex-col h-screen sticky top-0 sidebar-scroll overflow-y-auto bg-sidebar">
        {/* 頂部: 標題 */}
        <div className="p-4 pb-2">
          <h1 className="text-lg font-bold text-white">圖片處理工具</h1>
        </div>

        {/* 中部: 模式面板 */}
        <div className="flex-1 p-4 pt-2 flex flex-col gap-3">
          {mode === "preview" && (
            <CropToolPanel
              onEnterCropMode={handleEnterCropMode}
              onEnterOutputMode={handleEnterOutputMode}
              onRotateLeft={handleRotateLeft}
              onRotateRight={handleRotateRight}
              onFlipX={handleFlipX}
              onFlipY={handleFlipY}
              flipX={currentFlipX}
              flipY={currentFlipY}
              isExporting={isExporting}
              pipelineState={pipelineState}
            />
          )}

          {mode === "crop" && (
            <CropControlPanel
              onConfirm={handleConfirmCrop}
              onCancel={handleCancelCrop}
              isExporting={isExporting}
              scale={cropViewState.scale}
              rotate={cropViewState.rotate}
              onScaleChange={(s) =>
                editorControlRef.current?.setScale(s)
              }
              onRotateChange={(r) =>
                editorControlRef.current?.setRotate(r)
              }
              onSetCropRatio={handleSetCropRatio}
            />
          )}
        </div>

        {/* 底部: 選擇其他圖片 */}
        <div className="p-4 pt-0">
          {mode === "preview" && (
            <button
              onClick={onReset}
              className="w-full px-4 py-2 text-white/70 hover:text-white text-sm transition-colors"
            >
              選擇其他圖片
            </button>
          )}
        </div>
      </aside>

      {/* ===== 右側預覽區 ===== */}
      <main className="flex-1 flex flex-col h-screen">
        {/* 圖片預覽區 — flex-1 佔滿剩餘空間 */}
        <div ref={previewContainerRef} className="flex-1 bg-preview flex items-center justify-center m-4 mb-0 rounded-lg overflow-hidden">
          {mode === "preview" ? (
            <PreviewWorkspace
              key={activeImageId}
              editorState={pipelineState.editorState}
              imageInfo={pipelineState.imageInfo}
              originalSrc={imageSrc}
              previewUrl={pipelineState.previewUrl}
              isProcessing={isExporting}
              mode="preview"
              outputWidth={pipelineState.outputWidth}
              outputHeight={pipelineState.outputHeight}
              visualBaseRotate={currentImageData.visualBaseRotate}
              maxPreviewWidth={viewportSize.width}
              maxPreviewHeight={viewportSize.height}
            />
          ) : (
            <ImageEditor
              src={imageSrc}
              onStateChange={handleStateChange}
              initialState={pipelineState.editorState}
              showControls={false}
              onEditorControlRef={editorControlRef}
              viewportWidth={viewportSize.width}
              viewportHeight={viewportSize.height}
              referenceM={pipelineState.imageInfo.displayMultiplier}
            />
          )}
        </div>

        {/* 縮圖列表 — 固定高度，含追加按鈕 */}
        <div className={`h-[120px] shrink-0 w-full overflow-x-auto thumbnail-scroll px-5 py-2.5 flex items-center gap-3 transition-opacity ${mode === "crop" ? "opacity-40 pointer-events-none" : ""}`}>
          {/* 追加圖片按鈕 (固定最左側) */}
          <button
            onClick={() => appendInputRef.current?.click()}
            className="shrink-0 w-16 h-16 rounded-lg border-2 border-dashed border-white/30 hover:border-highlight/60 bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
          >
            <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 5v14m-7-7h14"
                stroke="#D4FF3F"
                strokeWidth={2.5}
                strokeLinecap="round"
              />
            </svg>
          </button>
          <input
            ref={appendInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleAppendFiles}
            className="hidden"
          />

          {images.map((item) => (
            <button
              key={item.id}
              onClick={() => onSelectImage(item.id)}
              className={`shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-colors ${
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
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================

/** 裁切工具面板 (Preview mode) */
function CropToolPanel({
  onEnterCropMode,
  onEnterOutputMode,
  onRotateLeft,
  onRotateRight,
  onFlipX,
  onFlipY,
  flipX,
  flipY,
  isExporting,
  pipelineState,
}: {
  onEnterCropMode: () => void;
  onEnterOutputMode: () => void;
  onRotateLeft: () => void;
  onRotateRight: () => void;
  onFlipX: () => void;
  onFlipY: () => void;
  flipX: boolean;
  flipY: boolean;
  isExporting: boolean;
  pipelineState: PipelineState;
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* 旋轉區塊 */}
      <div className="bg-white/10 rounded-[10px] p-3">
        <p className="text-xs text-white/70 mb-2 font-medium">旋轉</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onRotateLeft}
            disabled={isExporting}
            className="px-2 py-2 text-sm bg-white/10 hover:bg-white/20 disabled:opacity-30 text-white rounded-[10px] transition-colors"
            title="左轉 90°"
          >
            ↺ 左轉
          </button>
          <button
            onClick={onRotateRight}
            disabled={isExporting}
            className="px-2 py-2 text-sm bg-white/10 hover:bg-white/20 disabled:opacity-30 text-white rounded-[10px] transition-colors"
            title="右轉 90°"
          >
            ↻ 右轉
          </button>
        </div>
      </div>

      {/* 翻轉區塊 */}
      <div className="bg-white/10 rounded-[10px] p-3">
        <p className="text-xs text-white/70 mb-2 font-medium">翻轉</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onFlipX}
            disabled={isExporting}
            className={`px-2 py-2 text-sm rounded-[10px] transition-colors ${
              flipX
                ? "bg-highlight text-black font-medium"
                : "bg-white/10 hover:bg-white/20 text-white"
            } disabled:opacity-30`}
            title="水平翻轉"
          >
            ⇆ 水平
          </button>
          <button
            onClick={onFlipY}
            disabled={isExporting}
            className={`px-2 py-2 text-sm rounded-[10px] transition-colors ${
              flipY
                ? "bg-highlight text-black font-medium"
                : "bg-white/10 hover:bg-white/20 text-white"
            } disabled:opacity-30`}
            title="垂直翻轉"
          >
            ⇅ 垂直
          </button>
        </div>
      </div>

      {/* 狀態資訊 */}
      <div className="text-xs text-white/70 font-mono space-y-1 p-2">
        <div>
          裁切尺寸:{" "}
          {Math.round(
            pipelineState.editorState.cropW /
              pipelineState.imageInfo.displayMultiplier,
          )}{" "}
          ×{" "}
          {Math.round(
            pipelineState.editorState.cropH /
              pipelineState.imageInfo.displayMultiplier,
          )}{" "}
          px
        </div>
        <div>旋轉: {pipelineState.editorState.baseRotate}°</div>
      </div>

      {/* 底部按鈕 */}
      <div className="flex flex-col gap-2 mt-auto pt-4">
        <button
          onClick={onEnterCropMode}
          disabled={isExporting}
          className="w-full px-4 py-3 bg-white/10 hover:bg-white/20 disabled:opacity-30 text-white rounded-[10px] transition-colors font-medium"
        >
          進入裁切模式
        </button>
        <button
          onClick={onEnterOutputMode}
          disabled={isExporting}
          className="w-full px-4 py-3 bg-highlight text-black font-bold rounded-[10px] transition-all btn-highlight disabled:opacity-30"
        >
          導出圖片
        </button>
      </div>
    </div>
  );
}

/** 裁切控制面板 (Crop mode) — 含比例按鈕、縮放/旋轉滑桿 */
function CropControlPanel({
  onConfirm,
  onCancel,
  isExporting,
  scale,
  rotate,
  onScaleChange,
  onRotateChange,
  onSetCropRatio,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  isExporting: boolean;
  scale: number;
  rotate: number;
  onScaleChange: (s: number) => void;
  onRotateChange: (r: number) => void;
  onSetCropRatio: (ratioW: number, ratioH: number) => void;
}) {
  const ratios: { label: string; w: number; h: number }[] = [
    { label: "1:1", w: 1, h: 1 },
    { label: "4:5", w: 4, h: 5 },
    { label: "5:4", w: 5, h: 4 },
    { label: "2:3", w: 2, h: 3 },
    { label: "3:2", w: 3, h: 2 },
    { label: "9:16", w: 9, h: 16 },
    { label: "16:9", w: 16, h: 9 },
    { label: "3:4", w: 3, h: 4 },
    { label: "4:3", w: 4, h: 3 },
  ];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-white font-medium">裁切模式</p>
      <p className="text-xs text-white/70">
        拖動框框調整裁切範圍，滾輪縮放
      </p>

      {/* 比例按鈕 */}
      <div className="bg-white/10 rounded-[10px] p-3">
        <p className="text-xs text-white/70 font-medium mb-2">裁切比例</p>
        <div className="grid grid-cols-3 gap-2">
          {ratios.map(({ label, w, h }) => {
            const maxDim = 24;
            const iconW =
              w >= h ? maxDim : Math.round(maxDim * (w / h));
            const iconH =
              h >= w ? maxDim : Math.round(maxDim * (h / w));
            return (
              <button
                key={label}
                onClick={() => onSetCropRatio(w, h)}
                className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 transition-all
                  hover:bg-highlight/15 hover:border-highlight/60 active:scale-95"
                style={{ aspectRatio: "1 / 1" }}
              >
                <div
                  className="border border-highlight/70 rounded-[2px]"
                  style={{ width: iconW, height: iconH }}
                />
                <span className="text-[10px] font-medium text-white/80">
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 縮放滑桿 */}
      <div className="bg-white/10 rounded-[10px] p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-white/70 font-medium">縮放</p>
          <DarkEditableNumber
            value={Math.round(scale * 100)}
            min={100}
            max={500}
            suffix="%"
            onChange={(v) => onScaleChange(v / 100)}
          />
        </div>
        <input
          type="range"
          min={1}
          max={5}
          step={0.01}
          value={scale}
          onChange={(e) => onScaleChange(parseFloat(e.target.value))}
          className="w-full slider-dark"
        />
      </div>

      {/* 旋轉滑桿 */}
      <div className="bg-white/10 rounded-[10px] p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-white/70 font-medium">微調旋轉</p>
          <DarkEditableNumber
            value={Math.round(rotate)}
            min={-180}
            max={180}
            suffix="°"
            onChange={(v) => onRotateChange(v)}
          />
        </div>
        <input
          type="range"
          min={-180}
          max={180}
          step={1}
          value={rotate}
          onChange={(e) =>
            onRotateChange(parseFloat(e.target.value))
          }
          className="w-full slider-dark"
        />
      </div>

      {/* 底部按鈕 */}
      <div className="flex flex-col gap-2 mt-auto pt-4">
        <button
          onClick={onConfirm}
          disabled={isExporting}
          className="w-full px-4 py-3 bg-highlight text-black font-bold rounded-[10px] transition-all btn-highlight disabled:opacity-30"
        >
          {isExporting ? "處理中..." : "確定"}
        </button>
        <button
          onClick={onCancel}
          disabled={isExporting}
          className="w-full px-4 py-2 text-white/80 hover:text-white transition-colors"
        >
          返回
        </button>
      </div>
    </div>
  );
}
