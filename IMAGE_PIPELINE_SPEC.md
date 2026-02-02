# 圖片處理工作流規格 (V1 - Pipeline Workflow)

## 1. UI 佈局架構

- **左側工具面板 (Sidebar)**：採用分頁或風琴式選單，包含：
  - **裁切工具**：控制 `IMAGE_CROPPER_SPEC.md` 定義的參數。
  - **縮放工具**：設定目標寬高（支援固定比例）。
  - **匯出設定**：設定格式（WebP/JPG/PNG）與目標大小（KB）。
- **中央工作區 (Workspace)**：顯示符合 `IMAGE_CROPPER_SPEC.md` 的即時預覽。

## 2. 全域狀態管理 (Global Pipeline State)

每個工具應具備獨立狀態，確保切換時不遺失數據：

```typescript
interface GlobalPipelineState {
  crop: CropState; // 參照裁切引擎規格
  resize: {
    targetWidth: number; // 例如 100
    active: boolean;
  };
  export: {
    format: "webp" | "jpeg" | "png";
    targetSizeKb: number; // 例如 50
  };
}
```

## 3. 鏈式處理與後端連動

當使用者點擊「執行處理」時，前端打包 JSON Pipeline 傳遞至後端：

### 鏈式執行順序：

1. **Crop** (根據裁切座標與旋轉角度擷取原始像素)。
2. **Resize** (將裁切後的結果縮放至目標寬度)。
3. **Convert/Compress** (轉換格式並調整質量直到符合目標 KB)。

### JSON Payload 範例：

{
"pipeline": [
{ "action": "crop", "params": { "rotate": 168, "scale": 1.2, "x_orig": 120, "y_orig": 45, "w_orig": 500, "h_orig": 500 } },
{ "action": "resize", "params": { "width": 100 } },
{ "action": "export", "params": { "format": "webp", "targetSize": 50 } }
]
}
