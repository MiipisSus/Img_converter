import type { EditorState, ImageInfo } from '../hooks/useImageEditor'

export interface CropOptions {
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
 * 根據編輯器狀態生成裁切後的圖片 (V5 規格)
 *
 * V5 核心概念:
 * - UI 座標系使用 displayMultiplier (M) 放大顯示
 * - 導出時必須除以 M 還原為原始像素尺寸
 *
 * 座標同步邏輯 (The Golden Rule):
 * - CSS 預覽與 Canvas 必須共用同一個變換順序
 * - 順序: translate → rotate → scale
 *
 * Canvas 導出公式 (V5):
 * 1. canvas.width = cropBox.w / M, canvas.height = cropBox.h / M (還原像素)
 * 2. 計算 UI 向量差:
 *    - distX = (cropBox.x + cropBox.w/2) - (container.w/2 + image.x)
 *    - distY = (cropBox.y + cropBox.h/2) - (container.h/2 + image.y)
 * 3. 轉換為原始像素向量:
 *    - distX_orig = distX / M
 *    - distY_orig = distY / M
 * 4. ctx.translate(canvas.width/2 - distX_orig, canvas.height/2 - distY_orig)
 * 5. ctx.rotate(rotate * PI/180)
 * 6. ctx.scale(scale, scale)
 * 7. ctx.drawImage(img, -naturalWidth/2, -naturalHeight/2, naturalWidth, naturalHeight)
 */
export async function generateCroppedImage(
  image: HTMLImageElement,
  state: EditorState,
  imageInfo: ImageInfo,
  options: CropOptions = {}
): Promise<CropResult> {
  const { format = 'image/png', quality = 0.92 } = options
  const { imageX, imageY, scale, rotate, cropX, cropY, cropW, cropH } = state
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

  // 4. 座標變換步驟
  // 必須先套用 translate (包含偏移)，再 rotate/scale
  // 這樣偏移向量會和旋轉/縮放一起被正確變換

  // 4.1 平移到「圖片中心相對於 Canvas 中心」的位置 (原始像素座標)
  ctx.translate(canvas.width / 2 - distX_orig, canvas.height / 2 - distY_orig)

  // 4.2 旋轉
  ctx.rotate((rotate * Math.PI) / 180)

  // 4.3 縮放
  ctx.scale(scale, scale)

  // 5. 繪製圖片 (使用原始像素尺寸)
  ctx.drawImage(image, -naturalWidth / 2, -naturalHeight / 2, naturalWidth, naturalHeight)

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
    width: canvas.width,
    height: canvas.height,
  }
}
