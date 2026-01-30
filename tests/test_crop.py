#!/usr/bin/env python3
"""
圖片裁切功能測試腳本

這個腳本會自動建立 1000x1000 測試圖片，裁切出中間的 500x500，並驗證結果。

使用方式:
    python tests/test_crop.py
"""

import sys
import os
from pathlib import Path

# 將專案根目錄加入 Python 路徑
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from PIL import Image
from backend.services.image_service import ImageService


class Colors:
    """終端機顏色"""
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    BOLD = '\033[1m'
    END = '\033[0m'


def print_header(text: str):
    """列印標題"""
    print(f"\n{Colors.CYAN}{Colors.BOLD}{'=' * 60}{Colors.END}")
    print(f"{Colors.CYAN}{Colors.BOLD}{text:^60}{Colors.END}")
    print(f"{Colors.CYAN}{Colors.BOLD}{'=' * 60}{Colors.END}\n")


def print_success(text: str):
    """列印成功訊息"""
    print(f"{Colors.GREEN}✓ {text}{Colors.END}")


def print_error(text: str):
    """列印錯誤訊息"""
    print(f"{Colors.RED}✗ {text}{Colors.END}")


def print_info(text: str):
    """列印資訊"""
    print(f"{Colors.BLUE}ℹ {text}{Colors.END}")


def format_size(size_bytes: int) -> str:
    """格式化檔案大小"""
    for unit in ['B', 'KB', 'MB']:
        if size_bytes < 1024.0:
            return f"{size_bytes:.2f} {unit}"
        size_bytes /= 1024.0
    return f"{size_bytes:.2f} GB"


def create_test_image_1000x1000(test_dir: Path) -> Path:
    """建立 1000x1000 測試圖片"""
    print_header("建立 1000x1000 測試圖片")

    test_dir.mkdir(exist_ok=True)

    # 建立漸層測試圖片
    print_info("建立 test_1000x1000.png（彩色漸層）")
    img = Image.new('RGB', (1000, 1000))

    for y in range(1000):
        for x in range(1000):
            r = int(255 * x / 1000)
            g = int(255 * y / 1000)
            b = int(255 * (1000 - x) / 1000)
            img.putpixel((x, y), (r, g, b))

    test_image_path = test_dir / "test_1000x1000.png"
    img.save(test_image_path)
    print_success(f"建立 test_1000x1000.png")

    return test_image_path


def test_crop_center(service: ImageService, test_dir: Path, input_path: Path) -> tuple:
    """測試裁切中央 500x500"""
    print_header("測試 1: 裁切中央 500x500")

    # 從 1000x1000 的圖片中裁切中央 500x500
    # 中央起點: (250, 250)
    x, y = 250, 250
    width, height = 500, 500

    output_path = test_dir / "cropped_center_500x500.png"

    print_info(f"裁切參數: x={x}, y={y}, width={width}, height={height}")

    try:
        result = service.crop_image(
            str(input_path),
            str(output_path),
            x=x, y=y, width=width, height=height
        )

        if result['success']:
            print_success(f"裁切成功: {input_path.name} -> {output_path.name}")
            print(f"  原始尺寸: {result['original_size'][0]} x {result['original_size'][1]} px")
            print(f"  輸出尺寸: {result['output_size'][0]} x {result['output_size'][1]} px")
            print(f"  檔案大小: {format_size(result['output_file_size'])}")

            # 驗證輸出檔案尺寸
            with Image.open(output_path) as verify_img:
                actual_width, actual_height = verify_img.size

                if actual_width == 500 and actual_height == 500:
                    print_success(f"尺寸驗證通過: {actual_width} x {actual_height} px")
                    return ("裁切中央 500x500", True, None)
                else:
                    print_error(f"尺寸驗證失敗: 預期 500x500，實際 {actual_width}x{actual_height}")
                    return ("裁切中央 500x500", False, f"尺寸錯誤: {actual_width}x{actual_height}")
        else:
            print_error("裁切失敗")
            return ("裁切中央 500x500", False, "裁切失敗")

    except Exception as e:
        print_error(f"錯誤: {str(e)}")
        return ("裁切中央 500x500", False, str(e))


def test_crop_boundary_adjustment(service: ImageService, test_dir: Path, input_path: Path) -> tuple:
    """測試邊界自動調整"""
    print_header("測試 2: 邊界自動調整")

    # 嘗試裁切超出邊界的區域
    # 從 (800, 800) 開始裁切 400x400，應該自動調整為 200x200
    x, y = 800, 800
    width, height = 400, 400

    output_path = test_dir / "cropped_boundary_adjusted.png"

    print_info(f"裁切參數: x={x}, y={y}, width={width}, height={height}")
    print_info("預期會自動調整為 200x200（因為超出邊界）")

    try:
        result = service.crop_image(
            str(input_path),
            str(output_path),
            x=x, y=y, width=width, height=height
        )

        if result['success']:
            print_success(f"裁切成功（含自動調整）")
            print(f"  原始尺寸: {result['original_size'][0]} x {result['original_size'][1]} px")
            print(f"  輸出尺寸: {result['output_size'][0]} x {result['output_size'][1]} px")

            if result['adjusted']:
                print(f"{Colors.YELLOW}  調整訊息: {result['adjustment_message']}{Colors.END}")

            # 驗證輸出尺寸應該是 200x200
            with Image.open(output_path) as verify_img:
                actual_width, actual_height = verify_img.size

                if actual_width == 200 and actual_height == 200:
                    print_success(f"邊界調整驗證通過: {actual_width} x {actual_height} px")
                    return ("邊界自動調整", True, None)
                else:
                    print_error(f"邊界調整驗證失敗: 預期 200x200，實際 {actual_width}x{actual_height}")
                    return ("邊界自動調整", False, f"尺寸錯誤: {actual_width}x{actual_height}")
        else:
            print_error("裁切失敗")
            return ("邊界自動調整", False, "裁切失敗")

    except Exception as e:
        print_error(f"錯誤: {str(e)}")
        return ("邊界自動調整", False, str(e))


