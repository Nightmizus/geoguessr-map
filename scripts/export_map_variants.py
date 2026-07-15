import json
import re
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

from export_no_color_map import (
    HEIGHT,
    ROOT,
    SCALE_FACTOR,
    WIDTH,
    polygon_rings,
    split_ring,
)


HTML = ROOT / "index.html"
INDEX = ROOT / "data" / "source" / "plonkit_map_index.json"
GEOJSON = ROOT / "data" / "source" / "ne_50m_admin_0_map_units.geojson"
OUTPUT_DRIVING = ROOT / "exports" / "driving_side_map.png"
OUTPUT_LANGUAGE = ROOT / "exports" / "driving_side_language_map.png"

OCEAN = "#07111d"
LAND = "#263448"
RIGHT_DRIVE = "#ef4444"
LEFT_DRIVE = "#3b82f6"
BORDER = (216, 230, 248, 148)
PATTERN_OPACITY = 158

PATTERNS = {
    "english": ("horizontal", "#111827"),
    "russian": ("vertical", "#111827"),
    "french": ("plus", "#1d4ed8"),
    "italian": ("dots", "#15803d"),
    "german": ("checker", "#111827"),
    "iberian": ("diagonal", "#b91c1c"),
    "dutch_lowland": ("wave", "#ea580c"),
    "nordic": ("nordic_cross", "#2563eb"),
    "baltic_finnic": ("triangles", "#0f766e"),
    "slavic_other": ("back_diagonal", "#7e22ce"),
    "balkan_greek": ("meander", "#4338ca"),
    "arabic_middle_east": ("arc", "#92400e"),
    "turkic_central_asia": ("diamonds", "#be123c"),
    "south_asian": ("diamond_grid", "#d97706"),
    "southeast_asian": ("zigzag", "#16a34a"),
    "african_local": ("crosses", "#27272a"),
    "pacific_creole": ("waves", "#0891b2"),
}


def extract_js_block(source, declaration):
    start = source.index(declaration) + len(declaration)
    end = source.index("};", start)
    return source[start:end]


def load_page_settings():
    source = HTML.read_text(encoding="utf-8")
    left_match = re.search(
        r"const LEFT_DRIVE_CODES = new Set\(\[(.*?)\]\);",
        source,
        re.S,
    )
    if not left_match:
        raise RuntimeError("LEFT_DRIVE_CODES was not found")
    left_drive = set(re.findall(r'"([A-Z0-9_]+)"', left_match.group(1)))

    language_block = extract_js_block(source, "const LANGUAGE_BY_CODE = {")
    languages = {}
    for code, values in re.findall(r"([A-Z0-9_]+):\s*\[([^\]]*)\]", language_block):
        ids = re.findall(r'"([a-z_]+)"', values)
        if ids:
            languages[code] = ids[0]
    return left_drive, languages


def feature_code(feature):
    properties = feature.get("properties") or {}
    for key in ("ADM0_A3", "ISO_A3", "GU_A3", "SU_A3", "BRK_A3", "SOV_A3"):
        value = properties.get(key)
        if value and value != "-99":
            return value
    return ""


def draw_feature(mask, feature, fill=255):
    draw = ImageDraw.Draw(mask)
    for ring in polygon_rings(feature):
        parts = split_ring(ring)
        if len(parts) == 1 and len(parts[0]) >= 3:
            draw.polygon(parts[0], fill=fill)


def feature_mask(features, predicate):
    size = (WIDTH * SCALE_FACTOR, HEIGHT * SCALE_FACTOR)
    mask = Image.new("L", size, 0)
    for feature in features:
        if predicate(feature):
            draw_feature(mask, feature)
    return mask


def alaska_mask(features):
    size = (WIDTH * SCALE_FACTOR, HEIGHT * SCALE_FACTOR)
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    for feature in features:
        if feature_code(feature) != "USA":
            continue
        geometry = feature.get("geometry") or {}
        polygons = geometry.get("coordinates") or []
        if geometry.get("type") == "Polygon":
            polygons = [polygons]
        for polygon in polygons:
            points = [point for ring in polygon for point in ring]
            if not points:
                continue
            longitudes = [point[0] for point in points]
            latitudes = [point[1] for point in points]
            if max(latitudes) <= 50 or (min(longitudes) >= -128 and max(longitudes) <= 170):
                continue
            for ring in polygon:
                parts = split_ring(ring)
                if len(parts) == 1 and len(parts[0]) >= 3:
                    draw.polygon(parts[0], fill=255)
    return mask


def apply_solid(image, color, mask):
    layer = Image.new("RGBA", image.size, color)
    layer.putalpha(mask)
    return Image.alpha_composite(image, layer)


