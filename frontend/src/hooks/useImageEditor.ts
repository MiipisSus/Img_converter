import { useState, useCallback, useMemo, useRef } from 'react'
import { CONTAINER_MIN_WIDTH, CONTAINER_MAX_WIDTH, CONTAINER_MIN_HEIGHT, CONTAINER_MAX_HEIGHT } from '../constants'

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

/** 容器尺寸限制 — 從 constants.ts 匯入 */
const MIN_CONTAINER_WIDTH = CONTAINER_MIN_WIDTH
const MAX_CONTAINER_WIDTH = CONTAINER_MAX_WIDTH
const MIN_CONTAINER_HEIGHT = CONTAINER_MIN_HEIGHT
const MAX_CONTAINER_HEIGHT = CONTAINER_MAX_HEIGHT

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
 * 計算覆蓋容器四角所需的最小縮放倍率
 *
 * 將容器四角反旋轉到圖片座標系，取最大投影距離。
 * 數學上只需自由旋轉角度和原始圖片尺寸（不依賴 baseRotate）。
 *
 * 推導：
 *   寬度約束: S >= |cos(θ)| + (H/W) * |sin(θ)|
 *   高度約束: S >= |cos(θ)| + (W/H) * |sin(θ)|
 *   S_needed = max(1, 兩者)
 */
function getRequiredScale(
  rotate: number,
  naturalWidth: number,
  naturalHeight: number
): number {
  const rad = Math.abs(rotate * Math.PI / 180)
  const cosR = Math.abs(Math.cos(rad))
  const sinR = Math.abs(Math.sin(rad))
  const sw = cosR + (naturalHeight / naturalWidth) * sinR
  const sh = cosR + (naturalWidth / naturalHeight) * sinR
  return Math.max(1, sw, sh)
}

/**
 * 限制圖片位置 — 確保容器四角皆落在旋轉後的圖片矩形內
 *
 * 核心：在圖片的旋轉座標系中做 clamp（該座標系中圖片是軸對齊矩形）
 *
 * 演算法：
 *   1. 計算容器四角在旋轉座標系中的最大投影半徑 Ru, Rv
 *   2. 圖片半寬 hw, 半高 hh → 旋轉座標系中可偏移量 maxKu = hw - Ru
 *   3. 將 (imageX, imageY) 投影到旋轉座標 (Ku, Kv)，做對稱 clamp
 *   4. 反旋轉回螢幕座標得到修正後的 (imageX, imageY)
 *
 * 為什麼不能用 AABB：
 *   AABB 比實際旋轉矩形大，在角落處有間隙。
 *   用 AABB 的 maxDx 會允許圖片移動過多，導致旋轉矩形的邊露出背景。
 */
