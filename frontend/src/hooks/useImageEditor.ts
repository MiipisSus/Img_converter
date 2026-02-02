import { useState, useCallback, useMemo, useRef } from 'react'

/**
 * 編輯器狀態 (符合 V5 規格)
 */
export interface EditorState {
  // 圖片變換 (相對於容器中心)
  imageX: number      // 圖片中心相對於容器中心的 X 偏移
  imageY: number      // 圖片中心相對於容器中心的 Y 偏移
  scale: number       // 使用者縮放倍率 (1.0+)
  rotate: number      // 旋轉角度 (0-360)

  // 裁切框 (相對於容器左上角，UI 座標)
  cropX: number
  cropY: number
  cropW: number
  cropH: number
}

/** 圖片資訊 (V5 規格) */
export interface ImageInfo {
  naturalWidth: number       // 原始像素寬度
  naturalHeight: number      // 原始像素高度
  displayMultiplier: number  // 顯示倍率 M (小圖放大用)
  containerWidth: number     // 容器寬度 = naturalWidth * M
  containerHeight: number    // 容器高度 = naturalHeight * M
}

/** 容器寬度限制 (px) */
const MIN_CONTAINER_WIDTH = 400
const MAX_CONTAINER_WIDTH = 800

interface UseImageEditorOptions {
  minCropSize?: number
}

const DEFAULT_STATE: EditorState = {
  imageX: 0,
  imageY: 0,
  scale: 1,
  rotate: 0,
  cropX: 0,
  cropY: 0,
  cropW: 100,
  cropH: 100,
}

export function useImageEditor(options: UseImageEditorOptions | null) {
  const [state, setState] = useState<EditorState>(DEFAULT_STATE)
  const [imageInfo, setImageInfo] = useState<ImageInfo | null>(null)
  const initializedRef = useRef(false)

  const optionsRef = useRef(options)
  optionsRef.current = options

  const minCropSize = options?.minCropSize ?? 50

  // 初始化 (V6 規格)
  const initialize = useCallback(
    (naturalWidth: number, naturalHeight: number) => {
      // 計算顯示倍率 M (V6: 同時處理放大和縮小)
      let displayMultiplier: number
      if (naturalWidth > MAX_CONTAINER_WIDTH) {
        // 大圖縮小顯示
        displayMultiplier = MAX_CONTAINER_WIDTH / naturalWidth
      } else if (naturalWidth < MIN_CONTAINER_WIDTH) {
        // 小圖放大顯示
        displayMultiplier = MIN_CONTAINER_WIDTH / naturalWidth
      } else {
        // 原始大小顯示
        displayMultiplier = 1
      }

      // 容器尺寸 = 原始尺寸 * M (保持原始比例)
      const containerWidth = Math.round(naturalWidth * displayMultiplier)
      const containerHeight = Math.round(naturalHeight * displayMultiplier)

      setImageInfo({
        naturalWidth,
        naturalHeight,
        displayMultiplier,
        containerWidth,
        containerHeight,
      })

      // 初始裁切框：完全貼合容器
      setState({
        imageX: 0,
        imageY: 0,
        scale: 1,
        rotate: 0,
        cropX: 0,
        cropY: 0,
        cropW: containerWidth,
        cropH: containerHeight,
      })

      initializedRef.current = true
    },
    []
  )

  // 設定縮放
  const setScale = useCallback((scale: number) => {
    setState((prev) => ({
      ...prev,
      scale: Math.max(1, Math.min(5, scale)),
    }))
  }, [])

  // 設定旋轉
  const setRotate = useCallback((rotate: number) => {
    const normalized = ((rotate % 360) + 360) % 360
    setState((prev) => ({ ...prev, rotate: normalized }))
  }, [])

  // 設定圖片位置
  const setImagePosition = useCallback((x: number, y: number) => {
    setState((prev) => ({ ...prev, imageX: x, imageY: y }))
  }, [])

  // 用於邊界檢查的 imageInfo ref
  const imageInfoRef = useRef<ImageInfo | null>(null)
  imageInfoRef.current = imageInfo

  // 移動裁切框
  const moveCropBox = useCallback(
    (deltaX: number, deltaY: number) => {
      const info = imageInfoRef.current
      if (!info) return

      const { containerWidth, containerHeight } = info

      setState((prev) => {
        let newX = prev.cropX + deltaX
        let newY = prev.cropY + deltaY

        newX = Math.max(0, Math.min(containerWidth - prev.cropW, newX))
        newY = Math.max(0, Math.min(containerHeight - prev.cropH, newY))

        return { ...prev, cropX: newX, cropY: newY }
      })
    },
    []
  )

  // 調整裁切框大小
  const resizeCropBox = useCallback(
    (
      handle: 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w',
      deltaX: number,
      deltaY: number
    ) => {
      const info = imageInfoRef.current
      if (!info) return

      const { containerWidth, containerHeight } = info

      setState((prev) => {
        let { cropX, cropY, cropW, cropH } = prev
        const originalRight = cropX + cropW
        const originalBottom = cropY + cropH

        switch (handle) {
          case 'nw':
            cropX += deltaX
            cropY += deltaY
            cropW -= deltaX
            cropH -= deltaY
            break
          case 'ne':
            cropY += deltaY
            cropW += deltaX
            cropH -= deltaY
            break
          case 'sw':
            cropX += deltaX
            cropW -= deltaX
            cropH += deltaY
            break
          case 'se':
            cropW += deltaX
            cropH += deltaY
            break
          case 'n':
            cropY += deltaY
            cropH -= deltaY
            break
          case 's':
            cropH += deltaY
            break
          case 'w':
            cropX += deltaX
            cropW -= deltaX
            break
          case 'e':
            cropW += deltaX
            break
        }

        // 邊界檢查
        if (handle.includes('n') && cropY < 0) {
          cropY = 0
          cropH = originalBottom
        }
        if (handle.includes('w') && cropX < 0) {
          cropX = 0
          cropW = originalRight
        }
        if (handle.includes('s') && cropY + cropH > containerHeight) {
          cropH = containerHeight - cropY
        }
        if (handle.includes('e') && cropX + cropW > containerWidth) {
          cropW = containerWidth - cropX
        }

        // 最小尺寸
        if (cropW < minCropSize) {
          if (handle.includes('w')) cropX = originalRight - minCropSize
          cropW = minCropSize
        }
        if (cropH < minCropSize) {
          if (handle.includes('n')) cropY = originalBottom - minCropSize
          cropH = minCropSize
        }

        return { ...prev, cropX, cropY, cropW, cropH }
      })
    },
    [minCropSize]
  )

  // 直接設定裁切框
  const setCropBox = useCallback(
    (crop: { cropX?: number; cropY?: number; cropW?: number; cropH?: number }) => {
      setState((prev) => ({ ...prev, ...crop }))
    },
    []
  )

  /**
   * CSS Transform (符合 V5 規格順序: translate → rotate → scale)
   * transform-origin 必須是 center center
   */
  const imageTransform = useMemo(() => {
    const { imageX, imageY, rotate, scale } = state
    // 順序: 先平移 → 再旋轉 → 再縮放
    return `translate(${imageX}px, ${imageY}px) rotate(${rotate}deg) scale(${scale})`
  }, [state.imageX, state.imageY, state.rotate, state.scale])

  return {
    state,
    imageInfo,
    imageTransform,
    initialized: initializedRef.current,
    initialize,
    setScale,
    setRotate,
    setImagePosition,
    moveCropBox,
    resizeCropBox,
    setCropBox,
  }
}
