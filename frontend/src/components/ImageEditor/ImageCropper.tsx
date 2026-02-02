import { useRef, useState, useEffect, useCallback } from 'react'
import { useCropBox, type CropBoxState } from '../../hooks/useCropBox'

interface ImageCropperProps {
  /** 圖片來源 */
  src: string
  /** 容器最大寬度 */
  maxWidth?: number
  /** 容器最大高度 */
  maxHeight?: number
  /** 裁切完成回調 */
  onCropChange?: (state: CropBoxState, scale: number) => void
}

type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w'

export function ImageCropper({
  src,
  maxWidth = 500,
  maxHeight = 400,
  onCropChange,
}: ImageCropperProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)

  // 圖片資訊
  const [imageInfo, setImageInfo] = useState<{
    naturalWidth: number
    naturalHeight: number
    displayWidth: number
    displayHeight: number
    scale: number // 顯示尺寸 / 原始尺寸
  } | null>(null)

  // 拖動狀態
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState<ResizeHandle | null>(null)
  const dragStartRef = useRef({ x: 0, y: 0, cropX: 0, cropY: 0, cropW: 0, cropH: 0 })

  // 裁切框 hook
  const cropBox = useCropBox(
    imageInfo
      ? {
          imageDisplayWidth: imageInfo.displayWidth,
          imageDisplayHeight: imageInfo.displayHeight,
        }
      : null
  )

  // 圖片載入
  const handleImageLoad = useCallback(() => {
    const img = imageRef.current
    if (!img) return

    const { naturalWidth, naturalHeight } = img

    // 計算適應容器的顯示尺寸 (Contain strategy)
    const scaleX = maxWidth / naturalWidth
    const scaleY = maxHeight / naturalHeight
    const scale = Math.min(scaleX, scaleY, 1) // 不放大超過原始尺寸

    const displayWidth = naturalWidth * scale
    const displayHeight = naturalHeight * scale

    setImageInfo({
      naturalWidth,
      naturalHeight,
      displayWidth,
      displayHeight,
      scale,
    })
  }, [maxWidth, maxHeight])

  // 圖片載入後初始化裁切框
  useEffect(() => {
    if (imageInfo) {
      cropBox.initialize()
    }
  }, [imageInfo])

  // 回報裁切變更
  useEffect(() => {
    if (imageInfo && onCropChange) {
      onCropChange(cropBox.state, imageInfo.scale)
    }
  }, [cropBox.state, imageInfo?.scale, onCropChange])

  // --- 拖動裁切框 ---
  const handleCropBoxMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      setIsDragging(true)
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        cropX: cropBox.state.cropX,
        cropY: cropBox.state.cropY,
        cropW: cropBox.state.cropW,
        cropH: cropBox.state.cropH,
      }
    },
    [cropBox.state]
  )

  // --- 調整大小 ---
  const handleResizeMouseDown = useCallback(
    (handle: ResizeHandle) => (e: React.MouseEvent) => {
      e.stopPropagation()
      setIsResizing(handle)
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        cropX: cropBox.state.cropX,
        cropY: cropBox.state.cropY,
        cropW: cropBox.state.cropW,
        cropH: cropBox.state.cropH,
      }
    },
    [cropBox.state]
  )

  // --- 全域滑鼠事件 ---
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const deltaX = e.clientX - dragStartRef.current.x
        const deltaY = e.clientY - dragStartRef.current.y
        cropBox.setCropBox({
          cropX: dragStartRef.current.cropX + deltaX,
          cropY: dragStartRef.current.cropY + deltaY,
        })
        // 套用邊界檢查
        cropBox.move(0, 0)
      } else if (isResizing) {
        const deltaX = e.clientX - dragStartRef.current.x
        const deltaY = e.clientY - dragStartRef.current.y

        // 先重置到拖動開始的狀態
        cropBox.setCropBox({
          cropX: dragStartRef.current.cropX,
          cropY: dragStartRef.current.cropY,
          cropW: dragStartRef.current.cropW,
          cropH: dragStartRef.current.cropH,
        })
        // 然後套用 resize
        cropBox.resize(isResizing, deltaX, deltaY)
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
  }, [isDragging, isResizing, cropBox])

  const { cropX, cropY, cropW, cropH } = cropBox.state

  return (
    <div className="inline-flex flex-col gap-4">
      {/* 容器 */}
      <div
        ref={containerRef}
        className="relative select-none bg-gray-900"
        style={{
          width: imageInfo?.displayWidth ?? maxWidth,
          height: imageInfo?.displayHeight ?? maxHeight,
        }}
      >
        {/* Layer 1: Background Image (固定) */}
        <img
          ref={imageRef}
          src={src}
          alt=""
          onLoad={handleImageLoad}
          draggable={false}
          className="block"
          style={{
            width: imageInfo?.displayWidth,
            height: imageInfo?.displayHeight,
          }}
        />

        {imageInfo && (
          <>
            {/* Layer 3: Shroud/Mask (裁切框外的遮罩) */}
            <div className="absolute inset-0 pointer-events-none">
              {/* 上方遮罩 */}
              <div
                className="absolute bg-black/50"
                style={{
                  top: 0,
                  left: 0,
                  right: 0,
                  height: cropY,
                }}
              />
              {/* 下方遮罩 */}
              <div
                className="absolute bg-black/50"
                style={{
                  top: cropY + cropH,
                  left: 0,
                  right: 0,
                  bottom: 0,
                }}
              />
              {/* 左方遮罩 */}
              <div
                className="absolute bg-black/50"
                style={{
                  top: cropY,
                  left: 0,
                  width: cropX,
                  height: cropH,
                }}
              />
              {/* 右方遮罩 */}
              <div
                className="absolute bg-black/50"
                style={{
                  top: cropY,
                  left: cropX + cropW,
                  right: 0,
                  height: cropH,
                }}
              />
            </div>

            {/* Layer 2: CropBox (可拖動的裁切框) */}
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
              {/* 九宮格輔助線 */}
              <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none">
                {[...Array(9)].map((_, i) => (
                  <div key={i} className="border border-white/30" />
                ))}
              </div>

              {/* Resize Handles - 四個角落 */}
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

              {/* Resize Handles - 四個邊 */}
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

      {/* Debug 資訊 */}
      {import.meta.env.DEV && imageInfo && (
        <div className="text-xs text-gray-500 font-mono space-y-1">
          <div>原圖: {imageInfo.naturalWidth} × {imageInfo.naturalHeight}</div>
          <div>顯示: {imageInfo.displayWidth.toFixed(0)} × {imageInfo.displayHeight.toFixed(0)} (scale: {imageInfo.scale.toFixed(3)})</div>
          <div>裁切框: ({cropX.toFixed(0)}, {cropY.toFixed(0)}) {cropW.toFixed(0)} × {cropH.toFixed(0)}</div>
        </div>
      )}
    </div>
  )
}
