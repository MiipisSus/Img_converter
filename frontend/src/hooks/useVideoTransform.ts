import { useState, useCallback, useMemo, useRef } from 'react'

/**
 * 影片裁切變換狀態
 * 簡化自 useImageEditor — 排除所有旋轉/翻轉計算
 */
export interface VideoTransformState {
  scale: number       // 1.0–5.0
  translateX: number  // 相對於容器中心的 px 偏移
  translateY: number
  cropX: number       // 裁切框左上角 (相對容器左上角, UI px)
  cropY: number
  cropW: number
  cropH: number
}

type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w'

const DEFAULT_STATE: VideoTransformState = {
  scale: 1,
  translateX: 0,
  translateY: 0,
  cropX: 0,
  cropY: 0,
  cropW: 0,
  cropH: 0,
}

/**
 * 無旋轉版位移約束
 * 確保影片縮放後覆蓋整個容器四邊（而非僅裁切框）
 * 防止拖動時容器邊緣露出黑色背景
 */
function clampTranslate(
  state: VideoTransformState,
  videoW: number,
  videoH: number,
  M: number,
  containerW: number,
  containerH: number,
): { translateX: number; translateY: number } | null {
  const { scale, translateX: tx, translateY: ty } = state

  // 影片縮放後的顯示尺寸
  const vw = videoW * M * scale
  const vh = videoH * M * scale

  // 影片左上角 (transform-origin: center → 影片中心在容器中心 + 偏移)
  // videoLeft  = (containerW - vw) / 2 + tx
  // videoRight = (containerW + vw) / 2 + tx
  //
  // 約束: 影片必須覆蓋整個容器
  //   videoLeft  <= 0           →  tx <= (vw - containerW) / 2
  //   videoRight >= containerW  →  tx >= (containerW - vw) / 2
  //   videoTop   <= 0           →  ty <= (vh - containerH) / 2
  //   videoBottom >= containerH →  ty >= (containerH - vh) / 2

  const maxTx = (vw - containerW) / 2
  const minTx = (containerW - vw) / 2
  const maxTy = (vh - containerH) / 2
  const minTy = (containerH - vh) / 2

  const clampedTx = Math.max(minTx, Math.min(maxTx, tx))
  const clampedTy = Math.max(minTy, Math.min(maxTy, ty))

  if (Math.abs(clampedTx - tx) < 0.5 && Math.abs(clampedTy - ty) < 0.5) return null
  return { translateX: clampedTx, translateY: clampedTy }
}

export interface UseVideoTransformOptions {
  videoWidth: number
  videoHeight: number
  containerWidth: number
  containerHeight: number
  minCropSize?: number
}

