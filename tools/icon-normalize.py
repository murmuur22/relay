"""Bounded stdin raster -> metadata-free PNG; no filesystem/user paths."""
import io
import sys
import warnings
from PIL import Image

Image.MAX_IMAGE_PIXELS = 4_000_000
warnings.simplefilter('error', Image.DecompressionBombWarning)
try:
    data = sys.stdin.buffer.read(1_048_577)
    if not data or len(data) > 1_048_576:
        raise ValueError()
    expected = {'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/webp': 'WEBP'}[sys.argv[1]]
    with Image.open(io.BytesIO(data)) as source:
        if source.format != expected or source.width * source.height > 4_000_000 or getattr(source, 'n_frames', 1) != 1:
            raise ValueError()
        source.load()
        source.thumbnail((128, 128), Image.Resampling.LANCZOS)
        # A fresh image excludes EXIF, ICC, text and other source metadata.
        clean = Image.new('RGBA', source.size)
        clean.paste(source.convert('RGBA'))
        clean.save(sys.stdout.buffer, format='PNG')
except Exception:
    sys.exit(1)
