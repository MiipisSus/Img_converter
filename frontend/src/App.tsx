import { useState, useCallback, useRef } from "react";
import type { AppStep, PipelineState } from "./types";
import { UploadPage } from "./pages/UploadPage";
import { EditorPage } from "./pages/EditorPage";
import { ExportPage } from "./pages/ExportPage";

function App() {
  const [currentStep, setCurrentStep] = useState<AppStep>("upload");
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [pipelineState, setPipelineState] = useState<PipelineState | null>(
    null,
  );
  const imageRef = useRef<HTMLImageElement | null>(null);

  const handleImageLoaded = useCallback(
    (src: string, img: HTMLImageElement, pipeline: PipelineState) => {
      setImageSrc(src);
      imageRef.current = img;
      setPipelineState(pipeline);
      setCurrentStep("edit");
    },
    [],
  );

  const handleExport = useCallback(() => {
    setCurrentStep("export");
  }, []);

  const handleReturnToEdit = useCallback(() => {
    setCurrentStep("edit");
  }, []);

  const handleReset = useCallback(() => {
    setImageSrc(null);
    setPipelineState(null);
    setCurrentStep("upload");
  }, []);

  switch (currentStep) {
    case "upload":
      return <UploadPage onImageLoaded={handleImageLoaded} />;

    case "edit":
      if (!imageSrc || !pipelineState) return null;
      return (
        <EditorPage
          imageSrc={imageSrc}
          imageRef={imageRef}
          pipelineState={pipelineState}
          setPipelineState={setPipelineState}
          onExport={handleExport}
          onReset={handleReset}
        />
      );

    case "export":
      if (!imageSrc || !pipelineState) return null;
      return (
        <ExportPage
          imageSrc={imageSrc}
          imageRef={imageRef}
          pipelineState={pipelineState}
          setPipelineState={setPipelineState}
          onReturn={handleReturnToEdit}
        />
      );
  }
}

export default App;
