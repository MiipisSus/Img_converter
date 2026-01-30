# 圖片處理工具開發規範

## 📌 專案當前狀態

- **階段**: 前後端整合階段
- **後端**: FastAPI Memory First 模式 (穩定)
- **前端**: React + Vite + TypeScript + Tailwind CSS (PWA 支援)
- **支援格式**: PNG, JPEG, WEBP, AVIF, HEIF, ICO, SVG(讀取), BMP, GIF, TIFF, QOI 等

## 📂 專案結構

- **backend/**: 後端程式碼
  - **api/**: FastAPI 路由與控制器
  - **services/**: 核心業務邏輯
  - **cli.py**: CLI 工具入口
- **frontend/**: React 前端 (Vite + TypeScript + Tailwind)
  - **src/api/**: API Client (Axios)
  - **src/components/**: UI 元件
- **tests/**: 各功能模組測試

## 🛠️ 開發與測試指令

### 後端
- **啟動 API**: `uvicorn backend.api.main:app --reload`
- **執行 API 測試**: `pytest tests/test_api.py -v`

### 前端
- **開發模式**: `cd frontend && npm run dev`
- **建構**: `cd frontend && npm run build`

## ⚖️ 後端 API 開發規範

1. **無痕處理 (Memory First)**: 全程在記憶體處理，使用 `StreamingResponse` 回傳
2. **非同步效能**: Pillow 操作須在 `run_in_executor` 中執行
3. **資料驗證**: 使用 Pydantic Model，檢查 Magic Bytes
4. **錯誤回饋**: 統一回傳中文錯誤訊息，適當的 HTTP 狀態碼

## 🎨 前端開發規範

1. **PWA 支援**: 已配置 manifest.json 與 iOS Meta 標籤
2. **響應式設計**: 支援 Safe Area (iPhone 瀏海/底部)
3. **API 整合**: 使用 Axios 封裝，支援進度回報
