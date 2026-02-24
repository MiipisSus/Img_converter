import { useState, useCallback, useRef } from "react";
import { ImageEditor } from "./components/ImageEditor";
import {
  generateCroppedImage,
  type CropResult,
} from "./utils/generateCroppedImage";
import type { EditorState, ImageInfo } from "./hooks/useImageEditor";
import {
  CONTAINER_MIN_WIDTH,
  CONTAINER_MAX_WIDTH,
  CONTAINER_MIN_HEIGHT,
  CONTAINER_MAX_HEIGHT,
} from "./constants";

type AppMode = "preview" | "crop" | "output";

/** 調整尺寸狀態 */
interface ResizeState {
  active: boolean;
  targetWidth: number;
  targetHeight: number;
  lockAspectRatio: boolean;
  /** 裁切後的原始基準尺寸 (用於計算比例和顯示) */
  croppedWidth: number;
  croppedHeight: number;
}

/** 持久化的 Pipeline 狀態 */
interface PipelineState {
  editorState: EditorState;
  imageInfo: ImageInfo;
  previewUrl: string | null;
  resize: ResizeState;
  /** 實際輸出尺寸 (僅在套用後更新) */
  outputWidth: number;
  outputHeight: number;
}

/** 計算有效尺寸和容器參數 - 符合 IMAGE_CROPPER_SPEC V7 (雙向限制) */
function calculateContainerParams(
  naturalWidth: number,
  naturalHeight: number,
  baseRotate: number,
): {
  effW: number;
  effH: number;
  M: number;
  containerWidth: number;
  containerHeight: number;
} {
  const MIN_WIDTH = CONTAINER_MIN_WIDTH,
    MAX_WIDTH = CONTAINER_MAX_WIDTH;
  const MIN_HEIGHT = CONTAINER_MIN_HEIGHT,
    MAX_HEIGHT = CONTAINER_MAX_HEIGHT;

  const isLeaning = Math.abs(baseRotate % 180) === 90;
  const effW = isLeaning ? naturalHeight : naturalWidth;
  const effH = isLeaning ? naturalWidth : naturalHeight;

  // 寬度需求倍率
  let Mw: number;
  if (effW > MAX_WIDTH) Mw = MAX_WIDTH / effW;
  else if (effW < MIN_WIDTH) Mw = MIN_WIDTH / effW;
  else Mw = 1;

  // 高度需求倍率
  let Mh: number;
  if (effH > MAX_HEIGHT) Mh = MAX_HEIGHT / effH;
  else if (effH < MIN_HEIGHT) Mh = MIN_HEIGHT / effH;
  else Mh = 1;

  // 模式判定：縮小優先
  const needsShrink = effW > MAX_WIDTH || effH > MAX_HEIGHT;
  const needsEnlarge = effW < MIN_WIDTH || effH < MIN_HEIGHT;

  let M: number;
  if (needsShrink) M = Math.min(Mw, Mh);
  else if (needsEnlarge) M = Math.max(Mw, Mh);
  else M = 1;

  const containerWidth = Math.round(effW * M);
  const containerHeight = Math.round(effH * M);

  return { effW, effH, M, containerWidth, containerHeight };
}

/** 計算裁切後的原始像素尺寸 */
function getCroppedOriginalSize(
  state: EditorState,
  info: ImageInfo,
): { width: number; height: number } {
  const width = Math.round(state.cropW / info.displayMultiplier);
  const height = Math.round(state.cropH / info.displayMultiplier);
  return { width, height };
}

/** 輸出設定狀態 (暫態，返回裁切時會重置) */
interface OutputSettings {
  targetWidth: number;
  targetHeight: number;
  lockAspectRatio: boolean;
  format: "png" | "jpeg" | "webp";
  /** 基準尺寸 (進入輸出模式時的裁切尺寸) */
  baseWidth: number;
  baseHeight: number;
  /** 品質 (0-100, 僅 JPEG/WebP 有效) */
  quality: number;
  /** 目標檔案大小 (KB)，null 表示不限制 */
  targetKB: number | null;
  /** 是否啟用目標 KB 限制 */
  enableTargetKB: boolean;
  /** 上次導出的檔案大小 (bytes) */
  lastExportSize: number | null;
}