def pattern_tile(kind, color):
    size = 42
    stroke = 6
    tile = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(tile)
    rgba = (*Image.new("RGB", (1, 1), color).getpixel((0, 0)), PATTERN_OPACITY)

    if kind == "horizontal":
        draw.line((0, 12, size, 12), fill=rgba, width=stroke)
        draw.line((0, 30, size, 30), fill=rgba, width=stroke)
    elif kind == "vertical":
        draw.line((12, 0, 12, size), fill=rgba, width=stroke)
        draw.line((30, 0, 30, size), fill=rgba, width=stroke)
    elif kind == "diagonal":
        draw.line((-12, size, size, -12), fill=rgba, width=stroke)
        draw.line((0, size + 12, size + 12, 0), fill=rgba, width=stroke)
    elif kind == "back_diagonal":
        draw.line((-12, 0, size, size + 12), fill=rgba, width=stroke)
        draw.line((0, -12, size + 12, size), fill=rgba, width=stroke)
    elif kind == "checker":
        draw.rectangle((0, 0, 20, 20), fill=rgba)
        draw.rectangle((21, 21, 41, 41), fill=rgba)
    elif kind == "dots":
        draw.ellipse((6, 6, 18, 18), fill=rgba)
        draw.ellipse((27, 27, 39, 39), fill=rgba)
    elif kind == "plus":
        draw.line((21, 6, 21, 36), fill=rgba, width=stroke)
        draw.line((6, 21, 36, 21), fill=rgba, width=stroke)
    elif kind == "nordic_cross":
        draw.rectangle((12, 0, 20, 42), fill=rgba)
        draw.rectangle((0, 18, 42, 26), fill=rgba)
    elif kind == "triangles":
        draw.line((21, 3, 39, 36, 3, 36, 21, 3), fill=rgba, width=stroke, joint="curve")
    elif kind in ("diamonds", "diamond_grid"):
        draw.line((21, 3, 39, 21, 21, 39, 3, 21, 21, 3), fill=rgba, width=stroke, joint="curve")
    elif kind == "zigzag":
        draw.line((-3, 24, 9, 12, 21, 24, 33, 12, 45, 24), fill=rgba, width=stroke, joint="curve")
    elif kind == "crosses":
        draw.line((9, 9, 33, 33), fill=rgba, width=stroke)
        draw.line((33, 9, 9, 33), fill=rgba, width=stroke)
    else:
        draw.arc((-3, 6, 27, 36), 190, 350, fill=rgba, width=stroke)
        draw.arc((18, 6, 48, 36), 10, 170, fill=rgba, width=stroke)
    return tile


def tiled_pattern(size, kind, color):
    tile = pattern_tile(kind, color)
    pattern = Image.new("RGBA", size, (0, 0, 0, 0))
    for y in range(0, size[1], tile.height):
        for x in range(0, size[0], tile.width):
            pattern.paste(tile, (x, y), tile)
    return pattern


def apply_pattern(image, mask, kind, color):
    pattern = tiled_pattern(image.size, kind, color)
    alpha = ImageChops.multiply(pattern.getchannel("A"), mask)
    pattern.putalpha(alpha)
    return Image.alpha_composite(image, pattern)


def draw_borders(image, features):
    draw = ImageDraw.Draw(image, "RGBA")
    width = max(1, round(0.52 * SCALE_FACTOR))
    for feature in features:
        for ring in polygon_rings(feature):
            for part in split_ring(ring):
                if len(part) >= 2:
                    draw.line(part, fill=BORDER, width=width, joint="curve")


def main():
    data = json.loads(GEOJSON.read_text(encoding="utf-8"))
    index = json.loads(INDEX.read_text(encoding="utf-8"))
    features = data["features"]
    target_codes = set(index["redCodes"])
    target_codes.discard("CHN")
    left_drive, languages = load_page_settings()
    size = (WIDTH * SCALE_FACTOR, HEIGHT * SCALE_FACTOR)

    base = Image.new("RGBA", size, OCEAN)
    land_mask = feature_mask(features, lambda feature: True)
    base = apply_solid(base, LAND, land_mask)

    right_mask = feature_mask(
        features,
        lambda feature: feature_code(feature) in target_codes
        and feature_code(feature) not in left_drive,
    )
    excluded_alaska_mask = alaska_mask(features)
    right_mask = ImageChops.subtract(right_mask, excluded_alaska_mask)
    left_mask = feature_mask(
        features,
        lambda feature: feature_code(feature) in target_codes
        and feature_code(feature) in left_drive
        and feature_code(feature) != "IND",
    )
    india_mask = feature_mask(features, lambda feature: feature_code(feature) == "IND")
    china_mask = feature_mask(features, lambda feature: feature_code(feature) == "CHN")
    india_mask = ImageChops.subtract(india_mask, china_mask)
    left_mask = ImageChops.lighter(left_mask, india_mask)

    driving = apply_solid(base, RIGHT_DRIVE, right_mask)
    driving = apply_solid(driving, LEFT_DRIVE, left_mask)
    draw_borders(driving, features)

    language = apply_solid(base, RIGHT_DRIVE, right_mask)
    language = apply_solid(language, LEFT_DRIVE, left_mask)
    for language_id, (kind, color) in PATTERNS.items():
        language_mask = feature_mask(
            features,
            lambda feature, language_id=language_id: (
                feature_code(feature) in target_codes
                and languages.get(feature_code(feature)) == language_id
                and feature_code(feature) != "IND"
            ),
        )
        if languages.get("IND") == language_id:
            language_mask = ImageChops.lighter(language_mask, india_mask)
        language_mask = ImageChops.subtract(language_mask, excluded_alaska_mask)
        language = apply_pattern(language, language_mask, kind, color)
    draw_borders(language, features)

    OUTPUT_DRIVING.parent.mkdir(parents=True, exist_ok=True)
    driving.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS).convert("RGB").save(OUTPUT_DRIVING)
    language.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS).convert("RGB").save(OUTPUT_LANGUAGE)
    print(OUTPUT_DRIVING)
    print(OUTPUT_LANGUAGE)


if __name__ == "__main__":
    main()
