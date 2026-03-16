import { useRef, useEffect, useCallback, useState, type Dispatch, type SetStateAction } from "react";
import {
  useImageEditor,
  type EditorState,
  type ImageInfo,
} from "../../hooks/useImageEditor";

interface ImageEditorProps {
  /** 圖片來源 */
  src: string;
  /** 狀態變更回調 */
  onStateChange?: (state: EditorState, imageInfo: ImageInfo | null) => void;
  /** 初始狀態 (用於恢復上次的裁切參數) */
  initialState?: EditorState;
  /** 是否顯示控制面板 */
  showControls?: boolean;
  /** 旋轉/翻轉控制回調 (由外部提供按鈕) */
  onRotateFlipRef?: React.MutableRefObject<{
    rotateLeft: () => void;
    rotateRight: () => void;
    flipX: () => void;
    flipY: () => void;
  } | null>;
  /** 縮放/旋轉/裁切框控制回調 (由外部 sidebar 控制) */
  onEditorControlRef?: React.MutableRefObject<{
    setScale: (s: number) => void;
    setRotate: (r: number) => void;
    setCropBox: (crop: { cropX: number; cropY: number; cropW: number; cropH: number }, animated?: boolean) => void;
    setRatioLock: (locked: boolean, ratio: number | null) => void;
  } | null>;
  /** 比例鎖定狀態（外部控制） */
  isRatioLocked?: boolean;
  onRatioLockChange?: Dispatch<SetStateAction<boolean>>;
  /** 已選比例文字（外部控制，解鎖時清除） */
  onSelectedCropRatioChange?: Dispatch<SetStateAction<string | null>>;
  /** 操作模式：移動圖片 or 移動裁切框 */
  editMode?: "move-image" | "move-crop";
  /** 預覽容器實際寬度 (用於 viewport-aware M 計算) */
  viewportWidth?: number;
  /** 預覽容器實際高度 */
  viewportHeight?: number;
  /** initialState 座標所基於的 M 值 (用於座標歸一化) */
  referenceM?: number;
}

type ResizeHandle = "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";