function App() {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [mode, setMode] = useState<AppMode>("preview");
  const [isExporting, setIsExporting] = useState(false);

  // 輸出設定 (暫態)
  const [outputSettings, setOutputSettings] = useState<OutputSettings | null>(
    null,
  );

  // 全域 Pipeline 狀態
  const [pipelineState, setPipelineState] = useState<PipelineState | null>(
    null,
  );

  // 當前編輯中的狀態 (裁切模式用)
  const imageRef = useRef<HTMLImageElement | null>(null);
  const currentEditorStateRef = useRef<{
    state: EditorState;
    imageInfo: ImageInfo;
  } | null>(null);
  // 用於標記是否跳過下次狀態變更的 resize 同步 (進入裁切模式時的自動調整不應覆蓋 resize)
  const skipNextResizeSyncRef = useRef(false);

  // Crop mode: 外部控制 refs
  const editorControlRef = useRef<{
    setScale: (s: number) => void;
    setRotate: (r: number) => void;
  } | null>(null);
  const [cropViewState, setCropViewState] = useState({ scale: 1, rotate: 0 });

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        const src = event.target?.result as string;
        setImageSrc(src);
        setPipelineState(null);
        setMode("preview");
        setOutputSettings(null);

        const img = new Image();
        img.src = src;
        img.onload = () => {
          const { M, containerWidth, containerHeight } =
            calculateContainerParams(img.naturalWidth, img.naturalHeight, 0);

          const initialState: EditorState = {
            imageX: 0,
            imageY: 0,
            scale: 1,
            rotate: 0,
            baseRotate: 0,
            flipX: false,
            flipY: false,
            cropX: 0,
            cropY: 0,
            cropW: containerWidth,
            cropH: containerHeight,
          };

          const initialImageInfo: ImageInfo = {
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
            displayMultiplier: M,
            containerWidth,
            containerHeight,
          };

          // 初始裁切後尺寸
          const croppedSize = getCroppedOriginalSize(
            initialState,
            initialImageInfo,
          );

          setPipelineState({
            editorState: initialState,
            imageInfo: initialImageInfo,
            previewUrl: null,
            resize: {
              active: false,
              targetWidth: croppedSize.width,
              targetHeight: croppedSize.height,
              lockAspectRatio: true,
              croppedWidth: croppedSize.width,
              croppedHeight: croppedSize.height,
            },
            outputWidth: croppedSize.width,
            outputHeight: croppedSize.height,
          });
        };
        imageRef.current = img;
      };
      reader.readAsDataURL(file);
    },
    [],
  );

  // 接收編輯器狀態更新 (裁切模式下，動態更新 resize 目標以匹配裁切框比例)
  const handleStateChange = useCallback(
    (state: EditorState, imageInfo: ImageInfo | null) => {
      if (imageInfo) {
        currentEditorStateRef.current = { state, imageInfo };

        // 更新 sidebar 顯示用的 crop 狀態
        setCropViewState({ scale: state.scale, rotate: state.rotate });

        // 在裁切模式下，檢查裁切框比例是否改變
        if (mode === "crop") {
          // 如果是進入裁切模式時的自動調整，跳過這次同步
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

            // 只有當比例改變時才更新 resize 目標 (防止扭曲)
            // 保留使用者設定的縮放尺寸，只在比例變化時覆蓋
            if (Math.abs(cropAspectRatio - targetAspectRatio) > 0.01) {
              return {
                ...prev,
                resize: {
                  ...prev.resize,
                  // 使用者手動調整了裁切比例，更新 resize 目標為裁切尺寸
                  targetWidth: croppedSize.width,
                  targetHeight: croppedSize.height,
                  croppedWidth: croppedSize.width,
                  croppedHeight: croppedSize.height,
                  // 比例改變後，清除 active 狀態 (用戶需要重新設定縮放)
                  active: false,
                },
              };
            }

            // 比例相同，只更新基準尺寸
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
    [mode],
  );

  // 進入裁切模式 (預設採用 resize 設定的比例作為引導)
  const handleEnterCropMode = useCallback(() => {
    // 如果有 resize 設定，調整初始裁切框以符合該比例
    if (pipelineState) {
      const { editorState, imageInfo, resize } = pipelineState;
      const targetAspectRatio = resize.targetWidth / resize.targetHeight;
      const currentAspectRatio = editorState.cropW / editorState.cropH;

      // 如果比例不符，調整裁切框以符合 resize 比例
      if (Math.abs(targetAspectRatio - currentAspectRatio) > 0.01) {
        const { containerWidth, containerHeight } = imageInfo;
        let newCropW: number, newCropH: number;

        // 以較小的尺寸為基準，確保裁切框在容器內
        if (targetAspectRatio > containerWidth / containerHeight) {
          // 目標比例較寬，以寬度為基準
          newCropW = containerWidth;
          newCropH = containerWidth / targetAspectRatio;
        } else {
          // 目標比例較高，以高度為基準
          newCropH = containerHeight;
          newCropW = containerHeight * targetAspectRatio;
        }

        // 置中
        const newCropX = (containerWidth - newCropW) / 2;
        const newCropY = (containerHeight - newCropH) / 2;

        // 標記跳過下次的 resize 同步 (這是自動調整，不是使用者手動操作)
        skipNextResizeSyncRef.current = true;

        // 更新 pipelineState 中的 editorState
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

      // 初始化 crop view state
      setCropViewState({
        scale: editorState.scale,
        rotate: editorState.rotate,
      });
    }
    setMode("crop");
  }, [pipelineState]);

  // 確定裁切：儲存狀態並生成預覽，同時更新 resize 基準值
  const handleConfirmCrop = useCallback(async () => {
    if (!imageRef.current || !currentEditorStateRef.current || isExporting)
      return;

    setIsExporting(true);
    try {
      const { state, imageInfo } = currentEditorStateRef.current;

      // 計算新的裁切後尺寸
      const croppedSize = getCroppedOriginalSize(state, imageInfo);

      // 如果有 active resize，傳遞 resize 參數
      const prevResize = pipelineState?.resize;
      const hasActiveResize = prevResize?.active ?? false;
      const resizeOptions = hasActiveResize
        ? {
            targetWidth: prevResize!.targetWidth,
            targetHeight: prevResize!.targetHeight,
          }
        : {};

      const result: CropResult = await generateCroppedImage(
        imageRef.current,
        state,
        imageInfo,
        resizeOptions,
      );

      // 確保 resize 目標與裁切框比例一致 (防止扭曲)
      setPipelineState((prev) => {
        const prevResize = prev?.resize;
        const cropAspectRatio = croppedSize.width / croppedSize.height;
        const targetAspectRatio = prevResize
          ? prevResize.targetWidth / prevResize.targetHeight
          : cropAspectRatio;

        // 如果比例相同且有 active resize，保留用戶的縮放設定
        const ratioMatches =
          Math.abs(cropAspectRatio - targetAspectRatio) < 0.01;
        const keepActiveResize = ratioMatches && (prevResize?.active ?? false);

        return {
          editorState: { ...state },
          imageInfo: { ...imageInfo },
          previewUrl: result.dataUrl,
          resize: {
            active: keepActiveResize,
            // 如果比例匹配且有 active resize，保留用戶設定的尺寸；否則使用裁切尺寸
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
  }, [isExporting, pipelineState?.resize]);

  // 返回 (從裁切模式)
  const handleCancelCrop = useCallback(() => {
    setMode("preview");
  }, []);

  // === 輸出模式相關 ===

  // 進入輸出模式
  const handleEnterOutputMode = useCallback(async () => {
    if (!imageRef.current || !pipelineState || isExporting) return;

    setIsExporting(true);
    try {
      const { editorState, imageInfo } = pipelineState;

      // 計算裁切後的原始像素尺寸
      const croppedSize = getCroppedOriginalSize(editorState, imageInfo);

      // 生成預覽圖
      const result = await generateCroppedImage(
        imageRef.current,
        editorState,
        imageInfo,
        {},
      );

      // 更新 pipelineState 預覽
      setPipelineState((prev) => ({
        ...prev!,
        previewUrl: result.dataUrl,
        outputWidth: result.width,
        outputHeight: result.height,
      }));

      // 初始化輸出設定 (暫態)，包含初始檔案大小
      setOutputSettings({
        targetWidth: croppedSize.width,
        targetHeight: croppedSize.height,
        lockAspectRatio: true,
        format: "png",
        baseWidth: croppedSize.width,
        baseHeight: croppedSize.height,
        quality: 92,
        targetKB: null,
        enableTargetKB: false,
        lastExportSize: result.blob.size,
      });

      setMode("output");
    } catch (error) {
      console.error("進入輸出模式失敗:", error);
    } finally {
      setIsExporting(false);
    }
  }, [isExporting, pipelineState]);

  // 更新輸出設定
  const handleUpdateOutputSettings = useCallback(
    (updates: Partial<OutputSettings>) => {
      setOutputSettings((prev) => {
        if (!prev) return prev;
        return { ...prev, ...updates };
      });
    },
    [],
  );

  // 套用輸出設定並生成最終圖片
  const handleApplyOutput = useCallback(async () => {
    if (!imageRef.current || !pipelineState || !outputSettings || isExporting)
      return;

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

      // 如果啟用目標 KB 限制，使用迭代壓縮
      let result: Awaited<ReturnType<typeof generateCroppedImage>>;
      let finalQuality = quality / 100;

      if (enableTargetKB && targetKB && format !== "png") {
        // 迭代壓縮以達到目標大小
        const targetBytes = targetKB * 1024;
        let minQuality = 0.1;
        let maxQuality = 1.0;
        let attempts = 0;
        const maxAttempts = 10;

        // 先嘗試最高品質
        result = await generateCroppedImage(
          imageRef.current,
          editorState,
          imageInfo,
          { targetWidth, targetHeight, format: mimeType, quality: maxQuality },
        );

        // 如果最高品質已經符合目標，直接使用
        if (result.blob.size <= targetBytes) {
          finalQuality = maxQuality;
        } else {
          // 二分搜尋找到合適的品質
          while (attempts < maxAttempts && maxQuality - minQuality > 0.02) {
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

          // 最終生成
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
        // 不限制大小，直接使用指定品質
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

      // 更新預覽
      setPipelineState((prev) => ({
        ...prev!,
        previewUrl: result.dataUrl,
        outputWidth: result.width,
        outputHeight: result.height,
      }));

      // 更新檔案大小資訊
      setOutputSettings((prev) =>
        prev
          ? {
              ...prev,
              lastExportSize: result.blob.size,
            }
          : prev,
      );

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
  }, [isExporting, pipelineState, outputSettings]);

  // 返回裁切模式 (清除輸出設定)
  const handleReturnFromOutput = useCallback(() => {
    // 重置輸出設定 (暫態清除)
    setOutputSettings(null);
    setMode("preview");
  }, []);

  // 選擇其他圖片
  const handleReset = useCallback(() => {
    setImageSrc(null);
    setPipelineState(null);
    setMode("preview");
    setOutputSettings(null);
  }, []);

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
      if (!imageRef.current || !pipelineState || isExporting) return;

      setIsExporting(true);

      try {
        const { newState, newInfo } = transformFn(
          pipelineState.editorState,
          pipelineState.imageInfo,
        );

        // 計算新的裁切後尺寸
        const croppedSize = getCroppedOriginalSize(newState, newInfo);
        const prevResize = pipelineState.resize;

        // 計算新的 resize 目標尺寸
        // 對於 90° 旋轉：如果有 active resize，交換寬高
        // 對於翻轉：保持原有尺寸
        // 始終確保 resize 目標與裁切框比例一致
        let newTargetWidth = croppedSize.width;
        let newTargetHeight = croppedSize.height;

        if (prevResize.active) {
          if (is90Rotation) {
            // 90° 旋轉時交換目標寬高
            newTargetWidth = prevResize.targetHeight;
            newTargetHeight = prevResize.targetWidth;
          } else {
            // 翻轉時保持原尺寸 (翻轉不改變比例)
            newTargetWidth = prevResize.targetWidth;
            newTargetHeight = prevResize.targetHeight;
          }
        }

        // 傳遞更新後的 resize 參數給 generateCroppedImage
        const resizeOptions = prevResize.active
          ? { targetWidth: newTargetWidth, targetHeight: newTargetHeight }
          : {};

        const result = await generateCroppedImage(
          imageRef.current,
          newState,
          newInfo,
          resizeOptions,
        );

        setPipelineState((prev) => ({
          editorState: newState,
          imageInfo: newInfo,
          previewUrl: result.dataUrl,
          resize: {
            ...prev!.resize,
            // 更新 resize 目標以匹配新的裁切比例
            targetWidth: newTargetWidth,
            targetHeight: newTargetHeight,
            croppedWidth: croppedSize.width,
            croppedHeight: croppedSize.height,
          },
          outputWidth: result.width,
          outputHeight: result.height,
        }));

        console.log("變換後尺寸:", result.width, "×", result.height);
      } catch (error) {
        console.error("變換失敗:", error);
      } finally {
        setIsExporting(false);
      }
    },
    [isExporting, pipelineState],
  );

  // 90° 旋轉 — 全像素路徑轉向
  //
  // 核心：保留 imageOffset 旋轉而非歸零，避免 clamp 截斷 cropBox 導致尺寸縮水。
  //
  // 流程:
  //   UI 座標 ──(÷ oldM*S)──▶ 像素座標 ──(旋轉)──▶ 像素座標 ──(× newM*S)──▶ UI 座標
  //   imageOffset ──(向量旋轉)──▶ newImageOffset
  const handleRotate = useCallback(
    (direction: "left" | "right") => {
      applyTransformAndGenerate((prevState, oldInfo) => {
        const oldM = oldInfo.displayMultiplier;
        const S = prevState.scale;

        // ── 1. 旋轉前的有效像素尺寸 ──
        const oldIsLeaning = Math.abs(prevState.baseRotate % 180) === 90;
        const oldEffW = oldIsLeaning ? oldInfo.naturalHeight : oldInfo.naturalWidth;
        const oldEffH = oldIsLeaning ? oldInfo.naturalWidth : oldInfo.naturalHeight;

        // ── Debug: BEFORE ──
        console.log('[Rotation Debug - BEFORE]', {
          naturalWidth: oldInfo.naturalWidth,
          naturalHeight: oldInfo.naturalHeight,
          baseRotate: prevState.baseRotate,
          oldEffW, oldEffH, oldM, S,
          imageOffset: { x: prevState.imageX, y: prevState.imageY },
          cropBox: { x: prevState.cropX, y: prevState.cropY, w: prevState.cropW, h: prevState.cropH },
          container: { w: oldInfo.containerWidth, h: oldInfo.containerHeight },
          exportWouldBe: { w: Math.round(prevState.cropW / oldM), h: Math.round(prevState.cropH / oldM) },
        });

        // ── 2. 強制重新計算 newM（嚴禁沿用旋轉前的 M）──
        const newBaseRotate =
          direction === "right"
            ? (prevState.baseRotate + 90) % 360
            : (prevState.baseRotate - 90 + 360) % 360;

        const {
          M: newM,
          effW: newEffW,
          effH: newEffH,
          containerWidth: newContainerW,
          containerHeight: newContainerH,
        } = calculateContainerParams(
          oldInfo.naturalWidth,
          oldInfo.naturalHeight,
          newBaseRotate,
        );

        // ── 3. 位移向量旋轉（不歸零）──
        //    CW  90°: (x, y) → (-y,  x)
        //    CCW 90°: (x, y) → ( y, -x)
        let newImageX: number, newImageY: number;
        if (direction === "right") {
          newImageX = -prevState.imageY;
          newImageY = prevState.imageX;
        } else {
          newImageX = prevState.imageY;
          newImageY = -prevState.imageX;
        }

        // ── 4. cropBox UI 座標 → 像素座標 ──
        //    圖片視覺左上角 = container*(1-S)/2 + imageOffset
        const oldVisualLeft = oldInfo.containerWidth * (1 - S) / 2 + prevState.imageX;
        const oldVisualTop = oldInfo.containerHeight * (1 - S) / 2 + prevState.imageY;

        const pxX = (prevState.cropX - oldVisualLeft) / (oldM * S);
        const pxY = (prevState.cropY - oldVisualTop) / (oldM * S);
        const pxW = prevState.cropW / (oldM * S);
        const pxH = prevState.cropH / (oldM * S);

        // ── 5. 像素座標 90° 旋轉 ──
        let newPxX: number, newPxY: number, newPxW: number, newPxH: number;

        if (direction === "right") {
          // CW 90°: (x, y, w, h) → (effH - y - h, x, h, w)
          newPxX = oldEffH - pxY - pxH;
          newPxY = pxX;
          newPxW = pxH;
          newPxH = pxW;
        } else {
          // CCW 90°: (x, y, w, h) → (y, effW - x - w, h, w)
          newPxX = pxY;
          newPxY = oldEffW - pxX - pxW;
          newPxW = pxH;
          newPxH = pxW;
        }

        // ── 6. 像素座標 → 新 UI 座標（使用 newM * S + 旋轉後的 offset）──
        const newVisualLeft = newContainerW * (1 - S) / 2 + newImageX;
        const newVisualTop = newContainerH * (1 - S) / 2 + newImageY;

        const rawCropX = newPxX * newM * S + newVisualLeft;
        const rawCropY = newPxY * newM * S + newVisualTop;
        const rawCropW = newPxW * newM * S;
        const rawCropH = newPxH * newM * S;

        // ── 7. Clamp（保護性，正常情況不應截斷）──
        const clampedCropX = Math.max(0, Math.min(newContainerW - 50, Math.round(rawCropX)));
        const clampedCropY = Math.max(0, Math.min(newContainerH - 50, Math.round(rawCropY)));
        const clampedCropW = Math.max(50, Math.min(newContainerW - clampedCropX, Math.round(rawCropW)));
        const clampedCropH = Math.max(50, Math.min(newContainerH - clampedCropY, Math.round(rawCropH)));

        // ── 8. 組裝新狀態 ──
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

        // ── Debug: AFTER ──
        console.log('[Rotation Debug - AFTER]', {
          direction, newBaseRotate, newEffW, newEffH,
          oldM, newM, M_changed: oldM !== newM,
          imageOffset: { x: newImageX, y: newImageY },
          container: { w: newContainerW, h: newContainerH },
          pixelCrop: { x: newPxX, y: newPxY, w: newPxW, h: newPxH },
          rawUiCrop: { x: rawCropX, y: rawCropY, w: rawCropW, h: rawCropH },
          clampedCrop: { x: clampedCropX, y: clampedCropY, w: clampedCropW, h: clampedCropH },
          exportWillBe: { w: Math.round(clampedCropW / newM), h: Math.round(clampedCropH / newM) },
          // 驗證
          effW_swapped: newEffW === oldEffH,
          natural_unchanged: newInfo.naturalWidth === oldInfo.naturalWidth && newInfo.naturalHeight === oldInfo.naturalHeight,
          clamp_didnt_cut: Math.round(rawCropW) === clampedCropW && Math.round(rawCropH) === clampedCropH,
        });

        return { newState, newInfo };
      }, true); // is90Rotation = true
    },
    [applyTransformAndGenerate],
  );

  /**
   * 翻轉 (基於圖片自身軸)
   * 由於變換順序為 flip → rotate，翻轉永遠是基於圖片自身的軸：
   * - 水平翻轉 (flipX): 圖片以自身垂直中軸做左右鏡像
   * - 垂直翻轉 (flipY): 圖片以自身水平中軸做上下鏡像
   * 不論目前旋轉幾度，翻轉效果都一致。
   */
  const handleFlip = useCallback(
    (axis: "x" | "y") => {
      applyTransformAndGenerate((prevState, oldInfo) => {
        // 鏡像裁切框位置：在圖片顯示範圍內做鏡像
        // 化簡公式: newCrop = containerSize + 2*imageOffset - crop - cropSize
        let { cropX, cropY } = prevState;
        if (axis === "x") {
          const displayW = oldInfo.containerWidth * prevState.scale;
          const visualLeft =
            oldInfo.containerWidth / 2 + prevState.imageX - displayW / 2;
          cropX =
            visualLeft + (displayW - (cropX - visualLeft) - prevState.cropW);
        } else {
          const displayH = oldInfo.containerHeight * prevState.scale;
          const visualTop =
            oldInfo.containerHeight / 2 + prevState.imageY - displayH / 2;
          cropY =
            visualTop + (displayH - (cropY - visualTop) - prevState.cropH);
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

  // 當前狀態
  const currentFlipX = pipelineState?.editorState.flipX ?? false;
  const currentFlipY = pipelineState?.editorState.flipY ?? false;

  // ============================
  // JSX — 新版佈局
  // ============================

  // 未載入圖片: 全螢幕上傳畫面
  if (!imageSrc) {
    return (
      <div className="min-h-screen bg-preview flex flex-col items-center justify-center">
        <div className="flex flex-col items-center gap-6">
          <h1 className="text-3xl font-bold text-sidebar">圖片處理工具</h1>
          <label
            htmlFor="image-upload"
            className="px-8 py-4 bg-highlight text-black font-bold rounded-[10px] cursor-pointer transition-all btn-highlight hover:brightness-110 text-lg"
          >
            選擇圖片
          </label>
          <input
            id="image-upload"
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
          />
          <p className="text-sm text-gray-500">支援 JPG, PNG, WebP 等格式</p>
        </div>
      </div>
    );
  }

  // 已載入圖片: Sidebar + Preview 佈局
  return (
    <div className="h-screen flex overflow-hidden bg-sidebar">
      {/* ===== 左側 Sidebar ===== */}
      <aside className="w-[30%] min-w-[240px] max-w-[320px] flex flex-col h-screen sticky top-0 sidebar-scroll overflow-y-auto bg-sidebar">
        {/* 頂部: 標題 */}
        <div className="p-4 pb-2">
          <h1 className="text-lg font-bold text-white">圖片處理工具</h1>
          {pipelineState && (
            <p className="text-xs text-white/70 mt-1 font-mono">
              {pipelineState.imageInfo.naturalWidth} ×{" "}
              {pipelineState.imageInfo.naturalHeight} px
            </p>
          )}
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
              onScaleChange={(s) => editorControlRef.current?.setScale(s)}
              onRotateChange={(r) => editorControlRef.current?.setRotate(r)}
            />
          )}

          {mode === "output" && outputSettings && (
            <OutputSettingsPanel
              settings={outputSettings}
              onUpdateSettings={handleUpdateOutputSettings}
              onApply={handleApplyOutput}
              onReturn={handleReturnFromOutput}
              isExporting={isExporting}
              previewUrl={pipelineState?.previewUrl ?? null}
            />
          )}
        </div>

        {/* 底部: 選擇其他圖片 */}
        <div className="p-4 pt-0">
          {mode === "preview" && (
            <button
              onClick={handleReset}
              className="w-full px-4 py-2 text-white/70 hover:text-white text-sm transition-colors"
            >
              選擇其他圖片
            </button>
          )}
        </div>
      </aside>

      {/* ===== 右側預覽區 ===== */}
      <main className="flex-1 bg-preview flex items-center justify-center m-4 rounded-lg">
        {mode === "preview" || mode === "output" ? (
          <PreviewWorkspace
            previewUrl={pipelineState?.previewUrl ?? null}
            originalSrc={imageSrc}
            isProcessing={isExporting}
            outputWidth={pipelineState?.outputWidth ?? 400}
            outputHeight={pipelineState?.outputHeight ?? 300}
          />
        ) : (
          pipelineState && (
            <ImageEditor
              src={imageSrc}
              onStateChange={handleStateChange}
              initialState={pipelineState.editorState}
              showControls={false}
              onEditorControlRef={editorControlRef}
            />
          )
        )}
      </main>
    </div>
  );
}

// ============================================================
// Sub-components (dark sidebar theme)
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
  pipelineState: PipelineState | null;
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* 旋轉區塊 */}
      <div className="bg-white/10 rounded-[10px] p-3">
        <p className="text-xs text-white/70 mb-2 font-medium">旋轉</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onRotateLeft}
            disabled={isExporting || !pipelineState}
            className="px-2 py-2 text-sm bg-white/10 hover:bg-white/20 disabled:opacity-30 text-white rounded-[10px] transition-colors"
            title="左轉 90°"
          >
            ↺ 左轉
          </button>
          <button
            onClick={onRotateRight}
            disabled={isExporting || !pipelineState}
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
            disabled={isExporting || !pipelineState}
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
            disabled={isExporting || !pipelineState}
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
      {pipelineState && (
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
      )}

      {/* 底部按鈕 */}
      <div className="flex flex-col gap-2 mt-auto pt-4">
        <button
          onClick={onEnterCropMode}
          disabled={isExporting || !pipelineState}
          className="w-full px-4 py-3 bg-white/10 hover:bg-white/20 disabled:opacity-30 text-white rounded-[10px] transition-colors font-medium"
        >
          進入裁切模式
        </button>
        <button
          onClick={onEnterOutputMode}
          disabled={isExporting || !pipelineState}
          className="w-full px-4 py-3 bg-highlight text-black font-bold rounded-[10px] transition-all btn-highlight disabled:opacity-30"
        >
          導出圖片
        </button>
      </div>
    </div>
  );
}

/** 裁切控制面板 (Crop mode) — 含縮放/旋轉滑桿 */
function CropControlPanel({
  onConfirm,
  onCancel,
  isExporting,
  scale,
  rotate,
  onScaleChange,
  onRotateChange,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  isExporting: boolean;
  scale: number;
  rotate: number;
  onScaleChange: (s: number) => void;
  onRotateChange: (r: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-white font-medium">裁切模式</p>
      <p className="text-xs text-white/70">拖動框框調整裁切範圍，滾輪縮放</p>

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
          onChange={(e) => onRotateChange(parseFloat(e.target.value))}
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

/** 可點擊編輯的數字 (dark theme) */
function DarkEditableNumber({
  value,
  min,
  max,
  suffix = "",
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(String(value));

  const commit = () => {
    setEditing(false);
    const num = parseInt(inputValue);
    if (!isNaN(num) && num >= min && num <= max) {
      onChange(num);
    } else {
      setInputValue(String(value));
    }
  };

  if (editing) {
    return (
      <input
        type="number"
        min={min}
        max={max}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setInputValue(String(value));
            setEditing(false);
          }
        }}
        autoFocus
        className="w-16 px-1 py-0 text-xs text-right input-dark"
      />
    );
  }

  return (
    <span
      onClick={() => {
        setInputValue(String(value));
        setEditing(true);
      }}
      className="text-xs text-white/70 font-medium cursor-pointer hover:text-highlight transition-colors"
      title="點擊輸入數值"
    >
      {value}
      {suffix}
    </span>
  );
}

/** 輸出設定面板 (Output mode) */
function OutputSettingsPanel({
  settings,
  onUpdateSettings,
  onApply,
  onReturn,
  isExporting,
  previewUrl,
}: {
  settings: OutputSettings;
  onUpdateSettings: (updates: Partial<OutputSettings>) => void;
  onApply: () => void;
  onReturn: () => void;
  isExporting: boolean;
  previewUrl: string | null;
}) {
  // 本地輸入狀態 (字串，允許空值)
  const [widthInput, setWidthInput] = useState(String(settings.targetWidth));
  const [heightInput, setHeightInput] = useState(String(settings.targetHeight));
  const [widthError, setWidthError] = useState(false);
  const [heightError, setHeightError] = useState(false);

  const { baseWidth, baseHeight, lockAspectRatio, format } = settings;

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
    settings.targetWidth !== baseWidth || settings.targetHeight !== baseHeight;
  const hasError = widthError || heightError;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-white font-medium">輸出設定</p>

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
      <div className="bg-white/10 rounded-[10px] p-3">
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
                    onChange={(val) => onUpdateSettings({ quality: val })}
                  />
                </div>
                <input
                  type="range"
                  min={10}
                  max={100}
                  step={1}
                  value={settings.quality}
                  onChange={(e) =>
                    onUpdateSettings({ quality: parseInt(e.target.value) })
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
                      targetKB: isNaN(val) ? null : Math.max(1, val),
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
            輸出尺寸: {settings.targetWidth} × {settings.targetHeight} px
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
          className="w-full px-4 py-3 bg-highlight text-black font-bold rounded-[10px] transition-all btn-highlight disabled:opacity-30"
        >
          {isExporting ? "處理中..." : "套用並預覽"}
        </button>
        {previewUrl && (
          <a
            href={previewUrl}
            download="processed-image.png"
            className="w-full px-4 py-2 text-center text-sm text-white/80 hover:text-white border border-white/20 rounded-[10px] transition-colors block"
          >
            下載圖片
          </a>
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

/** 計算預覽顯示倍率 - 符合 IMAGE_CROPPER_SPEC V7 (雙向限制) */
function calculatePreviewMultiplier(width: number, height: number): number {
  const MIN_WIDTH = CONTAINER_MIN_WIDTH,
    MAX_WIDTH = CONTAINER_MAX_WIDTH;
  const MIN_HEIGHT = CONTAINER_MIN_HEIGHT,
    MAX_HEIGHT = CONTAINER_MAX_HEIGHT;

  const Mw =
    width > MAX_WIDTH
      ? MAX_WIDTH / width
      : width < MIN_WIDTH
        ? MIN_WIDTH / width
        : 1;

  const Mh =
    height > MAX_HEIGHT
      ? MAX_HEIGHT / height
      : height < MIN_HEIGHT
        ? MIN_HEIGHT / height
        : 1;

  const needsShrink = width > MAX_WIDTH || height > MAX_HEIGHT;
  const needsEnlarge = width < MIN_WIDTH || height < MIN_HEIGHT;

  if (needsShrink) return Math.min(Mw, Mh);
  if (needsEnlarge) return Math.max(Mw, Mh);
  return 1;
}

/** 預覽工作區 */
function PreviewWorkspace({
  previewUrl,
  originalSrc,
  isProcessing,
  outputWidth,
  outputHeight,
}: {
  previewUrl: string | null;
  originalSrc: string;
  isProcessing?: boolean;
  outputWidth: number;
  outputHeight: number;
}) {
  const displayUrl = previewUrl ?? originalSrc;
  const hasCropResult = previewUrl !== null;

  // 計算顯示倍率 M
  const M = calculatePreviewMultiplier(outputWidth, outputHeight);
  const displayWidth = Math.round(outputWidth * M);
  const displayHeight = Math.round(outputHeight * M);

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

export default App;
