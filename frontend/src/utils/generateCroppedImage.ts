import type { CropBoxState } from '../hooks/useCropBox'

export interface CropOptions {
  /** 顯示尺寸到原始尺寸的縮放比例 */
  displayScale: number
  /** 輸出格式 */
  format?: 'image/png' | 'image/jpeg' | 'image/webp'
  /** JPEG/WebP 品質 (0-1) */
  quality?: number
}

export interface CropResult {
  blob: Blob
  dataUrl: string
  width: number
  height: number
}

/**
 * 根據 CropBoxState 生成裁切後的圖片
 *
 * 新架構：固定圖片 + 可移動裁切框
 * - cropX, cropY, cropW, cropH 是相對於「顯示尺寸」的座標
 * - 需要除以 displayScale 來換算成原始像素座標
 */
export async function generateCroppedImage(
  image: HTMLImageElement,
  cropState: CropBoxState,
  options: CropOptions
): Promise<CropResult> {
  const {
    displayScale,
    format = 'image/png',
    quality = 0.92,
  } = options

  const { cropX, cropY, cropW, cropH } = cropState

  // 換算成原始圖片的像素座標
  const srcX = cropX / displayScale
  const srcY = cropY / displayScale
  const srcW = cropW / displayScale
  const srcH = cropH / displayScale

  // 輸出尺寸 = 原始像素尺寸
  const outputW = Math.round(srcW)
  const outputH = Math.round(srcH)

  // 建立 Canvas
  const canvas = document.createElement('canvas')
  canvas.width = outputW
  canvas.height = outputH

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('無法建立 Canvas Context')
  }

  // 繪製裁切區域
  ctx.drawImage(
    image,
    srcX, srcY, srcW, srcH,  // 來源區域 (原始像素)
    0, 0, outputW, outputH    // 目標區域
  )

  // 轉換為 Blob
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b)
        else reject(new Error('Canvas toBlob 失敗'))
      },
      format,
      quality
    )
  })

  const dataUrl = canvas.toDataURL(format, quality)

  return {
    blob,
    dataUrl,
    width: outputW,
    height: outputH,
  }
}
