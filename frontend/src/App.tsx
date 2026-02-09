import { useState, useCallback, useRef } from 'react'
import { ImageEditor } from './components/ImageEditor'
import { generateCroppedImage, type CropResult } from './utils/generateCroppedImage'
import type { EditorState, ImageInfo } from './hooks/useImageEditor'

type AppMode = 'preview' | 'crop'

/** 持久化的 Pipeline 狀態 */
interface PipelineState {
  editorState: EditorState
  imageInfo: ImageInfo
  previewUrl: string | null
}

/** 計算有效尺寸和容器參數 */
function calculateContainerParams(
  naturalWidth: number,
  naturalHeight: number,
  baseRotate: number
): { effW: number; effH: number; M: number; containerWidth: number; containerHeight: number } {
  const MIN_WIDTH = 400, MAX_WIDTH = 800

  // 根據 baseRotate 計算有效尺寸
  const isRotated90 = baseRotate === 90 || baseRotate === 270
  const effW = isRotated90 ? naturalHeight : naturalWidth
  const effH = isRotated90 ? naturalWidth : naturalHeight

  // 計算 displayMultiplier
  let M: number
  if (effW > MAX_WIDTH) M = MAX_WIDTH / effW
  else if (effW < MIN_WIDTH) M = MIN_WIDTH / effW
  else M = 1

  const containerWidth = Math.round(effW * M)
  const containerHeight = Math.round(effH * M)

  return { effW, effH, M, containerWidth, containerHeight }
}

