"""Gera os ícones e a tela de abertura do app Android no mesmo estilo do ícone do app."""
from pathlib import Path
from PIL import Image, ImageDraw

RES = Path(__file__).resolve().parent.parent / "frontend" / "android" / "app" / "src" / "main" / "res"
FUNDO, VERMELHO, CINZA = "#16181b", "#c4403a", "#6b7078"


def cartao(d: ImageDraw.ImageDraw, x: float, y: float, s: float):
    """Desenha o cartão do ícone (desenho de 256 px) com escala s a partir de (x, y)."""
    r = lambda a, b, c, e: (x + a * s, y + b * s, x + c * s, y + e * s)
    d.rounded_rectangle(r(44, 72, 212, 184), radius=20 * s, outline=VERMELHO, width=max(1, round(14 * s)))
    d.rectangle(r(44, 100, 212, 120), fill=VERMELHO)
    d.rounded_rectangle(r(68, 144, 116, 158), radius=6 * s, fill=CINZA)


def legado(px: int, redondo: bool) -> Image.Image:
    img = Image.new("RGBA", (px * 4, px * 4), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    S = px * 4
    if redondo:
        d.ellipse((0, 0, S - 1, S - 1), fill=FUNDO)
        cartao(d, S * 0.1, S * 0.1, S * 0.8 / 256)
    else:
        d.rounded_rectangle((0, 0, S - 1, S - 1), radius=S * 56 / 256, fill=FUNDO)
        cartao(d, 0, 0, S / 256)
    return img.resize((px, px), Image.LANCZOS)


def frente(px: int) -> Image.Image:
    # ícone adaptativo: 108 dp, com o desenho dentro da zona segura central (~66 dp)
    S = px * 4
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    lado = S * 72 / 108
    cartao(ImageDraw.Draw(img), (S - lado) / 2, (S - lado) / 2, lado / 256)
    return img.resize((px, px), Image.LANCZOS)


for nome, base in {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}.items():
    pasta = RES / f"mipmap-{nome}"
    legado(base, False).save(pasta / "ic_launcher.png")
    legado(base, True).save(pasta / "ic_launcher_round.png")
    frente(base * 108 // 48).save(pasta / "ic_launcher_foreground.png")

(RES / "values" / "ic_launcher_background.xml").write_text(
    f'<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">{FUNDO}</color>\n</resources>\n',
    encoding="utf-8")

# tela de abertura: fundo do app com o ícone no centro, mantendo o tamanho de cada arquivo
for splash in RES.glob("drawable*/splash.png"):
    w, h = Image.open(splash).size
    img = Image.new("RGB", (w, h), "#0f1012")
    lado = min(w, h) * 0.28
    icone = legado(round(lado), False)
    img.paste(icone, ((w - icone.width) // 2, (h - icone.height) // 2), icone)
    img.save(splash)
print("ok")
