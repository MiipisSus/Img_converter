#!/usr/bin/env python3
"""
圖片尺寸調整功能測試腳本

這個腳本會自動建立測試圖片，測試各種尺寸調整方式，並驗證結果。

使用方式:
    python tests/test_resize.py
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


def create_test_image(test_dir: Path) -> Path:
    """建立 800x600 測試圖片"""
    print_header("建立 800x600 測試圖片")

    test_dir.mkdir(exist_ok=True)

    # 建立漸層測試圖片
    print_info("建立 test_800x600.png（彩色漸層）")
    img = Image.new('RGB', (800, 600))

    for y in range(600):
        for x in range(800):
            r = int(255 * x / 800)
            g = int(255 * y / 600)
            b = int(255 * (800 - x) / 800)
            img.putpixel((x, y), (r, g, b))

    test_image_path = test_dir / "test_800x600.png"
    img.save(test_image_path)
    print_success(f"建立 test_800x600.png")

    return test_image_path


def test_resize_with_size(service: ImageService, test_dir: Path, input_path: Path) -> tuple:
    """測試 1: 使用 --size 精確指定尺寸（保持長寬比）"""
    print_header("測試 1: --size 400 300（保持長寬比）")

    output_path = test_dir / "resized_size_400x300.png"

    print_info("目標: 400x300，原始: 800x600")
    print_info("預期: 400x300（完美比例，應該剛好）")

    try:
        result = service.resize_image(
            str(input_path),
            str(output_path),
            width=400,
            height=300,
            keep_aspect_ratio=True
        )

        if result['success']:
            print_success("調整成功")
            print(f"  輸出尺寸: {result['output_size'][0]} x {result['output_size'][1]} px")

            with Image.open(output_path) as verify_img:
                actual_width, actual_height = verify_img.size

                if actual_width == 400 and actual_height == 300:
                    print_success(f"尺寸驗證通過: {actual_width} x {actual_height} px")
                    return ("--size 精確尺寸", True, None)
                else:
                    print_error(f"尺寸驗證失敗: 預期 400x300，實際 {actual_width}x{actual_height}")
                    return ("--size 精確尺寸", False, f"尺寸錯誤")
        else:
            return ("--size 精確尺寸", False, "調整失敗")

    except Exception as e:
        print_error(f"錯誤: {str(e)}")
        return ("--size 精確尺寸", False, str(e))


def test_resize_with_width_only(service: ImageService, test_dir: Path, input_path: Path) -> tuple:
    """測試 2: 只指定寬度，高度自動計算"""
    print_header("測試 2: --width 400（高度自動計算）")

    output_path = test_dir / "resized_width_400.png"

    print_info("目標寬度: 400，原始: 800x600")
    print_info("預期: 400x300（高度按比例計算: 600 * 400/800 = 300）")

    try:
        result = service.resize_image(
            str(input_path),
            str(output_path),
            width=400,
            keep_aspect_ratio=True
        )

        if result['success']:
            print_success("調整成功")

            with Image.open(output_path) as verify_img:
                actual_width, actual_height = verify_img.size

                if actual_width == 400 and actual_height == 300:
                    print_success(f"尺寸驗證通過: {actual_width} x {actual_height} px")
                    return ("--width 自動高度", True, None)
                else:
                    print_error(f"尺寸驗證失敗: 預期 400x300，實際 {actual_width}x{actual_height}")
                    return ("--width 自動高度", False, f"尺寸錯誤")
        else:
            return ("--width 自動高度", False, "調整失敗")

    except Exception as e:
        print_error(f"錯誤: {str(e)}")
        return ("--width 自動高度", False, str(e))


def test_resize_with_height_only(service: ImageService, test_dir: Path, input_path: Path) -> tuple:
    """測試 3: 只指定高度，寬度自動計算"""
    print_header("測試 3: --height 300（寬度自動計算）")

    output_path = test_dir / "resized_height_300.png"

    print_info("目標高度: 300，原始: 800x600")
    print_info("預期: 400x300（寬度按比例計算: 800 * 300/600 = 400）")

    try:
        result = service.resize_image(
            str(input_path),
            str(output_path),
            height=300,
            keep_aspect_ratio=True
        )

        if result['success']:
            print_success("調整成功")

            with Image.open(output_path) as verify_img:
                actual_width, actual_height = verify_img.size

                if actual_width == 400 and actual_height == 300:
                    print_success(f"尺寸驗證通過: {actual_width} x {actual_height} px")
                    return ("--height 自動寬度", True, None)
                else:
                    print_error(f"尺寸驗證失敗: 預期 400x300，實際 {actual_width}x{actual_height}")
                    return ("--height 自動寬度", False, f"尺寸錯誤")
        else:
            return ("--height 自動寬度", False, "調整失敗")

    except Exception as e:
        print_error(f"錯誤: {str(e)}")
        return ("--height 自動寬度", False, str(e))


def test_resize_with_scale(service: ImageService, test_dir: Path, input_path: Path) -> tuple:
    """測試 4: 使用百分比縮放"""
    print_header("測試 4: --scale 50（縮小為 50%）")

    output_path = test_dir / "resized_scale_50.png"

    print_info("縮放: 50%，原始: 800x600")
    print_info("預期: 400x300")

    try:
        result = service.resize_image(
            str(input_path),
            str(output_path),
            scale=50
        )

        if result['success']:
            print_success("調整成功")

            with Image.open(output_path) as verify_img:
                actual_width, actual_height = verify_img.size

                if actual_width == 400 and actual_height == 300:
                    print_success(f"尺寸驗證通過: {actual_width} x {actual_height} px")
                    return ("--scale 百分比縮放", True, None)
                else:
                    print_error(f"尺寸驗證失敗: 預期 400x300，實際 {actual_width}x{actual_height}")
                    return ("--scale 百分比縮放", False, f"尺寸錯誤")
        else:
            return ("--scale 百分比縮放", False, "調整失敗")

    except Exception as e:
        print_error(f"錯誤: {str(e)}")
        return ("--scale 百分比縮放", False, str(e))


def test_resize_enlarge(service: ImageService, test_dir: Path, input_path: Path) -> tuple:
    """測試 5: 放大圖片"""
    print_header("測試 5: --scale 150（放大為 150%）")

    output_path = test_dir / "resized_scale_150.png"

    print_info("縮放: 150%，原始: 800x600")
    print_info("預期: 1200x900")

    try:
        result = service.resize_image(
            str(input_path),
            str(output_path),
            scale=150
        )

        if result['success']:
            print_success("調整成功（圖片放大）")

            with Image.open(output_path) as verify_img:
                actual_width, actual_height = verify_img.size

                if actual_width == 1200 and actual_height == 900:
                    print_success(f"尺寸驗證通過: {actual_width} x {actual_height} px")
                    return ("--scale 放大圖片", True, None)
                else:
                    print_error(f"尺寸驗證失敗: 預期 1200x900，實際 {actual_width}x{actual_height}")
                    return ("--scale 放大圖片", False, f"尺寸錯誤")
        else:
            return ("--scale 放大圖片", False, "調整失敗")

    except Exception as e:
        print_error(f"錯誤: {str(e)}")
        return ("--scale 放大圖片", False, str(e))


def test_resize_no_keep_ratio(service: ImageService, test_dir: Path, input_path: Path) -> tuple:
    """測試 6: 不保持長寬比"""
    print_header("測試 6: --size 500 500 --no-keep-ratio")

    output_path = test_dir / "resized_no_ratio.png"

    print_info("目標: 500x500（不保持長寬比），原始: 800x600")
    print_info("預期: 500x500（會變形）")

    try:
        result = service.resize_image(
            str(input_path),
            str(output_path),
            width=500,
            height=500,
            keep_aspect_ratio=False
        )

        if result['success']:
            print_success("調整成功（不保持長寬比）")

            with Image.open(output_path) as verify_img:
                actual_width, actual_height = verify_img.size

                if actual_width == 500 and actual_height == 500:
                    print_success(f"尺寸驗證通過: {actual_width} x {actual_height} px")
                    return ("--no-keep-ratio", True, None)
                else:
                    print_error(f"尺寸驗證失敗: 預期 500x500，實際 {actual_width}x{actual_height}")
                    return ("--no-keep-ratio", False, f"尺寸錯誤")
        else:
            return ("--no-keep-ratio", False, "調整失敗")

    except Exception as e:
        print_error(f"錯誤: {str(e)}")
        return ("--no-keep-ratio", False, str(e))


def test_resize_invalid_params(service: ImageService, test_dir: Path, input_path: Path) -> tuple:
    """測試 7: 無效參數處理"""
    print_header("測試 7: 無效參數處理")

    output_path = test_dir / "resized_invalid.png"

    print_info("測試: 未指定任何尺寸參數")

    try:
        result = service.resize_image(
            str(input_path),
            str(output_path)
        )
        print_error("應該要拋出錯誤但沒有")
        return ("無效參數處理", False, "應拋出錯誤")

    except ValueError as e:
        print_success(f"正確拋出 ValueError: {str(e)}")
        return ("無效參數處理", True, None)

    except Exception as e:
        print_error(f"拋出了錯誤的例外類型: {type(e).__name__}")
        return ("無效參數處理", False, f"錯誤類型不正確")


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
    print("  ║             圖片尺寸調整功能測試 (Resize Test)            ║")
    print("  ╚═══════════════════════════════════════════════════════════╝")
    print(f"{Colors.END}")

    service = ImageService()
    test_dir = project_root / "tests" / "test_resize_images"

    # 建立測試圖片
    input_path = create_test_image(test_dir)

    # 執行測試
    results = []

    # 測試 1: --size 精確尺寸
    results.append(test_resize_with_size(service, test_dir, input_path))

    # 測試 2: --width 自動高度
    results.append(test_resize_with_width_only(service, test_dir, input_path))

    # 測試 3: --height 自動寬度
    results.append(test_resize_with_height_only(service, test_dir, input_path))

    # 測試 4: --scale 百分比縮放
    results.append(test_resize_with_scale(service, test_dir, input_path))

    # 測試 5: --scale 放大圖片
    results.append(test_resize_enlarge(service, test_dir, input_path))

    # 測試 6: --no-keep-ratio
    results.append(test_resize_no_keep_ratio(service, test_dir, input_path))

    # 測試 7: 無效參數處理
    results.append(test_resize_invalid_params(service, test_dir, input_path))

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