function App() {
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [mode, setMode] = useState<AppMode>('preview')
  const [isExporting, setIsExporting] = useState(false)

  // 全域 Pipeline 狀態 (單一來源)
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

        // 預載圖片供導出使用
        const img = new Image()
        img.src = src
        img.onload = () => {
          // 初始化 Pipeline 狀態
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

          setPipelineState({
            editorState: initialState,
            imageInfo: initialImageInfo,
            previewUrl: null, // 尚未處理
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
    setMode('crop')
  }, [])

  // 確定裁切：儲存狀態並生成預覽
  const handleConfirmCrop = useCallback(async () => {
    if (!imageRef.current || !currentEditorStateRef.current || isExporting) return

    setIsExporting(true)
    try {
      const { state, imageInfo } = currentEditorStateRef.current
      const result: CropResult = await generateCroppedImage(
        imageRef.current,
        state,
        imageInfo
      )

      // 更新 Pipeline 狀態
      setPipelineState({
        editorState: { ...state },
        imageInfo: { ...imageInfo },
        previewUrl: result.dataUrl,
      })

      console.log('導出尺寸:', result.width, '×', result.height)
      setMode('preview')
    } catch (error) {
      console.error('導出失敗:', error)
    } finally {
      setIsExporting(false)
    }
  }, [isExporting])

  // 返回：捨棄變動
  const handleCancelCrop = useCallback(() => {
    setMode('preview')
  }, [])

  // 選擇其他圖片
  const handleReset = useCallback(() => {
    setImageSrc(null)
    setPipelineState(null)
    setMode('preview')
  }, [])

  // === 旋轉/翻轉：修改現有狀態並重新生成 ===
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

      setPipelineState({
        editorState: newState,
        imageInfo: newInfo,
        previewUrl: result.dataUrl,
      })

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

      // 重新計算容器參數
      const { M, containerWidth, containerHeight } = calculateContainerParams(
        oldInfo.naturalWidth,
        oldInfo.naturalHeight,
        newBaseRotate
      )

      // 計算舊的相對裁切比例
      const oldRelCropX = prevState.cropX / oldInfo.containerWidth
      const oldRelCropY = prevState.cropY / oldInfo.containerHeight
      const oldRelCropW = prevState.cropW / oldInfo.containerWidth
      const oldRelCropH = prevState.cropH / oldInfo.containerHeight

      // 90° 旋轉時座標轉換
      // 右轉: (x, y) -> (1-y-h, x), (w, h) -> (h, w)
      // 左轉: (x, y) -> (y, 1-x-w), (w, h) -> (h, w)
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

      // 轉換回絕對座標
      const newCropX = Math.round(newRelCropX * containerWidth)
      const newCropY = Math.round(newRelCropY * containerHeight)
      const newCropW = Math.round(newRelCropW * containerWidth)
      const newCropH = Math.round(newRelCropH * containerHeight)

      // 邊界檢查
      const clampedCropX = Math.max(0, Math.min(containerWidth - 50, newCropX))
      const clampedCropY = Math.max(0, Math.min(containerHeight - 50, newCropY))
      const clampedCropW = Math.max(50, Math.min(containerWidth - clampedCropX, newCropW))
      const clampedCropH = Math.max(50, Math.min(containerHeight - clampedCropY, newCropH))

      const newState: EditorState = {
        ...prevState,
        baseRotate: newBaseRotate,
        // 90° 旋轉時重置圖片位置，保留 scale 和 rotate
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

  // 翻轉 (不改變容器尺寸，只改變 flipX/flipY)
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

  // 快捷方法
  const handleRotateLeft = useCallback(() => handleRotate('left'), [handleRotate])
  const handleRotateRight = useCallback(() => handleRotate('right'), [handleRotate])
  const handleFlipX = useCallback(() => handleFlip('x'), [handleFlip])
  const handleFlipY = useCallback(() => handleFlip('y'), [handleFlip])

  // 當前狀態
  const currentBaseRotate = pipelineState?.editorState.baseRotate ?? 0
  const currentFlipX = pipelineState?.editorState.flipX ?? false
  const currentFlipY = pipelineState?.editorState.flipY ?? false

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">圖片裁切工具</h1>

      {!imageSrc ? (
        // === 未選擇圖片 ===
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
        // === 已選擇圖片：雙模式 UI ===
        <div className="flex gap-6 items-start">
          {/* 左側工具面板 */}
          <div className="flex flex-col gap-4 w-48">
            {mode === 'preview' ? (
              // --- 預覽模式工具面板 ---
              <>
                {/* 裁切工具 */}
                <button
                  onClick={handleEnterCropMode}
                  disabled={isExporting || !pipelineState}
                  className="px-4 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white rounded-lg transition-colors font-medium"
                >
                  裁切
                </button>

                {/* 旋轉/翻轉工具 */}
                <div className="p-3 bg-white rounded-lg shadow">
                  <p className="text-xs text-gray-500 mb-2 font-medium">旋轉 / 翻轉</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={handleRotateLeft}
                      disabled={isExporting || !pipelineState}
                      className="px-2 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 disabled:text-gray-300 rounded transition-colors"
                      title="左轉 90°"
                    >
                      ↺ 左轉
                    </button>
                    <button
                      onClick={handleRotateRight}
                      disabled={isExporting || !pipelineState}
                      className="px-2 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 disabled:text-gray-300 rounded transition-colors"
                      title="右轉 90°"
                    >
                      ↻ 右轉
                    </button>
                    <button
                      onClick={handleFlipX}
                      disabled={isExporting || !pipelineState}
                      className={`px-2 py-1.5 text-sm rounded transition-colors ${
                        currentFlipX
                          ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                          : 'bg-gray-100 hover:bg-gray-200'
                      } disabled:bg-gray-50 disabled:text-gray-300`}
                      title="水平翻轉"
                    >
                      ⇆ 水平
                    </button>
                    <button
                      onClick={handleFlipY}
                      disabled={isExporting || !pipelineState}
                      className={`px-2 py-1.5 text-sm rounded transition-colors ${
                        currentFlipY
                          ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                          : 'bg-gray-100 hover:bg-gray-200'
                      } disabled:bg-gray-50 disabled:text-gray-300`}
                      title="垂直翻轉"
                    >
                      ⇅ 垂直
                    </button>
                  </div>
                </div>

                {/* 選擇其他圖片 */}
                <button
                  onClick={handleReset}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg transition-colors"
                >
                  選擇其他圖片
                </button>

                {/* 狀態資訊 */}
                {pipelineState && (
                  <div className="text-xs text-gray-500 font-mono mt-2 space-y-1">
                    <div>
                      尺寸: {Math.round(pipelineState.editorState.cropW / pipelineState.imageInfo.displayMultiplier)} × {Math.round(pipelineState.editorState.cropH / pipelineState.imageInfo.displayMultiplier)}
                    </div>
                    <div>旋轉: {currentBaseRotate}°</div>
                    <div>M: {pipelineState.imageInfo.displayMultiplier.toFixed(2)}</div>
                  </div>
                )}
              </>
            ) : (
              // --- 裁切模式工具面板 ---
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
              // --- 預覽模式：顯示裁切結果 ---
              <PreviewWorkspace
                previewUrl={pipelineState?.previewUrl ?? null}
                originalSrc={imageSrc}
                isProcessing={isExporting}
              />
            ) : (
              // --- 裁切模式：V7 互動容器 ---
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

/** 預覽工作區 */
function PreviewWorkspace({
  previewUrl,
  originalSrc,
  isProcessing,
}: {
  previewUrl: string | null
  originalSrc: string
  isProcessing?: boolean
}) {
  const displayUrl = previewUrl ?? originalSrc
  const hasCropResult = previewUrl !== null

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
        }}
      >
        <img
          src={displayUrl}
          alt={hasCropResult ? 'Processed preview' : 'Original'}
          className="max-w-full border border-gray-200"
          style={{ maxHeight: 400, maxWidth: 600 }}
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
