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
 * 根據編輯器狀態生成裁切後的圖片 (V8 規格)
 *
 * 策略: 直接複製 CSS transform 管線
 *
 * CSS 的 transform (transform-origin: center center):
 *   translate(imageX, imageY) scale(flipScaleX, flipScaleY) rotate(totalRotate)
 *
 * 等效矩陣:
 *   T(center) · translate(imageX, imageY) · scale(flip*zoom) · rotate(θ) · T(-center)
 *
 * Canvas 變換鏈 (複製 CSS 視覺結果):
 *   1. scale(1/M)               — display 像素 → canvas 像素
 *   2. translate(-cropX, -cropY) — 裁切框偏移 (canvas 視窗 = 裁切框區域)
 *   3. translate(center + offset) — 圖片中心在 display 座標的位置 (= 容器中心 + imageXY)
 *   4. scale(flip * zoom)        — 翻轉 + 使用者縮放
 *   5. rotate(totalRotate)       — 旋轉 (baseRotate + freeRotate)
 *   6. translate(-imgW/2, -imgH/2) — 回到圖片左上角 (imgW = naturalWidth*M)
 *   7. drawImage(0, 0, imgW, imgH) — 繪製圖片 (維持原始比例)
 *
 * 翻轉像素映射 (Mirror Mapping) 由步驟 4 的 scale(-1) 自然實現:
 *   flipY 時: 畫面上方裁切框取得的是翻轉後位於上方的像素 (即原圖底部)
 *   flipX 時: 同理，取得原圖右側的像素
 *
 * 等效公式 (無旋轉/縮放/偏移時):
 *   flipY: sy = naturalHeight - (cropY + cropH) / M
 *   flipX: sx = naturalWidth - (cropX + cropW) / M
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

  const M = displayMultiplier

  // 1. 畫布尺寸 = 裁切框的原始像素尺寸
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(cropW / M)
  canvas.height = Math.round(cropH / M)

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('無法建立 Canvas Context')
  }

  // 2. 直接複製 CSS transform 管線
  //    CSS: translate(imageX, imageY) scale(flipScaleX, flipScaleY) rotate(totalRotate)
  //    transform-origin: center center → T(center) · CSS · T(-center)
  const flipScaleX = (flipX ? -1 : 1) * scale
  const flipScaleY = (flipY ? -1 : 1) * scale
  const totalRotate = baseRotate + rotate

  // 圖片顯示尺寸 = 原始尺寸 * M (不隨 baseRotate 對調)
  const imgDisplayW = naturalWidth * M
  const imgDisplayH = naturalHeight * M

  // 步驟 1: display → canvas 像素
  ctx.scale(1 / M, 1 / M)

  // 步驟 2: 裁切框偏移 (canvas 視窗對齊裁切框左上角)
  ctx.translate(-cropX, -cropY)

  // 步驟 3: 移至圖片中心 (容器中心 + 偏移，flex 置中保證圖片中心 = 容器中心)
  ctx.translate(containerWidth / 2 + imageX, containerHeight / 2 + imageY)

  // 步驟 4: 翻轉 + 使用者縮放
  ctx.scale(flipScaleX, flipScaleY)

  // 步驟 5: 旋轉
  ctx.rotate((totalRotate * Math.PI) / 180)

  // 步驟 6: 回到圖片左上角 (以圖片顯示尺寸為基準)
  ctx.translate(-imgDisplayW / 2, -imgDisplayH / 2)

  // 3. 繪製圖片 (維持原始比例，與 CSS img 元素完全一致)
  ctx.drawImage(image, 0, 0, imgDisplayW, imgDisplayH)

  // 7. 調整尺寸 (如果有指定目標尺寸)
  let finalCanvas: HTMLCanvasElement = canvas
  const croppedWidth = canvas.width
  const croppedHeight = canvas.height

  const needsResize =
    targetWidth !== undefined &&
    targetHeight !== undefined &&
    (targetWidth !== croppedWidth || targetHeight !== croppedHeight)

  if (needsResize) {
    const resizeCanvas = document.createElement('canvas')
    resizeCanvas.width = targetWidth!
    resizeCanvas.height = targetHeight!

    const resizeCtx = resizeCanvas.getContext('2d')
    if (!resizeCtx) {
      throw new Error('無法建立 Resize Canvas Context')
    }

    resizeCtx.imageSmoothingEnabled = true
    resizeCtx.imageSmoothingQuality = 'high'
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
