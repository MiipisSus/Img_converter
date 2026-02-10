import { useState, useCallback, useRef } from 'react'
import { ImageEditor } from './components/ImageEditor'
import { generateCroppedImage, type CropResult } from './utils/generateCroppedImage'
import type { EditorState, ImageInfo } from './hooks/useImageEditor'

type AppMode = 'preview' | 'crop' | 'output'

/** 調整尺寸狀態 */
interface ResizeState {
  active: boolean
  targetWidth: number
  targetHeight: number
  lockAspectRatio: boolean
  /** 裁切後的原始基準尺寸 (用於計算比例和顯示) */
  croppedWidth: number
  croppedHeight: number
}

/** 持久化的 Pipeline 狀態 */
interface PipelineState {
  editorState: EditorState
  imageInfo: ImageInfo
  previewUrl: string | null
  resize: ResizeState
  /** 實際輸出尺寸 (僅在套用後更新) */
  outputWidth: number
  outputHeight: number
}

/** 計算有效尺寸和容器參數 - 符合 IMAGE_CROPPER_SPEC V7 */
function calculateContainerParams(
  naturalWidth: number,
  naturalHeight: number,
  baseRotate: number
): { effW: number; effH: number; M: number; containerWidth: number; containerHeight: number } {
  const MIN_WIDTH = 400, MAX_WIDTH = 600

  const isRotated90 = baseRotate === 90 || baseRotate === 270
  const effW = isRotated90 ? naturalHeight : naturalWidth
  const effH = isRotated90 ? naturalWidth : naturalHeight

  let M: number
  if (effW > MAX_WIDTH) M = MAX_WIDTH / effW
  else if (effW < MIN_WIDTH) M = MIN_WIDTH / effW
  else M = 1

  const containerWidth = Math.round(effW * M)
  const containerHeight = Math.round(effH * M)

  return { effW, effH, M, containerWidth, containerHeight }
}

/** 計算裁切後的原始像素尺寸 */
function getCroppedOriginalSize(state: EditorState, info: ImageInfo): { width: number; height: number } {
  const width = Math.round(state.cropW / info.displayMultiplier)
  const height = Math.round(state.cropH / info.displayMultiplier)
  return { width, height }
}

/** 輸出設定狀態 (暫態，返回裁切時會重置) */
interface OutputSettings {
  targetWidth: number
  targetHeight: number
  lockAspectRatio: boolean
  format: 'png' | 'jpeg' | 'webp'
  /** 基準尺寸 (進入輸出模式時的裁切尺寸) */
  baseWidth: number
  baseHeight: number
  /** 品質 (0-100, 僅 JPEG/WebP 有效) */
  quality: number
  /** 目標檔案大小 (KB)，null 表示不限制 */
  targetKB: number | null
  /** 是否啟用目標 KB 限制 */
  enableTargetKB: boolean
  /** 上次導出的檔案大小 (bytes) */
  lastExportSize: number | null
}

