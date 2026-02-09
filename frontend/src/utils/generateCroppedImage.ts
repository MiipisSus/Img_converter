import type { EditorState, ImageInfo } from '../hooks/useImageEditor'

export interface CropOptions {
  /** 輸出格式 */
  format?: 'image/png' | 'image/jpeg' | 'image/webp'
  /** JPEG/WebP 品質 (0-1) */
  quality?: number
  /** 目標寬度 (可選，用於縮放) */
  targetWidth?: number
  /** 目標高度 (可選，用於縮放) */
  targetHeight?: number
}

export interface CropResult {
  blob: Blob
  dataUrl: string
  width: number
  height: number
}

/**
 * 根據編輯器狀態生成裁切後的圖片 (V7 規格)
 *
 * V7 核心概念:
 * - UI 座標系使用 displayMultiplier (M) 放大/縮小顯示
 * - 導出時必須除以 M 還原為原始像素尺寸
 * - 支援 baseRotate (0, 90, 180, 270) 和 flipX/flipY
 *
 * 統一變換順序 (Canonical Order) - CSS 和 Canvas 必須一致:
 * 1. Translate (平移至中心)
 * 2. Scale + Flip (縮放，含翻轉)
 * 3. Rotate (總角度 = baseRotate + freeRotate)
 *
 * 這確保翻轉是基於圖片自身的軸，而旋轉是最後施加的視覺效果。
 * 使用者點擊『水平翻轉』時，圖片以『自身中軸』做鏡像。
 *
 * Canvas 導出公式:
 * 1. canvas.width = cropBox.w / M, canvas.height = cropBox.h / M
 * 2. 計算 UI 向量差並除以 M 轉換為原始像素
 * 3. 按順序執行變換: translate → scale(flip) → rotate(totalAngle)
 * 4. drawImage 使用原始像素尺寸
 */
export async function generateCroppedImage(
  image: HTMLImageElement,
  state: EditorState,
  imageInfo: ImageInfo,
  options: CropOptions = {}
): Promise<CropResult> {
  const { format = 'image/png', quality = 0.92, targetWidth, targetHeight } = options
  const {
    imageX,
    imageY,
    scale,
    rotate,
    baseRotate,
    flipX,
    flipY,
    cropX,
    cropY,
    cropW,
    cropH,
  } = state
  const { naturalWidth, naturalHeight, displayMultiplier, containerWidth, containerHeight } = imageInfo

  // M = displayMultiplier
  const M = displayMultiplier

  // 1. 畫布準備：除以 M 還原為原始像素尺寸
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(cropW / M)
  canvas.height = Math.round(cropH / M)

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('無法建立 Canvas Context')
  }

  // 2. 計算 UI 向量差 (在容器座標系中)
  // 裁切框中心 (UI 座標)
  const cropCenterX = cropX + cropW / 2
  const cropCenterY = cropY + cropH / 2

  // 圖片中心 (UI 座標) = 容器中心 + 圖片偏移
  const imageCenterX = containerWidth / 2 + imageX
  const imageCenterY = containerHeight / 2 + imageY

  // UI 向量差
  const distX = cropCenterX - imageCenterX
  const distY = cropCenterY - imageCenterY

  // 3. 轉換為原始像素向量 (除以 M)
  const distX_orig = distX / M
  const distY_orig = distY / M

  // 4. 座標變換步驟 (統一變換順序)
  // 4.1 平移到「圖片中心相對於 Canvas 中心」的位置 (原始像素座標)
  ctx.translate(canvas.width / 2 - distX_orig, canvas.height / 2 - distY_orig)

  // 4.2 縮放 + 翻轉 (翻轉在旋轉之前，確保翻轉是基於圖片自身的軸)
  const flipScaleX = (flipX ? -1 : 1) * scale
  const flipScaleY = (flipY ? -1 : 1) * scale
  ctx.scale(flipScaleX, flipScaleY)

  // 4.3 旋轉 (總角度 = baseRotate + freeRotate)
  const totalRotate = baseRotate + rotate
  ctx.rotate((totalRotate * Math.PI) / 180)

  // 5. 繪製圖片 (使用原始像素尺寸)
  ctx.drawImage(image, -naturalWidth / 2, -naturalHeight / 2, naturalWidth, naturalHeight)

  // 6. 調整尺寸 (如果有指定目標尺寸)
  let finalCanvas: HTMLCanvasElement = canvas
  const croppedWidth = canvas.width
  const croppedHeight = canvas.height

  // 檢查是否需要縮放
  const needsResize =
    targetWidth !== undefined &&
    targetHeight !== undefined &&
    (targetWidth !== croppedWidth || targetHeight !== croppedHeight)

  if (needsResize) {
    // 建立縮放用的新 Canvas
    const resizeCanvas = document.createElement('canvas')
    resizeCanvas.width = targetWidth!
    resizeCanvas.height = targetHeight!

    const resizeCtx = resizeCanvas.getContext('2d')
    if (!resizeCtx) {
      throw new Error('無法建立 Resize Canvas Context')
    }

    // 使用高品質縮放
    resizeCtx.imageSmoothingEnabled = true
    resizeCtx.imageSmoothingQuality = 'high'

    // 將裁切後的圖片繪製到縮放 Canvas
    resizeCtx.drawImage(canvas, 0, 0, croppedWidth, croppedHeight, 0, 0, targetWidth!, targetHeight!)

    finalCanvas = resizeCanvas
  }

  // 轉換為 Blob
  const blob = await new Promise<Blob>((resolve, reject) => {
    finalCanvas.toBlob(
      (b) => {
        if (b) resolve(b)
        else reject(new Error('Canvas toBlob 失敗'))
      },
      format,
      quality
    )
  })

  const dataUrl = finalCanvas.toDataURL(format, quality)

  return {
    blob,
    dataUrl,
    width: finalCanvas.width,
    height: finalCanvas.height,
  }
}