def test_crop_invalid_params(service: ImageService, test_dir: Path, input_path: Path) -> tuple:
    """測試無效參數處理"""
    print_header("測試 3: 無效參數處理")

    output_path = test_dir / "cropped_invalid.png"

    # 測試起始座標超出圖片範圍
    print_info("測試: 起始座標超出圖片範圍 (x=1500)")

    try:
        result = service.crop_image(
            str(input_path),
            str(output_path),
            x=1500, y=0, width=100, height=100
        )
        print_error("應該要拋出錯誤但沒有")
        return ("無效參數處理", False, "應拋出錯誤")

    except ValueError as e:
        print_success(f"正確拋出 ValueError: {str(e)}")
        return ("無效參數處理", True, None)

    except Exception as e:
        print_error(f"拋出了錯誤的例外類型: {type(e).__name__}")
        return ("無效參數處理", False, f"錯誤類型不正確: {type(e).__name__}")


def test_crop_full_image(service: ImageService, test_dir: Path, input_path: Path) -> tuple:
    """測試裁切整張圖片（0,0 開始，完整尺寸）"""
    print_header("測試 4: 裁切整張圖片")

    x, y = 0, 0
    width, height = 1000, 1000

    output_path = test_dir / "cropped_full.png"

    print_info(f"裁切參數: x={x}, y={y}, width={width}, height={height}")

    try:
        result = service.crop_image(
            str(input_path),
            str(output_path),
            x=x, y=y, width=width, height=height
        )

        if result['success']:
            print_success("裁切成功")

            with Image.open(output_path) as verify_img:
                actual_width, actual_height = verify_img.size

                if actual_width == 1000 and actual_height == 1000:
                    print_success(f"尺寸驗證通過: {actual_width} x {actual_height} px")
                    return ("裁切整張圖片", True, None)
                else:
                    print_error(f"尺寸驗證失敗")
                    return ("裁切整張圖片", False, f"尺寸錯誤")
        else:
            return ("裁切整張圖片", False, "裁切失敗")

    except Exception as e:
        print_error(f"錯誤: {str(e)}")
        return ("裁切整張圖片", False, str(e))


def print_summary(results: list) -> int:
    """列印測試摘要"""
    print_header("測試摘要")

    total = len(results)
    passed = sum(1 for _, success, _ in results if success)
    failed = total - passed

    print(f"{Colors.BOLD}總測試數: {total}{Colors.END}")
    print(f"{Colors.GREEN}通過: {passed}{Colors.END}")
    print(f"{Colors.RED}失敗: {failed}{Colors.END}\n")

    if failed > 0:
        print(f"{Colors.RED}{Colors.BOLD}失敗的測試:{Colors.END}")
        for desc, success, error in results:
            if not success:
                print(f"  {Colors.RED}✗ {desc}{Colors.END}")
                if error:
                    print(f"    原因: {error}")

    print()

    if passed == total:
        print(f"{Colors.GREEN}{Colors.BOLD}🎉 所有測試通過！{Colors.END}")
        return 0
    else:
        print(f"{Colors.RED}{Colors.BOLD}⚠️  部分測試失敗{Colors.END}")
        return 1


def cleanup(test_dir: Path, keep_test_images: bool = False):
    """清理測試檔案"""
    print_header("清理測試檔案")

    if keep_test_images:
        print_info(f"保留測試圖片於: {test_dir}")
        return

    try:
        import shutil
        if test_dir.exists():
            shutil.rmtree(test_dir)
            print_success(f"已刪除測試目錄: {test_dir}")
    except Exception as e:
        print_error(f"清理失敗: {str(e)}")


def main():
    """主函式"""
    print(f"{Colors.CYAN}{Colors.BOLD}")
    print("  ╔═══════════════════════════════════════════════════════════╗")
    print("  ║               圖片裁切功能測試 (Crop Test)                ║")
    print("  ╚═══════════════════════════════════════════════════════════╝")
    print(f"{Colors.END}")

    service = ImageService()
    test_dir = project_root / "tests" / "test_crop_images"

    # 建立測試圖片
    input_path = create_test_image_1000x1000(test_dir)

    # 執行測試
    results = []

    # 測試 1: 裁切中央 500x500
    results.append(test_crop_center(service, test_dir, input_path))

    # 測試 2: 邊界自動調整
    results.append(test_crop_boundary_adjustment(service, test_dir, input_path))

    # 測試 3: 無效參數處理
    results.append(test_crop_invalid_params(service, test_dir, input_path))

    # 測試 4: 裁切整張圖片
    results.append(test_crop_full_image(service, test_dir, input_path))

    # 列印摘要
    exit_code = print_summary(results)

    # 詢問是否保留測試檔案
    try:
        keep = input(f"\n{Colors.YELLOW}是否保留測試圖片？[y/N]: {Colors.END}").strip().lower()
        cleanup(test_dir, keep_test_images=(keep == 'y'))
    except KeyboardInterrupt:
        print(f"\n{Colors.YELLOW}保留測試圖片{Colors.END}")
        cleanup(test_dir, keep_test_images=True)

    sys.exit(exit_code)


if __name__ == "__main__":
    main()
