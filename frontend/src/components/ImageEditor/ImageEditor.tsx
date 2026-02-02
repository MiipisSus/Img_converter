import { useRef, useEffect, useCallback, useState } from 'react'
import { useImageEditor, type EditorState, type ImageInfo } from '../../hooks/useImageEditor'

interface ImageEditorProps {
  /** 圖片來源 */
  src: string
  /** 狀態變更回調 */
  onStateChange?: (state: EditorState, imageInfo: ImageInfo | null) => void
}

type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w'

export function ImageEditor({
  src,
  onStateChange,
}: ImageEditorProps) {
  const imageRef = useRef<HTMLImageElement>(null)
  const [imageLoaded, setImageLoaded] = useState(false)

  // 拖動狀態
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState<ResizeHandle | null>(null)
  const dragStartRef = useRef({ x: 0, y: 0, cropX: 0, cropY: 0, cropW: 0, cropH: 0 })

  // V5: useImageEditor 不再需要 viewport 尺寸參數
  const editor = useImageEditor({})

  const {
    state,
    imageInfo,
    imageTransform,
    initialize,
    setScale,
    setRotate,
    moveCropBox,
    resizeCropBox,
    setCropBox,
  } = editor

  // 圖片載入 - 初始化編輯器
  const handleImageLoad = useCallback(() => {
    const img = imageRef.current
    if (!img) return

    initialize(img.naturalWidth, img.naturalHeight)
    setImageLoaded(true)
  }, [initialize])

  // 回報狀態變更
  useEffect(() => {
    onStateChange?.(state, imageInfo)
  }, [state, imageInfo, onStateChange])

  // --- 裁切框拖動 ---
  const handleCropBoxMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      setIsDragging(true)
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        cropX: state.cropX,
        cropY: state.cropY,
        cropW: state.cropW,
        cropH: state.cropH,
      }
    },
    [state.cropX, state.cropY, state.cropW, state.cropH]
  )

  // --- 調整大小 ---
  const handleResizeMouseDown = useCallback(
    (handle: ResizeHandle) => (e: React.MouseEvent) => {
      e.stopPropagation()
      setIsResizing(handle)
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        cropX: state.cropX,
        cropY: state.cropY,
        cropW: state.cropW,
        cropH: state.cropH,
      }
    },
    [state.cropX, state.cropY, state.cropW, state.cropH]
  )

  // --- 全域滑鼠事件 ---
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragStartRef.current.x
      const deltaY = e.clientY - dragStartRef.current.y

      if (isDragging) {
        setCropBox({
          cropX: dragStartRef.current.cropX + deltaX,
          cropY: dragStartRef.current.cropY + deltaY,
        })
        moveCropBox(0, 0)
      } else if (isResizing) {
        setCropBox({
          cropX: dragStartRef.current.cropX,
          cropY: dragStartRef.current.cropY,
          cropW: dragStartRef.current.cropW,
          cropH: dragStartRef.current.cropH,
        })
        resizeCropBox(isResizing, deltaX, deltaY)
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      setIsResizing(null)
    }

    if (isDragging || isResizing) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDragging, isResizing, setCropBox, moveCropBox, resizeCropBox])

  const { cropX, cropY, cropW, cropH, scale, rotate } = state

  // V6: 容器尺寸由 imageInfo 決定
  const containerWidth = imageInfo?.containerWidth ?? 400
  const containerHeight = imageInfo?.containerHeight ?? 300

  return (
    <div
      className="flex flex-col gap-4"
      style={{ width: containerWidth }}
    >
      {/* 容器 - V6: 尺寸 = 原始尺寸 * displayMultiplier，保持原始比例 */}
      <div
        className="relative overflow-hidden bg-black select-none flex-shrink-0"
        style={{
          width: containerWidth,
          height: containerHeight,
        }}
      >
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
            backgroundSize: '20px 20px',
            backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
            backgroundColor: '#808080',
          }}
        />

        {/* Layer 1: 圖片層 - V6: 圖片填滿容器 */}
        <div className="absolute inset-0 flex items-center justify-center">
          <img
            ref={imageRef}
            src={src}
            alt=""
            onLoad={handleImageLoad}
            draggable={false}
            className="max-w-none pointer-events-none"
            style={{
              // V6: 圖片尺寸 = 容器尺寸 (填滿)
              width: containerWidth,
              height: containerHeight,
              // V6 規格: transform-origin 必須是 center center
              transform: imageTransform,
              transformOrigin: 'center center',
              willChange: 'transform',
            }}
          />
        </div>

        {imageInfo && imageLoaded && (
          <>
            {/* Layer 2: 遮罩層 */}
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute bg-black/50" style={{ top: 0, left: 0, right: 0, height: cropY }} />
              <div className="absolute bg-black/50" style={{ top: cropY + cropH, left: 0, right: 0, bottom: 0 }} />
              <div className="absolute bg-black/50" style={{ top: cropY, left: 0, width: cropX, height: cropH }} />
              <div className="absolute bg-black/50" style={{ top: cropY, left: cropX + cropW, right: 0, height: cropH }} />
            </div>

            {/* Layer 3: 裁切框 */}
            <div
              className="absolute border-2 border-white"
              style={{
                left: cropX,
                top: cropY,
                width: cropW,
                height: cropH,
                cursor: isDragging ? 'grabbing' : 'grab',
              }}
              onMouseDown={handleCropBoxMouseDown}
            >
              {/* 九宮格 */}
              <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none">
                {[...Array(9)].map((_, i) => (
                  <div key={i} className="border border-white/30" />
                ))}
              </div>

              {/* 四角 Handles */}
              {(['nw', 'ne', 'sw', 'se'] as const).map((handle) => (
                <div
                  key={handle}
                  className="absolute w-4 h-4 bg-white border border-gray-400"
                  style={{
                    top: handle.includes('n') ? -8 : 'auto',
                    bottom: handle.includes('s') ? -8 : 'auto',
                    left: handle.includes('w') ? -8 : 'auto',
                    right: handle.includes('e') ? -8 : 'auto',
                    cursor: handle === 'nw' || handle === 'se' ? 'nwse-resize' : 'nesw-resize',
                  }}
                  onMouseDown={handleResizeMouseDown(handle)}
                />
              ))}

              {/* 四邊 Handles */}
              {(['n', 's', 'e', 'w'] as const).map((handle) => (
                <div
                  key={handle}
                  className="absolute bg-white"
                  style={{
                    ...(handle === 'n' && { top: -3, left: '50%', transform: 'translateX(-50%)', width: 30, height: 6, cursor: 'ns-resize' }),
                    ...(handle === 's' && { bottom: -3, left: '50%', transform: 'translateX(-50%)', width: 30, height: 6, cursor: 'ns-resize' }),
                    ...(handle === 'w' && { left: -3, top: '50%', transform: 'translateY(-50%)', width: 6, height: 30, cursor: 'ew-resize' }),
                    ...(handle === 'e' && { right: -3, top: '50%', transform: 'translateY(-50%)', width: 6, height: 30, cursor: 'ew-resize' }),
                  }}
                  onMouseDown={handleResizeMouseDown(handle)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* 控制面板 - 獨立於圖片容器 */}
      {imageInfo && (
        <div className="flex flex-col gap-3 p-3 bg-white rounded shadow">
          {/* Scale 滑桿 */}
          <div className="flex items-center gap-3">
            <label className="w-16 text-sm text-gray-600">縮放</label>
            <input
              type="range"
              min={1}
              max={3}
              step={0.1}
              value={scale}
              onChange={(e) => setScale(parseFloat(e.target.value))}
              className="flex-1"
            />
            <span className="w-12 text-sm text-right">{(scale * 100).toFixed(0)}%</span>
          </div>

          {/* Rotate 滑桿 */}
          <div className="flex items-center gap-3">
            <label className="w-16 text-sm text-gray-600">旋轉</label>
            <input
              type="range"
              min={0}
              max={360}
              step={1}
              value={rotate}
              onChange={(e) => setRotate(parseFloat(e.target.value))}
              className="flex-1"
            />
            <span className="w-12 text-sm text-right">{rotate.toFixed(0)}°</span>
          </div>
        </div>
      )}

      {/* Debug 資訊 */}
      {import.meta.env.DEV && imageInfo && (
        <div className="text-xs text-gray-500 font-mono space-y-1">
          <div>原圖: {imageInfo.naturalWidth} × {imageInfo.naturalHeight}</div>
          <div>容器: {imageInfo.containerWidth} × {imageInfo.containerHeight} (M: {imageInfo.displayMultiplier.toFixed(2)})</div>
          <div>image: ({state.imageX}, {state.imageY}), scale: {scale.toFixed(2)}, rotate: {rotate}°</div>
          <div>cropBox: ({cropX.toFixed(0)}, {cropY.toFixed(0)}) {cropW.toFixed(0)} × {cropH.toFixed(0)}</div>
          <div>導出尺寸: {(cropW / imageInfo.displayMultiplier).toFixed(0)} × {(cropH / imageInfo.displayMultiplier).toFixed(0)} px</div>
        </div>
      )}
    </div>
  )
}