export function useVideoTransform(options: UseVideoTransformOptions) {
  const { videoWidth, videoHeight, containerWidth, containerHeight, minCropSize: _minCropSize = 50 } = options

  const [state, setState] = useState<VideoTransformState>(() => ({
    ...DEFAULT_STATE,
    cropW: containerWidth,
    cropH: containerHeight,
  }))

  // object-fit: contain 等效顯示倍率
  const displayMultiplier = useMemo(() => {
    if (videoWidth <= 0 || videoHeight <= 0 || containerWidth <= 0 || containerHeight <= 0) return 1
    return Math.min(containerWidth / videoWidth, containerHeight / videoHeight)
  }, [videoWidth, videoHeight, containerWidth, containerHeight])

  const optsRef = useRef(options)
  optsRef.current = options

  const MRef = useRef(displayMultiplier)
  MRef.current = displayMultiplier

  // ── setScale ──
  const setScale = useCallback((newScale: number) => {
    setState((prev) => {
      const s = Math.max(1, Math.min(5, newScale))
      const updated = { ...prev, scale: s }
      const { videoWidth: vw, videoHeight: vh, containerWidth: cW, containerHeight: cH } = optsRef.current
      const result = clampTranslate(updated, vw, vh, MRef.current, cW, cH)
      if (result) return { ...updated, ...result }
      return updated
    })
  }, [])

  // ── setTranslate ──
  const setTranslate = useCallback((x: number, y: number) => {
    setState((prev) => ({ ...prev, translateX: x, translateY: y }))
  }, [])

  // ── clampPosition ──
  const clampPosition = useCallback(() => {
    setState((prev) => {
      const { videoWidth: vw, videoHeight: vh, containerWidth: cW, containerHeight: cH } = optsRef.current
      const result = clampTranslate(prev, vw, vh, MRef.current, cW, cH)
      if (!result) return prev
      return { ...prev, ...result }
    })
  }, [])

  // ── resizeCropBox ──
  const resizeCropBox = useCallback(
    (handle: ResizeHandle, deltaX: number, deltaY: number) => {
      const { containerWidth: cW, containerHeight: cH, minCropSize: minCS = 50 } = optsRef.current

      setState((prev) => {
        let { cropX, cropY, cropW, cropH } = prev
        const originalRight = cropX + cropW
        const originalBottom = cropY + cropH

        switch (handle) {
          case 'nw': cropX += deltaX; cropY += deltaY; cropW -= deltaX; cropH -= deltaY; break
          case 'ne': cropY += deltaY; cropW += deltaX; cropH -= deltaY; break
          case 'sw': cropX += deltaX; cropW -= deltaX; cropH += deltaY; break
          case 'se': cropW += deltaX; cropH += deltaY; break
          case 'n': cropY += deltaY; cropH -= deltaY; break
          case 's': cropH += deltaY; break
          case 'w': cropX += deltaX; cropW -= deltaX; break
          case 'e': cropW += deltaX; break
        }

        // 邊界檢查
        if (handle.includes('n') && cropY < 0) { cropY = 0; cropH = originalBottom }
        if (handle.includes('w') && cropX < 0) { cropX = 0; cropW = originalRight }
        if (handle.includes('s') && cropY + cropH > cH) { cropH = cH - cropY }
        if (handle.includes('e') && cropX + cropW > cW) { cropW = cW - cropX }

        // 最小尺寸
        if (cropW < minCS) {
          if (handle.includes('w')) cropX = originalRight - minCS
          cropW = minCS
        }
        if (cropH < minCS) {
          if (handle.includes('n')) cropY = originalBottom - minCS
          cropH = minCS
        }

        return { ...prev, cropX, cropY, cropW, cropH }
      })
    },
    [],
  )

  // ── setCropBox ──
  const setCropBox = useCallback(
    (crop: { cropX?: number; cropY?: number; cropW?: number; cropH?: number }) => {
      setState((prev) => ({ ...prev, ...crop }))
    },
    [],
  )

  // ── reset ──
  const reset = useCallback(() => {
    const { containerWidth: cW, containerHeight: cH } = optsRef.current
    setState({
      scale: 1,
      translateX: 0,
      translateY: 0,
      cropX: 0,
      cropY: 0,
      cropW: cW,
      cropH: cH,
    })
  }, [])

  // ── restoreState — 一次性設定完整狀態 + 自動 clamp ──
  const restoreState = useCallback((newState: VideoTransformState) => {
    setState(() => {
      const { videoWidth: vw, videoHeight: vh, containerWidth: cW, containerHeight: cH } = optsRef.current
      const M = Math.min(cW / vw, cH / vh)
      const clamped = clampTranslate(newState, vw, vh, M, cW, cH)
      return clamped ? { ...newState, ...clamped } : newState
    })
  }, [])

  // ── forceState — 直接設定完整狀態，不做 clamp ──
  // 用於初始化階段：caller 確保狀態有效，且 optsRef 可能尚未更新
  const forceState = useCallback((newState: VideoTransformState) => {
    setState(newState)
  }, [])

  // ── CSS transform ──
  const videoTransform = useMemo(() => {
    const { translateX: tx, translateY: ty, scale: s } = state
    return `translate(${tx}px, ${ty}px) scale(${s})`
  }, [state.translateX, state.translateY, state.scale])

  return {
    state,
    displayMultiplier,
    videoTransform,
    setScale,
    setTranslate,
    clampPosition,
    resizeCropBox,
    setCropBox,
    reset,
    restoreState,
    forceState,
  }
}
