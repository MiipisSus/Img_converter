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
 * 根據編輯器狀態生成裁切後的圖片 (V3 規格)
 *
 * 座標同步邏輯 (The Golden Rule):
 * - CSS 預覽與 Canvas 必須共用同一個變換順序
 * - 順序: translate → rotate → scale
 *
 * V3 核心修正:
 * - distX/distY 是在 Viewport 座標系（未旋轉）中的向量
 * - 必須在 rotate/scale 之前套用 translate，讓偏移向量與座標系一起被正確變換
 * - 這樣不需要手動計算三角函數，Canvas 的 rotate() 會自然處理方向
 *
 * Canvas 導出公式:
 * 1. canvas.width = cropBox.w, canvas.height = cropBox.h
 * 2. 計算偏移 (Viewport 座標系):
 *    - distX = (cropBox.x + cropBox.w/2) - (viewport.w/2 + image.x)
 *    - distY = (cropBox.y + cropBox.h/2) - (viewport.h/2 + image.y)
 * 3. ctx.translate(canvas.width/2 - distX, canvas.height/2 - distY) ← 關鍵：先套用偏移
 * 4. ctx.rotate(rotate * PI/180)
 * 5. ctx.scale(scale, scale)
 * 6. ctx.drawImage(img, -W_view/2, -H_view/2, W_view, H_view)
 */
export async function generateCroppedImage(
  image: HTMLImageElement,
  state: EditorState,
  imageInfo: ImageInfo,
  options: CropOptions = {}
): Promise<CropResult> {
  const { format = 'image/png', quality = 0.92 } = options
  const { imageX, imageY, scale, rotate, cropX, cropY, cropW, cropH } = state
  const { displayWidth, displayHeight, viewportWidth, viewportHeight } = imageInfo

  // 1. 畫布準備：使用裁切框的視覺尺寸
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(cropW)
  canvas.height = Math.round(cropH)

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('無法建立 Canvas Context')
  }

  // 2. 計算偏移向量 (在 Viewport 座標系中)
  // 找出「裁切框中心」與「圖片中心」的距離

  // 裁切框中心 (Viewport 座標)
  const cropCenterX = cropX + cropW / 2
  const cropCenterY = cropY + cropH / 2

  // 圖片中心 (Viewport 座標) = Viewport 中心 + 圖片偏移
  const imageCenterX = viewportWidth / 2 + imageX
  const imageCenterY = viewportHeight / 2 + imageY

  // 裁切框中心與圖片中心的距離 (Viewport 座標系)
  const distX = cropCenterX - imageCenterX
  const distY = cropCenterY - imageCenterY

  // 3. 座標變換步驟 (V3 關鍵修正)
  // 必須先套用 translate (包含 distX/distY)，再 rotate/scale
  // 這樣偏移向量會和旋轉/縮放一起被正確變換，不需要手動計算三角函數

  // 3.1 平移到「圖片中心相對於 Canvas 中心」的位置
  ctx.translate(canvas.width / 2 - distX, canvas.height / 2 - distY)

  // 3.2 旋轉
  ctx.rotate((rotate * Math.PI) / 180)

  // 3.3 縮放
  ctx.scale(scale, scale)

  // 4. 繪製圖片 (以圖片中心為原點)
  ctx.drawImage(image, -displayWidth / 2, -displayHeight / 2, displayWidth, displayHeight)

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
