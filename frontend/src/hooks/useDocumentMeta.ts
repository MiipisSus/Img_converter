import { useEffect } from "react";

interface DocumentMeta {
  title: string;
  description: string;
}

const PAGE_META: Record<string, DocumentMeta> = {
  upload: {
    title: "Picvic! — 線上圖片壓縮、影片剪裁、格式轉換工具",
    description:
      "Picvic! 是免費的線上媒體編輯工具，支援圖片裁切、線上壓縮、格式轉換（JPG、PNG、WebP）以及影片剪裁、旋轉與 GIF 製作，全程瀏覽器處理，無需上傳。",
  },
  "pic-edit": {
    title: "圖片裁切與編輯 — Picvic!",
    description:
      "線上圖片裁切、旋轉、翻轉工具，支援自訂比例與批次處理，全程瀏覽器處理。",
  },
  "pic-export": {
    title: "圖片壓縮與格式轉換 — Picvic!",
    description:
      "線上圖片壓縮與格式轉換，支援 JPG、PNG、WebP、AVIF 等格式，可設定目標檔案大小，批次匯出。",
  },
  "vic-edit": {
    title: "影片剪裁與編輯 — Picvic!",
    description:
      "線上影片剪裁工具，支援時間裁剪、空間裁切、旋轉翻轉，全程瀏覽器處理。",
  },
  "vic-export": {
    title: "影片壓縮與匯出 — Picvic!",
    description:
      "線上影片壓縮與匯出，支援 MP4、GIF 格式，可調整解析度與編碼品質。",
  },
};

/**
 * 根據頁面 key 動態更新 document.title 與 meta description。
 */
export function useDocumentMeta(pageKey: string) {
  useEffect(() => {
    const meta = PAGE_META[pageKey];
    if (!meta) return;

    document.title = meta.title;

    let descEl = document.querySelector<HTMLMetaElement>(
      'meta[name="description"]',
    );
    if (descEl) {
      descEl.setAttribute("content", meta.description);
    }
  }, [pageKey]);
}
