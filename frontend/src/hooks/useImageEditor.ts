import { useState, useCallback, useMemo, useRef } from 'react'

/**
 * 編輯器狀態 (符合 V7 規格)
 */
export interface EditorState {
  // 圖片變換 (相對於容器中心)
  imageX: number      // 圖片中心相對於容器中心的 X 偏移
  imageY: number      // 圖片中心相對於容器中心的 Y 偏移
  scale: number       // 使用者縮放倍率 (1.0+)
  rotate: number      // 自由旋轉角度 (-180 ~ 180)
  baseRotate: number  // 步進旋轉 (0, 90, 180, 270)
  flipX: boolean      // 水平翻轉
  flipY: boolean      // 垂直翻轉

  // 裁切框 (相對於容器左上角，UI 座標)
  cropX: number
  cropY: number
  cropW: number
  cropH: number
}

/** 圖片資訊 (V7 規格) */
export interface ImageInfo {
  naturalWidth: number       // 原始像素寬度
  naturalHeight: number      // 原始像素高度
  displayMultiplier: number  // 顯示倍率 M
  containerWidth: number     // 容器寬度 = effW * M
  containerHeight: number    // 容器高度 = effH * M
}

/** 容器寬度限制 (px) - 符合 IMAGE_CROPPER_SPEC V7 */
const MIN_CONTAINER_WIDTH = 400
const MAX_CONTAINER_WIDTH = 600

interface UseImageEditorOptions {
  minCropSize?: number
  /** 初始狀態 (用於恢復上次的裁切參數) */
  initialState?: EditorState
  /** 鎖定的裁切框比例 (width/height)，若設定則裁切框調整時維持此比例 */
  lockedAspectRatio?: number
}

const DEFAULT_STATE: EditorState = {
  imageX: 0,
  imageY: 0,
  scale: 1,
  rotate: 0,
  baseRotate: 0,
  flipX: false,
  flipY: false,
  cropX: 0,
  cropY: 0,
  cropW: 100,
  cropH: 100,
}

/**
 * 根據 baseRotate 計算有效尺寸 (V7 規格)
 * 當 baseRotate 為 90 或 270 時，寬高互換
 */
function getEffectiveDimensions(
  naturalWidth: number,
  naturalHeight: number,
  baseRotate: number
): { effW: number; effH: number } {
  if (baseRotate === 90 || baseRotate === 270) {
    return { effW: naturalHeight, effH: naturalWidth }
  }
  return { effW: naturalWidth, effH: naturalHeight }
}

/**
 * 根據有效寬度計算 displayMultiplier (V7 規格)
 */
function calculateDisplayMultiplier(effW: number): number {
  if (effW > MAX_CONTAINER_WIDTH) {
    return MAX_CONTAINER_WIDTH / effW
  } else if (effW < MIN_CONTAINER_WIDTH) {
    return MIN_CONTAINER_WIDTH / effW
  }
  return 1
}

