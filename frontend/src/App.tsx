import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import type { AppStep, PipelineState, ImageItem } from "./types";
import { UploadPage } from "./pages/UploadPage";
import { EditorPage } from "./pages/EditorPage";
import { ExportPage } from "./pages/ExportPage";

function App() {
  const [currentStep, setCurrentStep] = useState<AppStep>("upload");

  // ── 多圖狀態 ──
  const [images, setImages] = useState<ImageItem[]>([]);
  const [activeImageId, setActiveImageId] = useState<string>("");
  const activeImageIdRef = useRef("");
  activeImageIdRef.current = activeImageId;

  // ── 衍生資料 ──
  const activeImage = useMemo(
    () => images.find((i) => i.id === activeImageId) ?? null,
    [images, activeImageId],
  );

  // ── 橋接 imageRef：始終指向當前活動圖片的 HTMLImageElement ──
  const imageRef = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    imageRef.current = activeImage?.imgElement ?? null;
  }, [activeImage]);

  // ── 橋接 setPipelineState：防禦性更新，定位到 activeImageId ──
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

  // ── 回調 ──

  // UploadPage: 多圖載入完成
  const handleImagesLoaded = useCallback((newImages: ImageItem[]) => {
    setImages(newImages);
    setActiveImageId(newImages[0].id);
    setCurrentStep("edit");
  }, []);

  // 通用圖片更新 (visualBaseRotate 等)
  const handleUpdateImage = useCallback(
    (id: string, updates: Partial<ImageItem>) => {
      setImages((prev) =>
        prev.map((img) => (img.id === id ? { ...img, ...updates } : img)),
      );
    },
    [],
  );

  // 追加圖片 (EditorPage 使用)
  const handleAppendImages = useCallback((newImages: ImageItem[]) => {
    if (newImages.length === 0) return;
    setImages((prev) => [...prev, ...newImages]);
    setActiveImageId(newImages[0].id);
  }, []);

  // 選擇圖片
  const handleSelectImage = useCallback((id: string) => {
    setActiveImageId(id);
  }, []);

  const handleExport = useCallback(() => {
    setCurrentStep("export");
  }, []);

  const handleReturnToEdit = useCallback(() => {
    setCurrentStep("edit");
  }, []);

  const handleReset = useCallback(() => {
    setImages([]);
    setActiveImageId("");
    setCurrentStep("upload");
  }, []);

  switch (currentStep) {
    case "upload":
      return <UploadPage onImagesLoaded={handleImagesLoaded} />;

    case "edit":
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

    case "export":
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
}

export default App;
