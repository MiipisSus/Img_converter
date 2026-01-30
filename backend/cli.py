"""
圖片轉換 CLI 工具

使用方式:
    python backend/cli.py convert input.png output.jpg
    python backend/cli.py convert input.png output.jpg --quality 85
    python backend/cli.py info input.png
"""

import click
import sys
from pathlib import Path
from .services.image_service import ImageService


def format_size(size_bytes: int) -> str:
    """格式化檔案大小顯示"""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size_bytes < 1024.0:
            return f"{size_bytes:.2f} {unit}"
        size_bytes /= 1024.0
    return f"{size_bytes:.2f} TB"


@click.group()
@click.version_option(version='0.8.0', prog_name='img_convert')
def cli():
    """圖片處理工具 - 支援格式轉換、壓縮等功能"""
    pass


@cli.command()
@click.argument('input_path', type=click.Path(exists=True))
@click.argument('output_path', type=click.Path())
@click.option(
    '-q', '--quality',
    type=click.IntRange(1, 100),
    default=95,
    help='JPEG/WEBP 品質 (1-100)，預設 95'
)
def convert(input_path: str, output_path: str, quality: int):
    """
    轉換圖片格式

    範例:
        python backend/cli.py convert input.png output.jpg
        python backend/cli.py convert input.png output.jpg -q 85
    """
    service = ImageService()

    try:
        click.echo(f"🔄 正在轉換: {input_path} -> {output_path}")

        result = service.convert_format(input_path, output_path, quality)

        if result['success']:
            click.echo(click.style("✓ 轉換成功!", fg='green', bold=True))
            click.echo(f"  輸入大小: {format_size(result['input_size'])}")
            click.echo(f"  輸出大小: {format_size(result['output_size'])}")

            if result['size_reduction'] > 0:
                click.echo(click.style(
                    f"  節省空間: {result['size_reduction']:.2f}%",
                    fg='green'
                ))
            elif result['size_reduction'] < 0:
                click.echo(click.style(
                    f"  檔案增加: {abs(result['size_reduction']):.2f}%",
                    fg='yellow'
                ))
            else:
                click.echo("  檔案大小相同")

    except FileNotFoundError as e:
        click.echo(click.style(f"✗ 錯誤: {str(e)}", fg='red', bold=True), err=True)
        sys.exit(1)

    except ValueError as e:
        click.echo(click.style(f"✗ 錯誤: {str(e)}", fg='red', bold=True), err=True)
        click.echo("\n支援的格式: png, jpg, jpeg, bmp, gif, webp, tiff, tif")
        sys.exit(1)

    except Exception as e:
        click.echo(click.style(f"✗ 錯誤: {str(e)}", fg='red', bold=True), err=True)
        sys.exit(1)


@cli.command()
@click.argument('image_path', type=click.Path(exists=True))
def info(image_path: str):
    """
    顯示圖片資訊

    範例:
        python backend/cli.py info input.png
    """
    service = ImageService()

    try:
        info_data = service.get_image_info(image_path)

        click.echo(click.style(f"\n圖片資訊: {image_path}", fg='cyan', bold=True))
        click.echo(f"  格式: {info_data['format']}")
        click.echo(f"  色彩模式: {info_data['mode']}")
        click.echo(f"  尺寸: {info_data['width']} x {info_data['height']} px")
        click.echo(f"  檔案大小: {format_size(info_data['file_size'])}\n")

    except FileNotFoundError as e:
        click.echo(click.style(f"✗ 錯誤: {str(e)}", fg='red', bold=True), err=True)
        sys.exit(1)

    except Exception as e:
        click.echo(click.style(f"✗ 錯誤: {str(e)}", fg='red', bold=True), err=True)
        sys.exit(1)


