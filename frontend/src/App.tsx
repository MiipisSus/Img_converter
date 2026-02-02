import { useState, useCallback, useRef } from 'react'
import { ImageEditor } from './components/ImageEditor'
import { generateCroppedImage, type CropResult } from './utils/generateCroppedImage'
import type { EditorState, ImageInfo } from './hooks/useImageEditor'

type AppMode = 'preview' | 'crop'

/** 持久化的裁切狀態 */
interface SavedCropState {
  editorState: EditorState
  imageInfo: ImageInfo
  previewUrl: string
}

function App() {
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [mode, setMode] = useState<AppMode>('preview')
  const [isExporting, setIsExporting] = useState(false)

  // 持久化的裁切結果
  const [savedCropState, setSavedCropState] = useState<SavedCropState | null>(null)

  // 當前編輯中的狀態 (用於恢復)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const currentEditorStateRef = useRef<{ state: EditorState; imageInfo: ImageInfo } | null>(null)

  // 初始狀態 (用於恢復機制)
  const initialStateRef = useRef<EditorState | null>(null)

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      const reader = new FileReader()
      reader.onload = (event) => {
        const src = event.target?.result as string
        setImageSrc(src)
        setSavedCropState(null)
        setMode('preview') // 新圖片先進入預覽模式

        // 預載圖片供導出使用
        const img = new Image()
        img.src = src
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

      // 記錄初始狀態 (僅第一次)
      if (!initialStateRef.current) {
        initialStateRef.current = { ...state }
      }
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

      // 儲存裁切狀態
      setSavedCropState({
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
    // 回到預覽模式，不儲存變動
    setMode('preview')
  }, [])

  // 選擇其他圖片
  const handleReset = useCallback(() => {
    setImageSrc(null)
    setSavedCropState(null)
    setMode('preview')
    initialStateRef.current = null
  }, [])

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
              // --- 預覽模式：裁切按鈕 ---
              <>
                <button
                  onClick={handleEnterCropMode}
                  className="px-4 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors font-medium"
                >
                  裁切
                </button>
                <button
                  onClick={handleReset}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg transition-colors"
                >
                  選擇其他圖片
                </button>

                {/* 預覽模式的資訊 */}
                {savedCropState && (
                  <div className="text-xs text-gray-500 font-mono mt-4 space-y-1">
                    <div>尺寸: {Math.round(savedCropState.editorState.cropW / savedCropState.imageInfo.displayMultiplier)} × {Math.round(savedCropState.editorState.cropH / savedCropState.imageInfo.displayMultiplier)}</div>
                    <div>旋轉: {savedCropState.editorState.rotate}°</div>
                    <div>縮放: {(savedCropState.editorState.scale * 100).toFixed(0)}%</div>
                  </div>
                )}
              </>
            ) : (
              // --- 裁切模式：滑桿與按鈕 ---
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
                previewUrl={savedCropState?.previewUrl ?? null}
                originalSrc={imageSrc}
              />
            ) : (
              // --- 裁切模式：V6 互動容器 ---
              <ImageEditor
                src={imageSrc}
                onStateChange={handleStateChange}
                initialState={savedCropState?.editorState}
                showControls={true}
              />
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
}: {
  previewUrl: string | null
  originalSrc: string
}) {
  // 顯示的圖片：有裁切結果時顯示裁切結果，否則顯示原圖
  const displayUrl = previewUrl ?? originalSrc
  const hasCropResult = previewUrl !== null

  return (
    <div className="flex flex-col items-center gap-2 p-4 bg-white rounded-lg shadow min-w-[400px] min-h-[300px]">
      <p className="text-sm text-gray-600 mb-2">
        {hasCropResult ? '裁切結果預覽' : '原始圖片'}
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
          alt={hasCropResult ? 'Cropped preview' : 'Original'}
          className="max-w-full border border-gray-200"
          style={{ maxHeight: 400, maxWidth: 600 }}
        />
      </div>

      {hasCropResult ? (
        <a
          href={previewUrl}
          download="cropped-image.png"
          className="mt-2 text-sm text-blue-500 hover:text-blue-700 underline"
        >
          下載圖片
        </a>
      ) : (
        <>
          <span className="mt-2 text-sm text-gray-300 cursor-not-allowed">
            下載圖片
          </span>
          <p className="text-xs text-gray-400">點擊左側「裁切」按鈕開始編輯</p>
        </>
      )}
    </div>
  )
}

/** 裁切控制面板 (滑桿在 ImageEditor 內部，這裡只有按鈕) */
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
      <p className="text-xs text-gray-400">拖動框框調整裁切範圍，使用下方滑桿調整縮放與旋轉</p>

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