function App() {
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [mode, setMode] = useState<AppMode>('preview')
  const [isExporting, setIsExporting] = useState(false)

  // 輸出設定 (暫態)
  const [outputSettings, setOutputSettings] = useState<OutputSettings | null>(null)

  // 全域 Pipeline 狀態
  const [pipelineState, setPipelineState] = useState<PipelineState | null>(null)

  // 當前編輯中的狀態 (裁切模式用)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const currentEditorStateRef = useRef<{ state: EditorState; imageInfo: ImageInfo } | null>(null)
  // 用於標記是否跳過下次狀態變更的 resize 同步 (進入裁切模式時的自動調整不應覆蓋 resize)
  const skipNextResizeSyncRef = useRef(false)

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      const reader = new FileReader()
      reader.onload = (event) => {
        const src = event.target?.result as string
        setImageSrc(src)
        setPipelineState(null)
        setMode('preview')
        setOutputSettings(null)

        const img = new Image()
        img.src = src
        img.onload = () => {
          const { M, containerWidth, containerHeight } = calculateContainerParams(
            img.naturalWidth,
            img.naturalHeight,
            0
          )

          const initialState: EditorState = {
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
          }

          const initialImageInfo: ImageInfo = {
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
            displayMultiplier: M,
            containerWidth,
            containerHeight,
          }

          // 初始裁切後尺寸
          const croppedSize = getCroppedOriginalSize(initialState, initialImageInfo)

          setPipelineState({
            editorState: initialState,
            imageInfo: initialImageInfo,
            previewUrl: null,
            resize: {
              active: false,
              targetWidth: croppedSize.width,
              targetHeight: croppedSize.height,
              lockAspectRatio: true,
              croppedWidth: croppedSize.width,
              croppedHeight: croppedSize.height,
            },
            outputWidth: croppedSize.width,
            outputHeight: croppedSize.height,
          })
        }
        imageRef.current = img
      }
      reader.readAsDataURL(file)
    },
    []
  )

  // 接收編輯器狀態更新 (裁切模式下，動態更新 resize 目標以匹配裁切框比例)
  const handleStateChange = useCallback((state: EditorState, imageInfo: ImageInfo | null) => {
    if (imageInfo) {
      currentEditorStateRef.current = { state, imageInfo }

      // 在裁切模式下，檢查裁切框比例是否改變
      if (mode === 'crop') {
        // 如果是進入裁切模式時的自動調整，跳過這次同步
        if (skipNextResizeSyncRef.current) {
          skipNextResizeSyncRef.current = false
          return
        }

        const croppedSize = getCroppedOriginalSize(state, imageInfo)
        setPipelineState(prev => {
          if (!prev) return prev

          const cropAspectRatio = croppedSize.width / croppedSize.height
          const targetAspectRatio = prev.resize.targetWidth / prev.resize.targetHeight

          // 只有當比例改變時才更新 resize 目標 (防止扭曲)
          // 保留使用者設定的縮放尺寸，只在比例變化時覆蓋
          if (Math.abs(cropAspectRatio - targetAspectRatio) > 0.01) {
            return {
              ...prev,
              resize: {
                ...prev.resize,
                // 使用者手動調整了裁切比例，更新 resize 目標為裁切尺寸
                targetWidth: croppedSize.width,
                targetHeight: croppedSize.height,
                croppedWidth: croppedSize.width,
                croppedHeight: croppedSize.height,
                // 比例改變後，清除 active 狀態 (用戶需要重新設定縮放)
                active: false,
              },
            }
          }

          // 比例相同，只更新基準尺寸
          if (
            prev.resize.croppedWidth !== croppedSize.width ||
            prev.resize.croppedHeight !== croppedSize.height
          ) {
            return {
              ...prev,
              resize: {
                ...prev.resize,
                croppedWidth: croppedSize.width,
                croppedHeight: croppedSize.height,
              },
            }
          }

          return prev
        })
      }
    }
  }, [mode])

  // 進入裁切模式 (預設採用 resize 設定的比例作為引導)
  const handleEnterCropMode = useCallback(() => {
    // 如果有 resize 設定，調整初始裁切框以符合該比例
    if (pipelineState) {
      const { editorState, imageInfo, resize } = pipelineState
      const targetAspectRatio = resize.targetWidth / resize.targetHeight
      const currentAspectRatio = editorState.cropW / editorState.cropH

      // 如果比例不符，調整裁切框以符合 resize 比例
      if (Math.abs(targetAspectRatio - currentAspectRatio) > 0.01) {
        const { containerWidth, containerHeight } = imageInfo
        let newCropW: number, newCropH: number

        // 以較小的尺寸為基準，確保裁切框在容器內
        if (targetAspectRatio > containerWidth / containerHeight) {
          // 目標比例較寬，以寬度為基準
          newCropW = containerWidth
          newCropH = containerWidth / targetAspectRatio
        } else {
          // 目標比例較高，以高度為基準
          newCropH = containerHeight
          newCropW = containerHeight * targetAspectRatio
        }

        // 置中
        const newCropX = (containerWidth - newCropW) / 2
        const newCropY = (containerHeight - newCropH) / 2

        // 標記跳過下次的 resize 同步 (這是自動調整，不是使用者手動操作)
        skipNextResizeSyncRef.current = true

        // 更新 pipelineState 中的 editorState
        setPipelineState(prev => ({
          ...prev!,
          editorState: {
            ...prev!.editorState,
            cropX: newCropX,
            cropY: newCropY,
            cropW: newCropW,
            cropH: newCropH,
          },
        }))
      }
    }
    setMode('crop')
  }, [pipelineState])

  // 確定裁切：儲存狀態並生成預覽，同時更新 resize 基準值
  const handleConfirmCrop = useCallback(async () => {
    if (!imageRef.current || !currentEditorStateRef.current || isExporting) return

    setIsExporting(true)
    try {
      const { state, imageInfo } = currentEditorStateRef.current

      // 計算新的裁切後尺寸
      const croppedSize = getCroppedOriginalSize(state, imageInfo)

      // 如果有 active resize，傳遞 resize 參數
      const prevResize = pipelineState?.resize
      const hasActiveResize = prevResize?.active ?? false
      const resizeOptions = hasActiveResize
        ? { targetWidth: prevResize!.targetWidth, targetHeight: prevResize!.targetHeight }
        : {}

      const result: CropResult = await generateCroppedImage(
        imageRef.current,
        state,
        imageInfo,
        resizeOptions
      )

      // 確保 resize 目標與裁切框比例一致 (防止扭曲)
      setPipelineState(prev => {
        const prevResize = prev?.resize
        const cropAspectRatio = croppedSize.width / croppedSize.height
        const targetAspectRatio = prevResize
          ? prevResize.targetWidth / prevResize.targetHeight
          : cropAspectRatio

        // 如果比例相同且有 active resize，保留用戶的縮放設定
        const ratioMatches = Math.abs(cropAspectRatio - targetAspectRatio) < 0.01
        const keepActiveResize = ratioMatches && (prevResize?.active ?? false)

        return {
          editorState: { ...state },
          imageInfo: { ...imageInfo },
          previewUrl: result.dataUrl,
          resize: {
            active: keepActiveResize,
            // 如果比例匹配且有 active resize，保留用戶設定的尺寸；否則使用裁切尺寸
            targetWidth: keepActiveResize ? prevResize!.targetWidth : croppedSize.width,
            targetHeight: keepActiveResize ? prevResize!.targetHeight : croppedSize.height,
            lockAspectRatio: prevResize?.lockAspectRatio ?? true,
            croppedWidth: croppedSize.width,
            croppedHeight: croppedSize.height,
          },
          outputWidth: result.width,
          outputHeight: result.height,
        }
      })

      console.log('導出尺寸:', result.width, '×', result.height)
      setMode('preview')
    } catch (error) {
      console.error('導出失敗:', error)
    } finally {
      setIsExporting(false)
    }
  }, [isExporting, pipelineState?.resize])

  // 返回 (從裁切模式)
  const handleCancelCrop = useCallback(() => {
    setMode('preview')
  }, [])

  // === 輸出模式相關 ===

  // 進入輸出模式
  const handleEnterOutputMode = useCallback(async () => {
    if (!imageRef.current || !pipelineState || isExporting) return

    setIsExporting(true)
    try {
      const { editorState, imageInfo } = pipelineState

      // 計算裁切後的原始像素尺寸
      const croppedSize = getCroppedOriginalSize(editorState, imageInfo)

      // 生成預覽圖
      const result = await generateCroppedImage(
        imageRef.current,
        editorState,
        imageInfo,
        {}
      )

      // 更新 pipelineState 預覽
      setPipelineState(prev => ({
        ...prev!,
        previewUrl: result.dataUrl,
        outputWidth: result.width,
        outputHeight: result.height,
      }))

      // 初始化輸出設定 (暫態)，包含初始檔案大小
      setOutputSettings({
        targetWidth: croppedSize.width,
        targetHeight: croppedSize.height,
        lockAspectRatio: true,
        format: 'png',
        baseWidth: croppedSize.width,
        baseHeight: croppedSize.height,
        quality: 92,
        targetKB: null,
        enableTargetKB: false,
        lastExportSize: result.blob.size,
      })

      setMode('output')
    } catch (error) {
      console.error('進入輸出模式失敗:', error)
    } finally {
      setIsExporting(false)
    }
  }, [isExporting, pipelineState])

  // 更新輸出設定
  const handleUpdateOutputSettings = useCallback((updates: Partial<OutputSettings>) => {
    setOutputSettings(prev => {
      if (!prev) return prev
      return { ...prev, ...updates }
    })
  }, [])

  // 套用輸出設定並生成最終圖片
  const handleApplyOutput = useCallback(async () => {
    if (!imageRef.current || !pipelineState || !outputSettings || isExporting) return

    setIsExporting(true)
    try {
      const { editorState, imageInfo } = pipelineState
      const { targetWidth, targetHeight, format, quality, enableTargetKB, targetKB } = outputSettings

      const mimeType = format === 'png' ? 'image/png' : format === 'jpeg' ? 'image/jpeg' : 'image/webp'

      // 如果啟用目標 KB 限制，使用迭代壓縮
      let result: Awaited<ReturnType<typeof generateCroppedImage>>
      let finalQuality = quality / 100

      if (enableTargetKB && targetKB && format !== 'png') {
        // 迭代壓縮以達到目標大小
        const targetBytes = targetKB * 1024
        let minQuality = 0.1
        let maxQuality = 1.0
        let attempts = 0
        const maxAttempts = 10

        // 先嘗試最高品質
        result = await generateCroppedImage(
          imageRef.current,
          editorState,
          imageInfo,
          { targetWidth, targetHeight, format: mimeType, quality: maxQuality }
        )

        // 如果最高品質已經符合目標，直接使用
        if (result.blob.size <= targetBytes) {
          finalQuality = maxQuality
        } else {
          // 二分搜尋找到合適的品質
          while (attempts < maxAttempts && maxQuality - minQuality > 0.02) {
            const midQuality = (minQuality + maxQuality) / 2
            result = await generateCroppedImage(
              imageRef.current,
              editorState,
              imageInfo,
              { targetWidth, targetHeight, format: mimeType, quality: midQuality }
            )

            if (result.blob.size > targetBytes) {
              maxQuality = midQuality
            } else {
              minQuality = midQuality
            }
            attempts++
          }
          finalQuality = minQuality

          // 最終生成
          result = await generateCroppedImage(
            imageRef.current,
            editorState,
            imageInfo,
            { targetWidth, targetHeight, format: mimeType, quality: finalQuality }
          )
        }
      } else {
        // 不限制大小，直接使用指定品質
        result = await generateCroppedImage(
          imageRef.current,
          editorState,
          imageInfo,
          { targetWidth, targetHeight, format: mimeType, quality: finalQuality }
        )
      }

      // 更新預覽
      setPipelineState(prev => ({
        ...prev!,
        previewUrl: result.dataUrl,
        outputWidth: result.width,
        outputHeight: result.height,
      }))

      // 更新檔案大小資訊
      setOutputSettings(prev => prev ? {
        ...prev,
        lastExportSize: result.blob.size,
      } : prev)

      console.log('輸出尺寸:', result.width, '×', result.height, '檔案大小:', (result.blob.size / 1024).toFixed(1), 'KB')
    } catch (error) {
      console.error('套用輸出設定失敗:', error)
    } finally {
      setIsExporting(false)
    }
  }, [isExporting, pipelineState, outputSettings])

  // 返回裁切模式 (清除輸出設定)
  const handleReturnFromOutput = useCallback(() => {
    // 重置輸出設定 (暫態清除)
    setOutputSettings(null)
    setMode('preview')
  }, [])

  // 選擇其他圖片
  const handleReset = useCallback(() => {
    setImageSrc(null)
    setPipelineState(null)
    setMode('preview')
    setOutputSettings(null)
  }, [])

  // === 旋轉/翻轉 ===
  const applyTransformAndGenerate = useCallback(async (
    transformFn: (prev: EditorState, oldInfo: ImageInfo) => {
      newState: EditorState;
      newInfo: ImageInfo
    },
    is90Rotation = false
  ) => {
    if (!imageRef.current || !pipelineState || isExporting) return

    setIsExporting(true)

    try {
      const { newState, newInfo } = transformFn(pipelineState.editorState, pipelineState.imageInfo)

      // 計算新的裁切後尺寸
      const croppedSize = getCroppedOriginalSize(newState, newInfo)
      const prevResize = pipelineState.resize

      // 計算新的 resize 目標尺寸
      // 對於 90° 旋轉：如果有 active resize，交換寬高
      // 對於翻轉：保持原有尺寸
      // 始終確保 resize 目標與裁切框比例一致
      let newTargetWidth = croppedSize.width
      let newTargetHeight = croppedSize.height

      if (prevResize.active) {
        if (is90Rotation) {
          // 90° 旋轉時交換目標寬高
          newTargetWidth = prevResize.targetHeight
          newTargetHeight = prevResize.targetWidth
        } else {
          // 翻轉時保持原尺寸 (翻轉不改變比例)
          newTargetWidth = prevResize.targetWidth
          newTargetHeight = prevResize.targetHeight
        }
      }

      // 傳遞更新後的 resize 參數給 generateCroppedImage
      const resizeOptions = prevResize.active
        ? { targetWidth: newTargetWidth, targetHeight: newTargetHeight }
        : {}

      const result = await generateCroppedImage(imageRef.current, newState, newInfo, resizeOptions)

      setPipelineState(prev => ({
        editorState: newState,
        imageInfo: newInfo,
        previewUrl: result.dataUrl,
        resize: {
          ...prev!.resize,
          // 更新 resize 目標以匹配新的裁切比例
          targetWidth: newTargetWidth,
          targetHeight: newTargetHeight,
          croppedWidth: croppedSize.width,
          croppedHeight: croppedSize.height,
        },
        outputWidth: result.width,
        outputHeight: result.height,
      }))

      console.log('變換後尺寸:', result.width, '×', result.height)
    } catch (error) {
      console.error('變換失敗:', error)
    } finally {
      setIsExporting(false)
    }
  }, [isExporting, pipelineState])

  // 90° 旋轉
  const handleRotate = useCallback((direction: 'left' | 'right') => {
    applyTransformAndGenerate((prevState, oldInfo) => {
      const newBaseRotate = direction === 'right'
        ? (prevState.baseRotate + 90) % 360
        : (prevState.baseRotate - 90 + 360) % 360

      const { M, containerWidth, containerHeight } = calculateContainerParams(
        oldInfo.naturalWidth,
        oldInfo.naturalHeight,
        newBaseRotate
      )

      const oldRelCropX = prevState.cropX / oldInfo.containerWidth
      const oldRelCropY = prevState.cropY / oldInfo.containerHeight
      const oldRelCropW = prevState.cropW / oldInfo.containerWidth
      const oldRelCropH = prevState.cropH / oldInfo.containerHeight

      let newRelCropX: number, newRelCropY: number, newRelCropW: number, newRelCropH: number

      if (direction === 'right') {
        newRelCropX = 1 - oldRelCropY - oldRelCropH
        newRelCropY = oldRelCropX
        newRelCropW = oldRelCropH
        newRelCropH = oldRelCropW
      } else {
        newRelCropX = oldRelCropY
        newRelCropY = 1 - oldRelCropX - oldRelCropW
        newRelCropW = oldRelCropH
        newRelCropH = oldRelCropW
      }

      const newCropX = Math.round(newRelCropX * containerWidth)
      const newCropY = Math.round(newRelCropY * containerHeight)
      const newCropW = Math.round(newRelCropW * containerWidth)
      const newCropH = Math.round(newRelCropH * containerHeight)

      const clampedCropX = Math.max(0, Math.min(containerWidth - 50, newCropX))
      const clampedCropY = Math.max(0, Math.min(containerHeight - 50, newCropY))
      const clampedCropW = Math.max(50, Math.min(containerWidth - clampedCropX, newCropW))
      const clampedCropH = Math.max(50, Math.min(containerHeight - clampedCropY, newCropH))

      const newState: EditorState = {
        ...prevState,
        baseRotate: newBaseRotate,
        imageX: 0,
        imageY: 0,
        cropX: clampedCropX,
        cropY: clampedCropY,
        cropW: clampedCropW,
        cropH: clampedCropH,
      }

      const newInfo: ImageInfo = {
        ...oldInfo,
        displayMultiplier: M,
        containerWidth,
        containerHeight,
      }

      return { newState, newInfo }
    }, true) // is90Rotation = true
  }, [applyTransformAndGenerate])

  /**
   * 翻轉 (基於圖片自身軸)
   * 由於變換順序為 flip → rotate，翻轉永遠是基於圖片自身的軸：
   * - 水平翻轉 (flipX): 圖片以自身垂直中軸做左右鏡像
   * - 垂直翻轉 (flipY): 圖片以自身水平中軸做上下鏡像
   * 不論目前旋轉幾度，翻轉效果都一致。
   */
  const handleFlip = useCallback((axis: 'x' | 'y') => {
    applyTransformAndGenerate((prevState, oldInfo) => {
      // 鏡像裁切框位置：在圖片顯示範圍內做鏡像
      // 化簡公式: newCrop = containerSize + 2*imageOffset - crop - cropSize
      let { cropX, cropY } = prevState
      if (axis === 'x') {
        const displayW = oldInfo.containerWidth * prevState.scale
        const visualLeft = oldInfo.containerWidth / 2 + prevState.imageX - displayW / 2
        cropX = visualLeft + (displayW - (cropX - visualLeft) - prevState.cropW)
      } else {
        const displayH = oldInfo.containerHeight * prevState.scale
        const visualTop = oldInfo.containerHeight / 2 + prevState.imageY - displayH / 2
        cropY = visualTop + (displayH - (cropY - visualTop) - prevState.cropH)
      }

      const newState: EditorState = {
        ...prevState,
        flipX: axis === 'x' ? !prevState.flipX : prevState.flipX,
        flipY: axis === 'y' ? !prevState.flipY : prevState.flipY,
        cropX,
        cropY,
      }
      return { newState, newInfo: oldInfo }
    })
  }, [applyTransformAndGenerate])

  const handleRotateLeft = useCallback(() => handleRotate('left'), [handleRotate])
  const handleRotateRight = useCallback(() => handleRotate('right'), [handleRotate])
  const handleFlipX = useCallback(() => handleFlip('x'), [handleFlip])
  const handleFlipY = useCallback(() => handleFlip('y'), [handleFlip])

  // 當前狀態
  const currentFlipX = pipelineState?.editorState.flipX ?? false
  const currentFlipY = pipelineState?.editorState.flipY ?? false

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">圖片處理工具</h1>

      {!imageSrc ? (
        <div className="flex flex-col items-center gap-4">
          <label
            htmlFor="image-upload"
            className="px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg cursor-pointer transition-colors"
          >
            選擇圖片
          </label>
          <input
            id="image-upload"
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
          />
          <p className="text-sm text-gray-500">支援 JPG, PNG, WebP 等格式</p>
        </div>
      ) : (
        <div className="flex gap-6 items-start">
          {/* 左側工具面板 */}
          <div className="flex flex-col gap-4 w-52">
            {mode === 'preview' && (
              <>
                <CropToolPanel
                  onEnterCropMode={handleEnterCropMode}
                  onEnterOutputMode={handleEnterOutputMode}
                  onRotateLeft={handleRotateLeft}
                  onRotateRight={handleRotateRight}
                  onFlipX={handleFlipX}
                  onFlipY={handleFlipY}
                  flipX={currentFlipX}
                  flipY={currentFlipY}
                  isExporting={isExporting}
                  pipelineState={pipelineState}
                />

                {/* 選擇其他圖片 */}
                <button
                  onClick={handleReset}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg transition-colors"
                >
                  選擇其他圖片
                </button>
              </>
            )}

            {mode === 'crop' && (
              <CropControlPanel
                onConfirm={handleConfirmCrop}
                onCancel={handleCancelCrop}
                isExporting={isExporting}
              />
            )}

            {mode === 'output' && outputSettings && (
              <OutputSettingsPanel
                settings={outputSettings}
                onUpdateSettings={handleUpdateOutputSettings}
                onApply={handleApplyOutput}
                onReturn={handleReturnFromOutput}
                isExporting={isExporting}
              />
            )}
          </div>

          {/* 右側工作區 */}
          <div className="flex flex-col items-center gap-4">
            {(mode === 'preview' || mode === 'output') ? (
              <PreviewWorkspace
                previewUrl={pipelineState?.previewUrl ?? null}
                originalSrc={imageSrc}
                isProcessing={isExporting}
                outputWidth={pipelineState?.outputWidth ?? 400}
                outputHeight={pipelineState?.outputHeight ?? 300}
                isOutputMode={mode === 'output'}
              />
            ) : (
              pipelineState && (
                <ImageEditor
                  src={imageSrc}
                  onStateChange={handleStateChange}
                  initialState={pipelineState.editorState}
                  showControls={true}
                />
              )
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** 裁切工具面板 */
function CropToolPanel({
  onEnterCropMode,
  onEnterOutputMode,
  onRotateLeft,
  onRotateRight,
  onFlipX,
  onFlipY,
  flipX,
  flipY,
  isExporting,
  pipelineState,
}: {
  onEnterCropMode: () => void
  onEnterOutputMode: () => void
  onRotateLeft: () => void
  onRotateRight: () => void
  onFlipX: () => void
  onFlipY: () => void
  flipX: boolean
  flipY: boolean
  isExporting: boolean
  pipelineState: PipelineState | null
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* 裁切按鈕 */}
      <button
        onClick={onEnterCropMode}
        disabled={isExporting || !pipelineState}
        className="px-4 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white rounded-lg transition-colors font-medium"
      >
        進入裁切模式
      </button>

      {/* 輸出圖片按鈕 */}
      <button
        onClick={onEnterOutputMode}
        disabled={isExporting || !pipelineState}
        className="px-4 py-3 bg-green-500 hover:bg-green-600 disabled:bg-gray-300 text-white rounded-lg transition-colors font-medium"
      >
        輸出圖片
      </button>

      {/* 旋轉/翻轉工具 */}
      <div className="p-3 bg-white rounded-lg shadow">
        <p className="text-xs text-gray-500 mb-2 font-medium">旋轉 / 翻轉</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onRotateLeft}
            disabled={isExporting || !pipelineState}
            className="px-2 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 disabled:text-gray-300 rounded transition-colors"
            title="左轉 90°"
          >
            ↺ 左轉
          </button>
          <button
            onClick={onRotateRight}
            disabled={isExporting || !pipelineState}
            className="px-2 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 disabled:text-gray-300 rounded transition-colors"
            title="右轉 90°"
          >
            ↻ 右轉
          </button>
          <button
            onClick={onFlipX}
            disabled={isExporting || !pipelineState}
            className={`px-2 py-1.5 text-sm rounded transition-colors ${
              flipX
                ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                : 'bg-gray-100 hover:bg-gray-200'
            } disabled:bg-gray-50 disabled:text-gray-300`}
            title="水平翻轉"
          >
            ⇆ 水平
          </button>
          <button
            onClick={onFlipY}
            disabled={isExporting || !pipelineState}
            className={`px-2 py-1.5 text-sm rounded transition-colors ${
              flipY
                ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                : 'bg-gray-100 hover:bg-gray-200'
            } disabled:bg-gray-50 disabled:text-gray-300`}
            title="垂直翻轉"
          >
            ⇅ 垂直
          </button>
        </div>
      </div>

      {/* 狀態資訊 */}
      {pipelineState && (
        <div className="text-xs text-gray-500 font-mono space-y-1 p-2 bg-gray-50 rounded">
          <div>
            裁切尺寸: {Math.round(pipelineState.editorState.cropW / pipelineState.imageInfo.displayMultiplier)} × {Math.round(pipelineState.editorState.cropH / pipelineState.imageInfo.displayMultiplier)} px
          </div>
          <div>旋轉: {pipelineState.editorState.baseRotate}°</div>
        </div>
      )}
    </div>
  )
}

/** 可點擊編輯的數字顯示 */
function EditableNumber({
  value,
  min,
  max,
  suffix = '',
  onChange,
}: {
  value: number
  min: number
  max: number
  suffix?: string
  onChange: (value: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [inputValue, setInputValue] = useState(String(value))
  const inputRef = useRef<HTMLInputElement>(null)

  const commit = () => {
    setEditing(false)
    const num = parseInt(inputValue)
    if (!isNaN(num) && num >= min && num <= max) {
      onChange(num)
    } else {
      setInputValue(String(value))
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        min={min}
        max={max}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') {
            setInputValue(String(value))
            setEditing(false)
          }
        }}
        autoFocus
        className="w-14 px-1 py-0 text-xs text-right border border-blue-400 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
    )
  }

  return (
    <span
      onClick={() => {
        setInputValue(String(value))
        setEditing(true)
      }}
      className="text-xs text-gray-600 font-medium cursor-pointer hover:text-blue-600 hover:underline"
      title="點擊輸入數值"
    >
      {value}{suffix}
    </span>
  )
}

/** 輸出設定面板 */
function OutputSettingsPanel({
  settings,
  onUpdateSettings,
  onApply,
  onReturn,
  isExporting,
}: {
  settings: OutputSettings
  onUpdateSettings: (updates: Partial<OutputSettings>) => void
  onApply: () => void
  onReturn: () => void
  isExporting: boolean
}) {
  // 本地輸入狀態 (字串，允許空值)
  const [widthInput, setWidthInput] = useState(String(settings.targetWidth))
  const [heightInput, setHeightInput] = useState(String(settings.targetHeight))
  const [widthError, setWidthError] = useState(false)
  const [heightError, setHeightError] = useState(false)

  const { baseWidth, baseHeight, lockAspectRatio, format } = settings

  // 處理寬度輸入變更
  const handleWidthInputChange = (value: string) => {
    setWidthInput(value)
    setWidthError(false)

    const num = parseInt(value)
    if (!isNaN(num) && num >= 1) {
      if (lockAspectRatio) {
        const aspectRatio = baseHeight / baseWidth
        const newHeight = Math.round(num * aspectRatio)
        setHeightInput(String(Math.max(1, newHeight)))
        onUpdateSettings({
          targetWidth: num,
          targetHeight: Math.max(1, newHeight),
        })
      } else {
        onUpdateSettings({ targetWidth: num })
      }
    }
  }

  // 處理高度輸入變更
  const handleHeightInputChange = (value: string) => {
    setHeightInput(value)
    setHeightError(false)

    const num = parseInt(value)
    if (!isNaN(num) && num >= 1) {
      if (lockAspectRatio) {
        const aspectRatio = baseWidth / baseHeight
        const newWidth = Math.round(num * aspectRatio)
        setWidthInput(String(Math.max(1, newWidth)))
        onUpdateSettings({
          targetWidth: Math.max(1, newWidth),
          targetHeight: num,
        })
      } else {
        onUpdateSettings({ targetHeight: num })
      }
    }
  }

  // 寬度失焦驗證
  const handleWidthBlur = () => {
    const num = parseInt(widthInput)
    if (isNaN(num) || num < 1 || widthInput.trim() === '') {
      setWidthError(true)
      setWidthInput(String(settings.targetWidth))
    }
  }

  // 高度失焦驗證
  const handleHeightBlur = () => {
    const num = parseInt(heightInput)
    if (isNaN(num) || num < 1 || heightInput.trim() === '') {
      setHeightError(true)
      setHeightInput(String(settings.targetHeight))
    }
  }

  // 重設為原始尺寸
  const handleResetSize = () => {
    setWidthInput(String(baseWidth))
    setHeightInput(String(baseHeight))
    setWidthError(false)
    setHeightError(false)
    onUpdateSettings({
      targetWidth: baseWidth,
      targetHeight: baseHeight,
    })
  }

  const isModified = settings.targetWidth !== baseWidth || settings.targetHeight !== baseHeight
  const hasError = widthError || heightError

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-gray-600 font-medium">輸出設定</p>

      {/* 調整尺寸 */}
      <div className="p-3 bg-white rounded-lg shadow">
        <p className="text-xs text-gray-500 mb-3 font-medium">調整尺寸</p>

        {/* 寬度輸入 */}
        <div className="flex items-center gap-2 mb-2">
          <label className="text-sm text-gray-600 w-8 shrink-0">寬</label>
          <input
            type="number"
            min={1}
            value={widthInput}
            onChange={(e) => handleWidthInputChange(e.target.value)}
            onBlur={handleWidthBlur}
            className={`w-20 min-w-0 px-2 py-1 border rounded text-sm focus:outline-none focus:ring-1 ${
              widthError
                ? 'border-red-500 focus:ring-red-500'
                : 'border-gray-300 focus:ring-blue-500'
            }`}
          />
          <span className="text-xs text-gray-400 shrink-0">px</span>
        </div>

        {/* 高度輸入 */}
        <div className="flex items-center gap-2 mb-1">
          <label className="text-sm text-gray-600 w-8 shrink-0">高</label>
          <input
            type="number"
            min={1}
            value={heightInput}
            onChange={(e) => handleHeightInputChange(e.target.value)}
            onBlur={handleHeightBlur}
            className={`w-20 min-w-0 px-2 py-1 border rounded text-sm focus:outline-none focus:ring-1 ${
              heightError
                ? 'border-red-500 focus:ring-red-500'
                : 'border-gray-300 focus:ring-blue-500'
            }`}
          />
          <span className="text-xs text-gray-400 shrink-0">px</span>
        </div>

        {/* 錯誤訊息 */}
        {hasError && (
          <p className="text-xs text-red-500 mb-2">尺寸不得為空或小於 1</p>
        )}

        {/* 鎖定比例開關 */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">鎖定比例</span>
            {lockAspectRatio && (
              <span className="text-xs text-gray-400">({baseWidth} : {baseHeight})</span>
            )}
          </div>
          <button
            onClick={() => onUpdateSettings({ lockAspectRatio: !lockAspectRatio })}
            className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
              lockAspectRatio ? 'bg-blue-500' : 'bg-gray-300'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                lockAspectRatio ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* 重設按鈕 */}
        {isModified && (
          <button
            onClick={handleResetSize}
            className="w-full px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded transition-colors"
          >
            重設為原始尺寸
          </button>
        )}
      </div>

      {/* 匯出格式 */}
      <div className="p-3 bg-white rounded-lg shadow">
        <p className="text-xs text-gray-500 mb-3 font-medium">匯出格式</p>

        <div className="flex gap-2 mb-3">
          {(['png', 'jpeg', 'webp'] as const).map((fmt) => (
            <button
              key={fmt}
              onClick={() => onUpdateSettings({ format: fmt })}
              className={`flex-1 px-2 py-1.5 text-sm rounded transition-colors ${
                format === fmt
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {fmt.toUpperCase()}
            </button>
          ))}
        </div>

        {/* PNG 說明 */}
        {format === 'png' && (
          <p className="text-xs text-gray-400 mb-3">PNG 為無損格式，不支援品質調整</p>
        )}

        {/* 壓縮模式切換 (僅 JPEG/WebP) */}
        {format !== 'png' && (
          <div className="pt-3 border-t border-gray-100">
            {/* 模式選擇按鈕 */}
            <div className="flex gap-1 mb-3 bg-gray-100 rounded p-0.5">
              <button
                onClick={() => onUpdateSettings({ enableTargetKB: false })}
                className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
                  !settings.enableTargetKB
                    ? 'bg-white text-gray-800 shadow-sm font-medium'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                品質控制
              </button>
              <button
                onClick={() => onUpdateSettings({ enableTargetKB: true })}
                className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
                  settings.enableTargetKB
                    ? 'bg-white text-gray-800 shadow-sm font-medium'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                限制檔案大小
              </button>
            </div>

            {/* 品質滑桿 */}
            {!settings.enableTargetKB && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-500">品質</span>
                  <EditableNumber
                    value={settings.quality}
                    min={10}
                    max={100}
                    suffix="%"
                    onChange={(val) => onUpdateSettings({ quality: val })}
                  />
                </div>
                <input
                  type="range"
                  min={10}
                  max={100}
                  step={1}
                  value={settings.quality}
                  onChange={(e) => onUpdateSettings({ quality: parseInt(e.target.value) })}
                  className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
                <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
                  <span>小檔案</span>
                  <span>高品質</span>
                </div>
              </div>
            )}

            {/* 目標 KB 輸入 */}
            {settings.enableTargetKB && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">目標</span>
                <input
                  type="number"
                  min={1}
                  max={10000}
                  value={settings.targetKB ?? ''}
                  onChange={(e) => {
                    const val = parseInt(e.target.value)
                    onUpdateSettings({ targetKB: isNaN(val) ? null : Math.max(1, val) })
                  }}
                  placeholder="KB"
                  className="w-20 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <span className="text-xs text-gray-400">KB</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 狀態資訊 */}
      <div className="text-xs text-gray-500 font-mono space-y-1 p-2 bg-gray-50 rounded">
        <div>原始尺寸: {baseWidth} × {baseHeight} px</div>
        {isModified && (
          <div className="text-blue-600">
            輸出尺寸: {settings.targetWidth} × {settings.targetHeight} px
          </div>
        )}
        {settings.lastExportSize !== null && (
          <div className="text-green-600">
            檔案大小: {(settings.lastExportSize / 1024).toFixed(1)} KB
          </div>
        )}
      </div>

      {/* 操作按鈕 */}
      <div className="flex flex-col gap-2 mt-2">
        <button
          onClick={onApply}
          disabled={isExporting}
          className="px-4 py-2 bg-green-500 hover:bg-green-600 disabled:bg-gray-300 text-white rounded-lg transition-colors font-medium"
        >
          {isExporting ? '處理中...' : '套用並預覽'}
        </button>
        <button
          onClick={onReturn}
          disabled={isExporting}
          className="px-4 py-2 text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg transition-colors"
        >
          返回裁切
        </button>
      </div>
    </div>
  )
}

/** 計算預覽顯示倍率 - 符合 IMAGE_CROPPER_SPEC V7 */
function calculatePreviewMultiplier(width: number): number {
  const MIN_WIDTH = 400
  const MAX_WIDTH = 600

  if (width > MAX_WIDTH) return MAX_WIDTH / width
  if (width < MIN_WIDTH) return MIN_WIDTH / width
  return 1
}

/** 預覽工作區 */
function PreviewWorkspace({
  previewUrl,
  originalSrc,
  isProcessing,
  outputWidth,
  outputHeight,
  isOutputMode = false,
}: {
  previewUrl: string | null
  originalSrc: string
  isProcessing?: boolean
  outputWidth: number
  outputHeight: number
  isOutputMode?: boolean
}) {
  const displayUrl = previewUrl ?? originalSrc
  const hasCropResult = previewUrl !== null

  // 計算顯示倍率 M
  const M = calculatePreviewMultiplier(outputWidth)
  const displayWidth = Math.round(outputWidth * M)
  const displayHeight = Math.round(outputHeight * M)

  // 根據模式決定標題
  const getTitle = () => {
    if (isOutputMode) return '最終結果預覽'
    if (hasCropResult) return '處理結果預覽'
    return '原始圖片'
  }

  return (
    <div className="flex flex-col items-center gap-2 p-4 bg-white rounded-lg shadow min-w-[400px] min-h-[300px] relative">
      {isProcessing && (
        <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10 rounded-lg">
          <p className="text-gray-500">處理中...</p>
        </div>
      )}

      <p className="text-sm text-gray-600 mb-2">
        {getTitle()}
      </p>
      <div
        className="relative"
        style={{
          backgroundImage: `
            linear-gradient(45deg, #e0e0e0 25%, transparent 25%),
            linear-gradient(-45deg, #e0e0e0 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #e0e0e0 75%),
            linear-gradient(-45deg, transparent 75%, #e0e0e0 75%)
          `,
          backgroundSize: '16px 16px',
          backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
          backgroundColor: '#ffffff',
          width: displayWidth,
          height: displayHeight,
        }}
      >
        <img
          src={displayUrl}
          alt={hasCropResult ? 'Processed preview' : 'Original'}
          className="border border-gray-200"
          style={{ width: displayWidth, height: displayHeight }}
        />
      </div>

      {hasCropResult ? (
        <a
          href={previewUrl}
          download="processed-image.png"
          className="mt-2 text-sm text-blue-500 hover:text-blue-700 underline"
        >
          下載圖片
        </a>
      ) : (
        <>
          <span className="mt-2 text-sm text-gray-300 cursor-not-allowed">
            下載圖片
          </span>
          <p className="text-xs text-gray-400">使用左側工具進行編輯</p>
        </>
      )}

      {/* 顯示輸出尺寸與顯示倍率 */}
      {hasCropResult && (
        <p className="text-xs text-gray-500 mt-1">
          輸出尺寸: {outputWidth} × {outputHeight} px
          {M !== 1 && <span className="text-gray-400"> (顯示 {(M * 100).toFixed(0)}%)</span>}
        </p>
      )}
    </div>
  )
}

/** 裁切控制面板 */
function CropControlPanel({
  onConfirm,
  onCancel,
  isExporting,
}: {
  onConfirm: () => void
  onCancel: () => void
  isExporting: boolean
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-gray-600 font-medium">裁切模式</p>
      <p className="text-xs text-gray-400">拖動框框調整裁切範圍，使用滑桿調整縮放與微調旋轉</p>

      <div className="flex flex-col gap-2 mt-4">
        <button
          onClick={onConfirm}
          disabled={isExporting}
          className="px-4 py-2 bg-green-500 hover:bg-green-600 disabled:bg-gray-300 text-white rounded-lg transition-colors font-medium"
        >
          {isExporting ? '處理中...' : '確定'}
        </button>
        <button
          onClick={onCancel}
          disabled={isExporting}
          className="px-4 py-2 text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg transition-colors"
        >
          返回
        </button>
      </div>
    </div>
  )
}

export default App
