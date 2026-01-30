#!/usr/bin/env python3
"""
FastAPI API 自動化測試腳本

測試所有 API 端點的功能與錯誤處理
使用 pytest + httpx 進行測試

使用方式:
    pytest tests/test_api.py -v
    python tests/test_api.py  # 直接執行
"""

import sys
import io
from pathlib import Path

# 將專案根目錄加入 Python 路徑
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.api.main import app


# ===== Fixtures =====

@pytest.fixture
def client():
    """建立 FastAPI 測試客戶端"""
    return TestClient(app)


@pytest.fixture
def sample_png_bytes():
    """建立 100x100 PNG 測試圖片 bytes"""
    img = Image.new('RGB', (100, 100), color='red')
    buffer = io.BytesIO()
    img.save(buffer, format='PNG')
    buffer.seek(0)
    return buffer.getvalue()


@pytest.fixture
def sample_jpg_bytes():
    """建立 200x150 JPEG 測試圖片 bytes"""
    img = Image.new('RGB', (200, 150), color='blue')
    buffer = io.BytesIO()
    img.save(buffer, format='JPEG', quality=95)
    buffer.seek(0)
    return buffer.getvalue()


@pytest.fixture
def sample_rgba_png_bytes():
    """建立帶 Alpha 通道的 PNG 圖片 bytes"""
    img = Image.new('RGBA', (80, 80), color=(255, 0, 0, 128))
    buffer = io.BytesIO()
    img.save(buffer, format='PNG')
    buffer.seek(0)
    return buffer.getvalue()


# ===== 健康檢查端點測試 =====

class TestHealthEndpoints:
    """健康檢查相關端點測試"""

    def test_root(self, client):
        """測試根路徑"""
        response = client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert "version" in data
        assert "docs" in data

    def test_test_endpoint(self, client):
        """測試 /test 端點"""
        response = client.get("/test")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "timestamp" in data
        assert "python_version" in data

    def test_health_endpoint(self, client):
        """測試 /health 端點"""
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["service"] == "img_convert_api"

    def test_info_endpoint(self, client):
        """測試 /info 端點"""
        response = client.get("/info")
        assert response.status_code == 200
        data = response.json()
        assert "name" in data
        assert "version" in data
        assert "features" in data
        assert "supported_formats" in data


# ===== 圖片資訊端點測試 =====

