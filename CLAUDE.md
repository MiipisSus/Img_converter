# 圖片處理工具開發規範

## 📌 專案當前狀態

- **階段**: 中期目標 - FastAPI 後端 API 開發中
- **核心邏輯**: `backend/services/image_service.py` (穩定，支援轉檔、壓縮、裁切、縮放、旋轉、翻轉)
- **支援格式**: PNG, JPEG, WEBP, AVIF, HEIF, ICO, SVG(讀取), BMP, GIF, TIFF, QOI 等

## 📂 專案結構

- **backend/**: 後端程式碼
  - **api/**: FastAPI 路由與控制器 (目前的開發重點)
  - **services/**: 核心業務邏輯 (封裝所有圖片處理函式)
  - **cli.py**: CLI 工具入口
- **tests/**: 各功能模組測試
- **frontend/**: React 前端預留空間
- **CLAUDE.md**: 本開發規範文件

## 🛠️ 開發與測試指令

- **啟動 API**: `uvicorn backend.api.main:app --reload`
- **執行 API 測試**: `pytest tests/test_api.py -v`
- **執行所有測試**: `pytest tests/`
- **環境設定**: `source venv/bin/activate` 且已安裝 `requirements.txt`

## ⚖️ 後端 API 開發規範 (必讀)

1. **無痕處理 (Memory First)**:
   - 除非必要，否則圖片處理應在記憶體完成 (`io.BytesIO`)。
   - 使用 `StreamingResponse` 直接回傳處理後的二進位流。
   - 禁止在伺服器硬碟永久儲存使用者上傳的原始或處理後圖片。
2. **非同步效能 (Async/Sync)**:
   - Pillow 是同步阻塞操作，必須在 `run_in_executor` 中執行，避免卡死 FastAPI Event Loop。
3. **資料驗證**:
   - 使用 **Pydantic Model** 定義請求參數。
   - 必須檢查 `UploadFile` 的 Magic Bytes 以確保檔案類型安全。
4. **錯誤回饋**:
   - 統一回傳中文字語系的錯誤訊息。
   - 處理失敗時回傳適當的 HTTP 狀態碼 (400/500)。

## 📝 後續待辦清單

- [ ] 準備 React 前端串接環境