@cli.command('batch-convert')
@click.argument('input_patterns', nargs=-1, required=True)
@click.option(
    '-o', '--output-dir',
    type=click.Path(),
    required=True,
    help='輸出目錄'
)
@click.option(
    '-f', '--format',
    'target_format',
    type=str,
    required=True,
    help='目標格式（jpg, png, webp, 等）'
)
@click.option(
    '-q', '--quality',
    type=click.IntRange(1, 100),
    default=95,
    help='JPEG/WEBP 品質 (1-100)，預設 95'
)
def batch_convert(input_patterns: tuple, output_dir: str, target_format: str, quality: int):
    """
    批次轉換圖片格式

    支援多個檔案路徑或 glob 模式。

    範例:
        python -m backend.cli batch-convert img1.png img2.jpg -o output/ -f webp
        python -m backend.cli batch-convert "photos/*.png" -o converted/ -f jpg -q 85
        python -m backend.cli batch-convert tests/test_images/* -o output/ -f webp
    """
    service = ImageService()

    try:
        click.echo(click.style("🚀 開始批次轉換", fg='cyan', bold=True))
        click.echo(f"  輸入模式: {', '.join(input_patterns)}")
        click.echo(f"  輸出目錄: {output_dir}")
        click.echo(f"  目標格式: {target_format}")
        click.echo(f"  品質: {quality}\n")

        result = service.batch_convert_format(
            list(input_patterns),
            output_dir,
            target_format,
            quality=quality
        )

        if result['total'] == 0:
            click.echo(click.style("⚠️  未找到符合條件的圖片檔案", fg='yellow', bold=True))
            sys.exit(0)

        # 顯示每個檔案的轉換結果
        click.echo(click.style(f"\n處理結果:", fg='cyan', bold=True))
        for item in result['results']:
            if item['success']:
                input_file = Path(item['input_file']).name
                output_file = Path(item['output_file']).name
                click.echo(click.style(f"  ✓ {input_file} -> {output_file}", fg='green'))
            else:
                input_file = Path(item['input_file']).name
                click.echo(click.style(f"  ✗ {input_file}: {item['error']}", fg='red'))

        # 顯示總結
        click.echo(click.style(f"\n總結:", fg='cyan', bold=True))
        click.echo(f"  總檔案數: {result['total']}")
        click.echo(click.style(f"  成功: {result['success_count']}", fg='green'))
        if result['fail_count'] > 0:
            click.echo(click.style(f"  失敗: {result['fail_count']}", fg='red'))

        click.echo(f"\n  總輸入大小: {format_size(result['total_input_size'])}")
        click.echo(f"  總輸出大小: {format_size(result['total_output_size'])}")

        if result['total_size_reduction'] > 0:
            click.echo(click.style(
                f"  總節省空間: {result['total_size_reduction']:.2f}%",
                fg='green',
                bold=True
            ))
        elif result['total_size_reduction'] < 0:
            click.echo(click.style(
                f"  總增加空間: {abs(result['total_size_reduction']):.2f}%",
                fg='yellow'
            ))
        else:
            click.echo("  檔案大小總和相同")

        click.echo(click.style(f"\n✨ 批次轉換完成！", fg='green', bold=True))

    except ValueError as e:
        click.echo(click.style(f"✗ 錯誤: {str(e)}", fg='red', bold=True), err=True)
        click.echo("\n支援的格式: png, jpg, jpeg, bmp, gif, webp, tiff, tif")
        sys.exit(1)

    except Exception as e:
        click.echo(click.style(f"✗ 錯誤: {str(e)}", fg='red', bold=True), err=True)
        sys.exit(1)


