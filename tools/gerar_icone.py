"""Gera icon.ico (usado no .exe) no mesmo estilo do ícone do app."""
from PIL import Image, ImageDraw

S = 256
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle((0, 0, S - 1, S - 1), radius=56, fill="#16181b")
d.rounded_rectangle((44, 72, 212, 184), radius=20, outline="#c4403a", width=14)
d.rectangle((44, 100, 212, 120), fill="#c4403a")
d.rounded_rectangle((68, 144, 116, 158), radius=6, fill="#6b7078")
img.save("icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
