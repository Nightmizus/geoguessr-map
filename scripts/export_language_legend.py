import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
HTML = ROOT / "plonkit_pacific_map.html"
OUTPUT = ROOT / "exports" / "language_legend.png"

WIDTH = 1920
HEIGHT = 1080
BACKGROUND = "#07111d"
TEXT = "#e8eef7"
MUTED = "#9fb0c5"

FONT_REGULAR = Path("C:/Windows/Fonts/msyh.ttc")
FONT_BOLD = Path("C:/Windows/Fonts/msyhbd.ttc")


def language_rows():
    source = HTML.read_text(encoding="utf-8")
    start = source.index("const LANGUAGE_GROUPS = [")
    end = source.index("const LANGUAGE_GROUP_BY_ID", start)
    block = source[start:end]
    rows = re.findall(
        r'id:\s*"[^"]+"\s*,\s*label:\s*"([^"]+)"\s*,\s*mark:\s*"([^"]+)"',
        block,
    )
    if len(rows) != 20:
        raise RuntimeError(f"Expected 20 language rows, found {len(rows)}")
    return rows


def main():
    rows = language_rows()
    image = Image.new("RGB", (WIDTH, HEIGHT), BACKGROUND)
    draw = ImageDraw.Draw(image)

    bold = ImageFont.truetype(str(FONT_BOLD), 34)
    regular = ImageFont.truetype(str(FONT_REGULAR), 32)
    row_height = 48
    top = (HEIGHT - row_height * len(rows)) // 2
    label_right = 1000
    divider_x = 1030
    mark_x = 1080

    for index, (label, mark) in enumerate(rows):
        y = top + index * row_height
        label_box = draw.textbbox((0, 0), label, font=bold)
        label_width = label_box[2] - label_box[0]
        draw.text((label_right - label_width, y), label, font=bold, fill=TEXT)
        draw.text((divider_x, y), "｜", font=regular, fill=MUTED)
        draw.text((mark_x, y), mark, font=regular, fill=TEXT)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    image.save(OUTPUT)
    print(OUTPUT)


if __name__ == "__main__":
    main()
