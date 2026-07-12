import json
import math
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
WIDTH = 1920
HEIGHT = 1080
SCALE_FACTOR = 2
EXTENT = ((18, 20), (WIDTH - 18, HEIGHT - 20))
OUTPUT = ROOT / "exports" / "no_color_map.png"
GEOJSON = ROOT / "data" / "source" / "ne_50m_admin_0_map_units.geojson"

A0 = 0.8707
A1 = -0.131979
A2 = -0.013791
A3 = 0.003971
A4 = -0.001529
B0 = 1.007226
B1 = 0.015085
B2 = -0.044475
B3 = 0.028874
B4 = -0.005916


def natural_earth_raw(lon_degrees, lat_degrees):
    lon = ((lon_degrees - 150 + 180) % 360) - 180
    lam = math.radians(lon)
    phi = math.radians(max(-89.999999, min(89.999999, lat_degrees)))
    phi2 = phi * phi
    phi4 = phi2 * phi2
    phi6 = phi4 * phi2
    phi8 = phi4 * phi4
    x = lam * (A0 + A1 * phi2 + A2 * phi4 + A3 * phi6 + A4 * phi8)
    y = phi * (B0 + B1 * phi2 + B2 * phi4 + B3 * phi6 + B4 * phi8)
    return x, y


def fit_projection():
    samples = []
    for lon in range(-180, 181, 2):
        samples.append(natural_earth_raw(lon, -90))
        samples.append(natural_earth_raw(lon, 90))
    for lat in range(-90, 91, 2):
        samples.append(natural_earth_raw(-180, lat))
        samples.append(natural_earth_raw(180, lat))
    xs = [x for x, _ in samples]
    ys = [y for _, y in samples]
    raw_min_x, raw_max_x = min(xs), max(xs)
    raw_min_y, raw_max_y = min(ys), max(ys)
    (x0, y0), (x1, y1) = EXTENT
    scale = min((x1 - x0) / (raw_max_x - raw_min_x), (y1 - y0) / (raw_max_y - raw_min_y))
    tx = (x0 + x1) / 2 - scale * (raw_min_x + raw_max_x) / 2
    ty = (y0 + y1) / 2 + scale * (raw_min_y + raw_max_y) / 2
    return scale, tx, ty


SCALE, TX, TY = fit_projection()


def project(point):
    x, y = natural_earth_raw(point[0], point[1])
    return (x * SCALE + TX) * SCALE_FACTOR, (-y * SCALE + TY) * SCALE_FACTOR


def polygon_rings(feature):
    geometry = feature.get("geometry") or {}
    coordinates = geometry.get("coordinates") or []
    if geometry.get("type") == "Polygon":
        return coordinates
    if geometry.get("type") == "MultiPolygon":
        return [ring for polygon in coordinates for ring in polygon]
    return []


def split_ring(points):
    projected = [project(point) for point in points]
    parts = []
    current = []
    max_jump = WIDTH * SCALE_FACTOR * 0.45
    for point in projected:
        if current and abs(point[0] - current[-1][0]) > max_jump:
            if len(current) > 1:
                parts.append(current)
            current = [point]
        else:
            current.append(point)
    if len(current) > 1:
        parts.append(current)
    return parts


def main():
    data = json.loads(GEOJSON.read_text(encoding="utf-8"))
    image = Image.new("RGB", (WIDTH * SCALE_FACTOR, HEIGHT * SCALE_FACTOR), "#05070a")
    draw = ImageDraw.Draw(image, "RGBA")

    land_fill = (24, 29, 36, 255)
    border = (225, 230, 236, 150)

    for feature in data["features"]:
        for ring in polygon_rings(feature):
            parts = split_ring(ring)
            if len(parts) == 1 and len(parts[0]) >= 3:
                draw.polygon(parts[0], fill=land_fill)

    for feature in data["features"]:
        for ring in polygon_rings(feature):
            for part in split_ring(ring):
                if len(part) >= 2:
                    draw.line(part, fill=border, width=max(1, round(0.52 * SCALE_FACTOR)), joint="curve")

    image = image.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    image.save(OUTPUT)
    print(OUTPUT)


if __name__ == "__main__":
    main()