function clampImagePosition(
  state: EditorState,
  imageInfo: ImageInfo
): { imageX: number; imageY: number } | null {
  const { imageX, imageY, scale, rotate, baseRotate } = state
  const { naturalWidth, naturalHeight, displayMultiplier: M, containerWidth: cW, containerHeight: cH } = imageInfo

  // 圖片在旋轉座標系中的半寬/半高
  const hw = naturalWidth * M * scale / 2
  const hh = naturalHeight * M * scale / 2

  const totalRad = (baseRotate + rotate) * Math.PI / 180
  const cosT = Math.cos(totalRad)
  const sinT = Math.sin(totalRad)
  const absCos = Math.abs(cosT)
  const absSin = Math.abs(sinT)

  // 容器四角 (±cW/2, ±cH/2) 在旋轉座標系中的最大投影半徑
  const Ru = cW / 2 * absCos + cH / 2 * absSin
  const Rv = cW / 2 * absSin + cH / 2 * absCos

  // 旋轉座標系中的最大可偏移量（若 < 0 表示圖片不夠大，強制居中）
  const maxKu = Math.max(0, hw - Ru)
  const maxKv = Math.max(0, hh - Rv)

  // 當前 (imageX, imageY) 投影到旋轉座標系
  const Ku = imageX * cosT + imageY * sinT
  const Kv = -imageX * sinT + imageY * cosT

  // 對稱 clamp
  const clampedKu = Math.max(-maxKu, Math.min(maxKu, Ku))
  const clampedKv = Math.max(-maxKv, Math.min(maxKv, Kv))

  // 反旋轉回螢幕座標
  const newImageX = cosT * clampedKu - sinT * clampedKv
  const newImageY = sinT * clampedKu + cosT * clampedKv

  if (Math.abs(newImageX - imageX) < 0.5 && Math.abs(newImageY - imageY) < 0.5) return null

  return { imageX: newImageX, imageY: newImageY }
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

      const info: ImageInfo = {
        naturalWidth,
        naturalHeight,
        displayMultiplier,
        containerWidth,
        containerHeight,
      }
      setImageInfo(info)

      if (initialStateOption) {
        // 恢復初始狀態，但必須驗證並校正各數值
        let restored = { ...initialStateOption }

        // 1. 強制自動貼合：確保 scale >= 旋轉所需最小倍率
        const minScale = getRequiredScale(restored.rotate, naturalWidth, naturalHeight)
        restored.scale = Math.max(1, Math.min(5, Math.max(restored.scale, minScale)))

        // 2. 裁切框限制在容器範圍內
        restored.cropW = Math.max(50, Math.min(containerWidth, restored.cropW))
        restored.cropH = Math.max(50, Math.min(containerHeight, restored.cropH))
        restored.cropX = Math.max(0, Math.min(containerWidth - restored.cropW, restored.cropX))
        restored.cropY = Math.max(0, Math.min(containerHeight - restored.cropH, restored.cropY))

        // 3. 校正圖片位移（確保覆蓋容器）
        const clamped = clampImagePosition(restored, info)
        if (clamped) {
          restored.imageX = clamped.imageX
          restored.imageY = clamped.imageY
        }

        setState(restored)
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

  // 用於邊界檢查的 imageInfo ref (須在 setScale/setRotate 之前宣告)
  const imageInfoRef = useRef<ImageInfo | null>(null)
  imageInfoRef.current = imageInfo

  // 設定縮放 (強制自動貼合 + 即時位移校正)
  const setScale = useCallback((scale: number) => {
    setState((prev) => {
      let newScale = Math.max(1, Math.min(5, scale))
      const dims = naturalDimensionsRef.current
      if (dims) {
        const minScale = getRequiredScale(prev.rotate, dims.width, dims.height)
        newScale = Math.max(newScale, minScale)
      }
      // 先更新 scale，再校正位移
      const updated = { ...prev, scale: newScale }
      const info = imageInfoRef.current
      if (info) {
        const result = clampImagePosition(updated, info)
        if (result) return { ...updated, imageX: result.imageX, imageY: result.imageY }
      }
      return updated
    })
  }, [])

  // 設定旋轉 (-180 ~ 180, 強制自動貼合 + 即時位移校正)
  // 順序：旋轉 → 自動縮放 → 校正位移
  const setRotate = useCallback((rotate: number) => {
    const clampedRotate = Math.max(-180, Math.min(180, rotate))
    setState((prev) => {
      const dims = naturalDimensionsRef.current
      let newScale = prev.scale
      if (dims) {
        const minScale = getRequiredScale(clampedRotate, dims.width, dims.height)
        newScale = Math.max(1, minScale)
      }
      // 先更新 rotate + scale，再校正位移
      const updated = { ...prev, rotate: clampedRotate, scale: newScale }
      const info = imageInfoRef.current
      if (info) {
        const result = clampImagePosition(updated, info)
        if (result) return { ...updated, imageX: result.imageX, imageY: result.imageY }
      }
      return updated
    })
  }, [])

  // 設定圖片位置
  const setImagePosition = useCallback((x: number, y: number) => {
    setState((prev) => ({ ...prev, imageX: x, imageY: y }))
  }, [])

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

  // 邊界回彈：確保裁切框在圖片範圍內
  const clampImage = useCallback(() => {
    const info = imageInfoRef.current
    if (!info) return
    setState((prev) => {
      const result = clampImagePosition(prev, info)
      if (!result) return prev
      return { ...prev, imageX: result.imageX, imageY: result.imageY }
    })
  }, [])

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
    initialize,
    setScale,
    setRotate,
    setImagePosition,
    clampImage,
    rotateBy90,
    toggleFlipX,
    toggleFlipY,
    moveCropBox,
    resizeCropBox,
    setCropBox,
  }
}
