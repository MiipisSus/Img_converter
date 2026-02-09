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
 * 根據編輯器狀態生成裁切後的圖片 (V7 規格)
 *
 * V7 核心概念:
 * - UI 座標系使用 displayMultiplier (M) 放大/縮小顯示
 * - 導出時必須除以 M 還原為原始像素尺寸
 * - 支援 baseRotate (0, 90, 180, 270) 和 flipX/flipY
 *
 * 變換順序 (The Golden Rule) - CSS 和 Canvas 必須一致:
 * 1. Translate (平移至中心)
 * 2. Base Rotate (90度單位旋轉)
 * 3. Free Rotate (自由旋轉)
 * 4. Flip (水平/垂直翻轉)
 * 5. User Scale (使用者縮放)
 *
 * Canvas 導出公式 (V7):
 * 1. canvas.width = cropBox.w / M, canvas.height = cropBox.h / M
 * 2. 計算 UI 向量差並除以 M 轉換為原始像素
 * 3. 按順序執行變換: translate → baseRotate → rotate → flip → scale
 * 4. drawImage 使用原始像素尺寸
 */
export async function generateCroppedImage(
  image: HTMLImageElement,
  state: EditorState,
  imageInfo: ImageInfo,
  options: CropOptions = {}
): Promise<CropResult> {
  const { format = 'image/png', quality = 0.92 } = options
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

  // 4. 座標變換步驟 (V7 順序)
  // 4.1 平移到「圖片中心相對於 Canvas 中心」的位置 (原始像素座標)
  ctx.translate(canvas.width / 2 - distX_orig, canvas.height / 2 - distY_orig)

  // 4.2 步進旋轉 (baseRotate)
  ctx.rotate((baseRotate * Math.PI) / 180)

  // 4.3 自由旋轉 (rotate)
  ctx.rotate((rotate * Math.PI) / 180)

  // 4.4 翻轉 (在旋轉之後，確保翻轉方向符合使用者預期)
  ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1)

  // 4.5 使用者縮放
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
