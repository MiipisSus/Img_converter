"""
圖片處理服務模組

提供圖片格式轉換、壓縮等核心功能
"""

from PIL import Image
import os
from typing import Optional, Tuple, List
from pathlib import Path
import glob
import io

# 註冊 HEIF/HEIC 格式支援
try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
    HEIF_SUPPORTED = True
except ImportError:
    HEIF_SUPPORTED = False

# SVG 支援
try:
    import cairosvg
    SVG_SUPPORTED = True
except ImportError:
    SVG_SUPPORTED = False


class ImageService:
    """圖片處理服務類別"""

    # 支援的圖片格式（可讀取和寫入）
    SUPPORTED_FORMATS = {
        # 常用格式
        'png': 'PNG',
        'jpg': 'JPEG',
        'jpeg': 'JPEG',
        'bmp': 'BMP',
        'gif': 'GIF',
        'webp': 'WEBP',
        'tiff': 'TIFF',
        'tif': 'TIFF',
        # 新增格式
        'avif': 'AVIF',         # 新一代高效壓縮格式
        'heif': 'HEIF',         # 高效圖片格式
        'heic': 'HEIF',         # HEIF 的 Apple 副檔名
        'ico': 'ICO',           # 圖標格式
        'jp2': 'JPEG2000',      # JPEG 2000
        'j2k': 'JPEG2000',      # JPEG 2000 另一副檔名
        'tga': 'TGA',           # Targa 格式
        'qoi': 'QOI',           # Quite OK Image Format
    }

    # 只能讀取的格式（向量格式）
    READ_ONLY_FORMATS = {'svg'}

    # 支援品質參數的格式
    QUALITY_FORMATS = {'jpg', 'jpeg', 'webp', 'avif', 'heif', 'heic'}

    def __init__(self):
        """初始化圖片處理服務"""
        pass

    def _open_image(self, input_path: str, scale: float = 1.0) -> Image.Image:
        """
        開啟圖片檔案，支援一般圖片和 SVG 向量格式

        Args:
            input_path: 輸入圖片路徑
            scale: SVG 縮放倍率（預設 1.0）

        Returns:
            PIL Image 物件

        Raises:
            FileNotFoundError: 檔案不存在
            ValueError: 不支援的格式或 SVG 未安裝
        """
        if not os.path.exists(input_path):
            raise FileNotFoundError(f"輸入檔案不存在: {input_path}")

        input_format = Path(input_path).suffix.lower().lstrip('.')

        if input_format == 'svg':
            if not SVG_SUPPORTED:
                raise ValueError("SVG 格式需要安裝 cairosvg 套件：pip install cairosvg")

            # 使用 cairosvg 將 SVG 轉換為 PNG bytes
            with open(input_path, 'rb') as f:
                svg_content = f.read()

            # 根據 scale 調整輸出尺寸
            if scale != 1.0:
                png_bytes = cairosvg.svg2png(bytestring=svg_content, scale=scale)
            else:
                png_bytes = cairosvg.svg2png(bytestring=svg_content)

            # 轉換為 PIL Image
            img = Image.open(io.BytesIO(png_bytes))
            # 確保返回副本，避免 BytesIO 被關閉後出問題
            return img.copy()
        else:
            return Image.open(input_path)

    def _is_valid_input_format(self, format_ext: str) -> bool:
        """檢查是否為有效的輸入格式"""
        return format_ext in self.SUPPORTED_FORMATS or format_ext in self.READ_ONLY_FORMATS

    def _is_valid_output_format(self, format_ext: str) -> bool:
        """檢查是否為有效的輸出格式"""
        return format_ext in self.SUPPORTED_FORMATS

    def convert_format(
        self,
        input_path: str,
        output_path: str,
        quality: int = 95,
        svg_scale: float = 1.0
    ) -> dict:
        """
        轉換圖片格式

        Args:
            input_path: 輸入圖片路徑
            output_path: 輸出圖片路徑
            quality: JPEG/WEBP 品質 (1-100)，預設 95
            svg_scale: SVG 縮放倍率（預設 1.0）

        Returns:
            dict: 包含轉換結果資訊的字典
            {
                'success': bool,
                'message': str,
                'input_size': int,
                'output_size': int,
                'size_reduction': float
            }

        Raises:
            FileNotFoundError: 輸入檔案不存在
            ValueError: 不支援的圖片格式
            Exception: 其他處理錯誤
        """
        # 驗證輸入檔案
        if not os.path.exists(input_path):
            raise FileNotFoundError(f"輸入檔案不存在: {input_path}")

        # 取得並驗證格式
        input_format = Path(input_path).suffix.lower().lstrip('.')
        output_format = Path(output_path).suffix.lower().lstrip('.')

        if not self._is_valid_input_format(input_format):
            raise ValueError(f"不支援的輸入格式: {input_format}")

        if not self._is_valid_output_format(output_format):
            raise ValueError(f"不支援的輸出格式: {output_format}")

        try:
            # 開啟圖片（支援 SVG）
            img = self._open_image(input_path, scale=svg_scale)
            try:
                # 取得原始檔案大小
                input_size = os.path.getsize(input_path)

                # 不支援透明通道的格式
                no_alpha_formats = {'jpg', 'jpeg', 'bmp', 'jp2', 'j2k'}

                # 處理透明通道（RGBA -> RGB）
                if img.mode == 'RGBA' and output_format in no_alpha_formats:
                    # 轉換成白色背景
                    rgb_img = Image.new('RGB', img.size, (255, 255, 255))
                    rgb_img.paste(img, mask=img.split()[3])  # 使用 alpha 通道作為遮罩
                    img = rgb_img

                # 儲存圖片
                save_kwargs = {}
                if output_format in self.QUALITY_FORMATS:
                    save_kwargs['quality'] = quality
                    if output_format in ['jpg', 'jpeg', 'webp']:
                        save_kwargs['optimize'] = True

                img.save(output_path, self.SUPPORTED_FORMATS[output_format], **save_kwargs)

                # 取得輸出檔案大小
                output_size = os.path.getsize(output_path)

                # 計算檔案大小變化
                size_reduction = ((input_size - output_size) / input_size) * 100

                return {
                    'success': True,
                    'message': f'成功轉換: {input_path} -> {output_path}',
                    'input_size': input_size,
                    'output_size': output_size,
                    'size_reduction': size_reduction
                }
            finally:
                img.close()

        except Exception as e:
            raise Exception(f"圖片處理錯誤: {str(e)}")

    def get_image_info(self, image_path: str) -> dict:
        """
        取得圖片資訊

        Args:
            image_path: 圖片路徑

        Returns:
            dict: 圖片資訊
        """
        if not os.path.exists(image_path):
            raise FileNotFoundError(f"檔案不存在: {image_path}")

        input_format = Path(image_path).suffix.lower().lstrip('.')

        if input_format == 'svg':
            # SVG 特殊處理
            img = self._open_image(image_path)
            try:
                return {
                    'format': 'SVG',
                    'mode': img.mode,
                    'size': img.size,
                    'width': img.width,
                    'height': img.height,
                    'file_size': os.path.getsize(image_path),
                    'is_vector': True
                }
            finally:
                img.close()
        else:
            with Image.open(image_path) as img:
                return {
                    'format': img.format,
                    'mode': img.mode,
                    'size': img.size,
                    'width': img.width,
                    'height': img.height,
                    'file_size': os.path.getsize(image_path),
                    'is_vector': False
                }

    def batch_convert_format(
        self,
        input_patterns: List[str],
        output_dir: str,
        target_format: str,
        quality: int = 95
    ) -> dict:
        """
        批次轉換圖片格式

        Args:
            input_patterns: 輸入圖片路徑列表或 glob 模式列表
            output_dir: 輸出目錄
            target_format: 目標格式（不含點，如 'jpg', 'png'）
            quality: JPEG/WEBP 品質 (1-100)，預設 95

        Returns:
            dict: 批次轉換結果
            {
                'success_count': int,
                'fail_count': int,
                'total': int,
                'results': List[dict],
                'total_input_size': int,
                'total_output_size': int,
                'total_size_reduction': float
            }
        """
        # 驗證目標格式
        target_format = target_format.lower().lstrip('.')
        if target_format not in self.SUPPORTED_FORMATS:
            raise ValueError(f"不支援的目標格式: {target_format}")

        # 建立輸出目錄
        output_path_obj = Path(output_dir)
        output_path_obj.mkdir(parents=True, exist_ok=True)

        # 收集所有輸入檔案
        input_files = []
        for pattern in input_patterns:
            # 如果是 glob 模式
            if '*' in pattern or '?' in pattern:
                matched_files = glob.glob(pattern)
                input_files.extend(matched_files)
            else:
                # 直接的檔案路徑
                if os.path.exists(pattern):
                    input_files.append(pattern)

        # 去重
        input_files = list(set(input_files))

        # 過濾出支援的圖片檔案
        valid_files = []
        for file_path in input_files:
            file_format = Path(file_path).suffix.lower().lstrip('.')
            if file_format in self.SUPPORTED_FORMATS:
                valid_files.append(file_path)

        if not valid_files:
            return {
                'success_count': 0,
                'fail_count': 0,
                'total': 0,
                'results': [],
                'total_input_size': 0,
                'total_output_size': 0,
                'total_size_reduction': 0.0
            }

        # 批次轉換
        results = []
        success_count = 0
        fail_count = 0
        total_input_size = 0
        total_output_size = 0

        for input_file in valid_files:
            input_path = Path(input_file)
            output_filename = input_path.stem + '.' + target_format
            output_file = output_path_obj / output_filename

            try:
                result = self.convert_format(
                    str(input_path),
                    str(output_file),
                    quality=quality
                )
                success_count += 1
                total_input_size += result['input_size']
                total_output_size += result['output_size']
                results.append({
                    'input_file': str(input_path),
                    'output_file': str(output_file),
                    'success': True,
                    'result': result
                })
            except Exception as e:
                fail_count += 1
                results.append({
                    'input_file': str(input_path),
                    'output_file': str(output_file),
                    'success': False,
                    'error': str(e)
                })

        # 計算總體節省比例
        total_size_reduction = 0.0
        if total_input_size > 0:
            total_size_reduction = ((total_input_size - total_output_size) / total_input_size) * 100

        return {
            'success_count': success_count,
            'fail_count': fail_count,
            'total': len(valid_files),
            'results': results,
            'total_input_size': total_input_size,
            'total_output_size': total_output_size,
            'total_size_reduction': total_size_reduction
        }

    def compress_image(
        self,
        input_path: str,
        output_path: str,
        target_size_kb: Optional[float] = None,
        quality: int = 85,
        max_dimension: Optional[int] = None
    ) -> dict:
        """
        壓縮圖片到指定檔案大小

        Args:
            input_path: 輸入圖片路徑
            output_path: 輸出圖片路徑
            target_size_kb: 目標檔案大小（KB），None 表示只用品質壓縮
            quality: 初始壓縮品質 (1-100)，預設 85
            max_dimension: 最大邊長（px），None 表示不調整尺寸

        Returns:
            dict: 壓縮結果資訊
            {
                'success': bool,
                'message': str,
                'input_size': int,
                'output_size': int,
                'size_reduction': float,
                'final_quality': int,
                'resized': bool
            }
        """
        # 驗證輸入檔案
        if not os.path.exists(input_path):
            raise FileNotFoundError(f"輸入檔案不存在: {input_path}")

        # 取得並驗證格式
        input_format = Path(input_path).suffix.lower().lstrip('.')
        output_format = Path(output_path).suffix.lower().lstrip('.')

        if input_format not in self.SUPPORTED_FORMATS:
            raise ValueError(f"不支援的輸入格式: {input_format}")

        if output_format not in self.SUPPORTED_FORMATS:
            raise ValueError(f"不支援的輸出格式: {output_format}")

        try:
            # 開啟圖片
            with Image.open(input_path) as img:
                input_size = os.path.getsize(input_path)
                original_size = img.size
                resized = False

                # 不支援透明通道的格式
                no_alpha_formats = {'jpg', 'jpeg', 'bmp', 'jp2', 'j2k'}

                # 處理透明通道
                if img.mode == 'RGBA' and output_format in no_alpha_formats:
                    rgb_img = Image.new('RGB', img.size, (255, 255, 255))
                    rgb_img.paste(img, mask=img.split()[3])
                    img = rgb_img

                # 調整尺寸（如果指定）
                if max_dimension and (img.width > max_dimension or img.height > max_dimension):
                    # 保持長寬比調整
                    img.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)
                    resized = True

                # 如果指定了目標大小，使用二分搜尋找到合適的品質
                if target_size_kb is not None:
                    target_size_bytes = target_size_kb * 1024
                    final_quality = self._find_optimal_quality(
                        img,
                        output_format,
                        target_size_bytes
                    )
                else:
                    final_quality = quality

                # 儲存圖片
                save_kwargs = {}
                if output_format in self.QUALITY_FORMATS:
                    save_kwargs['quality'] = final_quality
                    if output_format in ['jpg', 'jpeg', 'webp']:
                        save_kwargs['optimize'] = True

                img.save(output_path, self.SUPPORTED_FORMATS[output_format], **save_kwargs)

                # 取得輸出檔案大小
                output_size = os.path.getsize(output_path)

                # 計算檔案大小變化
                size_reduction = ((input_size - output_size) / input_size) * 100

                return {
                    'success': True,
                    'message': f'成功壓縮: {input_path} -> {output_path}',
                    'input_size': input_size,
                    'output_size': output_size,
                    'size_reduction': size_reduction,
                    'final_quality': final_quality,
                    'resized': resized,
                    'original_dimensions': original_size,
                    'final_dimensions': img.size
                }

        except Exception as e:
            raise Exception(f"圖片壓縮錯誤: {str(e)}")

    def _find_optimal_quality(
        self,
        img: Image.Image,
        output_format: str,
        target_size_bytes: int,
        tolerance: int = 1024
    ) -> int:
        """
        使用二分搜尋找到最佳品質參數

        Args:
            img: PIL Image 物件
            output_format: 輸出格式
            target_size_bytes: 目標檔案大小（bytes）
            tolerance: 容許誤差（bytes），預設 1KB

        Returns:
            int: 最佳品質參數 (1-100)
        """
        # 如果格式不支援品質調整，返回預設值
        if output_format not in self.QUALITY_FORMATS:
            return 95

        min_quality = 1
        max_quality = 95
        best_quality = 85

        # 先測試最高品質是否已經小於目標
        test_size = self._get_image_size_at_quality(img, output_format, max_quality)
        if test_size <= target_size_bytes:
            return max_quality

        # 二分搜尋
        while min_quality <= max_quality:
            mid_quality = (min_quality + max_quality) // 2
            current_size = self._get_image_size_at_quality(img, output_format, mid_quality)

            if abs(current_size - target_size_bytes) <= tolerance:
                return mid_quality

            if current_size > target_size_bytes:
                # 檔案太大，降低品質
                max_quality = mid_quality - 1
            else:
                # 檔案太小，可以提高品質
                best_quality = mid_quality
                min_quality = mid_quality + 1

        return best_quality

    def _get_image_size_at_quality(
        self,
        img: Image.Image,
        output_format: str,
        quality: int
    ) -> int:
        """
        取得指定品質下的圖片檔案大小

        Args:
            img: PIL Image 物件
            output_format: 輸出格式
            quality: 品質參數

        Returns:
            int: 檔案大小（bytes）
        """
        buffer = io.BytesIO()
        save_kwargs = {
            'quality': quality,
            'optimize': True
        }
        img.save(buffer, self.SUPPORTED_FORMATS[output_format], **save_kwargs)
        return buffer.tell()

    def resize_image(
        self,
        input_path: str,
        output_path: str,
        width: Optional[int] = None,
        height: Optional[int] = None,
        scale: Optional[float] = None,
        keep_aspect_ratio: bool = True,
        quality: int = 95,
        svg_scale: float = 1.0
    ) -> dict:
        """
        調整圖片尺寸

        Args:
            input_path: 輸入圖片路徑
            output_path: 輸出圖片路徑
            width: 目標寬度（px），None 表示自動計算
            height: 目標高度（px），None 表示自動計算
            scale: 縮放百分比（如 50 表示縮小為 50%），與 width/height 互斥
            keep_aspect_ratio: 是否保持長寬比（預設 True）
            quality: JPEG/WEBP 品質 (1-100)，預設 95
            svg_scale: SVG 初始縮放倍率（預設 1.0）

        Returns:
            dict: 調整結果資訊
            {
                'success': bool,
                'message': str,
                'original_size': Tuple[int, int],
                'output_size': Tuple[int, int],
                'input_file_size': int,
                'output_file_size': int,
                'scale_factor': Tuple[float, float]
            }

        Raises:
            FileNotFoundError: 輸入檔案不存在
            ValueError: 不支援的圖片格式或無效的參數
        """
        # 驗證輸入檔案
        if not os.path.exists(input_path):
            raise FileNotFoundError(f"輸入檔案不存在: {input_path}")

        # 取得並驗證格式
        input_format = Path(input_path).suffix.lower().lstrip('.')
        output_format = Path(output_path).suffix.lower().lstrip('.')

        if not self._is_valid_input_format(input_format):
            raise ValueError(f"不支援的輸入格式: {input_format}")

        if not self._is_valid_output_format(output_format):
            raise ValueError(f"不支援的輸出格式: {output_format}")

        # 驗證參數
        if scale is not None and (width is not None or height is not None):
            raise ValueError("scale 參數不可與 width/height 同時使用")

        if scale is not None and scale <= 0:
            raise ValueError(f"scale 必須大於 0: {scale}")

        if width is not None and width <= 0:
            raise ValueError(f"width 必須大於 0: {width}")

        if height is not None and height <= 0:
            raise ValueError(f"height 必須大於 0: {height}")

        if width is None and height is None and scale is None:
            raise ValueError("必須指定 width、height 或 scale 其中之一")

        try:
            img = self._open_image(input_path, scale=svg_scale)
            try:
                original_width, original_height = img.size
                input_file_size = os.path.getsize(input_path)

                # 計算目標尺寸
                if scale is not None:
                    # 使用百分比縮放
                    target_width = int(original_width * scale / 100)
                    target_height = int(original_height * scale / 100)
                elif keep_aspect_ratio:
                    # 保持長寬比
                    if width is not None and height is not None:
                        # 兩個都指定時，以較小的縮放比例為準
                        ratio_w = width / original_width
                        ratio_h = height / original_height
                        ratio = min(ratio_w, ratio_h)
                        target_width = int(original_width * ratio)
                        target_height = int(original_height * ratio)
                    elif width is not None:
                        # 只指定寬度
                        ratio = width / original_width
                        target_width = width
                        target_height = int(original_height * ratio)
                    else:
                        # 只指定高度
                        ratio = height / original_height
                        target_width = int(original_width * ratio)
                        target_height = height
                else:
                    # 不保持長寬比
                    target_width = width if width is not None else original_width
                    target_height = height if height is not None else original_height

                # 確保尺寸至少為 1
                target_width = max(1, target_width)
                target_height = max(1, target_height)

                # 執行縮放
                resized_img = img.resize(
                    (target_width, target_height),
                    Image.Resampling.LANCZOS
                )

                # 不支援透明通道的格式
                no_alpha_formats = {'jpg', 'jpeg', 'bmp', 'jp2', 'j2k'}

                # 處理透明通道（RGBA -> RGB）
                if resized_img.mode == 'RGBA' and output_format in no_alpha_formats:
                    rgb_img = Image.new('RGB', resized_img.size, (255, 255, 255))
                    rgb_img.paste(resized_img, mask=resized_img.split()[3])
                    resized_img = rgb_img

                # 儲存圖片
                save_kwargs = {}
                if output_format in self.QUALITY_FORMATS:
                    save_kwargs['quality'] = quality
                    if output_format in ['jpg', 'jpeg', 'webp']:
                        save_kwargs['optimize'] = True

                resized_img.save(output_path, self.SUPPORTED_FORMATS[output_format], **save_kwargs)

                # 取得輸出檔案大小
                output_file_size = os.path.getsize(output_path)

                # 計算縮放因子
                scale_factor_w = target_width / original_width
                scale_factor_h = target_height / original_height

                return {
                    'success': True,
                    'message': f'成功調整尺寸: {input_path} -> {output_path}',
                    'original_size': (original_width, original_height),
                    'output_size': (target_width, target_height),
                    'input_file_size': input_file_size,
                    'output_file_size': output_file_size,
                    'scale_factor': (scale_factor_w, scale_factor_h),
                    'keep_aspect_ratio': keep_aspect_ratio
                }
            finally:
                img.close()

        except Exception as e:
            if isinstance(e, (FileNotFoundError, ValueError)):
                raise
            raise Exception(f"圖片尺寸調整錯誤: {str(e)}")

    def crop_image(
        self,
        input_path: str,
        output_path: str,
        x: int,
        y: int,
        width: int,
        height: int,
        quality: int = 95,
        svg_scale: float = 1.0
    ) -> dict:
        """
        裁切圖片

        Args:
            input_path: 輸入圖片路徑
            output_path: 輸出圖片路徑
            x: 裁切起始點 X 座標（左上角）
            y: 裁切起始點 Y 座標（左上角）
            width: 裁切寬度
            height: 裁切高度
            quality: JPEG/WEBP 品質 (1-100)，預設 95
            svg_scale: SVG 縮放倍率（預設 1.0）

        Returns:
            dict: 裁切結果資訊
            {
                'success': bool,
                'message': str,
                'original_size': Tuple[int, int],
                'crop_box': Tuple[int, int, int, int],
                'output_size': Tuple[int, int],
                'adjusted': bool,
                'adjustment_message': str
            }

        Raises:
            FileNotFoundError: 輸入檔案不存在
            ValueError: 不支援的圖片格式或無效的裁切參數
        """
        # 驗證輸入檔案
        if not os.path.exists(input_path):
            raise FileNotFoundError(f"輸入檔案不存在: {input_path}")

        # 取得並驗證格式
        input_format = Path(input_path).suffix.lower().lstrip('.')
        output_format = Path(output_path).suffix.lower().lstrip('.')

        if not self._is_valid_input_format(input_format):
            raise ValueError(f"不支援的輸入格式: {input_format}")

        if not self._is_valid_output_format(output_format):
            raise ValueError(f"不支援的輸出格式: {output_format}")

        # 驗證基本參數
        if x < 0 or y < 0:
            raise ValueError(f"裁切起始座標不可為負數: x={x}, y={y}")

        if width <= 0 or height <= 0:
            raise ValueError(f"裁切尺寸必須大於 0: width={width}, height={height}")

        try:
            img = self._open_image(input_path, scale=svg_scale)
            try:
                original_width, original_height = img.size
                input_file_size = os.path.getsize(input_path)

                # 邊界檢查與自動調整
                adjusted = False
                adjustment_messages = []

                # 檢查起始座標是否超出圖片範圍
                if x >= original_width:
                    raise ValueError(f"起始座標 X ({x}) 超出圖片寬度 ({original_width})")

                if y >= original_height:
                    raise ValueError(f"起始座標 Y ({y}) 超出圖片高度 ({original_height})")

                # 計算裁切終點
                x2 = x + width
                y2 = y + height

                # 自動調整超出邊界的部分
                if x2 > original_width:
                    old_x2 = x2
                    x2 = original_width
                    adjusted = True
                    adjustment_messages.append(
                        f"寬度自動調整: {width} -> {x2 - x} (超出右邊界 {old_x2 - original_width}px)"
                    )

                if y2 > original_height:
                    old_y2 = y2
                    y2 = original_height
                    adjusted = True
                    adjustment_messages.append(
                        f"高度自動調整: {height} -> {y2 - y} (超出下邊界 {old_y2 - original_height}px)"
                    )

                # 實際裁切區域 (left, upper, right, lower)
                crop_box = (x, y, x2, y2)
                actual_width = x2 - x
                actual_height = y2 - y

                # 執行裁切
                cropped_img = img.crop(crop_box)

                # 不支援透明通道的格式
                no_alpha_formats = {'jpg', 'jpeg', 'bmp', 'jp2', 'j2k'}

                # 處理透明通道（RGBA -> RGB）
                if cropped_img.mode == 'RGBA' and output_format in no_alpha_formats:
                    rgb_img = Image.new('RGB', cropped_img.size, (255, 255, 255))
                    rgb_img.paste(cropped_img, mask=cropped_img.split()[3])
                    cropped_img = rgb_img

                # 儲存圖片
                save_kwargs = {}
                if output_format in self.QUALITY_FORMATS:
                    save_kwargs['quality'] = quality
                    if output_format in ['jpg', 'jpeg', 'webp']:
                        save_kwargs['optimize'] = True

                cropped_img.save(output_path, self.SUPPORTED_FORMATS[output_format], **save_kwargs)

                # 取得輸出檔案大小
                output_file_size = os.path.getsize(output_path)

                return {
                    'success': True,
                    'message': f'成功裁切: {input_path} -> {output_path}',
                    'original_size': (original_width, original_height),
                    'crop_box': crop_box,
                    'output_size': (actual_width, actual_height),
                    'input_file_size': input_file_size,
                    'output_file_size': output_file_size,
                    'adjusted': adjusted,
                    'adjustment_message': '; '.join(adjustment_messages) if adjustment_messages else None
                }
            finally:
                img.close()

        except Exception as e:
            if isinstance(e, (FileNotFoundError, ValueError)):
                raise
            raise Exception(f"圖片裁切錯誤: {str(e)}")

    def rotate_image(
        self,
        input_path: str,
        output_path: str,
        angle: float,
        expand: bool = True,
        fill_color: tuple = (255, 255, 255),
        quality: int = 95,
        svg_scale: float = 1.0
    ) -> dict:
        """
        旋轉圖片

        Args:
            input_path: 輸入圖片路徑
            output_path: 輸出圖片路徑
            angle: 旋轉角度（正值為逆時針，負值為順時針）
            expand: 是否擴展畫布以容納整張圖片（預設 True）
            fill_color: 旋轉後空白區域的填充顏色（預設白色）
            quality: JPEG/WEBP 品質 (1-100)，預設 95
            svg_scale: SVG 縮放倍率（預設 1.0）

        Returns:
            dict: 旋轉結果資訊
            {
                'success': bool,
                'message': str,
                'original_size': Tuple[int, int],
                'output_size': Tuple[int, int],
                'angle': float,
                'expanded': bool
            }

        Raises:
            FileNotFoundError: 輸入檔案不存在
            ValueError: 不支援的圖片格式
        """
        # 驗證輸入檔案
        if not os.path.exists(input_path):
            raise FileNotFoundError(f"輸入檔案不存在: {input_path}")

        # 取得並驗證格式
        input_format = Path(input_path).suffix.lower().lstrip('.')
        output_format = Path(output_path).suffix.lower().lstrip('.')

        if not self._is_valid_input_format(input_format):
            raise ValueError(f"不支援的輸入格式: {input_format}")

        if not self._is_valid_output_format(output_format):
            raise ValueError(f"不支援的輸出格式: {output_format}")

        try:
            img = self._open_image(input_path, scale=svg_scale)
            try:
                original_size = img.size
                input_file_size = os.path.getsize(input_path)

                # 判斷是否為特殊角度（90 的倍數）
                normalized_angle = angle % 360
                is_right_angle = normalized_angle in [0, 90, 180, 270]

                # 執行旋轉
                if is_right_angle and normalized_angle != 0:
                    # 使用 transpose 進行無損 90 度旋轉
                    if normalized_angle == 90:
                        rotated_img = img.transpose(Image.Transpose.ROTATE_90)
                    elif normalized_angle == 180:
                        rotated_img = img.transpose(Image.Transpose.ROTATE_180)
                    elif normalized_angle == 270:
                        rotated_img = img.transpose(Image.Transpose.ROTATE_270)
                elif normalized_angle == 0:
                    rotated_img = img.copy()
                else:
                    # 自訂角度旋轉，使用 expand 避免裁切
                    # 處理透明/半透明背景
                    if img.mode == 'RGBA':
                        rotated_img = img.rotate(
                            angle,
                            expand=expand,
                            resample=Image.Resampling.BICUBIC,
                            fillcolor=(fill_color[0], fill_color[1], fill_color[2], 255)
                        )
                    else:
                        rotated_img = img.rotate(
                            angle,
                            expand=expand,
                            resample=Image.Resampling.BICUBIC,
                            fillcolor=fill_color
                        )

                # 不支援透明通道的格式
                no_alpha_formats = {'jpg', 'jpeg', 'bmp', 'jp2', 'j2k'}

                # 處理透明通道（RGBA -> RGB）
                if rotated_img.mode == 'RGBA' and output_format in no_alpha_formats:
                    rgb_img = Image.new('RGB', rotated_img.size, fill_color)
                    rgb_img.paste(rotated_img, mask=rotated_img.split()[3])
                    rotated_img = rgb_img

                # 儲存圖片
                save_kwargs = {}
                if output_format in self.QUALITY_FORMATS:
                    save_kwargs['quality'] = quality
                    if output_format in ['jpg', 'jpeg', 'webp']:
                        save_kwargs['optimize'] = True

                rotated_img.save(output_path, self.SUPPORTED_FORMATS[output_format], **save_kwargs)

                # 取得輸出檔案大小
                output_file_size = os.path.getsize(output_path)

                return {
                    'success': True,
                    'message': f'成功旋轉: {input_path} -> {output_path}',
                    'original_size': original_size,
                    'output_size': rotated_img.size,
                    'input_file_size': input_file_size,
                    'output_file_size': output_file_size,
                    'angle': angle,
                    'expanded': expand and not is_right_angle
                }
            finally:
                img.close()

        except Exception as e:
            if isinstance(e, (FileNotFoundError, ValueError)):
                raise
            raise Exception(f"圖片旋轉錯誤: {str(e)}")

    def flip_image(
        self,
        input_path: str,
        output_path: str,
        direction: str,
        quality: int = 95,
        svg_scale: float = 1.0
    ) -> dict:
        """
        翻轉圖片

        Args:
            input_path: 輸入圖片路徑
            output_path: 輸出圖片路徑
            direction: 翻轉方向（'horizontal' 或 'vertical'）
            quality: JPEG/WEBP 品質 (1-100)，預設 95
            svg_scale: SVG 縮放倍率（預設 1.0）

        Returns:
            dict: 翻轉結果資訊
            {
                'success': bool,
                'message': str,
                'original_size': Tuple[int, int],
                'direction': str
            }

        Raises:
            FileNotFoundError: 輸入檔案不存在
            ValueError: 不支援的圖片格式或無效的翻轉方向
        """
        # 驗證輸入檔案
        if not os.path.exists(input_path):
            raise FileNotFoundError(f"輸入檔案不存在: {input_path}")

        # 驗證翻轉方向
        direction = direction.lower()
        if direction not in ['horizontal', 'vertical']:
            raise ValueError(f"無效的翻轉方向: {direction}（須為 'horizontal' 或 'vertical'）")

        # 取得並驗證格式
        input_format = Path(input_path).suffix.lower().lstrip('.')
        output_format = Path(output_path).suffix.lower().lstrip('.')

        if not self._is_valid_input_format(input_format):
            raise ValueError(f"不支援的輸入格式: {input_format}")

        if not self._is_valid_output_format(output_format):
            raise ValueError(f"不支援的輸出格式: {output_format}")

        try:
            img = self._open_image(input_path, scale=svg_scale)
            try:
                original_size = img.size
                input_file_size = os.path.getsize(input_path)

                # 執行翻轉
                if direction == 'horizontal':
                    flipped_img = img.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                else:  # vertical
                    flipped_img = img.transpose(Image.Transpose.FLIP_TOP_BOTTOM)

                # 不支援透明通道的格式
                no_alpha_formats = {'jpg', 'jpeg', 'bmp', 'jp2', 'j2k'}

                # 處理透明通道（RGBA -> RGB）
                if flipped_img.mode == 'RGBA' and output_format in no_alpha_formats:
                    rgb_img = Image.new('RGB', flipped_img.size, (255, 255, 255))
                    rgb_img.paste(flipped_img, mask=flipped_img.split()[3])
                    flipped_img = rgb_img

                # 儲存圖片
                save_kwargs = {}
                if output_format in self.QUALITY_FORMATS:
                    save_kwargs['quality'] = quality
                    if output_format in ['jpg', 'jpeg', 'webp']:
                        save_kwargs['optimize'] = True

                flipped_img.save(output_path, self.SUPPORTED_FORMATS[output_format], **save_kwargs)

                # 取得輸出檔案大小
                output_file_size = os.path.getsize(output_path)

                return {
                    'success': True,
                    'message': f'成功翻轉: {input_path} -> {output_path}',
                    'original_size': original_size,
                    'output_size': original_size,  # 翻轉不改變尺寸
                    'input_file_size': input_file_size,
                    'output_file_size': output_file_size,
                    'direction': direction
                }
            finally:
                img.close()

        except Exception as e:
            if isinstance(e, (FileNotFoundError, ValueError)):
                raise
            raise Exception(f"圖片翻轉錯誤: {str(e)}")

    # ==================== Memory First 方法 ====================

    def _open_image_from_bytes(
        self,
        image_bytes: bytes,
        input_format: str,
        svg_scale: float = 1.0
    ) -> Image.Image:
        """
        從 bytes 開啟圖片

        Args:
            image_bytes: 圖片二進位資料
            input_format: 輸入格式（如 'png', 'jpg', 'svg'）
            svg_scale: SVG 縮放倍率

        Returns:
            PIL Image 物件
        """
        if input_format == 'svg':
            if not SVG_SUPPORTED:
                raise ValueError("SVG 格式需要安裝 cairosvg 套件")

            if svg_scale != 1.0:
                png_bytes = cairosvg.svg2png(bytestring=image_bytes, scale=svg_scale)
            else:
                png_bytes = cairosvg.svg2png(bytestring=image_bytes)

            img = Image.open(io.BytesIO(png_bytes))
            return img.copy()
        else:
            img = Image.open(io.BytesIO(image_bytes))
            return img.copy()

    def _save_image_to_bytes(
        self,
        img: Image.Image,
        output_format: str,
        quality: int = 95
    ) -> bytes:
        """
        將圖片儲存為 bytes

        Args:
            img: PIL Image 物件
            output_format: 輸出格式
            quality: 品質參數

        Returns:
            圖片二進位資料
        """
        buffer = io.BytesIO()

        # 不支援透明通道的格式
        no_alpha_formats = {'jpg', 'jpeg', 'bmp', 'jp2', 'j2k'}

        # 處理透明通道
        if img.mode == 'RGBA' and output_format in no_alpha_formats:
            rgb_img = Image.new('RGB', img.size, (255, 255, 255))
            rgb_img.paste(img, mask=img.split()[3])
            img = rgb_img

        # 儲存參數
        save_kwargs = {}
        if output_format in self.QUALITY_FORMATS:
            save_kwargs['quality'] = quality
            if output_format in ['jpg', 'jpeg', 'webp']:
                save_kwargs['optimize'] = True

        # 儲存到 buffer
        pil_format = self.SUPPORTED_FORMATS.get(output_format, 'PNG')
        img.save(buffer, pil_format, **save_kwargs)
        buffer.seek(0)

        return buffer.getvalue()

    def process_image_bytes(
        self,
        image_bytes: bytes,
        input_format: str,
        output_format: Optional[str] = None,
        quality: int = 95,
        # 旋轉參數
        rotate_angle: Optional[float] = None,
        rotate_expand: bool = True,
        # 翻轉參數
        flip_direction: Optional[str] = None,
        # 裁切參數
        crop_x: Optional[int] = None,
        crop_y: Optional[int] = None,
        crop_width: Optional[int] = None,
        crop_height: Optional[int] = None,
        # 縮放參數
        resize_width: Optional[int] = None,
        resize_height: Optional[int] = None,
        resize_scale: Optional[float] = None,
        resize_keep_ratio: bool = True,
        # SVG 參數
        svg_scale: float = 1.0
    ) -> dict:
        """
        在記憶體中處理圖片（Memory First 模式）

        支援的操作會按以下順序執行：
        1. 旋轉
        2. 翻轉
        3. 裁切
        4. 縮放

        Args:
            image_bytes: 輸入圖片的二進位資料
            input_format: 輸入格式（如 'png', 'jpg', 'svg'）
            output_format: 輸出格式（預設與輸入相同，SVG 預設轉 PNG）
            quality: 輸出品質 (1-100)
            rotate_angle: 旋轉角度
            rotate_expand: 旋轉時是否擴展畫布
            flip_direction: 翻轉方向 ('horizontal' 或 'vertical')
            crop_x, crop_y, crop_width, crop_height: 裁切參數
            resize_width, resize_height: 縮放目標尺寸
            resize_scale: 縮放百分比
            resize_keep_ratio: 是否保持長寬比
            svg_scale: SVG 初始縮放倍率

        Returns:
            dict: {
                'success': bool,
                'output_bytes': bytes,
                'original_size': Tuple[int, int],
                'output_size': Tuple[int, int],
                'input_bytes_size': int,
                'output_bytes_size': int,
                'operations_applied': list[str],
                'output_format': str
            }
        """
        input_format = input_format.lower().lstrip('.')

        # 驗證輸入格式
        if not self._is_valid_input_format(input_format):
            raise ValueError(f"不支援的輸入格式: {input_format}")

        # 決定輸出格式
        if output_format:
            output_format = output_format.lower().lstrip('.')
        else:
            output_format = 'png' if input_format == 'svg' else input_format

        # 驗證輸出格式
        if not self._is_valid_output_format(output_format):
            raise ValueError(f"不支援的輸出格式: {output_format}")

        operations_applied = []
        input_bytes_size = len(image_bytes)

        try:
            # 開啟圖片
            img = self._open_image_from_bytes(image_bytes, input_format, svg_scale)
            original_size = img.size

            # 1. 旋轉處理
            if rotate_angle is not None:
                normalized_angle = rotate_angle % 360
                is_right_angle = normalized_angle in [0, 90, 180, 270]

                if is_right_angle and normalized_angle != 0:
                    if normalized_angle == 90:
                        img = img.transpose(Image.Transpose.ROTATE_90)
                    elif normalized_angle == 180:
                        img = img.transpose(Image.Transpose.ROTATE_180)
                    elif normalized_angle == 270:
                        img = img.transpose(Image.Transpose.ROTATE_270)
                elif normalized_angle != 0:
                    fill_color = (255, 255, 255)
                    if img.mode == 'RGBA':
                        img = img.rotate(
                            rotate_angle,
                            expand=rotate_expand,
                            resample=Image.Resampling.BICUBIC,
                            fillcolor=(255, 255, 255, 255)
                        )
                    else:
                        img = img.rotate(
                            rotate_angle,
                            expand=rotate_expand,
                            resample=Image.Resampling.BICUBIC,
                            fillcolor=fill_color
                        )

                operations_applied.append(f"旋轉 {rotate_angle}°")

            # 2. 翻轉處理
            if flip_direction:
                flip_direction = flip_direction.lower()
                if flip_direction not in ['horizontal', 'vertical']:
                    raise ValueError(f"無效的翻轉方向: {flip_direction}")

                if flip_direction == 'horizontal':
                    img = img.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                else:
                    img = img.transpose(Image.Transpose.FLIP_TOP_BOTTOM)

                direction_text = "水平" if flip_direction == "horizontal" else "垂直"
                operations_applied.append(f"{direction_text}翻轉")

            # 3. 裁切處理
            if all(v is not None for v in [crop_x, crop_y, crop_width, crop_height]):
                img_width, img_height = img.size

                # 邊界檢查
                if crop_x >= img_width:
                    raise ValueError(f"裁切起始 X ({crop_x}) 超出圖片寬度 ({img_width})")
                if crop_y >= img_height:
                    raise ValueError(f"裁切起始 Y ({crop_y}) 超出圖片高度 ({img_height})")

                # 自動調整超出邊界
                x2 = min(crop_x + crop_width, img_width)
                y2 = min(crop_y + crop_height, img_height)

                img = img.crop((crop_x, crop_y, x2, y2))
                actual_width = x2 - crop_x
                actual_height = y2 - crop_y
                operations_applied.append(f"裁切 ({crop_x},{crop_y}) {actual_width}x{actual_height}")

            # 4. 縮放處理
            if resize_width or resize_height or resize_scale:
                current_width, current_height = img.size

                if resize_scale is not None:
                    target_width = int(current_width * resize_scale / 100)
                    target_height = int(current_height * resize_scale / 100)
                elif resize_width and resize_height:
                    if resize_keep_ratio:
                        ratio = min(resize_width / current_width, resize_height / current_height)
                        target_width = int(current_width * ratio)
                        target_height = int(current_height * ratio)
                    else:
                        target_width = resize_width
                        target_height = resize_height
                elif resize_width:
                    ratio = resize_width / current_width
                    target_width = resize_width
                    target_height = int(current_height * ratio)
                else:  # resize_height
                    ratio = resize_height / current_height
                    target_width = int(current_width * ratio)
                    target_height = resize_height

                target_width = max(1, target_width)
                target_height = max(1, target_height)

                img = img.resize((target_width, target_height), Image.Resampling.LANCZOS)

                if resize_scale:
                    operations_applied.append(f"縮放 {resize_scale}%")
                else:
                    operations_applied.append(f"調整尺寸 {target_width}x{target_height}")

            # 如果沒有任何操作，記錄格式轉換
            if not operations_applied:
                operations_applied.append(f"格式轉換為 {output_format}")

            # 儲存到 bytes
            output_bytes = self._save_image_to_bytes(img, output_format, quality)
            output_size = img.size

            img.close()

            return {
                'success': True,
                'output_bytes': output_bytes,
                'original_size': original_size,
                'output_size': output_size,
                'input_bytes_size': input_bytes_size,
                'output_bytes_size': len(output_bytes),
                'operations_applied': operations_applied,
                'output_format': output_format
            }

        except Exception as e:
            if isinstance(e, ValueError):
                raise
            raise Exception(f"圖片處理錯誤: {str(e)}")

    def get_image_info_from_bytes(self, image_bytes: bytes, input_format: str) -> dict:
        """
        從 bytes 取得圖片資訊

        Args:
            image_bytes: 圖片二進位資料
            input_format: 輸入格式

        Returns:
            dict: 圖片資訊
        """
        input_format = input_format.lower().lstrip('.')

        img = self._open_image_from_bytes(image_bytes, input_format)
        try:
            return {
                'format': input_format.upper(),
                'mode': img.mode,
                'size': img.size,
                'width': img.width,
                'height': img.height,
                'file_size': len(image_bytes),
                'is_vector': input_format == 'svg'
            }
        finally:
            img.close()
