import { useState, useCallback, useRef } from 'react'
import { ImageEditor } from './components/ImageEditor'
import { generateCroppedImage, type CropResult } from './utils/generateCroppedImage'
import type { EditorState, ImageInfo } from './hooks/useImageEditor'

function App() {
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)

  const imageRef = useRef<HTMLImageElement | null>(null)
  const editorStateRef = useRef<{ state: EditorState; imageInfo: ImageInfo } | null>(null)

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      const reader = new FileReader()
      reader.onload = (event) => {
        const src = event.target?.result as string
        setImageSrc(src)
        setPreviewUrl(null)

        // 預載圖片供導出使用
        const img = new Image()
        img.src = src
        imageRef.current = img
      }
      reader.readAsDataURL(file)
    },
    []
  )

  const handleStateChange = useCallback((state: EditorState, imageInfo: ImageInfo | null) => {
    if (imageInfo) {
      editorStateRef.current = { state, imageInfo }
    }
  }, [])

  const handleExport = useCallback(async () => {
    if (!imageRef.current || !editorStateRef.current || isExporting) return

    setIsExporting(true)
    try {
      const { state, imageInfo } = editorStateRef.current
      const result: CropResult = await generateCroppedImage(
        imageRef.current,
        state,
        imageInfo
      )
      setPreviewUrl(result.dataUrl)
      console.log('導出尺寸:', result.width, '×', result.height)
    } catch (error) {
      console.error('導出失敗:', error)
    } finally {
      setIsExporting(false)
    }
  }, [isExporting])

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">圖片裁切工具</h1>

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
        <div className="flex flex-col items-center gap-4">
          <ImageEditor
            src={imageSrc}
            maxWidth={800}
            maxHeight={600}
            onStateChange={handleStateChange}
          />

          <div className="flex gap-2">
            <button
              onClick={handleExport}
              disabled={isExporting}
              className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white rounded transition-colors"
            >
              {isExporting ? '處理中...' : '完成裁切'}
            </button>
            <button
              onClick={() => {
                setImageSrc(null)
                setPreviewUrl(null)
              }}
              className="px-4 py-2 text-gray-600 hover:text-gray-800 border border-gray-300 rounded transition-colors"
            >
              選擇其他圖片
            </button>
          </div>

          {/* 導出預覽 */}
          {previewUrl && (
            <div className="flex flex-col items-center gap-2 p-4 bg-white rounded shadow">
              <p className="text-sm text-gray-600">導出結果:</p>
              <img
                src={previewUrl}
                alt="Cropped preview"
                className="max-w-full border border-gray-200"
                style={{ maxHeight: 300 }}
              />
              <a
                href={previewUrl}
                download="cropped-image.png"
                className="text-sm text-blue-500 hover:text-blue-700 underline"
              >
                下載圖片
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default App