class TestImageInfoEndpoint:
    """圖片資訊端點測試 (/images/info)"""

    def test_get_png_info(self, client, sample_png_bytes):
        """測試取得 PNG 圖片資訊"""
        response = client.post(
            "/images/info",
            files={"file": ("test.png", sample_png_bytes, "image/png")}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["format"] == "PNG"
        assert data["width"] == 100
        assert data["height"] == 100
        assert data["mode"] == "RGB"
        assert data["file_size"] > 0

    def test_get_jpg_info(self, client, sample_jpg_bytes):
        """測試取得 JPEG 圖片資訊"""
        response = client.post(
            "/images/info",
            files={"file": ("test.jpg", sample_jpg_bytes, "image/jpeg")}
        )
        assert response.status_code == 200
        data = response.json()
        # Pillow 回傳 'JPEG'，但 magic bytes 偵測可能回傳 'JPG'
        assert data["format"] in ["JPEG", "JPG"]
        assert data["width"] == 200
        assert data["height"] == 150

    def test_empty_file(self, client):
        """測試上傳空檔案"""
        response = client.post(
            "/images/info",
            files={"file": ("empty.png", b"", "image/png")}
        )
        assert response.status_code == 400
        assert "空" in response.json()["detail"]

    def test_invalid_format(self, client):
        """測試上傳無效格式"""
        response = client.post(
            "/images/info",
            files={"file": ("test.xyz", b"not an image", "application/octet-stream")}
        )
        assert response.status_code == 415


# ===== 圖片處理端點測試 (JSON 回應) =====

class TestUploadInfoEndpoint:
    """圖片處理端點測試 - JSON 回應 (/images/upload/info)"""

    def test_process_without_operations(self, client, sample_png_bytes):
        """測試不帶任何操作的處理"""
        response = client.post(
            "/images/upload/info",
            files={"file": ("test.png", sample_png_bytes, "image/png")}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["original_size"] == [100, 100]
        assert data["output_size"] == [100, 100]

    def test_format_conversion(self, client, sample_png_bytes):
        """測試格式轉換 PNG -> JPEG"""
        response = client.post(
            "/images/upload/info",
            files={"file": ("test.png", sample_png_bytes, "image/png")},
            data={"output_format": "jpg"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert any("格式轉換" in op for op in data["operations_applied"])

    def test_rotate_90(self, client, sample_jpg_bytes):
        """測試旋轉 90 度"""
        response = client.post(
            "/images/upload/info",
            files={"file": ("test.jpg", sample_jpg_bytes, "image/jpeg")},
            data={"rotate_angle": "90"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        # 200x150 旋轉 90 度後變成 150x200
        assert data["output_size"] == [150, 200]
        assert any("旋轉" in op for op in data["operations_applied"])

    def test_flip_horizontal(self, client, sample_png_bytes):
        """測試水平翻轉"""
        response = client.post(
            "/images/upload/info",
            files={"file": ("test.png", sample_png_bytes, "image/png")},
            data={"flip_direction": "horizontal"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert any("翻轉" in op for op in data["operations_applied"])

    def test_flip_vertical(self, client, sample_png_bytes):
        """測試垂直翻轉"""
        response = client.post(
            "/images/upload/info",
            files={"file": ("test.png", sample_png_bytes, "image/png")},
            data={"flip_direction": "vertical"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True

    def test_crop(self, client, sample_png_bytes):
        """測試裁切"""
        response = client.post(
            "/images/upload/info",
            files={"file": ("test.png", sample_png_bytes, "image/png")},
            data={
                "crop_x": "10",
                "crop_y": "10",
                "crop_width": "50",
                "crop_height": "50"
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["output_size"] == [50, 50]
        assert any("裁切" in op for op in data["operations_applied"])

    def test_resize_with_width(self, client, sample_jpg_bytes):
        """測試縮放 - 只指定寬度"""
        response = client.post(
            "/images/upload/info",
            files={"file": ("test.jpg", sample_jpg_bytes, "image/jpeg")},
            data={"resize_width": "100"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        # 200x150 縮放到寬度 100，保持比例，高度為 75
        assert data["output_size"][0] == 100
        assert data["output_size"][1] == 75

    def test_resize_with_scale(self, client, sample_png_bytes):
        """測試縮放 - 百分比"""
        response = client.post(
            "/images/upload/info",
            files={"file": ("test.png", sample_png_bytes, "image/png")},
            data={"resize_scale": "50"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        # 100x100 縮放 50% = 50x50
        assert data["output_size"] == [50, 50]

    def test_multiple_operations(self, client, sample_jpg_bytes):
        """測試多重操作組合"""
        response = client.post(
            "/images/upload/info",
            files={"file": ("test.jpg", sample_jpg_bytes, "image/jpeg")},
            data={
                "rotate_angle": "90",
                "flip_direction": "horizontal",
                "resize_scale": "50",
                "output_format": "png"
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        # 200x150 旋轉 90 度 -> 150x200，縮放 50% -> 75x100
        assert data["output_size"] == [75, 100]
        assert len(data["operations_applied"]) >= 3

    def test_invalid_output_format(self, client, sample_png_bytes):
        """測試無效輸出格式"""
        response = client.post(
            "/images/upload/info",
            files={"file": ("test.png", sample_png_bytes, "image/png")},
            data={"output_format": "xyz"}
        )
        assert response.status_code == 400


# ===== 圖片處理端點測試 (二進位回應) =====

class TestUploadEndpoint:
    """圖片處理端點測試 - 二進位回應 (/images/upload)"""

    def test_process_returns_image(self, client, sample_png_bytes):
        """測試處理後返回圖片"""
        response = client.post(
            "/images/upload",
            files={"file": ("test.png", sample_png_bytes, "image/png")}
        )
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/png"
        assert "Content-Disposition" in response.headers

        # 驗證返回的是有效圖片
        result_img = Image.open(io.BytesIO(response.content))
        assert result_img.size == (100, 100)

    def test_format_conversion_binary(self, client, sample_png_bytes):
        """測試格式轉換返回正確 MIME 類型"""
        response = client.post(
            "/images/upload",
            files={"file": ("test.png", sample_png_bytes, "image/png")},
            data={"output_format": "jpg"}
        )
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/jpeg"

        # 驗證返回的是 JPEG 格式
        result_img = Image.open(io.BytesIO(response.content))
        assert result_img.format == "JPEG"

    def test_rotate_binary(self, client, sample_jpg_bytes):
        """測試旋轉返回正確尺寸"""
        response = client.post(
            "/images/upload",
            files={"file": ("test.jpg", sample_jpg_bytes, "image/jpeg")},
            data={"rotate_angle": "90"}
        )
        assert response.status_code == 200

        result_img = Image.open(io.BytesIO(response.content))
        # 200x150 旋轉 90 度 -> 150x200
        assert result_img.size == (150, 200)

    def test_response_headers(self, client, sample_png_bytes):
        """測試回應標頭包含正確資訊"""
        response = client.post(
            "/images/upload",
            files={"file": ("test.png", sample_png_bytes, "image/png")},
            data={"resize_scale": "50"}
        )
        assert response.status_code == 200
        assert "X-Original-Size" in response.headers
        assert "X-Output-Size" in response.headers
        assert response.headers["X-Original-Size"] == "100x100"
        assert response.headers["X-Output-Size"] == "50x50"

    def test_quality_parameter(self, client, sample_png_bytes):
        """測試品質參數"""
        # 低品質
        response_low = client.post(
            "/images/upload",
            files={"file": ("test.png", sample_png_bytes, "image/png")},
            data={"output_format": "jpg", "quality": "10"}
        )
        # 高品質
        response_high = client.post(
            "/images/upload",
            files={"file": ("test.png", sample_png_bytes, "image/png")},
            data={"output_format": "jpg", "quality": "95"}
        )

        assert response_low.status_code == 200
        assert response_high.status_code == 200
        # 低品質檔案應該較小
        assert len(response_low.content) < len(response_high.content)


# ===== RGBA 轉 RGB 測試 =====

class TestRGBAConversion:
    """RGBA 轉 RGB 測試（如 PNG 轉 JPEG）"""

    def test_rgba_to_jpeg(self, client, sample_rgba_png_bytes):
        """測試 RGBA PNG 轉 JPEG（自動轉 RGB）"""
        response = client.post(
            "/images/upload",
            files={"file": ("rgba.png", sample_rgba_png_bytes, "image/png")},
            data={"output_format": "jpg"}
        )
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/jpeg"

        result_img = Image.open(io.BytesIO(response.content))
        assert result_img.mode == "RGB"


# ===== 錯誤處理測試 =====

class TestErrorHandling:
    """錯誤處理測試"""

    def test_missing_file(self, client):
        """測試未上傳檔案"""
        response = client.post("/images/info")
        assert response.status_code == 422

    def test_crop_out_of_bounds(self, client, sample_png_bytes):
        """測試裁切起始點超出圖片"""
        response = client.post(
            "/images/upload/info",
            files={"file": ("test.png", sample_png_bytes, "image/png")},
            data={
                "crop_x": "150",  # 超出 100x100 的範圍
                "crop_y": "150",
                "crop_width": "50",
                "crop_height": "50"
            }
        )
        assert response.status_code == 400

    def test_invalid_flip_direction(self, client, sample_png_bytes):
        """測試無效翻轉方向"""
        response = client.post(
            "/images/upload/info",
            files={"file": ("test.png", sample_png_bytes, "image/png")},
            data={"flip_direction": "diagonal"}  # 無效值
        )
        assert response.status_code == 400


# ===== 直接執行測試 =====

if __name__ == "__main__":
    # 支援直接執行
    sys.exit(pytest.main([__file__, "-v", "--tb=short"]))