export function useImageEditor(options: UseImageEditorOptions | null) {
  const [state, setState] = useState<EditorState>(DEFAULT_STATE)
  const [imageInfo, setImageInfo] = useState<ImageInfo | null>(null)
  const initializedRef = useRef(false)

  // 保存原始圖片尺寸供 90° 旋轉重算使用
  const naturalDimensionsRef = useRef<{ width: number; height: number } | null>(null)

  const optionsRef = useRef(options)
  optionsRef.current = options

  const minCropSize = options?.minCropSize ?? 50
  const initialStateOption = options?.initialState
  const lockedAspectRatio = options?.lockedAspectRatio

  // 初始化 (V7 規格)
  const initialize = useCallback(
    (naturalWidth: number, naturalHeight: number) => {
      // 保存原始尺寸
      naturalDimensionsRef.current = { width: naturalWidth, height: naturalHeight }

      // 初始 baseRotate (從 initialState 或預設 0)
      const baseRotate = initialStateOption?.baseRotate ?? 0

      // 計算有效尺寸
      const { effW, effH } = getEffectiveDimensions(naturalWidth, naturalHeight, baseRotate)

      // 計算顯示倍率 M
      const displayMultiplier = calculateDisplayMultiplier(effW)

      // 容器尺寸 = 有效尺寸 * M
      const containerWidth = Math.round(effW * displayMultiplier)
      const containerHeight = Math.round(effH * displayMultiplier)

      setImageInfo({
        naturalWidth,
        naturalHeight,
        displayMultiplier,
        containerWidth,
        containerHeight,
      })

      // 如果有初始狀態，使用它；否則裁切框完全貼合容器
      if (initialStateOption) {
        setState(initialStateOption)
      } else {
        setState({
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
        })
      }

      initializedRef.current = true
    },
    [initialStateOption]
  )

  // 設定縮放
  const setScale = useCallback((scale: number) => {
    setState((prev) => ({
      ...prev,
      scale: Math.max(1, Math.min(5, scale)),
    }))
  }, [])

  // 設定旋轉 (-180 ~ 180)
  const setRotate = useCallback((rotate: number) => {
    const clamped = Math.max(-180, Math.min(180, rotate))
    setState((prev) => ({ ...prev, rotate: clamped }))
  }, [])

  // 設定圖片位置
  const setImagePosition = useCallback((x: number, y: number) => {
    setState((prev) => ({ ...prev, imageX: x, imageY: y }))
  }, [])

  // 用於邊界檢查的 imageInfo ref
  const imageInfoRef = useRef<ImageInfo | null>(null)
  imageInfoRef.current = imageInfo

  /**
   * 90° 旋轉 (重新計算容器尺寸)
   */
  const rotateBy90 = useCallback((direction: 'left' | 'right') => {
    const dims = naturalDimensionsRef.current
    if (!dims) return

    setState((prev) => {
      // 計算新的 baseRotate
      let newBaseRotate: number
      if (direction === 'right') {
        newBaseRotate = (prev.baseRotate + 90) % 360
      } else {
        newBaseRotate = (prev.baseRotate - 90 + 360) % 360
      }

      // 計算新的有效尺寸和容器尺寸
      const { effW, effH } = getEffectiveDimensions(dims.width, dims.height, newBaseRotate)
      const newM = calculateDisplayMultiplier(effW)
      const newContainerW = Math.round(effW * newM)
      const newContainerH = Math.round(effH * newM)

      // 更新 imageInfo
      setImageInfo({
        naturalWidth: dims.width,
        naturalHeight: dims.height,
        displayMultiplier: newM,
        containerWidth: newContainerW,
        containerHeight: newContainerH,
      })

      // 重置裁切框為新容器大小，重置位置
      return {
        ...prev,
        baseRotate: newBaseRotate,
        imageX: 0,
        imageY: 0,
        cropX: 0,
        cropY: 0,
        cropW: newContainerW,
        cropH: newContainerH,
      }
    })
  }, [])

  /**
   * 翻轉
   */
  const toggleFlipX = useCallback(() => {
    setState((prev) => ({ ...prev, flipX: !prev.flipX }))
  }, [])

  const toggleFlipY = useCallback(() => {
    setState((prev) => ({ ...prev, flipY: !prev.flipY }))
  }, [])

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

  // 用於比例鎖定的 ref
  const lockedAspectRatioRef = useRef<number | undefined>(undefined)
  lockedAspectRatioRef.current = lockedAspectRatio

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
      const aspectRatio = lockedAspectRatioRef.current

      setState((prev) => {
        let { cropX, cropY, cropW, cropH } = prev
        const originalRight = cropX + cropW
        const originalBottom = cropY + cropH

        // 如果有鎖定比例且是角落拖動，使用比例鎖定邏輯
        const isCorner = ['nw', 'ne', 'sw', 'se'].includes(handle)

        if (aspectRatio && isCorner) {
          // 比例鎖定模式：根據拖動距離較大的方向決定新尺寸
          const absDeltaX = Math.abs(deltaX)
          const absDeltaY = Math.abs(deltaY)

          let newW: number, newH: number

          // 決定以哪個方向為主
          if (absDeltaX > absDeltaY) {
            // 以 X 方向為主
            if (handle === 'nw' || handle === 'sw') {
              newW = cropW - deltaX
            } else {
              newW = cropW + deltaX
            }
            newH = newW / aspectRatio
          } else {
            // 以 Y 方向為主
            if (handle === 'nw' || handle === 'ne') {
              newH = cropH - deltaY
            } else {
              newH = cropH + deltaY
            }
            newW = newH * aspectRatio
          }

          // 確保最小尺寸
          if (newW < minCropSize) {
            newW = minCropSize
            newH = newW / aspectRatio
          }
          if (newH < minCropSize) {
            newH = minCropSize
            newW = newH * aspectRatio
          }

          // 根據 handle 決定位置調整
          switch (handle) {
            case 'nw':
              cropX = originalRight - newW
              cropY = originalBottom - newH
              break
            case 'ne':
              cropY = originalBottom - newH
              break
            case 'sw':
              cropX = originalRight - newW
              break
            case 'se':
              // 位置不變，只改變尺寸
              break
          }
          cropW = newW
          cropH = newH

          // 邊界檢查 (比例鎖定模式)
          if (cropX < 0) {
            cropX = 0
            cropW = Math.min(containerWidth, originalRight)
            cropH = cropW / aspectRatio
            if (handle === 'nw' || handle === 'sw') {
              if (handle === 'nw') cropY = originalBottom - cropH
            }
          }
          if (cropY < 0) {
            cropY = 0
            cropH = Math.min(containerHeight, originalBottom)
            cropW = cropH * aspectRatio
            if (handle === 'nw' || handle === 'ne') {
              if (handle === 'nw') cropX = originalRight - cropW
            }
          }
          if (cropX + cropW > containerWidth) {
            cropW = containerWidth - cropX
            cropH = cropW / aspectRatio
          }
          if (cropY + cropH > containerHeight) {
            cropH = containerHeight - cropY
            cropW = cropH * aspectRatio
          }
        } else {
          // 原始邏輯 (無比例鎖定或邊緣拖動)
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
   * CSS Transform (符合 V7 規格順序)
   * 順序: translate → baseRotate → freeRotate → flip → scale
   * transform-origin 必須是 center center
   */
  const imageTransform = useMemo(() => {
    const { imageX, imageY, rotate, baseRotate, flipX, flipY, scale } = state
    const flipScaleX = flipX ? -1 : 1
    const flipScaleY = flipY ? -1 : 1
    // 順序: 平移 → 步進旋轉 → 自由旋轉 → 翻轉 → 縮放
    return `translate(${imageX}px, ${imageY}px) rotate(${baseRotate}deg) rotate(${rotate}deg) scale(${flipScaleX * scale}, ${flipScaleY * scale})`
  }, [state.imageX, state.imageY, state.rotate, state.baseRotate, state.flipX, state.flipY, state.scale])

  return {
    state,
    imageInfo,
    imageTransform,
    initialized: initializedRef.current,
    initialize,
    setScale,
    setRotate,
    setImagePosition,
    rotateBy90,
    toggleFlipX,
    toggleFlipY,
    moveCropBox,
    resizeCropBox,
    setCropBox,
  }
}
