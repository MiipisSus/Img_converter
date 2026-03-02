const API_BASE = "/api";

interface ExportPdfOptions {
  images: Blob[];
  filename?: string;
  /** PDF 模式：high=PNG無損, standard=JPEG壓縮 */
  pdfMode: "high" | "standard";
  /** 內嵌圖片壓縮品質 1-100 (僅 standard 模式) */
  quality?: number;
  /** 目標 PDF 總檔案大小 (KB)，null 表示不限制 */
  totalTargetKB?: number | null;
}

/**
 * 將多張圖片 Blob 匯出為 PDF
 *
 * @returns PDF Blob
 */
export async function exportPdf({
  images,
  filename = "export.pdf",
  pdfMode,
  quality,
  totalTargetKB,
}: ExportPdfOptions): Promise<Blob> {
  const formData = new FormData();
  const ext = pdfMode === "high" ? "png" : "jpeg";
  images.forEach((blob, i) => {
    formData.append("images", blob, `image-${i}.${ext}`);
  });
  formData.append("filename", filename);
  formData.append("pdf_mode", pdfMode);
  if (quality !== undefined) {
    formData.append("quality", String(quality));
  }
  if (totalTargetKB != null) {
    formData.append("total_target_kb", String(totalTargetKB));
  }

  const res = await fetch(`${API_BASE}/images/export/pdf`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "PDF 匯出失敗" }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }

  return res.blob();
}
