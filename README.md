# 圖片處理工具 (Image Converter)

一個功能強大的圖片處理工具，目前提供 CLI 介面，未來將擴展為完整的 Web 應用。

## 特色功能

- 多格式轉換 (PNG, JPEG, BMP, GIF, WEBP, TIFF)
- 批次轉換（支援 glob 模式）
- 智能壓縮（指定目標檔案大小，自動優化品質）
- 品質控制 (JPEG/WEBP)
- 自動處理透明背景
- 檔案大小比較與統計
- 圖片資訊查看
- 模組化架構，易於擴展

## 快速開始

### 安裝

```bash
# 1. 建立並啟動虛擬環境
python3 -m venv venv
source venv/bin/activate  # macOS/Linux

# 2. 安裝依賴
pip install -r requirements.txt
```

### 使用範例

```bash
# 單檔案轉換
python -m backend.cli convert input.png output.jpg

# 指定品質（適用於 JPEG/WEBP）
python -m backend.cli convert photo.png photo.jpg --quality 85

# 批次轉換
python -m backend.cli batch-convert img1.png img2.jpg img3.bmp -o output/ -f webp
python -m backend.cli batch-convert "photos/*.png" -o converted/ -f jpg -q 85

# 壓縮到指定檔案大小
python -m backend.cli compress input.jpg output.jpg -s 20
python -m backend.cli compress large.bmp small.jpg -s 10 -d 800

# 查看圖片資訊
python -m backend.cli info myimage.png

# 查看幫助
python -m backend.cli --help
python -m backend.cli batch-convert --help
python -m backend.cli compress --help
```

## 專案結構

```
img_convert/
├── backend/              # 後端程式碼
│   ├── cli.py           # CLI 工具
│   ├── services/        # 核心業務邏輯
│   │   └── image_service.py
│   └── api/             # FastAPI 路由（未來）
├── frontend/            # React 前端（未來）
├── tests/               # 測試檔案
│   └── test_conversion.py
├── requirements.txt     # Python 依賴
├── CLAUDE.md           # 開發規範
└── README.md           # 本檔案
```

## 執行測試

```bash
# 執行自動化測試
python tests/test_conversion.py
```

測試會自動建立測試圖片，執行各種轉換，並驗證結果。

## 支援格式

| 格式 | 副檔名 | 支援 | 備註 |
|------|--------|------|------|
| PNG | .png | ✓ | 支援透明通道 |
| JPEG | .jpg, .jpeg | ✓ | 不支援透明通道 |
| BMP | .bmp | ✓ | |
| GIF | .gif | ✓ | |
| WEBP | .webp | ✓ | 支援品質控制 |
| TIFF | .tiff, .tif | ✓ | |

## 在程式中使用

```python
from backend.services.image_service import ImageService

# 建立服務實例
service = ImageService()

# 轉換格式
result = service.convert_format('input.png', 'output.jpg', quality=90)
print(f"節省空間: {result['size_reduction']:.2f}%")

# 壓縮圖片
result = service.compress_image('input.jpg', 'output.jpg', target_size_kb=20)
print(f"最終品質: {result['final_quality']}")
print(f"檔案大小: {result['output_size']} bytes")

# 取得圖片資訊
info = service.get_image_info('input.png')
print(f"尺寸: {info['width']} x {info['height']}")
```

## 未來計畫

### 短期 (CLI)
- ✓ 批次轉換功能
- ✓ 圖片壓縮優化
- 尺寸調整功能
- 圖片旋轉/翻轉

### 中期 (API)
- FastAPI RESTful API
- 檔案上傳處理
- 非同步處理

### 長期 (Web App)
- React 前端介面
- 拖放上傳
- 即時預覽

## 授權

MIT License

## 作者

Mango

---

**版本**: 0.3.0
**最後更新**: 2026-01-28