@cli.command()
@click.argument('input_path', type=click.Path(exists=True))
@click.argument('output_path', type=click.Path())
@click.option(
    '-s', '--size',
    'target_size',
    type=float,
    help='目標檔案大小（KB）'
)
@click.option(
    '-q', '--quality',
    type=click.IntRange(1, 100),
    default=85,
    help='壓縮品質 (1-100)，預設 85'
)
@click.option(
    '-d', '--max-dimension',
    type=int,
    help='最大邊長（px），會保持長寬比'
)
def compress(input_path: str, output_path: str, target_size: float, quality: int, max_dimension: int):
    """
    壓縮圖片到指定檔案大小

    可以指定目標檔案大小（KB）或品質參數。

    範例:
        python -m backend.cli compress input.jpg output.jpg -s 20
        python -m backend.cli compress input.png output.jpg -s 50 -d 1920
        python -m backend.cli compress input.jpg output.jpg -q 70
    """
    service = ImageService()

    try:
        click.echo(f"🔄 正在壓縮: {input_path} -> {output_path}")

        if target_size:
            click.echo(f"  目標大小: {target_size} KB")
        else:
            click.echo(f"  品質: {quality}")

        if max_dimension:
            click.echo(f"  最大邊長: {max_dimension} px")

        result = service.compress_image(
            input_path,
            output_path,
            target_size_kb=target_size,
            quality=quality,
            max_dimension=max_dimension
        )

        if result['success']:
            click.echo(click.style("\n✓ 壓縮成功!", fg='green', bold=True))
            click.echo(f"  輸入大小: {format_size(result['input_size'])}")
            click.echo(f"  輸出大小: {format_size(result['output_size'])}")
            click.echo(f"  最終品質: {result['final_quality']}")

            if result['resized']:
                click.echo(f"  原始尺寸: {result['original_dimensions'][0]} x {result['original_dimensions'][1]} px")
                click.echo(f"  壓縮尺寸: {result['final_dimensions'][0]} x {result['final_dimensions'][1]} px")

            if result['size_reduction'] > 0:
                click.echo(click.style(
                    f"  節省空間: {result['size_reduction']:.2f}%",
                    fg='green'
                ))
            elif result['size_reduction'] < 0:
                click.echo(click.style(
                    f"  檔案增加: {abs(result['size_reduction']):.2f}%",
                    fg='yellow'
                ))

            # 檢查是否達到目標
            if target_size:
                target_bytes = target_size * 1024
                if result['output_size'] <= target_bytes:
                    click.echo(click.style(
                        f"  ✓ 已達到目標大小",
                        fg='green',
                        bold=True
                    ))
                else:
                    click.echo(click.style(
                        f"  ⚠ 未能達到目標大小（可能需要調整尺寸）",
                        fg='yellow'
                    ))

    except FileNotFoundError as e:
        click.echo(click.style(f"✗ 錯誤: {str(e)}", fg='red', bold=True), err=True)
        sys.exit(1)

    except ValueError as e:
        click.echo(click.style(f"✗ 錯誤: {str(e)}", fg='red', bold=True), err=True)
        click.echo("\n支援的格式: png, jpg, jpeg, bmp, gif, webp, tiff, tif")
        sys.exit(1)

    except Exception as e:
        click.echo(click.style(f"✗ 錯誤: {str(e)}", fg='red', bold=True), err=True)
        sys.exit(1)


@cli.command()
@click.argument('input_path', type=click.Path(exists=True))
@click.argument('output_path', type=click.Path())
@click.option(
    '--crop',
    nargs=4,
    type=int,
    required=True,
    help='裁切參數：x y width height（從左上角開始）'
)
@click.option(
    '-q', '--quality',
    type=click.IntRange(1, 100),
    default=95,
    help='JPEG/WEBP 品質 (1-100)，預設 95'
)
def crop(input_path: str, output_path: str, crop: tuple, quality: int):
    """
    裁切圖片

    使用 (x, y, width, height) 格式指定裁切區域。
    如果裁切範圍超出圖片邊界，會自動調整為最大可用範圍。

    範例:
        python -m backend.cli crop input.png output.png --crop 100 100 500 500
        python -m backend.cli crop photo.jpg cropped.jpg --crop 0 0 800 600 -q 90
    """
    service = ImageService()
    x, y, width, height = crop

    try:
        click.echo(f"✂️  正在裁切: {input_path} -> {output_path}")
        click.echo(f"  裁切區域: x={x}, y={y}, width={width}, height={height}")

        result = service.crop_image(
            input_path,
            output_path,
            x=x,
            y=y,
            width=width,
            height=height,
            quality=quality
        )

        if result['success']:
            click.echo(click.style("\n✓ 裁切成功!", fg='green', bold=True))
            click.echo(f"  原始尺寸: {result['original_size'][0]} x {result['original_size'][1]} px")
            click.echo(f"  裁切區域: ({result['crop_box'][0]}, {result['crop_box'][1]}) -> ({result['crop_box'][2]}, {result['crop_box'][3]})")
            click.echo(f"  輸出尺寸: {result['output_size'][0]} x {result['output_size'][1]} px")
            click.echo(f"  輸入檔案: {format_size(result['input_file_size'])}")
            click.echo(f"  輸出檔案: {format_size(result['output_file_size'])}")

            if result['adjusted']:
                click.echo(click.style(
                    f"\n⚠️  邊界調整: {result['adjustment_message']}",
                    fg='yellow'
                ))

    except FileNotFoundError as e:
        click.echo(click.style(f"✗ 錯誤: {str(e)}", fg='red', bold=True), err=True)
        sys.exit(1)

    except ValueError as e:
        click.echo(click.style(f"✗ 錯誤: {str(e)}", fg='red', bold=True), err=True)
        sys.exit(1)

    except Exception as e:
        click.echo(click.style(f"✗ 錯誤: {str(e)}", fg='red', bold=True), err=True)
        sys.exit(1)


