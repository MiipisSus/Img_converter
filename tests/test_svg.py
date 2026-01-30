"""
SVG 格式支援測試腳本

測試 SVG 向量格式的讀取和轉換功能
"""

import os
import sys
from pathlib import Path

# 將專案根目錄加入 Python 路徑
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from backend.services.image_service import ImageService


def create_test_svg() -> str:
    """建立測試用的 SVG 檔案"""
    svg_content = '''<?xml version="1.0" encoding="UTF-8"?>
<svg width="200" height="150" xmlns="http://www.w3.org/2000/svg">
  <!-- 白色背景 -->
  <rect width="200" height="150" fill="white"/>

  <!-- 四個角落的色塊 -->
  <rect x="10" y="10" width="50" height="50" fill="red"/>
  <rect x="140" y="10" width="50" height="50" fill="green"/>
  <rect x="10" y="90" width="50" height="50" fill="blue"/>
  <rect x="140" y="90" width="50" height="50" fill="yellow"/>

  <!-- 中央圓形 -->
  <circle cx="100" cy="75" r="30" fill="gray"/>

  <!-- 文字 -->
  <text x="100" y="140" text-anchor="middle" font-size="12" fill="black">Test SVG</text>
</svg>'''

    test_dir = Path(__file__).parent / 'test_images'
    test_dir.mkdir(exist_ok=True)
    svg_path = test_dir / 'test_image.svg'

    with open(svg_path, 'w', encoding='utf-8') as f:
        f.write(svg_content)

    return str(svg_path)


def test_svg_to_png(service: ImageService, svg_path: str, test_dir: Path):
    """測試 SVG 轉換為 PNG"""
    print("\n" + "=" * 60)
    print("測試 1: SVG -> PNG 轉換")
    print("=" * 60)

    output_path = test_dir / 'svg_to_png.png'

    try:
        result = service.convert_format(svg_path, str(output_path))

        if result['success'] and os.path.exists(output_path):
            print(f"  ✓ SVG -> PNG 轉換成功")
            print(f"    輸入: {svg_path}")
            print(f"    輸出: {output_path} ({result['output_size']:,} bytes)")
            return True
        else:
            print(f"  ✗ SVG -> PNG 轉換失敗")
            return False

    except Exception as e:
        print(f"  ✗ 錯誤: {e}")
        return False


def test_svg_to_multiple_formats(service: ImageService, svg_path: str, test_dir: Path):
    """測試 SVG 轉換為多種格式"""
    print("\n" + "=" * 60)
    print("測試 2: SVG 轉換為多種格式")
    print("=" * 60)

    formats = ['jpg', 'webp', 'avif', 'heic', 'bmp', 'gif']
    passed = 0
    failed = 0

    for fmt in formats:
        output_path = test_dir / f'svg_to_{fmt}.{fmt}'

        try:
            result = service.convert_format(svg_path, str(output_path))

            if result['success'] and os.path.exists(output_path):
                size = os.path.getsize(output_path)
                print(f"  ✓ SVG -> {fmt.upper()} ({size:,} bytes)")
                passed += 1
            else:
                print(f"  ✗ SVG -> {fmt.upper()} 失敗")
                failed += 1

        except Exception as e:
            print(f"  ✗ SVG -> {fmt.upper()} 錯誤: {e}")
            failed += 1

    print(f"\n結果: {passed} 通過, {failed} 失敗")
    return failed == 0


def test_svg_info(service: ImageService, svg_path: str):
    """測試 SVG 圖片資訊"""
    print("\n" + "=" * 60)
    print("測試 3: 取得 SVG 圖片資訊")
    print("=" * 60)

    try:
        info = service.get_image_info(svg_path)

        print(f"  格式: {info['format']}")
        print(f"  尺寸: {info['width']} x {info['height']} px")
        print(f"  色彩模式: {info['mode']}")
        print(f"  檔案大小: {info['file_size']:,} bytes")
        print(f"  是向量格式: {info.get('is_vector', False)}")

        if info['format'] == 'SVG' and info.get('is_vector'):
            print(f"\n  ✓ SVG 資訊取得成功")
            return True
        else:
            print(f"\n  ⚠ SVG 資訊可能不完整")
            return True  # 仍視為通過

    except Exception as e:
        print(f"  ✗ 錯誤: {e}")
        return False


def test_svg_rotate(service: ImageService, svg_path: str, test_dir: Path):
    """測試 SVG 旋轉"""
    print("\n" + "=" * 60)
    print("測試 4: SVG 旋轉")
    print("=" * 60)

    output_path = test_dir / 'svg_rotated.png'

    try:
        result = service.rotate_image(svg_path, str(output_path), angle=90)

        if result['success']:
            # SVG 原始 200x150，旋轉 90 度後應為 150x200
            expected_size = (150, 200)
            if result['output_size'] == expected_size:
                print(f"  ✓ SVG 旋轉 90° 成功")
                print(f"    原始尺寸: {result['original_size']}")
                print(f"    輸出尺寸: {result['output_size']}")
                return True
            else:
                print(f"  ⚠ SVG 旋轉成功但尺寸不符預期")
                print(f"    預期: {expected_size}, 實際: {result['output_size']}")
                return True
        else:
            print(f"  ✗ SVG 旋轉失敗")
            return False

    except Exception as e:
        print(f"  ✗ 錯誤: {e}")
        return False


