"""Gera os ícones PNG do app (tela inicial iOS/Android) a partir da marca do Rachaê.

Uso:  python3 scripts/gerar_icones.py
Requer Pillow (pip install pillow).
"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
BLUE = (47, 111, 237)
AQUA = (15, 180, 176)
SS = 4  # supersampling para bordas suaves


def gradient(size):
    """Degradê diagonal azul -> verde-água (155°, como no CSS)."""
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (0.35 * x / size + 0.65 * y / size)
            px[x, y] = tuple(round(BLUE[i] + (AQUA[i] - BLUE[i]) * t) for i in range(3))
    return img


def draw_bolt(draw, size, scale):
    # Mesmo traço do SVG (viewBox 48): M20 7 L27 19 L18 22 L28 41
    pts = [(20, 7), (27, 19), (18, 22), (28, 41)]
    off = (size - 48 * scale) / 2
    p = [(off + x * scale, off + y * scale) for x, y in pts]
    w = round(5.5 * scale)
    draw.line(p, fill="white", width=w, joint="curve")
    r = w / 2
    for x, y in (p[0], p[-1]):
        draw.ellipse([x - r, y - r, x + r, y + r], fill="white")


def icon(size, *, rounded, content_ratio):
    big = size * SS
    img = gradient(64).resize((big, big), Image.BICUBIC).convert("RGBA")
    draw_bolt(ImageDraw.Draw(img), big, big * content_ratio / 48)
    if rounded:
        mask = Image.new("L", (big, big), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, big - 1, big - 1], radius=big * 0.22, fill=255)
        img.putalpha(mask)
    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    # "any": cantos arredondados, traço ocupando bem o ícone
    icon(192, rounded=True, content_ratio=0.62).save(OUT / "icon-192.png")
    icon(512, rounded=True, content_ratio=0.62).save(OUT / "icon-512.png")
    # "maskable" (Android recorta em círculo/squircle): fundo cheio, traço dentro da zona segura de 80%
    icon(512, rounded=False, content_ratio=0.46).save(OUT / "icon-maskable-512.png")
    # iOS aplica os cantos sozinho e não aceita transparência
    icon(180, rounded=False, content_ratio=0.58).convert("RGB").save(OUT / "apple-touch-icon.png")
    print("Ícones gerados em", OUT)


if __name__ == "__main__":
    main()
