import { useState, useCallback, useRef, useEffect } from 'react'
import { ImageEditor } from './components/ImageEditor'
import { generateCroppedImage, type CropResult } from './utils/generateCroppedImage'
import type { EditorState, ImageInfo } from './hooks/useImageEditor'

type AppMode = 'preview' | 'crop'
type ToolTab = 'crop' | 'resize'

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

function App() {
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [mode, setMode] = useState<AppMode>('preview')
  const [activeTab, setActiveTab] = useState<ToolTab>('crop')
  const [isExporting, setIsExporting] = useState(false)

  // 全域 Pipeline 狀態
  const [pipelineState, setPipelineState] = useState<PipelineState | null>(null)

  // 當前編輯中的狀態 (裁切模式用)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const currentEditorStateRef = useRef<{ state: EditorState; imageInfo: ImageInfo } | null>(null)

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
        setActiveTab('crop')

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

  // 接收編輯器狀態更新
  const handleStateChange = useCallback((state: EditorState, imageInfo: ImageInfo | null) => {
    if (imageInfo) {
      currentEditorStateRef.current = { state, imageInfo }
    }
  }, [])

  // 進入裁切模式
  const handleEnterCropMode = useCallback(() => {
    // 如果有鎖定比例，調整初始裁切框以符合比例
    if (pipelineState?.resize.lockAspectRatio) {
      const { editorState, imageInfo, resize } = pipelineState
      const targetAspectRatio = resize.targetWidth / resize.targetHeight
      const currentAspectRatio = editorState.cropW / editorState.cropH

      // 如果比例不符，調整裁切框
      if (Math.abs(targetAspectRatio - currentAspectRatio) > 0.001) {
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

      // 檢查是否需要縮放 (使用之前的 resize 設定，但尺寸需要更新為新的裁切基準)
      const prevResize = pipelineState?.resize
      const resizeOptions = prevResize?.active
        ? { targetWidth: prevResize.targetWidth, targetHeight: prevResize.targetHeight }
        : {}

      const result: CropResult = await generateCroppedImage(
        imageRef.current,
        state,
        imageInfo,
        resizeOptions
      )

      // 判斷使用者是否有自訂 resize 目標 (與之前的 croppedSize 不同)
      const hadCustomResize = prevResize && (
        prevResize.targetWidth !== prevResize.croppedWidth ||
        prevResize.targetHeight !== prevResize.croppedHeight
      )

      setPipelineState({
        editorState: { ...state },
        imageInfo: { ...imageInfo },
        previewUrl: result.dataUrl,
        resize: {
          // 如果使用者有自訂 resize，保留其設定；否則使用新的裁切尺寸
          active: hadCustomResize ? prevResize.active : false,
          targetWidth: hadCustomResize ? prevResize.targetWidth : croppedSize.width,
          targetHeight: hadCustomResize ? prevResize.targetHeight : croppedSize.height,
          lockAspectRatio: prevResize?.lockAspectRatio ?? true,
          // 永遠更新基準尺寸為新的裁切尺寸
          croppedWidth: croppedSize.width,
          croppedHeight: croppedSize.height,
        },
        outputWidth: result.width,
        outputHeight: result.height,
      })

      console.log('導出尺寸:', result.width, '×', result.height)
      setMode('preview')
    } catch (error) {
      console.error('導出失敗:', error)
    } finally {
      setIsExporting(false)
    }
  }, [isExporting, pipelineState?.resize])

  // 返回
  const handleCancelCrop = useCallback(() => {
    setMode('preview')
  }, [])

  // 選擇其他圖片
  const handleReset = useCallback(() => {
    setImageSrc(null)
    setPipelineState(null)
    setMode('preview')
    setActiveTab('crop')
  }, [])

  // === 旋轉/翻轉 ===
  const applyTransformAndGenerate = useCallback(async (
    transformFn: (prev: EditorState, oldInfo: ImageInfo) => {
      newState: EditorState;
      newInfo: ImageInfo
    }
  ) => {
    if (!imageRef.current || !pipelineState || isExporting) return

    setIsExporting(true)

    try {
      const { newState, newInfo } = transformFn(pipelineState.editorState, pipelineState.imageInfo)
      const result = await generateCroppedImage(imageRef.current, newState, newInfo)

      // 更新 resize 基準值
      const croppedSize = getCroppedOriginalSize(newState, newInfo)

      // 判斷使用者是否有自訂 resize 目標
      const prevResize = pipelineState.resize
      const hadCustomResize = prevResize && (
        prevResize.targetWidth !== prevResize.croppedWidth ||
        prevResize.targetHeight !== prevResize.croppedHeight
      )

      setPipelineState(prev => ({
        editorState: newState,
        imageInfo: newInfo,
        previewUrl: result.dataUrl,
        resize: {
          ...prev!.resize,
          // 如果使用者有自訂 resize，保留其設定；否則使用新的裁切尺寸
          targetWidth: hadCustomResize ? prevResize.targetWidth : croppedSize.width,
          targetHeight: hadCustomResize ? prevResize.targetHeight : croppedSize.height,
          // 永遠更新基準尺寸
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
    })
  }, [applyTransformAndGenerate])

  // 翻轉
  const handleFlip = useCallback((axis: 'x' | 'y') => {
    applyTransformAndGenerate((prevState, oldInfo) => {
      const newState: EditorState = {
        ...prevState,
        flipX: axis === 'x' ? !prevState.flipX : prevState.flipX,
        flipY: axis === 'y' ? !prevState.flipY : prevState.flipY,
      }
      return { newState, newInfo: oldInfo }
    })
  }, [applyTransformAndGenerate])

  const handleRotateLeft = useCallback(() => handleRotate('left'), [handleRotate])
  const handleRotateRight = useCallback(() => handleRotate('right'), [handleRotate])
  const handleFlipX = useCallback(() => handleFlip('x'), [handleFlip])
  const handleFlipY = useCallback(() => handleFlip('y'), [handleFlip])

  // === Resize 狀態更新 ===
  const updateResizeState = useCallback((updates: Partial<ResizeState>) => {
    setPipelineState(prev => {
      if (!prev) return prev
      return {
        ...prev,
        resize: {
          ...prev.resize,
          ...updates,
        },
      }
    })
  }, [])

  // === 套用 Resize ===
  const applyResize = useCallback(async () => {
    if (!imageRef.current || !pipelineState || isExporting) return

    const { resize, editorState, imageInfo } = pipelineState
    if (!resize.active) return

    setIsExporting(true)
    try {
      const result = await generateCroppedImage(
        imageRef.current,
        editorState,
        imageInfo,
        {
          targetWidth: resize.targetWidth,
          targetHeight: resize.targetHeight,
        }
      )

      setPipelineState(prev => ({
        ...prev!,
        previewUrl: result.dataUrl,
        outputWidth: result.width,
        outputHeight: result.height,
      }))

      console.log('縮放後尺寸:', result.width, '×', result.height)
    } catch (error) {
      console.error('縮放失敗:', error)
    } finally {
      setIsExporting(false)
    }
  }, [isExporting, pipelineState])

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
            {mode === 'preview' ? (
              <>
                {/* 分頁標籤 */}
                <div className="flex border-b border-gray-200">
                  <button
                    onClick={() => setActiveTab('crop')}
                    className={`flex-1 py-2 text-sm font-medium transition-colors ${
                      activeTab === 'crop'
                        ? 'text-blue-600 border-b-2 border-blue-600'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    裁切
                  </button>
                  <button
                    onClick={() => setActiveTab('resize')}
                    className={`flex-1 py-2 text-sm font-medium transition-colors ${
                      activeTab === 'resize'
                        ? 'text-blue-600 border-b-2 border-blue-600'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    調整尺寸
                  </button>
                </div>

                {/* 分頁內容 */}
                {activeTab === 'crop' ? (
                  <CropToolPanel
                    onEnterCropMode={handleEnterCropMode}
                    onRotateLeft={handleRotateLeft}
                    onRotateRight={handleRotateRight}
                    onFlipX={handleFlipX}
                    onFlipY={handleFlipY}
                    flipX={currentFlipX}
                    flipY={currentFlipY}
                    isExporting={isExporting}
                    pipelineState={pipelineState}
                  />
                ) : (
                  <ResizeToolPanel
                    pipelineState={pipelineState}
                    onUpdateResize={updateResizeState}
                    onApplyResize={applyResize}
                    isExporting={isExporting}
                  />
                )}

                {/* 選擇其他圖片 */}
                <button
                  onClick={handleReset}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg transition-colors"
                >
                  選擇其他圖片
                </button>
              </>
            ) : (
              <CropControlPanel
                onConfirm={handleConfirmCrop}
                onCancel={handleCancelCrop}
                isExporting={isExporting}
              />
            )}
          </div>

          {/* 右側工作區 */}
          <div className="flex flex-col items-center gap-4">
            {mode === 'preview' ? (
              <PreviewWorkspace
                previewUrl={pipelineState?.previewUrl ?? null}
                originalSrc={imageSrc}
                isProcessing={isExporting}
                outputWidth={pipelineState?.outputWidth ?? 400}
                outputHeight={pipelineState?.outputHeight ?? 300}
              />
            ) : (
              pipelineState && (
                <ImageEditor
                  src={imageSrc}
                  onStateChange={handleStateChange}
                  initialState={pipelineState.editorState}
                  showControls={true}
                  lockedAspectRatio={
                    pipelineState.resize.lockAspectRatio
                      ? pipelineState.resize.targetWidth / pipelineState.resize.targetHeight
                      : undefined
                  }
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

/** 調整尺寸工具面板 */
function ResizeToolPanel({
  pipelineState,
  onUpdateResize,
  onApplyResize,
  isExporting,
}: {
  pipelineState: PipelineState | null
  onUpdateResize: (updates: Partial<ResizeState>) => void
  onApplyResize: () => void
  isExporting: boolean
}) {
  // 本地輸入狀態 (字串，允許空值)
  const [widthInput, setWidthInput] = useState('')
  const [heightInput, setHeightInput] = useState('')
  const [widthError, setWidthError] = useState(false)
  const [heightError, setHeightError] = useState(false)

  // 追蹤是否正在輸入 (避免外部同步覆蓋使用者輸入)
  const isTypingRef = useRef(false)

  // 同步外部狀態到本地輸入
  const targetWidth = pipelineState?.resize.targetWidth
  const targetHeight = pipelineState?.resize.targetHeight

  useEffect(() => {
    if (!isTypingRef.current && targetWidth !== undefined) {
      setWidthInput(String(targetWidth))
      setWidthError(false)
    }
  }, [targetWidth])

  useEffect(() => {
    if (!isTypingRef.current && targetHeight !== undefined) {
      setHeightInput(String(targetHeight))
      setHeightError(false)
    }
  }, [targetHeight])

  if (!pipelineState) {
    return <p className="text-sm text-gray-400">請先載入圖片</p>
  }

  const { resize } = pipelineState
  // 使用 resize 中儲存的基準尺寸，而非即時計算
  const croppedSize = { width: resize.croppedWidth, height: resize.croppedHeight }

  // 處理寬度輸入變更 (允許空值)
  const handleWidthInputChange = (value: string) => {
    isTypingRef.current = true
    setWidthInput(value)
    setWidthError(false) // 輸入時清除錯誤

    const num = parseInt(value)
    if (!isNaN(num) && num >= 1) {
      if (resize.lockAspectRatio) {
        const aspectRatio = croppedSize.height / croppedSize.width
        const newHeight = Math.round(num * aspectRatio)
        setHeightInput(String(Math.max(1, newHeight)))
        onUpdateResize({
          targetWidth: num,
          targetHeight: Math.max(1, newHeight),
          active: true,
        })
      } else {
        onUpdateResize({ targetWidth: num, active: true })
      }
    }
  }

  // 處理高度輸入變更 (允許空值)
  const handleHeightInputChange = (value: string) => {
    isTypingRef.current = true
    setHeightInput(value)
    setHeightError(false) // 輸入時清除錯誤

    const num = parseInt(value)
    if (!isNaN(num) && num >= 1) {
      if (resize.lockAspectRatio) {
        const aspectRatio = croppedSize.width / croppedSize.height
        const newWidth = Math.round(num * aspectRatio)
        setWidthInput(String(Math.max(1, newWidth)))
        onUpdateResize({
          targetWidth: Math.max(1, newWidth),
          targetHeight: num,
          active: true,
        })
      } else {
        onUpdateResize({ targetHeight: num, active: true })
      }
    }
  }

  // 寬度失焦驗證
  const handleWidthBlur = () => {
    isTypingRef.current = false
    const num = parseInt(widthInput)
    if (isNaN(num) || num < 1 || widthInput.trim() === '') {
      setWidthError(true)
      // 恢復為有效值
      setWidthInput(String(resize.targetWidth))
    }
  }

  // 高度失焦驗證
  const handleHeightBlur = () => {
    isTypingRef.current = false
    const num = parseInt(heightInput)
    if (isNaN(num) || num < 1 || heightInput.trim() === '') {
      setHeightError(true)
      // 恢復為有效值
      setHeightInput(String(resize.targetHeight))
    }
  }

  // 重設為原始裁切尺寸
  const handleResetSize = () => {
    isTypingRef.current = false
    setWidthInput(String(croppedSize.width))
    setHeightInput(String(croppedSize.height))
    setWidthError(false)
    setHeightError(false)
    onUpdateResize({
      targetWidth: croppedSize.width,
      targetHeight: croppedSize.height,
      active: false,
    })
  }

  // 切換比例鎖定
  const handleToggleLock = () => {
    onUpdateResize({ lockAspectRatio: !resize.lockAspectRatio })
  }

  const isModified = resize.targetWidth !== croppedSize.width || resize.targetHeight !== croppedSize.height
  const hasError = widthError || heightError

  return (
    <div className="flex flex-col gap-3">
      <div className="p-3 bg-white rounded-lg shadow">
        <p className="text-xs text-gray-500 mb-3 font-medium">目標尺寸</p>

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
          <span className="text-sm text-gray-600">鎖定比例</span>
          <button
            onClick={handleToggleLock}
            className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
              resize.lockAspectRatio ? 'bg-blue-500' : 'bg-gray-300'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                resize.lockAspectRatio ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* 套用按鈕 */}
        <button
          onClick={onApplyResize}
          disabled={!isModified || isExporting}
          className="w-full px-3 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white rounded transition-colors font-medium disabled:cursor-not-allowed"
        >
          {isExporting ? '處理中...' : '套用尺寸'}
        </button>

        {/* 重設按鈕 */}
        <button
          onClick={handleResetSize}
          disabled={!isModified || isExporting}
          className="w-full px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          重設為原始尺寸
        </button>
      </div>

      {/* 狀態資訊 */}
      <div className="text-xs text-gray-500 font-mono space-y-1 p-2 bg-gray-50 rounded">
        <div>原始尺寸: {croppedSize.width} × {croppedSize.height} px</div>
        {isModified && (
          <div className="text-blue-600">
            縮放至: {resize.targetWidth} × {resize.targetHeight} px
          </div>
        )}
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
}: {
  previewUrl: string | null
  originalSrc: string
  isProcessing?: boolean
  outputWidth: number
  outputHeight: number
}) {
  const displayUrl = previewUrl ?? originalSrc
  const hasCropResult = previewUrl !== null

  // 計算顯示倍率 M
  const M = calculatePreviewMultiplier(outputWidth)
  const displayWidth = Math.round(outputWidth * M)
  const displayHeight = Math.round(outputHeight * M)

  return (
    <div className="flex flex-col items-center gap-2 p-4 bg-white rounded-lg shadow min-w-[400px] min-h-[300px] relative">
      {isProcessing && (
        <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10 rounded-lg">
          <p className="text-gray-500">處理中...</p>
        </div>
      )}

      <p className="text-sm text-gray-600 mb-2">
        {hasCropResult ? '處理結果預覽' : '原始圖片'}
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
