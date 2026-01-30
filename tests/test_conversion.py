#!/usr/bin/env python3
"""
圖片轉換功能測試腳本

這個腳本會自動建立測試圖片，執行各種格式轉換，並驗證結果。

使用方式:
    python tests/test_conversion.py
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


def create_test_images():
    """建立測試用圖片"""
    print_header("建立測試圖片")

    test_dir = project_root / "tests" / "test_images"
    test_dir.mkdir(exist_ok=True)

    # 建立 PNG 測試圖片（帶透明背景）
    print_info("建立 test_rgba.png（300x200，RGBA，漸層背景）")
    img_rgba = Image.new('RGBA', (300, 200))
    for y in range(200):
        for x in range(300):
            r = int(255 * x / 300)
            g = int(255 * y / 200)
            b = 128
            a = 255
            img_rgba.putpixel((x, y), (r, g, b, a))
    img_rgba.save(test_dir / "test_rgba.png")
    print_success(f"建立 test_rgba.png")

    # 建立 RGB 測試圖片
    print_info("建立 test_rgb.png（300x200，RGB，藍色背景）")
    img_rgb = Image.new('RGB', (300, 200), (66, 135, 245))
    img_rgb.save(test_dir / "test_rgb.png")
    print_success(f"建立 test_rgb.png")

    return test_dir


def test_format_conversions(test_dir: Path):
    """測試格式轉換"""
    print_header("測試格式轉換")

    service = ImageService()

    test_cases = [
        ("test_rgb.png", "test_output.jpg", 95, "PNG -> JPEG"),
        ("test_rgb.png", "test_output.webp", 90, "PNG -> WEBP"),
        ("test_rgb.png", "test_output.bmp", 100, "PNG -> BMP"),
        ("test_rgba.png", "test_rgba_to_jpg.jpg", 95, "RGBA PNG -> JPEG (透明背景處理)"),
    ]

    results = []

    for input_name, output_name, quality, description in test_cases:
        print_info(f"測試: {description}")

        input_path = test_dir / input_name
        output_path = test_dir / output_name

        try:
            result = service.convert_format(
                str(input_path),
                str(output_path),
                quality=quality
            )

            if result['success']:
                print_success(f"轉換成功: {input_name} -> {output_name}")
                print(f"  輸入: {format_size(result['input_size'])}")
                print(f"  輸出: {format_size(result['output_size'])}")
                if result['size_reduction'] > 0:
                    print(f"  {Colors.GREEN}節省: {result['size_reduction']:.2f}%{Colors.END}")
                else:
                    print(f"  {Colors.YELLOW}增加: {abs(result['size_reduction']):.2f}%{Colors.END}")

                # 驗證輸出檔案
                if output_path.exists():
                    print_success(f"檔案驗證通過: {output_name}")
                    results.append((description, True, None))
                else:
                    print_error(f"檔案驗證失敗: 檔案不存在")
                    results.append((description, False, "輸出檔案不存在"))
            else:
                print_error(f"轉換失敗")
                results.append((description, False, result.get('message')))

        except Exception as e:
            print_error(f"錯誤: {str(e)}")
            results.append((description, False, str(e)))

        print()

    return results


def test_image_info(test_dir: Path):
    """測試圖片資訊功能"""
    print_header("測試圖片資訊功能")

    service = ImageService()

    test_files = ["test_rgb.png", "test_rgba.png"]

    for filename in test_files:
        file_path = test_dir / filename
        if not file_path.exists():
            print_error(f"檔案不存在: {filename}")
            continue

        print_info(f"讀取資訊: {filename}")

        try:
            info = service.get_image_info(str(file_path))

            print(f"  格式: {info['format']}")
            print(f"  模式: {info['mode']}")
            print(f"  尺寸: {info['width']} x {info['height']} px")
            print(f"  檔案大小: {format_size(info['file_size'])}")
            print_success("資訊讀取成功")

        except Exception as e:
            print_error(f"錯誤: {str(e)}")

        print()


def print_summary(results: list):
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
    print("  ___                            ___                          _   ")
    print(" |_ _|_ __ ___   __ _  __ _  ___|_ _|__ ___  _ ____   _____ _ __| |_ ")
    print("  | || '_ ` _ \\ / _` |/ _` |/ _ \\| |/ __/ _ \\| '_ \\ \\ / / _ \\ '__| __|")
    print("  | || | | | | | (_| | (_| |  __/| | (_| (_) | | | \\ V /  __/ |  | |_ ")
    print(" |___|_| |_| |_|\\__,_|\\__, |\\___|___\\___\\___/|_| |_|\\_/ \\___|_|   \\__|")
    print("                      |___/                                            ")
    print(f"{Colors.END}")
    print(f"{Colors.BOLD}圖片轉換功能測試{Colors.END}\n")

    # 建立測試圖片
    test_dir = create_test_images()

    # 執行測試
    results = test_format_conversions(test_dir)

    # 測試圖片資訊
    test_image_info(test_dir)

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
