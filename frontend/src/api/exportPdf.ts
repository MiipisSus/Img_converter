const API_BASE = "/api";

/**
 * 將多張圖片 Blob 匯出為 PDF
 *
 * @param images - 圖片 Blob 陣列
 * @param filename - 匯出的 PDF 檔名
 * @returns PDF Blob
 */
export async function exportPdf(
  images: Blob[],
  filename = "export.pdf",
): Promise<Blob> {
  const formData = new FormData();
  images.forEach((blob, i) => {
    formData.append("images", blob, `image-${i}.png`);
  });
  formData.append("filename", filename);

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
