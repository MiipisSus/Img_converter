import { useState, useCallback } from 'react'

export interface CropBoxState {
  cropX: number      // 裁切框左上角 X 座標 (相對於顯示圖片)
  cropY: number      // 裁切框左上角 Y 座標 (相對於顯示圖片)
  cropW: number      // 裁切框寬度
  cropH: number      // 裁切框高度
}

interface UseCropBoxOptions {
  /** 圖片顯示寬度 */
  imageDisplayWidth: number
  /** 圖片顯示高度 */
  imageDisplayHeight: number
  /** 最小裁切框尺寸 */
  minSize?: number
}

export function useCropBox(options: UseCropBoxOptions | null) {
  const { minSize = 50 } = options || {}

  const [state, setState] = useState<CropBoxState>({
    cropX: 0,
    cropY: 0,
    cropW: 100,
    cropH: 100,
  })

  // 初始化：裁切框置中，佔圖片 80%
  const initialize = useCallback(() => {
    if (!options) return

    const { imageDisplayWidth, imageDisplayHeight } = options
    const size = Math.min(imageDisplayWidth, imageDisplayHeight) * 0.8
    const cropW = size
    const cropH = size
    const cropX = (imageDisplayWidth - cropW) / 2
    const cropY = (imageDisplayHeight - cropH) / 2

    setState({ cropX, cropY, cropW, cropH })
  }, [options])

  // 移動裁切框 (帶邊界檢查)
  const move = useCallback(
    (deltaX: number, deltaY: number) => {
      if (!options) return

      const { imageDisplayWidth, imageDisplayHeight } = options

      setState((prev) => {
        let newX = prev.cropX + deltaX
        let newY = prev.cropY + deltaY

        // 邊界檢查
        newX = Math.max(0, Math.min(imageDisplayWidth - prev.cropW, newX))
        newY = Math.max(0, Math.min(imageDisplayHeight - prev.cropH, newY))

        return { ...prev, cropX: newX, cropY: newY }
      })
    },
    [options]
  )

  // 調整大小 (從特定角落/邊緣)
  const resize = useCallback(
    (
      handle: 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w',
      deltaX: number,
      deltaY: number
    ) => {
      if (!options) return

      const { imageDisplayWidth, imageDisplayHeight } = options

      setState((prev) => {
        let { cropX, cropY, cropW, cropH } = prev

        // 根據拖動的 handle 調整尺寸
        switch (handle) {
          case 'nw': // 左上角
            cropX += deltaX
            cropY += deltaY
            cropW -= deltaX
            cropH -= deltaY
            break
          case 'ne': // 右上角
            cropY += deltaY
            cropW += deltaX
            cropH -= deltaY
            break
          case 'sw': // 左下角
            cropX += deltaX
            cropW -= deltaX
            cropH += deltaY
            break
          case 'se': // 右下角
            cropW += deltaX
            cropH += deltaY
            break
          case 'n': // 上邊
            cropY += deltaY
            cropH -= deltaY
            break
          case 's': // 下邊
            cropH += deltaY
            break
          case 'w': // 左邊
            cropX += deltaX
            cropW -= deltaX
            break
          case 'e': // 右邊
            cropW += deltaX
            break
        }

        // 最小尺寸限制
        if (cropW < minSize) {
          if (handle.includes('w')) cropX = prev.cropX + prev.cropW - minSize
          cropW = minSize
        }
        if (cropH < minSize) {
          if (handle.includes('n')) cropY = prev.cropY + prev.cropH - minSize
          cropH = minSize
        }

        // 邊界檢查
        cropX = Math.max(0, cropX)
        cropY = Math.max(0, cropY)
        if (cropX + cropW > imageDisplayWidth) {
          cropW = imageDisplayWidth - cropX
        }
        if (cropY + cropH > imageDisplayHeight) {
          cropH = imageDisplayHeight - cropY
        }

        return { cropX, cropY, cropW, cropH }
      })
    },
    [options, minSize]
  )

  // 直接設定狀態
  const setCropBox = useCallback((newState: Partial<CropBoxState>) => {
    setState((prev) => ({ ...prev, ...newState }))
  }, [])

  return {
    state,
    initialize,
    move,
    resize,
    setCropBox,
  }
}