export function ImageEditor({
  src,
  onStateChange,
  initialState,
  showControls = false,
  onRotateFlipRef,
  onEditorControlRef,
  viewportWidth,
  viewportHeight,
  referenceM,
  isRatioLocked = false,
  onRatioLockChange,
  onSelectedCropRatioChange,
  editMode = "move-image",
}: ImageEditorProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [imageLoaded, setImageLoaded] = useState(false);

  // 拖動狀態
  const [isResizing, setIsResizing] = useState<ResizeHandle | null>(null);
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [isDraggingCropBox, setIsDraggingCropBox] = useState(false);
  const [isSnappingBack, setIsSnappingBack] = useState(false);
  const [isCropAnimating, setIsCropAnimating] = useState(false);
  const dragStartRef = useRef({
    x: 0,
    y: 0,
    cropX: 0,
    cropY: 0,
    cropW: 0,
    cropH: 0,
    imageX: 0,
    imageY: 0,
  });
  // 雙指縮放狀態
  const pinchRef = useRef({ active: false, startDist: 0, startScale: 1 });
  // 比例鎖定
  const lockedRatioRef = useRef<number | null>(null);

  // V8: 傳入 viewport 尺寸供 viewport-aware M 計算
  const editor = useImageEditor({ initialState, viewportWidth, viewportHeight, referenceM });

  const {
    state,
    imageInfo,
    imageTransform,
    initialize,
    setScale,
    setRotate,
    setImagePosition,
    clampImage,
    rotateBy90,
    toggleFlipX,
    toggleFlipY,
    resizeCropBox,
    resizeCropBoxLocked,
    moveCropBox,
    setCropBox,
  } = editor;

  // 暴露旋轉/翻轉函數給外部
  useEffect(() => {
    if (onRotateFlipRef) {
      onRotateFlipRef.current = {
        rotateLeft: () => rotateBy90("left"),
        rotateRight: () => rotateBy90("right"),
        flipX: toggleFlipX,
        flipY: toggleFlipY,
      };
    }
    return () => {
      if (onRotateFlipRef) {
        onRotateFlipRef.current = null;
      }
    };
  }, [onRotateFlipRef, rotateBy90, toggleFlipX, toggleFlipY]);

  // 暴露縮放/旋轉/裁切框控制給外部 sidebar
  useEffect(() => {
    if (onEditorControlRef) {
      onEditorControlRef.current = {
        setScale,
        setRotate,
        setCropBox: (crop, animated = false) => {
          if (animated) {
            setIsCropAnimating(true);
            setTimeout(() => setIsCropAnimating(false), 450);
          }
          setCropBox(crop);
        },
        setRatioLock: (locked, ratio) => {
          lockedRatioRef.current = ratio;
          onRatioLockChange?.(locked);
        },
      };
    }
    return () => {
      if (onEditorControlRef) {
        onEditorControlRef.current = null;
      }
    };
  }, [onEditorControlRef, setScale, setRotate, setCropBox, onRatioLockChange]);

  // 圖片載入 - 初始化編輯器
  const handleImageLoad = useCallback(() => {
    const img = imageRef.current;
    if (!img) return;

    initialize(img.naturalWidth, img.naturalHeight);
    setImageLoaded(true);
  }, [initialize]);

  // 回報狀態變更
  useEffect(() => {
    onStateChange?.(state, imageInfo);
  }, [state, imageInfo, onStateChange]);

  // --- 調整大小 ---
  const handleResizeMouseDown = useCallback(
    (handle: ResizeHandle) => (e: React.MouseEvent) => {
      e.stopPropagation();
      setIsResizing(handle);
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        cropX: state.cropX,
        cropY: state.cropY,
        cropW: state.cropW,
        cropH: state.cropH,
        imageX: 0,
        imageY: 0,
      };
    },
    [state.cropX, state.cropY, state.cropW, state.cropH],
  );

  // --- 拖動圖片 or 裁切框 ---
  const handleContainerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (editMode === "move-crop") {
        setIsDraggingCropBox(true);
        dragStartRef.current = {
          x: e.clientX, y: e.clientY,
          cropX: state.cropX, cropY: state.cropY,
          cropW: 0, cropH: 0, imageX: 0, imageY: 0,
        };
      } else {
        setIsDraggingImage(true);
        dragStartRef.current = {
          x: e.clientX, y: e.clientY,
          cropX: 0, cropY: 0, cropW: 0, cropH: 0,
          imageX: state.imageX, imageY: state.imageY,
        };
      }
    },
    [editMode, state.scale, state.rotate, state.imageX, state.imageY, state.cropX, state.cropY],
  );

  // --- 觸控：調整裁切框大小 ---
  const handleResizeTouchStart = useCallback(
    (handle: ResizeHandle) => (e: React.TouchEvent) => {
      e.stopPropagation();
      const touch = e.touches[0];
      setIsResizing(handle);
      dragStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        cropX: state.cropX,
        cropY: state.cropY,
        cropW: state.cropW,
        cropH: state.cropH,
        imageX: 0,
        imageY: 0,
      };
    },
    [state.cropX, state.cropY, state.cropW, state.cropH],
  );

  // --- 觸控：拖動圖片/裁切框 / 雙指縮放 ---
  const handleContainerTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchRef.current = {
          active: true,
          startDist: Math.hypot(dx, dy),
          startScale: state.scale,
        };
      } else if (e.touches.length === 1) {
        const touch = e.touches[0];
        const touchOffsetY = editMode === "move-crop" ? -20 : 0;
        if (editMode === "move-crop") {
          setIsDraggingCropBox(true);
          dragStartRef.current = {
            x: touch.clientX, y: touch.clientY + touchOffsetY,
            cropX: state.cropX, cropY: state.cropY,
            cropW: 0, cropH: 0, imageX: 0, imageY: 0,
          };
        } else {
          setIsDraggingImage(true);
          dragStartRef.current = {
            x: touch.clientX, y: touch.clientY,
            cropX: 0, cropY: 0, cropW: 0, cropH: 0,
            imageX: state.imageX, imageY: state.imageY,
          };
        }
      }
    },
    [editMode, state.scale, state.imageX, state.imageY, state.cropX, state.cropY],
  );

  // --- 全域滑鼠 + 觸控事件 ---
  useEffect(() => {
    const handleMove = (clientX: number, clientY: number) => {
      const deltaX = clientX - dragStartRef.current.x;
      const deltaY = clientY - dragStartRef.current.y;

      if (isResizing) {
        setCropBox({
          cropX: dragStartRef.current.cropX,
          cropY: dragStartRef.current.cropY,
          cropW: dragStartRef.current.cropW,
          cropH: dragStartRef.current.cropH,
        });
        if (isRatioLocked && lockedRatioRef.current) {
          resizeCropBoxLocked(isResizing, deltaX, deltaY, lockedRatioRef.current);
        } else {
          resizeCropBox(isResizing, deltaX, deltaY);
        }
      } else if (isDraggingCropBox) {
        setCropBox({
          cropX: dragStartRef.current.cropX,
          cropY: dragStartRef.current.cropY,
        });
        moveCropBox(deltaX, deltaY);
      } else if (isDraggingImage) {
        setImagePosition(
          dragStartRef.current.imageX + deltaX,
          dragStartRef.current.imageY + deltaY,
        );
      }
    };

    const handleMouseMove = (e: MouseEvent) => handleMove(e.clientX, e.clientY);

    const handleTouchMove = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
      if (e.touches.length === 2 && pinchRef.current.active) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const ratio = dist / pinchRef.current.startDist;
        setScale(pinchRef.current.startScale * ratio);
        return;
      }
      if (e.touches.length === 1) {
        handleMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    const handleEnd = () => {
      setIsResizing(null);
      setIsDraggingImage(false);
      setIsDraggingCropBox(false);
      pinchRef.current.active = false;
      setIsSnappingBack(true);
      clampImage();
    };

    if (isResizing || isDraggingImage || isDraggingCropBox || pinchRef.current.active) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleEnd);
      window.addEventListener("touchmove", handleTouchMove, { passive: false });
      window.addEventListener("touchend", handleEnd);
      window.addEventListener("touchcancel", handleEnd);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleEnd);
        window.removeEventListener("touchmove", handleTouchMove);
        window.removeEventListener("touchend", handleEnd);
        window.removeEventListener("touchcancel", handleEnd);
      };
    }
  }, [
    isResizing,
    isDraggingImage,
    isDraggingCropBox,
    setCropBox,
    resizeCropBox,
    moveCropBox,
    setImagePosition,
    clampImage,
    setScale,
  ]);

  // 回彈動畫結束後重置 (fallback timeout 防止 transitionEnd 未觸發)
  useEffect(() => {
    if (isSnappingBack) {
      const timer = setTimeout(() => setIsSnappingBack(false), 250);
      return () => clearTimeout(timer);
    }
  }, [isSnappingBack]);

  // --- 滾輪縮放 ---
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      // 向前滾 (deltaY < 0) = 放大，向後滾 (deltaY > 0) = 縮小
      const delta = -e.deltaY * 0.001;
      setScale(state.scale + delta);
    },
    [state.scale, setScale],
  );

  const { cropX, cropY, cropW, cropH, scale, rotate } = state;

  // V6: 容器尺寸由 imageInfo 決定
  const containerWidth = imageInfo?.containerWidth ?? 400;
  const containerHeight = imageInfo?.containerHeight ?? 300;

  // 裁切框動畫過渡 (僅在程式化設定裁切比例時啟用，手動拖動時不啟用)
  const cropTransition = isCropAnimating && !isResizing && !isDraggingImage
    ? "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)"
    : "none";

  return (
    <div className="flex flex-col gap-4" style={{ width: containerWidth }}>
      {/* 容器 - V6: 尺寸 = 原始尺寸 * displayMultiplier，保持原始比例 */}
      <div
        className="relative select-none flex-shrink-0"
        style={{
          width: containerWidth,
          height: containerHeight,
          cursor: (isDraggingImage || isDraggingCropBox) ? "grabbing" : (editMode === "move-crop" ? "move" : "grab"),
          touchAction: "none",
        }}
        onWheel={handleWheel}
        onMouseDown={handleContainerMouseDown}
        onTouchStart={handleContainerTouchStart}
      >
        {/* 裁剪層: 棋盤格 + 圖片 + 遮罩 (overflow-hidden) */}
        <div className="absolute inset-0 overflow-hidden">
          {/* Layer 0: 棋盤格背景 (用於顯示透明區域) */}
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `
                linear-gradient(45deg, #404040 25%, transparent 25%),
                linear-gradient(-45deg, #404040 25%, transparent 25%),
                linear-gradient(45deg, transparent 75%, #404040 75%),
                linear-gradient(-45deg, transparent 75%, #404040 75%)
              `,
              backgroundSize: "20px 20px",
              backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px",
              backgroundColor: "#808080",
              opacity: 0.5,
            }}
          />

          {/* Layer 1: 圖片層 - 圖片維持原始比例 (naturalWidth*M × naturalHeight*M) */}
          <div className="absolute inset-0 flex items-center justify-center">
            <img
              ref={imageRef}
              src={src}
              alt=""
              onLoad={handleImageLoad}
              draggable={false}
              className="max-w-none pointer-events-none"
              style={{
                width: imageInfo
                  ? imageInfo.naturalWidth * imageInfo.displayMultiplier
                  : containerWidth,
                height: imageInfo
                  ? imageInfo.naturalHeight * imageInfo.displayMultiplier
                  : containerHeight,
                transform: imageTransform,
                transformOrigin: "center center",
                transition: isSnappingBack ? "transform 200ms ease-out" : "none",
                willChange: "transform",
              }}
            />
          </div>

          {/* Layer 2: 遮罩層 */}
          {imageInfo && imageLoaded && (
            <div className="absolute inset-0 pointer-events-none">
              <div
                className="absolute bg-black/50"
                style={{ top: 0, left: 0, right: 0, height: cropY, transition: cropTransition }}
              />
              <div
                className="absolute bg-black/50"
                style={{ top: cropY + cropH, left: 0, right: 0, bottom: 0, transition: cropTransition }}
              />
              <div
                className="absolute bg-black/50"
                style={{ top: cropY, left: 0, width: cropX, height: cropH, transition: cropTransition }}
              />
              <div
                className="absolute bg-black/50"
                style={{
                  top: cropY,
                  left: cropX + cropW,
                  right: 0,
                  height: cropH,
                  transition: cropTransition,
                }}
              />
            </div>
          )}
        </div>

        {/* Layer 3: 裁切框 + 手把 — 不受 overflow-hidden 限制 */}
        {imageInfo && imageLoaded && (
          <div
            className="absolute border-2 pointer-events-none"
            style={{
              left: cropX,
              top: cropY,
              width: cropW,
              height: cropH,
              borderColor: "#D4FF3F",
              transition: cropTransition,
            }}
          >
            {/* 九宮格 */}
            <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none">
              {[...Array(9)].map((_, i) => (
                <div
                  key={i}
                  className="border"
                  style={{ borderColor: "rgba(212, 255, 63, 0.3)" }}
                />
              ))}
            </div>

            {/* 四角 Handles (含擴展觸控區) */}
            {(["nw", "ne", "sw", "se"] as const).map((handle) => (
              <div
                key={handle}
                className="absolute w-4 h-4 pointer-events-auto crop-handle"
                style={{
                  top: handle.includes("n") ? -8 : "auto",
                  bottom: handle.includes("s") ? -8 : "auto",
                  left: handle.includes("w") ? -8 : "auto",
                  right: handle.includes("e") ? -8 : "auto",
                  cursor:
                    handle === "nw" || handle === "se"
                      ? "nwse-resize"
                      : "nesw-resize",
                  backgroundColor: "#D4FF3F",
                  borderRadius: 2,
                }}
                onMouseDown={handleResizeMouseDown(handle)}
                onTouchStart={handleResizeTouchStart(handle)}
              />
            ))}

            {/* 裁切尺寸標籤 — 僅桌面端顯示 */}
            {imageInfo && (
              <div
                className="hidden md:block absolute left-1/2 -translate-x-1/2 pointer-events-none whitespace-nowrap"
                style={{
                  bottom: -24,
                  fontSize: 12,
                  color: "#D4FF3F",
                  textShadow: "0 1px 3px rgba(0,0,0,0.8)",
                }}
              >
                {Math.round(cropW / (imageInfo.displayMultiplier * scale))}
                {" × "}
                {Math.round(cropH / (imageInfo.displayMultiplier * scale))}
                {" px"}
              </div>
            )}

            {/* 四邊 Handles (含擴展觸控區) */}
            {(["n", "s", "e", "w"] as const).map((handle) => (
              <div
                key={handle}
                className="absolute pointer-events-auto crop-handle"
                style={{
                  backgroundColor: "#D4FF3F",
                  borderRadius: 3,
                  ...(handle === "n" && {
                    top: -3,
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: 30,
                    height: 6,
                    cursor: "ns-resize",
                  }),
                  ...(handle === "s" && {
                    bottom: -3,
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: 30,
                    height: 6,
                    cursor: "ns-resize",
                  }),
                  ...(handle === "w" && {
                    left: -3,
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: 6,
                    height: 30,
                    cursor: "ew-resize",
                  }),
                  ...(handle === "e" && {
                    right: -3,
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: 6,
                    height: 30,
                    cursor: "ew-resize",
                  }),
                }}
                onMouseDown={handleResizeMouseDown(handle)}
                onTouchStart={handleResizeTouchStart(handle)}
              />
            ))}
          </div>
        )}

        {/* 比例鎖定按鈕 — 跟隨裁切框右上角 */}
        {imageInfo && imageLoaded && (
          <button
            onClick={() => {
              if (isRatioLocked) {
                onRatioLockChange?.(false);
                lockedRatioRef.current = null;
                onSelectedCropRatioChange?.(null);
              } else if (cropW > 0 && cropH > 0) {
                onRatioLockChange?.(true);
                lockedRatioRef.current = cropW / cropH;
              }
            }}
            className={`absolute z-10 w-7 h-7 flex items-center justify-center rounded-full transition-colors ${
              isRatioLocked
                ? "bg-highlight text-black shadow-lg shadow-highlight/30"
                : "bg-black/50 text-white/60 hover:text-white hover:bg-black/70"
            }`}
            style={{
              left: cropX + cropW - 40,
              top: cropY + 14,
              transition: cropTransition !== "none" ? "left 0.4s cubic-bezier(0.4,0,0.2,1), top 0.4s cubic-bezier(0.4,0,0.2,1)" : "none",
            }}
            title={isRatioLocked ? "解鎖比例" : "鎖定比例"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {isRatioLocked ? (
                <>
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </>
              ) : (
                <>
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                </>
              )}
            </svg>
          </button>
        )}
      </div>

      {/* 控制面板 (僅在 showControls=true 時顯示，新版由 sidebar 控制) */}
      {showControls && imageInfo && (
        <div className="flex flex-col gap-3 p-3 bg-white rounded shadow">
          {/* Scale 滑桿 */}
          <div className="flex items-center gap-3">
            <label className="w-16 text-sm text-gray-600">縮放</label>
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={scale}
              onChange={(e) => setScale(parseFloat(e.target.value))}
              className="flex-1"
            />
            <span className="w-12 text-sm text-right">
              {Math.round(scale * 100)}%
            </span>
          </div>

          {/* Rotate 滑桿 */}
          <div className="flex items-center gap-3">
            <label className="w-16 text-sm text-gray-600">旋轉</label>
            <input
              type="range"
              min={-180}
              max={180}
              step={1}
              value={rotate}
              onChange={(e) => setRotate(parseFloat(e.target.value))}
              className="flex-1"
            />
            <span className="w-12 text-sm text-right">
              {Math.round(rotate)}°
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
