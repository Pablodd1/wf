import json
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont, ImageOps


def fit_image(path, width, height):
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
        image.thumbnail((width, height), Image.Resampling.LANCZOS)
        canvas = Image.new("RGB", (width, height), "white")
        canvas.paste(image, ((width - image.width) // 2, (height - image.height) // 2))
        return canvas


def compact(value, limit):
    text = " ".join(str(value or "").split())
    return text if len(text) <= limit else f"{text[:limit - 1]}…"


def main():
    manifest_path = os.path.abspath(sys.argv[1])
    output_dir = os.path.abspath(sys.argv[2])
    os.makedirs(output_dir, exist_ok=True)
    with open(manifest_path, "r", encoding="utf-8") as handle:
        items = [
            item
            for item in json.load(handle)["items"]
            if item.get("image_status") == "REACHABLE" and item.get("local_image")
        ]

    columns, rows = 4, 3
    image_width, image_height = 280, 280
    label_height = 84
    cell_width, cell_height = image_width, image_height + label_height
    font = ImageFont.load_default(size=16)
    small = ImageFont.load_default(size=13)
    index_rows = []

    for sheet_index in range(math.ceil(len(items) / (columns * rows))):
        page = Image.new("RGB", (columns * cell_width, rows * cell_height), "#E5E7EB")
        draw = ImageDraw.Draw(page)
        page_items = items[sheet_index * columns * rows : (sheet_index + 1) * columns * rows]
        for offset, item in enumerate(page_items):
            x = (offset % columns) * cell_width
            y = (offset // columns) * cell_height
            page.paste(fit_image(item["local_image"], image_width, image_height), (x, y))
            draw.rectangle((x, y + image_height, x + cell_width, y + cell_height), fill="white")
            row_number = item["worksheet_row"]
            reference = item.get("reference") or "NO REF"
            model = item.get("model") or "NO MODEL"
            draw.text((x + 6, y + image_height + 5), f"ROW {row_number} · {reference}", fill="black", font=font)
            draw.text((x + 6, y + image_height + 29), compact(model, 34), fill="#111827", font=small)
            draw.text(
                (x + 6, y + image_height + 50),
                compact(item.get("raw_message"), 43),
                fill="#374151",
                font=small,
            )
            index_rows.append(
                {
                    "sheet": sheet_index + 1,
                    "worksheet_row": row_number,
                    "auction_id": item["auction_id"],
                    "reference": item.get("reference"),
                    "model": item.get("model"),
                    "raw_message": item.get("raw_message"),
                    "image_url": item.get("image_url"),
                }
            )
        target = os.path.join(output_dir, f"zenith-review-{sheet_index + 1:02d}.jpg")
        page.save(target, quality=92, optimize=True)

    with open(os.path.join(output_dir, "sheet-index.json"), "w", encoding="utf-8") as handle:
        json.dump(index_rows, handle, indent=2)
        handle.write("\n")
    print(json.dumps({"items": len(items), "sheets": math.ceil(len(items) / 12), "output": output_dir}))


if __name__ == "__main__":
    main()
