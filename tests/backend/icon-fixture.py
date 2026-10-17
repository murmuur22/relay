from PIL import Image
import sys
Image.new('RGB', (32, 32), (12, 34, 56)).save(sys.stdout.buffer, format='PNG')