@cli.command()
@click.argument('input_path', type=click.Path(exists=True))
@click.argument('output_path', type=click.Path())
@click.option(
    '--size',
    nargs=2,
    type=int,
    help='目標尺寸：width height'
)
@click.option(
    '--width', '-w',
    type=int,
    help='目標寬度（高度自動計算）'
)
@click.option(
    '--height', '-h',
    type=int,
    help='目標高度（寬度自動計算）'
)
@click.option(
    '--scale', '-s',
    type=float,
    help='縮放百分比（如 50 表示縮小為 50%）'
)
@click.option(
    '--no-keep-ratio',
    is_flag=True,
    default=False,
    help='不保持長寬比（預設保持）'
)
@click.option(
    '-q', '--quality',
    type=click.IntRange(1, 100),
    default=95,
    help='JPEG/WEBP 品質 (1-100)，預設 95'
)
def resize(input_path: str, output_path: str, size: tuple, width: int,
           height: int, scale: float, no_keep_ratio: bool, quality: int):
    """
    調整圖片尺寸

    支援多種方式指定目標尺寸：精確尺寸、單邊尺寸或百分比縮放。

    範例:
        python -m backend.cli resize input.png output.png --size 800 600
        python -m backend.cli resize input.png output.png --width 800
        python -m backend.cli resize input.png output.png --height 600
        python -m backend.cli resize input.png output.png --scale 50
        python -m backend.cli resize input.png output.png --size 800 600 --no-keep-ratio
    """
    service = ImageService()

    # 處理 --size 參數
    target_width = size[0] if size else width
    target_height = size[1] if size else height

    # 驗證參數
    if scale is not None and (target_width is not None or target_height is not None):
        click.echo(click.style(
            "✗ 錯誤: --scale 不可與 --size/--width/--height 同時使用",
            fg='red', bold=True
        ), err=True)
        sys.exit(1)

    if scale is None and target_width is None and target_height is None:
        click.echo(click.style(
            "✗ 錯誤: 必須指定 --size、--width、--height 或 --scale 其中之一",
            fg='red', bold=True
        ), err=True)
        sys.exit(1)

    try:
        click.echo(f"📐 正在調整尺寸: {input_path} -> {output_path}")

        if scale is not None:
            click.echo(f"  縮放比例: {scale}%")
        else:
            if target_width and target_height:
                click.echo(f"  目標尺寸: {target_width} x {target_height} px")
            elif target_width:
                click.echo(f"  目標寬度: {target_width} px（高度自動計算）")
            else:
                click.echo(f"  目標高度: {target_height} px（寬度自動計算）")

        click.echo(f"  保持長寬比: {'否' if no_keep_ratio else '是'}")

        result = service.resize_image(
            input_path,
            output_path,
            width=target_width,
            height=target_height,
            scale=scale,
            keep_aspect_ratio=not no_keep_ratio,
            quality=quality
        )

        if result['success']:
            click.echo(click.style("\n✓ 調整尺寸成功!", fg='green', bold=True))
            click.echo(f"  原始尺寸: {result['original_size'][0]} x {result['original_size'][1]} px")
            click.echo(f"  輸出尺寸: {result['output_size'][0]} x {result['output_size'][1]} px")
            click.echo(f"  縮放因子: {result['scale_factor'][0]:.2f}x (寬) / {result['scale_factor'][1]:.2f}x (高)")
            click.echo(f"  輸入檔案: {format_size(result['input_file_size'])}")
            click.echo(f"  輸出檔案: {format_size(result['output_file_size'])}")

            # 顯示放大/縮小提示
            if result['scale_factor'][0] > 1 or result['scale_factor'][1] > 1:
                click.echo(click.style("  ⚠️  圖片已放大，可能影響畫質", fg='yellow'))

    except FileNotFoundError as e:
        click.echo(click.style(f"✗ 錯誤: {str(e)}", fg='red', bold=True), err=True)
        sys.exit(1)

    except ValueError as e:
        click.echo(click.style(f"✗ 錯誤: {str(e)}", fg='red', bold=True), err=True)
        sys.exit(1)

    except Exception as e:
        click.echo(click.style(f"✗ 錯誤: {str(e)}", fg='red', bold=True), err=True)
        sys.exit(1)


