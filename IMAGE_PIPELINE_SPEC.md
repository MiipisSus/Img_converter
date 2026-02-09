圖片處理工作流規格 (V2 - 尺寸與 KB 壓縮版)

1.  UI 佈局架構

    左側工具面板 (Sidebar)：採用分頁標籤，包含：

        裁切工具：控制旋轉、縮放、翻轉及裁切框。

        調整尺寸：設定目標寬高，支援比例鎖定。

        匯出設定：選擇格式（WebP/JPG/PNG）並透過滑桿設定目標 KB 大小。

    中央工作區 (Workspace)：顯示符合裁切引擎規格的即時預覽圖。

2.  全域狀態管理 (Global Pipeline State)
    TypeScript

interface GlobalPipelineState {
// 1. 裁切狀態 (參照 IMAGE_CROPPER_SPEC)
crop: CropState;

// 2. 調整尺寸狀態
resize: {
active: boolean;
targetWidth: number;
targetHeight: number;
lockAspectRatio: boolean; // 鎖定比例
};

// 3. 匯出與壓縮狀態
export: {
format: 'webp' | 'jpeg' | 'png';
targetSizeKb: number; // 質量滑桿對應的目標 KB
currentOriginalSize: number; // 原始/裁切後的預估大小
};
}

3.  工具運算邏輯
    A. 調整尺寸 (Resize)

        比例連動：當 lockAspectRatio 為真時，更新寬度或高度需依據當前裁切區域的原始像素比例進行連動換算：

            Htarget​=Wtarget​×(Hcrop​/Wcrop​)

        基準數據：初始寬高應預設為裁切後的原始像素尺寸。

B. 壓縮 (Compress)

    目標 KB 導向：滑桿調整的是 targetSizeKb。

    自動迭代 (Binary Search)：執行處理時，前端應在指定格式下透過調整 quality 參數（0.1~1.0），並多次嘗試直到檔案大小最接近且低於 targetSizeKb。

4. 鏈式處理與後端連動

當使用者執行處理時，必須嚴格遵守以下順序執行，以確保品質與大小控制：

    Crop：根據座標、旋轉與翻轉參數擷取像素。

    Resize：將裁切後的結果縮放至 targetWidth。

    Convert/Compress：轉換為目標格式，並壓縮至符合 targetSizeKb。

JSON Payload 範例：
JSON

{
"pipeline": [
{ "action": "crop", "params": { "rotate": 168, "baseRotate": 90, "flipX": true, "x_orig": 120, "y_orig": 45, "w_orig": 500, "h_orig": 500 } },
{ "action": "resize", "params": { "width": 100, "keepRatio": true } },
{ "action": "export", "params": { "format": "webp", "targetSize": 50 } }
]
}
