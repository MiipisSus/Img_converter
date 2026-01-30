"""
FastAPI 應用程式主入口

提供圖片處理 RESTful API 服務，包含：
- Swagger UI 文件：/docs
- ReDoc 文件：/redoc
- OpenAPI JSON：/openapi.json
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import health, images

# 建立 FastAPI 應用程式
app = FastAPI(
    title="圖片處理 API",
    description="""
## 圖片處理工具 API

提供完整的圖片處理功能，包括：

### 功能列表
- **格式轉換** - 支援 PNG, JPEG, WEBP, AVIF, HEIC 等多種格式
- **圖片壓縮** - 智能壓縮到指定檔案大小
- **圖片裁切** - 自訂裁切區域
- **尺寸調整** - 精確尺寸或百分比縮放
- **圖片旋轉** - 支援任意角度
- **圖片翻轉** - 水平/垂直鏡像
- **SVG 轉換** - 向量圖轉點陣圖

### 支援格式
PNG, JPEG, BMP, GIF, WEBP, TIFF, AVIF, HEIF/HEIC, ICO, JPEG2000, TGA, QOI, SVG（只讀）
    """,
    version="0.8.0",
    contact={
        "name": "Mango",
    },
    license_info={
        "name": "MIT",
    },
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json"
)

# CORS 設定（允許前端跨域存取）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 開發階段允許所有來源，生產環境應限制
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 註冊路由
app.include_router(health.router, tags=["健康檢查"])
app.include_router(images.router)


@app.get("/", tags=["根路徑"])
async def root():
    """
    API 根路徑

    返回歡迎訊息和 API 文件連結
    """
    return {
        "message": "歡迎使用圖片處理 API",
        "version": "0.8.0",
        "docs": {
            "swagger": "/docs",
            "redoc": "/redoc",
            "openapi": "/openapi.json"
        }
    }