@cli.command()
@click.argument('input_path', type=click.Path(exists=True))
@click.argument('output_path', type=click.Path())
@click.option(
    '--rotate', '-r',
    'angle',
    type=float,
    required=True,
    help='旋轉角度（正值逆時針，負值順時針）'
)
@click.option(
    '--no-expand',
    is_flag=True,
    default=False,
    help='不擴展畫布（自訂角度可能會裁切圖片）'
)
@click.option(
    '-q', '--quality',
    type=click.IntRange(1, 100),
    default=95,
    help='JPEG/WEBP 品質 (1-100)，預設 95'
)
def rotate(input_path: str, output_path: str, angle: float, no_expand: bool, quality: int):
    """
    旋轉圖片

    支援任意角度旋轉。預設會自動擴展畫布以容納完整圖片。

    範例:
        python -m backend.cli rotate input.png output.png --rotate 90
        python -m backend.cli rotate input.png output.png --rotate 180
        python -m backend.cli rotate input.png output.png --rotate 45
        python -m backend.cli rotate input.png output.png --rotate -30
    """
    service = ImageService()

    try:
        click.echo(f"🔄 正在旋轉: {input_path} -> {output_path}")
        click.echo(f"  旋轉角度: {angle}°")

        result = service.rotate_image(
            input_path,
            output_path,
            angle=angle,
            expand=not no_expand,
            quality=quality
        )

        if result['success']:
            click.echo(click.style("\n✓ 旋轉成功!", fg='green', bold=True))
            click.echo(f"  原始尺寸: {result['original_size'][0]} x {result['original_size'][1]} px")
            click.echo(f"  輸出尺寸: {result['output_size'][0]} x {result['output_size'][1]} px")
            click.echo(f"  輸入檔案: {format_size(result['input_file_size'])}")
            click.echo(f"  輸出檔案: {format_size(result['output_file_size'])}")

            if result['expanded']:
                click.echo(click.style("  ℹ️  畫布已擴展以容納完整圖片", fg='cyan'))

    except FileNotFoundError as e:
        click.echo(click.style(f"✗ 錯誤: {str(e)}", fg='red', bold=True), err=True)
        sys.exit(1)

    except ValueError as e:
        click.echo(click.style(f"✗ 錯誤: {str(e)}", fg='red', bold=True), err=True)
        sys.exit(1)

    except Exception as e:
        click.echo(click.style(f"✗ 錯誤: {str(e)}", fg='red', bold=True), err=True)
        sys.exit(1)


@cli.command()
@click.argument('input_path', type=click.Path(exists=True))
@click.argument('output_path', type=click.Path())
@click.option(
    '--flip', '-f',
    'direction',
    type=click.Choice(['horizontal', 'vertical'], case_sensitive=False),
    required=True,
    help='翻轉方向：horizontal（水平）或 vertical（垂直）'
)
@click.option(
    '-q', '--quality',
    type=click.IntRange(1, 100),
    default=95,
    help='JPEG/WEBP 品質 (1-100)，預設 95'
)
def flip(input_path: str, output_path: str, direction: str, quality: int):
    """
    翻轉圖片

    支援水平翻轉（左右鏡像）和垂直翻轉（上下鏡像）。

    範例:
        python -m backend.cli flip input.png output.png --flip horizontal
        python -m backend.cli flip input.png output.png --flip vertical
    """
    service = ImageService()

    try:
        direction_text = '水平' if direction.lower() == 'horizontal' else '垂直'
        click.echo(f"🔃 正在翻轉: {input_path} -> {output_path}")
        click.echo(f"  翻轉方向: {direction_text}")

        result = service.flip_image(
            input_path,
            output_path,
            direction=direction,
            quality=quality
        )

        if result['success']:
            click.echo(click.style("\n✓ 翻轉成功!", fg='green', bold=True))
            click.echo(f"  圖片尺寸: {result['original_size'][0]} x {result['original_size'][1]} px")
            click.echo(f"  輸入檔案: {format_size(result['input_file_size'])}")
            click.echo(f"  輸出檔案: {format_size(result['output_file_size'])}")

    except FileNotFoundError as e:
        click.echo(click.style(f"✗ 錯誤: {str(e)}", fg='red', bold=True), err=True)
        sys.exit(1)

    except ValueError as e:
        click.echo(click.style(f"✗ 錯誤: {str(e)}", fg='red', bold=True), err=True)
        sys.exit(1)

    except Exception as e:
        click.echo(click.style(f"✗ 錯誤: {str(e)}", fg='red', bold=True), err=True)
        sys.exit(1)


if __name__ == '__main__':
    cli()
