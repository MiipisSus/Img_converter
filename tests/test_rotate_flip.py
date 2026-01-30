#!/usr/bin/env python3
"""
圖片旋轉與翻轉功能測試腳本

這個腳本會自動建立測試圖片，測試旋轉與翻轉功能，並驗證結果。

使用方式:
    python tests/test_rotate_flip.py
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
    """建立 400x300 非對稱測試圖片（方便驗證旋轉方向）"""
    print_header("建立 400x300 測試圖片")

    test_dir.mkdir(exist_ok=True)

    # 建立非對稱圖片，左上角有紅色標記，方便驗證旋轉方向
    print_info("建立 test_400x300.png（非對稱圖片，左上紅色標記）")
    img = Image.new('RGB', (400, 300), (200, 200, 200))

    # 在左上角畫一個紅色方塊（50x50）
    for y in range(50):
        for x in range(50):
            img.putpixel((x, y), (255, 0, 0))

    # 在右下角畫一個藍色方塊（50x50）
    for y in range(250, 300):
        for x in range(350, 400):
            img.putpixel((x, y), (0, 0, 255))

    # 建立漸層背景
    for y in range(50, 300):
        for x in range(50, 350):
            r = int(200 * x / 400)
            g = int(200 * y / 300)
            b = 100
            img.putpixel((x, y), (r, g, b))

    test_image_path = test_dir / "test_400x300.png"
    img.save(test_image_path)
    print_success(f"建立 test_400x300.png")

    return test_image_path


def test_rotate_90(service: ImageService, test_dir: Path, input_path: Path) -> tuple:
    """測試 1: 旋轉 90 度"""
    print_header("測試 1: 旋轉 90 度")

    output_path = test_dir / "rotated_90.png"

    print_info("旋轉角度: 90°（逆時針）")
    print_info("原始尺寸: 400x300")
    print_info("預期尺寸: 300x400（寬高互換）")

    try:
        result = service.rotate_image(
            str(input_path),
            str(output_path),
            angle=90
        )

        if result['success']:
            print_success("旋轉成功")
            print(f"  輸出尺寸: {result['output_size'][0]} x {result['output_size'][1]} px")

            with Image.open(output_path) as verify_img:
                actual_width, actual_height = verify_img.size

                # 90 度旋轉後，400x300 應該變成 300x400
                if actual_width == 300 and actual_height == 400:
                    # 驗證左上角的紅色方塊現在應該在左下角
                    pixel = verify_img.getpixel((10, 390))
                    if pixel[0] > 200 and pixel[1] < 50 and pixel[2] < 50:
                        print_success(f"尺寸與像素驗證通過: {actual_width} x {actual_height} px")
                        return ("旋轉 90°", True, None)
                    else:
                        print_error(f"像素驗證失敗: 紅色標記位置不正確")
                        return ("旋轉 90°", False, "像素位置錯誤")
                else:
                    print_error(f"尺寸驗證失敗: 預期 300x400，實際 {actual_width}x{actual_height}")
                    return ("旋轉 90°", False, f"尺寸錯誤")
        else:
            return ("旋轉 90°", False, "旋轉失敗")

    except Exception as e:
        print_error(f"錯誤: {str(e)}")
        return ("旋轉 90°", False, str(e))


def test_rotate_180(service: ImageService, test_dir: Path, input_path: Path) -> tuple:
    """測試 2: 旋轉 180 度"""
    print_header("測試 2: 旋轉 180 度")

    output_path = test_dir / "rotated_180.png"

    print_info("旋轉角度: 180°")
    print_info("原始尺寸: 400x300")
    print_info("預期尺寸: 400x300（尺寸不變）")

    try:
        result = service.rotate_image(
            str(input_path),
            str(output_path),
            angle=180
        )

        if result['success']:
            print_success("旋轉成功")

            with Image.open(output_path) as verify_img:
                actual_width, actual_height = verify_img.size

                if actual_width == 400 and actual_height == 300:
                    # 驗證：180 度旋轉後，原本左上角的紅色現在應該在右下角
                    pixel = verify_img.getpixel((390, 290))
                    if pixel[0] > 200 and pixel[1] < 50 and pixel[2] < 50:
                        print_success(f"尺寸與像素驗證通過")
                        return ("旋轉 180°", True, None)
                    else:
                        print_error(f"像素驗證失敗")
                        return ("旋轉 180°", False, "像素位置錯誤")
                else:
                    print_error(f"尺寸驗證失敗")
                    return ("旋轉 180°", False, f"尺寸錯誤")
        else:
            return ("旋轉 180°", False, "旋轉失敗")

    except Exception as e:
        print_error(f"錯誤: {str(e)}")
        return ("旋轉 180°", False, str(e))


def test_rotate_45_expand(service: ImageService, test_dir: Path, input_path: Path) -> tuple:
    """測試 3: 旋轉 45 度（自訂角度，expand=True）"""
    print_header("測試 3: 旋轉 45 度（expand=True）")

    output_path = test_dir / "rotated_45_expand.png"

    print_info("旋轉角度: 45°")
    print_info("原始尺寸: 400x300")
    print_info("預期: 尺寸會變大（畫布擴展），圖片完整保留")

    try:
        result = service.rotate_image(
            str(input_path),
            str(output_path),
            angle=45,
            expand=True
        )

        if result['success']:
            print_success("旋轉成功")
            print(f"  輸出尺寸: {result['output_size'][0]} x {result['output_size'][1]} px")

            with Image.open(output_path) as verify_img:
                actual_width, actual_height = verify_img.size

                # 45 度旋轉後，畫布應該擴大
                # 理論上對角線長度約為 sqrt(400^2 + 300^2) = 500
                if actual_width > 400 and actual_height > 300:
                    print_success(f"畫布已正確擴展: {actual_width} x {actual_height} px")
                    print_info(f"expanded 標記: {result['expanded']}")
                    return ("旋轉 45°（expand）", True, None)
                else:
                    print_error(f"畫布擴展失敗")
                    return ("旋轉 45°（expand）", False, "畫布未擴展")
        else:
            return ("旋轉 45°（expand）", False, "旋轉失敗")

    except Exception as e:
        print_error(f"錯誤: {str(e)}")
        return ("旋轉 45°（expand）", False, str(e))


def test_flip_horizontal(service: ImageService, test_dir: Path, input_path: Path) -> tuple:
    """測試 4: 水平翻轉"""
    print_header("測試 4: 水平翻轉")

    output_path = test_dir / "flipped_horizontal.png"

    print_info("翻轉方向: 水平（左右鏡像）")
    print_info("原始尺寸: 400x300")
    print_info("預期: 尺寸不變，左上紅色變成右上")

    try:
        result = service.flip_image(
            str(input_path),
            str(output_path),
            direction='horizontal'
        )

        if result['success']:
            print_success("翻轉成功")

            with Image.open(output_path) as verify_img:
                actual_width, actual_height = verify_img.size

                if actual_width == 400 and actual_height == 300:
                    # 驗證：水平翻轉後，原本左上角的紅色現在應該在右上角
                    pixel = verify_img.getpixel((390, 10))
                    if pixel[0] > 200 and pixel[1] < 50 and pixel[2] < 50:
                        print_success(f"尺寸與像素驗證通過")
                        return ("水平翻轉", True, None)
                    else:
                        print_error(f"像素驗證失敗: 紅色標記位置不正確 {pixel}")
                        return ("水平翻轉", False, "像素位置錯誤")
                else:
                    print_error(f"尺寸驗證失敗")
                    return ("水平翻轉", False, f"尺寸錯誤")
        else:
            return ("水平翻轉", False, "翻轉失敗")

    except Exception as e:
        print_error(f"錯誤: {str(e)}")
        return ("水平翻轉", False, str(e))


def test_flip_vertical(service: ImageService, test_dir: Path, input_path: Path) -> tuple:
    """測試 5: 垂直翻轉"""
    print_header("測試 5: 垂直翻轉")

    output_path = test_dir / "flipped_vertical.png"

    print_info("翻轉方向: 垂直（上下鏡像）")
    print_info("原始尺寸: 400x300")
    print_info("預期: 尺寸不變，左上紅色變成左下")

    try:
        result = service.flip_image(
            str(input_path),
            str(output_path),
            direction='vertical'
        )

        if result['success']:
            print_success("翻轉成功")

            with Image.open(output_path) as verify_img:
                actual_width, actual_height = verify_img.size

                if actual_width == 400 and actual_height == 300:
                    # 驗證：垂直翻轉後，原本左上角的紅色現在應該在左下角
                    pixel = verify_img.getpixel((10, 290))
                    if pixel[0] > 200 and pixel[1] < 50 and pixel[2] < 50:
                        print_success(f"尺寸與像素驗證通過")
                        return ("垂直翻轉", True, None)
                    else:
                        print_error(f"像素驗證失敗: 紅色標記位置不正確 {pixel}")
                        return ("垂直翻轉", False, "像素位置錯誤")
                else:
                    print_error(f"尺寸驗證失敗")
                    return ("垂直翻轉", False, f"尺寸錯誤")
        else:
            return ("垂直翻轉", False, "翻轉失敗")

    except Exception as e:
        print_error(f"錯誤: {str(e)}")
        return ("垂直翻轉", False, str(e))


def test_invalid_flip_direction(service: ImageService, test_dir: Path, input_path: Path) -> tuple:
    """測試 6: 無效翻轉方向"""
    print_header("測試 6: 無效翻轉方向")

    output_path = test_dir / "flipped_invalid.png"

    print_info("測試: 傳入無效的翻轉方向 'diagonal'")

    try:
        result = service.flip_image(
            str(input_path),
            str(output_path),
            direction='diagonal'
        )
        print_error("應該要拋出錯誤但沒有")
        return ("無效翻轉方向", False, "應拋出錯誤")

    except ValueError as e:
        print_success(f"正確拋出 ValueError: {str(e)}")
        return ("無效翻轉方向", True, None)

    except Exception as e:
        print_error(f"拋出了錯誤的例外類型: {type(e).__name__}")
        return ("無效翻轉方向", False, f"錯誤類型不正確")


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
    print("  ║          圖片旋轉與翻轉功能測試 (Rotate/Flip Test)        ║")
    print("  ╚═══════════════════════════════════════════════════════════╝")
    print(f"{Colors.END}")

    service = ImageService()
    test_dir = project_root / "tests" / "test_rotate_flip_images"

    # 建立測試圖片
    input_path = create_test_image(test_dir)

    # 執行測試
    results = []

    # 測試 1: 旋轉 90 度
    results.append(test_rotate_90(service, test_dir, input_path))

    # 測試 2: 旋轉 180 度
    results.append(test_rotate_180(service, test_dir, input_path))

    # 測試 3: 旋轉 45 度（expand）
    results.append(test_rotate_45_expand(service, test_dir, input_path))

    # 測試 4: 水平翻轉
    results.append(test_flip_horizontal(service, test_dir, input_path))

    # 測試 5: 垂直翻轉
    results.append(test_flip_vertical(service, test_dir, input_path))

    # 測試 6: 無效翻轉方向
    results.append(test_invalid_flip_direction(service, test_dir, input_path))

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