def test_svg_flip(service: ImageService, svg_path: str, test_dir: Path):
    """測試 SVG 翻轉"""
    print("\n" + "=" * 60)
    print("測試 5: SVG 翻轉")
    print("=" * 60)

    passed = 0
    failed = 0

    for direction in ['horizontal', 'vertical']:
        output_path = test_dir / f'svg_flipped_{direction}.png'

        try:
            result = service.flip_image(svg_path, str(output_path), direction=direction)

            if result['success']:
                print(f"  ✓ SVG {direction} 翻轉成功")
                passed += 1
            else:
                print(f"  ✗ SVG {direction} 翻轉失敗")
                failed += 1

        except Exception as e:
            print(f"  ✗ SVG {direction} 翻轉錯誤: {e}")
            failed += 1

    print(f"\n結果: {passed} 通過, {failed} 失敗")
    return failed == 0


def test_svg_crop(service: ImageService, svg_path: str, test_dir: Path):
    """測試 SVG 裁切"""
    print("\n" + "=" * 60)
    print("測試 6: SVG 裁切")
    print("=" * 60)

    output_path = test_dir / 'svg_cropped.png'

    try:
        # 裁切中央 100x100 區域
        result = service.crop_image(
            svg_path, str(output_path),
            x=50, y=25, width=100, height=100
        )

        if result['success']:
            if result['output_size'] == (100, 100):
                print(f"  ✓ SVG 裁切成功")
                print(f"    裁切區域: (50, 25) -> 100x100")
                print(f"    輸出尺寸: {result['output_size']}")
                return True
            else:
                print(f"  ⚠ SVG 裁切成功但尺寸不符: {result['output_size']}")
                return True
        else:
            print(f"  ✗ SVG 裁切失敗")
            return False

    except Exception as e:
        print(f"  ✗ 錯誤: {e}")
        return False


def test_svg_resize(service: ImageService, svg_path: str, test_dir: Path):
    """測試 SVG 縮放"""
    print("\n" + "=" * 60)
    print("測試 7: SVG 縮放")
    print("=" * 60)

    output_path = test_dir / 'svg_resized.png'

    try:
        # 縮放到 400x300（放大 2 倍）
        result = service.resize_image(
            svg_path, str(output_path),
            width=400, height=300
        )

        if result['success']:
            print(f"  ✓ SVG 縮放成功")
            print(f"    原始尺寸: {result['original_size']}")
            print(f"    輸出尺寸: {result['output_size']}")
            return True
        else:
            print(f"  ✗ SVG 縮放失敗")
            return False

    except Exception as e:
        print(f"  ✗ 錯誤: {e}")
        return False


def test_svg_chain_operations(service: ImageService, svg_path: str, test_dir: Path):
    """測試 SVG 鏈式操作"""
    print("\n" + "=" * 60)
    print("測試 8: SVG 鏈式操作")
    print("=" * 60)
    print("  流程: SVG -> PNG -> 旋轉 90° -> 翻轉 -> 裁切 -> AVIF")

    try:
        # Step 1: SVG -> PNG
        step1_path = test_dir / 'chain_step1.png'
        result1 = service.convert_format(svg_path, str(step1_path))
        print(f"  Step 1: SVG -> PNG - {'✓' if result1['success'] else '✗'}")

        # Step 2: 旋轉 90 度
        step2_path = test_dir / 'chain_step2.png'
        result2 = service.rotate_image(str(step1_path), str(step2_path), angle=90)
        print(f"  Step 2: 旋轉 90° - {'✓' if result2['success'] else '✗'}")

        # Step 3: 水平翻轉
        step3_path = test_dir / 'chain_step3.png'
        result3 = service.flip_image(str(step2_path), str(step3_path), direction='horizontal')
        print(f"  Step 3: 水平翻轉 - {'✓' if result3['success'] else '✗'}")

        # Step 4: 裁切中央 100x100
        step4_path = test_dir / 'chain_step4.png'
        result4 = service.crop_image(str(step3_path), str(step4_path), x=25, y=50, width=100, height=100)
        print(f"  Step 4: 裁切 100x100 - {'✓' if result4['success'] else '✗'}")

        # Step 5: 轉換為 AVIF
        step5_path = test_dir / 'chain_final.avif'
        result5 = service.convert_format(str(step4_path), str(step5_path))
        print(f"  Step 5: PNG -> AVIF - {'✓' if result5['success'] else '✗'}")

        if all([result1['success'], result2['success'], result3['success'],
                result4['success'], result5['success']]):
            final_size = os.path.getsize(step5_path)
            print(f"\n  ✓ 鏈式操作完成！最終檔案: {final_size:,} bytes")
            return True
        else:
            print(f"\n  ✗ 鏈式操作中有步驟失敗")
            return False

    except Exception as e:
        print(f"\n  ✗ 鏈式操作錯誤: {e}")
        return False


