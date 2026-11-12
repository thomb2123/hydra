"""Generates the 512x512 PNG app icons Vega requires (assets/image/icon.png).

Usage: python3 vega-tv/tools/make_icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
APPS = {
    "vega-poc": ("T", (45, 52, 64), (245, 197, 24)),
    "stremio-vega": ("S", (64, 42, 140), (255, 255, 255)),
    "flixnest-vega": ("F", (17, 19, 21), (90, 200, 250)),
}


def font(size: int) -> ImageFont.ImageFont:
    for name in ("DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def make(app: str, letter: str, background, foreground) -> Path:
    image = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((16, 16, 496, 496), radius=96, fill=background)
    face = font(300)
    box = draw.textbbox((0, 0), letter, font=face)
    width, height = box[2] - box[0], box[3] - box[1]
    draw.text(((512 - width) / 2 - box[0], (512 - height) / 2 - box[1]), letter, font=face, fill=foreground)
    out = ROOT / "apps" / app / "assets" / "image" / "icon.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    image.save(out, optimize=True)
    return out


if __name__ == "__main__":
    for app, (letter, bg, fg) in APPS.items():
        if (ROOT / "apps" / app).exists():
            print(make(app, letter, bg, fg))
