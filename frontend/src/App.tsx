import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import type { AppStep, PipelineState, ImageItem, VideoItem } from "./types";
import { UploadPage } from "./pages/UploadPage";
import { EditorPage } from "./pages/EditorPage";
import { ExportPage } from "./pages/ExportPage";
import { VideoEditorPage } from "./pages/VideoEditorPage";
import { VideoExportPage } from "./pages/VideoExportPage";
import type { ClipExportConfig } from "./pages/VideoEditorPage";

/** 應用模式：上傳頁 / 圖片流程 / 影片流程 */
type AppMode = "upload" | "pic" | "vic";

/** 影片匯出狀態 */
export interface VideoExportState {
  clipConfig: ClipExportConfig | null;
  rotate: number;
  flipH: boolean;
  flipV: boolean;
}

function App() {
  const [mode, setMode] = useState<AppMode>("upload");
  const [currentStep, setCurrentStep] = useState<AppStep>("upload");

  // ── 圖片狀態 (pic 模式) ──
  const [images, setImages] = useState<ImageItem[]>([]);
  const [activeImageId, setActiveImageId] = useState<string>("");
  const activeImageIdRef = useRef("");
  activeImageIdRef.current = activeImageId;

  // ── 影片狀態 (vic 模式) ──
  const [video, setVideo] = useState<VideoItem | null>(null);
  const [vicStep, setVicStep] = useState<"edit" | "export">("edit");
  const [videoExportState, setVideoExportState] = useState<VideoExportState | null>(null);

  // ── 衍生資料 ──
  const activeImage = useMemo(
    () => images.find((i) => i.id === activeImageId) ?? null,
    [images, activeImageId],
  );

  // ── 橋接 imageRef ──
  const imageRef = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    imageRef.current = activeImage?.imgElement ?? null;
  }, [activeImage]);

  // ── 橋接 setPipelineState ──
  const setPipelineState: React.Dispatch<
    React.SetStateAction<PipelineState | null>
  > = useCallback((action) => {
    setImages((prev) =>
      prev.map((img) => {
        if (img.id !== activeImageIdRef.current) return img;
        const newPipeline =
          typeof action === "function"
            ? action(img.pipelineState)
            : action;
        return newPipeline ? { ...img, pipelineState: newPipeline } : img;
      }),
    );
  }, []);

  // ── 回調：圖片模式 ──

  const handleImagesLoaded = useCallback((newImages: ImageItem[]) => {
    setImages(newImages);
    setActiveImageId(newImages[0].id);
    setMode("pic");
    setCurrentStep("edit");
  }, []);

  const handleUpdateImage = useCallback(
    (id: string, updates: Partial<ImageItem>) => {
      setImages((prev) =>
        prev.map((img) => (img.id === id ? { ...img, ...updates } : img)),
      );
    },
    [],
  );

  const handleAppendImages = useCallback((newImages: ImageItem[]) => {
    if (newImages.length === 0) return;
    setImages((prev) => [...prev, ...newImages]);
    setActiveImageId(newImages[0].id);
  }, []);

  const handleSelectImage = useCallback((id: string) => {
    setActiveImageId(id);
  }, []);

  const handleExport = useCallback(() => {
    setCurrentStep("export");
  }, []);

  const handleReturnToEdit = useCallback(() => {
    setCurrentStep("edit");
  }, []);

  // ── 回調：影片模式 ──

  const handleVideoLoaded = useCallback((v: VideoItem) => {
    setVideo(v);
    setMode("vic");
    setVicStep("edit");
  }, []);

  const handleVideoExport = useCallback((state: VideoExportState) => {
    setVideoExportState(state);
    setVicStep("export");
  }, []);

  const handleVideoReturnToEdit = useCallback(() => {
    setVicStep("edit");
  }, []);

  // ── 回調：返回首頁 (清除所有狀態) ──

  const handleReset = useCallback(() => {
    setImages([]);
    setActiveImageId("");
    setVideo(null);
    setVideoExportState(null);
    setVicStep("edit");
    setMode("upload");
    setCurrentStep("upload");
  }, []);

  // ── 路由渲染 ──

  // 上傳頁面 (首頁)
  if (mode === "upload") {
    return (
      <UploadPage
        onImagesLoaded={handleImagesLoaded}
        onVideoLoaded={handleVideoLoaded}
      />
    );
  }

  // 影片模式
  if (mode === "vic") {
    if (!video) return null;
    if (vicStep === "export" && videoExportState) {
      return (
        <VideoExportPage
          video={video}
          exportState={videoExportState}
          onReturn={handleVideoReturnToEdit}
          onReset={handleReset}
        />
      );
    }
    return (
      <VideoEditorPage
        video={video}
        onExport={handleVideoExport}
        onReset={handleReset}
      />
    );
  }

  // 圖片編輯模式
  if (currentStep === "edit") {
    if (!activeImage) return null;
    return (
      <EditorPage
        images={images}
        activeImageId={activeImageId}
        onSelectImage={handleSelectImage}
        onUpdateImage={handleUpdateImage}
        onAppendImages={handleAppendImages}
        imageRef={imageRef}
        setPipelineState={setPipelineState}
        onExport={handleExport}
        onReset={handleReset}
      />
    );
  }

  if (currentStep === "export") {
    if (!activeImage) return null;
    return (
      <ExportPage
        images={images}
        activeImageId={activeImageId}
        onSelectImage={handleSelectImage}
        setImages={setImages}
        onReturn={handleReturnToEdit}
      />
    );
  }

  return null;
}

export default App;
