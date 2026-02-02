import { useState, useCallback, useMemo, useRef } from 'react'

/**
 * 編輯器狀態 (符合 V2 規格)
 */
export interface EditorState {
  // 圖片變換 (相對於 Viewport 中心)
  imageX: number      // 圖片中心相對於 Viewport 中心的 X 偏移
  imageY: number      // 圖片中心相對於 Viewport 中心的 Y 偏移
  scale: number       // 使用者縮放倍率 (1.0+)
  rotate: number      // 旋轉角度 (0-360)

  // 裁切框 (相對於 Viewport 左上角)
  cropX: number
  cropY: number
  cropW: number
  cropH: number
}

/** 圖片資訊 */
export interface ImageInfo {
  naturalWidth: number    // 原始像素寬度
  naturalHeight: number   // 原始像素高度
  displayWidth: number    // 顯示寬度 (= naturalWidth * baseScale)
  displayHeight: number   // 顯示高度 (= naturalHeight * baseScale)
  viewportWidth: number   // Viewport 寬度
  viewportHeight: number  // Viewport 高度
  baseScale: number       // 基礎縮放比例 (contain)
}

interface UseImageEditorOptions {
  viewportWidth: number
  viewportHeight: number
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

  // 初始化
  const initialize = useCallback(
    (naturalWidth: number, naturalHeight: number) => {
      const opts = optionsRef.current
      if (!opts) return

      const { viewportWidth, viewportHeight } = opts

      // 計算 baseScale (contain strategy)
      const scaleX = viewportWidth / naturalWidth
      const scaleY = viewportHeight / naturalHeight
      const baseScale = Math.min(scaleX, scaleY)

      const displayWidth = naturalWidth * baseScale
      const displayHeight = naturalHeight * baseScale

      setImageInfo({
        naturalWidth,
        naturalHeight,
        displayWidth,
        displayHeight,
        viewportWidth,
        viewportHeight,
        baseScale,
      })

      // 初始裁切框：置中，佔 viewport 80%
      const cropSize = Math.min(viewportWidth, viewportHeight) * 0.8
      setState({
        imageX: 0,
        imageY: 0,
        scale: 1,
        rotate: 0,
        cropX: (viewportWidth - cropSize) / 2,
        cropY: (viewportHeight - cropSize) / 2,
        cropW: cropSize,
        cropH: cropSize,
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

  // 移動裁切框
  const moveCropBox = useCallback(
    (deltaX: number, deltaY: number) => {
      const opts = optionsRef.current
      if (!opts) return

      const { viewportWidth, viewportHeight } = opts

      setState((prev) => {
        let newX = prev.cropX + deltaX
        let newY = prev.cropY + deltaY

        newX = Math.max(0, Math.min(viewportWidth - prev.cropW, newX))
        newY = Math.max(0, Math.min(viewportHeight - prev.cropH, newY))

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
      const opts = optionsRef.current
      if (!opts) return

      const { viewportWidth, viewportHeight } = opts

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
        if (handle.includes('s') && cropY + cropH > viewportHeight) {
          cropH = viewportHeight - cropY
        }
        if (handle.includes('e') && cropX + cropW > viewportWidth) {
          cropW = viewportWidth - cropX
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
   * CSS Transform (符合 V2 規格順序: translate → rotate → scale)
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
