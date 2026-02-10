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
 * 座標還原策略:
 * 1. 將翻轉 (flip) 從繪製管線中分離，改為 Canvas 後處理
 * 2. 在翻轉軸上反轉 dist 向量，使裁切框追蹤「翻轉前的原始內容」
 * 3. 繪製管線只處理: 旋轉 + 縮放 + img 元素拉伸
 * 4. 最後將整個 Canvas 做鏡像翻轉
 *
 * 這確保:
 * - 裁切左上角的「頭」，翻轉後仍然是「頭」（只是鏡像），不會變成「腳」
 * - 自由旋轉的偏移在反轉 dist 時已被正確補償
 * - baseRotate=90/270 的非均勻拉伸由 stretch 步驟處理
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

  // 2. 計算裁切框中心到圖片中心的向量 (display 座標系)
  const imageCenterX = containerWidth / 2 + imageX
  const imageCenterY = containerHeight / 2 + imageY
  const distX = (cropX + cropW / 2) - imageCenterX
  const distY = (cropY + cropH / 2) - imageCenterY

  // 3. 翻轉補償: 在翻轉軸上反轉距離
  //    這使裁切框指向「翻轉前」的原始內容位置
  //    例: 裁切框在畫面上方 (dist < 0)，翻轉後內容跑到下方，
  //         反轉 dist → 正值 → Canvas 從下方取樣 → 配合後處理翻轉 → 結果正確
  const ufDistX = flipX ? -distX : distX
  const ufDistY = flipY ? -distY : distY

  // 4. img 元素拉伸比 (baseRotate=90/270 時為非均勻)
  const stretchX = containerWidth / naturalWidth
  const stretchY = containerHeight / naturalHeight

  // 5. Canvas 變換管線
  //
  // 步驟 A: 後處理翻轉 (繞 Canvas 中心鏡像)
  if (flipX || flipY) {
    ctx.translate(flipX ? canvas.width : 0, flipY ? canvas.height : 0)
    ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1)
  }

  // 步驟 B: display → canvas 像素座標
  ctx.scale(1 / M, 1 / M)

  // 步驟 C: 定位 (使用翻轉補償後的距離)
  ctx.translate(cropW / 2 - ufDistX, cropH / 2 - ufDistY)

  // 步驟 D: 使用者縮放 (不含翻轉，翻轉已由步驟 A 處理)
  ctx.scale(scale, scale)

  // 步驟 E: 旋轉 (總角度 = baseRotate + freeRotate)
  const totalRotate = baseRotate + rotate
  ctx.rotate((totalRotate * Math.PI) / 180)

  // 步驟 F: img 元素拉伸補償
  ctx.scale(stretchX, stretchY)

  // 6. 繪製圖片 (以圖片中心為原點)
  ctx.drawImage(image, -naturalWidth / 2, -naturalHeight / 2, naturalWidth, naturalHeight)

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