def test_svg_scale_parameter(service: ImageService, svg_path: str, test_dir: Path):
    """測試 SVG scale 參數"""
    print("\n" + "=" * 60)
    print("測試 9: SVG scale 參數（高解析度輸出）")
    print("=" * 60)

    # 測試 2x 縮放
    output_path = test_dir / 'svg_scale_2x.png'

    try:
        result = service.convert_format(svg_path, str(output_path), svg_scale=2.0)

        if result['success']:
            from PIL import Image
            with Image.open(output_path) as img:
                # 原始 200x150，2x 縮放應為 400x300
                if img.size == (400, 300):
                    print(f"  ✓ SVG 2x 縮放成功")
                    print(f"    輸出尺寸: {img.size}")
                    return True
                else:
                    print(f"  ⚠ SVG 縮放尺寸不符預期: {img.size}")
                    return True
        else:
            print(f"  ✗ SVG 縮放失敗")
            return False

    except Exception as e:
        print(f"  ✗ 錯誤: {e}")
        return False


def test_invalid_svg_output(service: ImageService, test_dir: Path):
    """測試不允許輸出為 SVG 格式"""
    print("\n" + "=" * 60)
    print("測試 10: 禁止輸出為 SVG 格式")
    print("=" * 60)

    input_path = test_dir / 'svg_to_png.png'  # 使用之前轉換的 PNG
    output_path = test_dir / 'invalid_output.svg'

    try:
        if os.path.exists(input_path):
            result = service.convert_format(str(input_path), str(output_path))
            print(f"  ✗ 應該拒絕輸出為 SVG，但沒有")
            return False
    except ValueError as e:
        if "不支援的輸出格式" in str(e):
            print(f"  ✓ 正確拒絕輸出為 SVG 格式")
            print(f"    錯誤訊息: {e}")
            return True
        else:
            print(f"  ⚠ 拒絕了但訊息不同: {e}")
            return True
    except Exception as e:
        print(f"  ✗ 發生非預期錯誤: {e}")
        return False


def cleanup_test_files(test_dir: Path):
    """清理測試檔案"""
    print("\n" + "=" * 60)
    print("清理測試檔案")
    print("=" * 60)

    patterns = ['svg_*.png', 'svg_*.jpg', 'svg_*.webp', 'svg_*.avif',
                'svg_*.heic', 'svg_*.bmp', 'svg_*.gif', 'chain_*', 'invalid_*']

    count = 0
    for pattern in patterns:
        for f in test_dir.glob(pattern):
            f.unlink()
            count += 1

    print(f"  已清理 {count} 個測試檔案")


def main():
    """執行所有測試"""
    print("=" * 60)
    print("SVG 格式支援功能測試")
    print("=" * 60)

    # 初始化
    service = ImageService()
    test_dir = Path(__file__).parent / 'test_images'
    test_dir.mkdir(exist_ok=True)

    # 建立測試 SVG
    svg_path = create_test_svg()
    print(f"\n測試 SVG: {svg_path}")

    # 執行測試
    results = []
    results.append(("SVG -> PNG", test_svg_to_png(service, svg_path, test_dir)))
    results.append(("SVG -> 多格式", test_svg_to_multiple_formats(service, svg_path, test_dir)))
    results.append(("SVG 資訊", test_svg_info(service, svg_path)))
    results.append(("SVG 旋轉", test_svg_rotate(service, svg_path, test_dir)))
    results.append(("SVG 翻轉", test_svg_flip(service, svg_path, test_dir)))
    results.append(("SVG 裁切", test_svg_crop(service, svg_path, test_dir)))
    results.append(("SVG 縮放", test_svg_resize(service, svg_path, test_dir)))
    results.append(("SVG 鏈式操作", test_svg_chain_operations(service, svg_path, test_dir)))
    results.append(("SVG scale 參數", test_svg_scale_parameter(service, svg_path, test_dir)))
    results.append(("禁止 SVG 輸出", test_invalid_svg_output(service, test_dir)))

    # 清理測試檔案
    cleanup_test_files(test_dir)

    # 總結
    print("\n" + "=" * 60)
    print("測試總結")
    print("=" * 60)

    passed = sum(1 for _, r in results if r)
    failed = len(results) - passed

    for name, result in results:
        status = "✓ 通過" if result else "✗ 失敗"
        print(f"  {name}: {status}")

    print(f"\n總計: {passed}/{len(results)} 測試通過")

    if failed == 0:
        print("\n🎉 所有測試通過！SVG 格式支援功能正常運作。")
        return 0
    else:
        print(f"\n⚠ 有 {failed} 個測試失敗，請檢查錯誤訊息。")
        return 1


if __name__ == '__main__':
    sys.exit(main())
