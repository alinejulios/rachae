"""Gera os ícones PNG do app (tela inicial iOS/Android) a partir da marca do Rachaê.

Uso:  python3 scripts/gerar_icones.py
Requer Pillow (pip install pillow).
"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
# Degradê da marca (135°): ciano -> azul elétrico -> azul primário
STOPS = [(0.0, (0, 210, 255)), (0.5, (37, 99, 235)), (1.0, (92, 130, 255))]
# Raio do icon.svg, no viewBox recortado "32 32 448 448"
BOLT = [(292, 96), (168, 284), (260, 284), (220, 416), (344, 228), (252, 228)]
SS = 4  # supersampling para bordas suaves


def cor(t):
    for (t0, c0), (t1, c1) in zip(STOPS, STOPS[1:]):
        if t <= t1:
            k = (t - t0) / (t1 - t0)
            return tuple(round(c0[i] + (c1[i] - c0[i]) * k) for i in range(3))
    return STOPS[-1][1]


def gradient(size):
    """Degradê diagonal, do canto superior esquerdo ao inferior direito."""
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            px[x, y] = cor((x + y) / (2 * (size - 1)))
    return img


def draw_bolt(draw, size, content_ratio):
    # No ícone original o raio ocupa a caixa 448x448 inteira; content_ratio encolhe em volta do centro.
    scale = size * content_ratio / 448
    off = (size - 448 * scale) / 2
    draw.polygon([(off + (x - 32) * scale, off + (y - 32) * scale) for x, y in BOLT], fill="white")


def icon(size, *, rounded, content_ratio):
    big = size * SS
    img = gradient(128).resize((big, big), Image.BICUBIC).convert("RGBA")
    draw_bolt(ImageDraw.Draw(img), big, content_ratio)
    if rounded:
        mask = Image.new("L", (big, big), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, big - 1, big - 1], radius=big * 0.25, fill=255)
        img.putalpha(mask)
    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    # "any": squircle com cantos arredondados, igual ao icon.svg
    icon(192, rounded=True, content_ratio=1.0).save(OUT / "icon-192.png")
    icon(512, rounded=True, content_ratio=1.0).save(OUT / "icon-512.png")
    # "maskable" (Android recorta em círculo/squircle): fundo cheio, raio dentro da zona segura de 80%
    icon(512, rounded=False, content_ratio=0.78).save(OUT / "icon-maskable-512.png")
    # iOS aplica os cantos sozinho e não aceita transparência
    icon(180, rounded=False, content_ratio=0.92).convert("RGB").save(OUT / "apple-touch-icon.png")
    print("Ícones gerados em", OUT)


if __name__ == "__main__":
    main()
