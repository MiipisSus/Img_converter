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

/** 容器尺寸限制 (px) - 符合 IMAGE_CROPPER_SPEC V7 */
const MIN_CONTAINER_WIDTH = 400
const MAX_CONTAINER_WIDTH = 600
const MIN_CONTAINER_HEIGHT = 300
const MAX_CONTAINER_HEIGHT = 500

interface UseImageEditorOptions {
  minCropSize?: number
  /** 初始狀態 (用於恢復上次的裁切參數) */
  initialState?: EditorState
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
 * 當 baseRotate 為 ±90 或 ±270 時，寬高互換
 */
function getEffectiveDimensions(
  naturalWidth: number,
  naturalHeight: number,
  baseRotate: number
): { effW: number; effH: number } {
  const isLeaning = Math.abs(baseRotate % 180) === 90
  if (isLeaning) {
    return { effW: naturalHeight, effH: naturalWidth }
  }
  return { effW: naturalWidth, effH: naturalHeight }
}

/**
 * 雙向限制計算 displayMultiplier (V7 規格)
 *
 * 分別計算寬高需求倍率 Mw/Mh，再依模式取值：
 *   縮小模式 (任一維度 > MAX): M = min(Mw, Mh) — 確保完全納入
 *   放大模式 (任一維度 < MIN): M = max(Mw, Mh) — 確保操作空間
 *   其餘: M = 1
 */
function calculateDisplayMultiplier(effW: number, effH: number): number {
  // 寬度需求倍率
  let Mw: number
  if (effW > MAX_CONTAINER_WIDTH) Mw = MAX_CONTAINER_WIDTH / effW
  else if (effW < MIN_CONTAINER_WIDTH) Mw = MIN_CONTAINER_WIDTH / effW
  else Mw = 1

  // 高度需求倍率
  let Mh: number
  if (effH > MAX_CONTAINER_HEIGHT) Mh = MAX_CONTAINER_HEIGHT / effH
  else if (effH < MIN_CONTAINER_HEIGHT) Mh = MIN_CONTAINER_HEIGHT / effH
  else Mh = 1

  // 模式判定
  const needsShrink = effW > MAX_CONTAINER_WIDTH || effH > MAX_CONTAINER_HEIGHT
  const needsEnlarge = effW < MIN_CONTAINER_WIDTH || effH < MIN_CONTAINER_HEIGHT

  if (needsShrink) return Math.min(Mw, Mh)
  if (needsEnlarge) return Math.max(Mw, Mh)
  return 1
}

/**
 * 計算旋轉自動貼合所需的最小縮放倍率
 *
 * 確保自由旋轉後的圖片完全覆蓋容器（無黑邊）。
 * 公式對任何 baseRotate 值皆正確（baseRotate 只影響容器尺寸，
 * 自動貼合只需考慮自由旋轉角度和原始圖片比例）。
 *
 * 推導：旋轉 θ 度後，圖片外接矩形需覆蓋容器：
 *   寬度約束: S >= |cos(θ)| + (H/W) * |sin(θ)|
 *   高度約束: S >= |cos(θ)| + (W/H) * |sin(θ)|
 *   neededScale = max(兩者)
 */
function calculateAutoFitScale(
  rotate: number,
  naturalWidth: number,
  naturalHeight: number
): number {
  const rad = Math.abs(rotate * Math.PI / 180)
  const cosR = Math.abs(Math.cos(rad))
  const sinR = Math.abs(Math.sin(rad))
  const s1 = cosR + (naturalHeight / naturalWidth) * sinR
  const s2 = cosR + (naturalWidth / naturalHeight) * sinR
  return Math.max(s1, s2)
}

export function useImageEditor(options: UseImageEditorOptions | null) {
  const [state, setState] = useState<EditorState>(DEFAULT_STATE)
  const [imageInfo, setImageInfo] = useState<ImageInfo | null>(null)
  const initializedRef = useRef(false)

  // 保存原始圖片尺寸供 90° 旋轉重算使用
  const naturalDimensionsRef = useRef<{ width: number; height: number } | null>(null)

  // 自動貼合旋轉
  const [isAutoFitEnabled, _setIsAutoFitEnabled] = useState(false)
  const isAutoFitEnabledRef = useRef(false)

  const optionsRef = useRef(options)
  optionsRef.current = options

  const minCropSize = options?.minCropSize ?? 50
  const initialStateOption = options?.initialState

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
      const displayMultiplier = calculateDisplayMultiplier(effW, effH)

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
    setState((prev) => {
      let newScale = Math.max(1, Math.min(5, scale))
      if (isAutoFitEnabledRef.current) {
        const dims = naturalDimensionsRef.current
        if (dims) {
          const minScale = calculateAutoFitScale(prev.rotate, dims.width, dims.height)
          newScale = Math.max(newScale, minScale)
        }
      }
      return { ...prev, scale: newScale }
    })
  }, [])

  // 設定旋轉 (-180 ~ 180)
  const setRotate = useCallback((rotate: number) => {
    const clamped = Math.max(-180, Math.min(180, rotate))
    setState((prev) => {
      if (isAutoFitEnabledRef.current) {
        const dims = naturalDimensionsRef.current
        if (dims) {
          const minScale = calculateAutoFitScale(clamped, dims.width, dims.height)
          return { ...prev, rotate: clamped, scale: Math.max(1, minScale) }
        }
      }
      return { ...prev, rotate: clamped }
    })
  }, [])

  // 設定圖片位置
  const setImagePosition = useCallback((x: number, y: number) => {
    setState((prev) => ({ ...prev, imageX: x, imageY: y }))
  }, [])

  // 設定自動貼合
  const setAutoFitEnabled = useCallback((enabled: boolean) => {
    isAutoFitEnabledRef.current = enabled
    _setIsAutoFitEnabled(enabled)
    if (enabled) {
      setState((prev) => {
        const dims = naturalDimensionsRef.current
        if (dims) {
          const minScale = calculateAutoFitScale(prev.rotate, dims.width, dims.height)
          return { ...prev, scale: Math.max(1, minScale) }
        }
        return prev
      })
    }
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
      const newM = calculateDisplayMultiplier(effW, effH)
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
   * 翻轉 — 在圖片顯示範圍內鏡像裁切框位置
   *
   * 翻轉改變 scale 符號，內容在該軸上以圖片視覺中心為軸鏡像。
   * 裁切框必須跟著鏡像，才能繼續框住相同的內容。
   *
   * 計算步驟:
   *   1. displayImageH = containerH * scale (圖片受縮放後的顯示高度)
   *   2. imageVisualTop = containerH/2 + imageY - displayImageH/2 (圖片上緣位置)
   *   3. relativeCropY = cropY - imageVisualTop (裁切框在圖片內的相對位置)
   *   4. newRelativeCropY = displayImageH - relativeCropY - cropH (鏡像)
   *   5. newCropY = imageVisualTop + newRelativeCropY (換算回容器座標)
   *
   * 化簡: newCropY = containerH + 2*imageY - cropY - cropH
   * (此公式對任意旋轉角度皆成立，因為 scale 項在推導中會消去)
   *
   * imageX/imageY 不改變 — 圖片視覺位置不動，只有內容鏡像。
   */
  const toggleFlipX = useCallback(() => {
    const info = imageInfoRef.current
    if (!info) return
    setState((prev) => {
      // 圖片受縮放後的顯示寬度
      const displayImageW = info.containerWidth * prev.scale
      // 圖片視覺左緣在容器座標系的位置
      const imageVisualLeft = info.containerWidth / 2 + prev.imageX - displayImageW / 2
      // 裁切框在圖片內的相對位置
      const relativeCropX = prev.cropX - imageVisualLeft
      // 在圖片範圍內進行鏡像
      const newRelativeCropX = displayImageW - relativeCropX - prev.cropW
      // 換算回容器座標
      const newCropX = imageVisualLeft + newRelativeCropX

      return {
        ...prev,
        flipX: !prev.flipX,
        cropX: newCropX,
      }
    })
  }, [])

  const toggleFlipY = useCallback(() => {
    const info = imageInfoRef.current
    if (!info) return
    setState((prev) => {
      // 圖片受縮放後的顯示高度
      const displayImageH = info.containerHeight * prev.scale
      // 圖片視覺上緣在容器座標系的位置
      const imageVisualTop = info.containerHeight / 2 + prev.imageY - displayImageH / 2
      // 裁切框在圖片內的相對位置
      const relativeCropY = prev.cropY - imageVisualTop
      // 在圖片範圍內進行鏡像
      const newRelativeCropY = displayImageH - relativeCropY - prev.cropH
      // 換算回容器座標
      const newCropY = imageVisualTop + newRelativeCropY

      return {
        ...prev,
        flipY: !prev.flipY,
        cropY: newCropY,
      }
    })
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
   * CSS Transform (統一變換順序)
   * 順序: translate → scale(flip) → rotate(totalAngle)
   *
   * 這確保:
   * 1. 翻轉是基於圖片自身的軸 (flip 在 rotate 之前)
   * 2. 旋轉是最後施加的視覺效果
   * 3. 使用者點擊『水平翻轉』時，圖片以『自身中軸』做鏡像
   *
   * transform-origin 必須是 center center
   */
  const imageTransform = useMemo(() => {
    const { imageX, imageY, rotate, baseRotate, flipX, flipY, scale } = state
    const flipScaleX = (flipX ? -1 : 1) * scale
    const flipScaleY = (flipY ? -1 : 1) * scale
    const totalRotate = baseRotate + rotate
    // 順序: 平移 → 縮放(含翻轉) → 旋轉(總角度)
    return `translate(${imageX}px, ${imageY}px) scale(${flipScaleX}, ${flipScaleY}) rotate(${totalRotate}deg)`
  }, [state.imageX, state.imageY, state.rotate, state.baseRotate, state.flipX, state.flipY, state.scale])

  return {
    state,
    imageInfo,
    imageTransform,
    initialized: initializedRef.current,
    isAutoFitEnabled,
    initialize,
    setScale,
    setRotate,
    setImagePosition,
    setAutoFitEnabled,
    rotateBy90,
    toggleFlipX,
    toggleFlipY,
    moveCropBox,
    resizeCropBox,
    setCropBox,
  }
}
