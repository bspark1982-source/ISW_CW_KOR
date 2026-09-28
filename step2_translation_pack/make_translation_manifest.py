#!/usr/bin/env python3
"""Extract unique narrative strings from the combined ArcGIS CSV.

Usage:
  python make_translation_manifest.py ALL_LAYERS_COMBINED.csv translation_manifest.csv

Only narrative fields are included. Geometry, IDs, dates, numeric attributes,
URLs and other machine-facing fields are deliberately excluded.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
import re
import unicodedata
from collections import OrderedDict
from pathlib import Path

TEXT_FIELDS = ("Blurb", "Additional_Context", "Associated_People")

def normalize(value: str) -> str:
    value = unicodedata.normalize("NFC", value or "")
    value = value.replace("\u00a0", " ")
    return re.sub(r"\s+", " ", value).strip()

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("input_csv", type=Path)
    ap.add_argument("output_csv", type=Path)
    ap.add_argument("--batch-size", type=int, default=40)
    args = ap.parse_args()
    if args.batch_size < 1:
        ap.error("--batch-size must be >= 1")

    # Preserve existing approved translations when regenerating after data updates.
    existing_ko = {}
    if args.output_csv.exists():
        with args.output_csv.open("r", encoding="utf-8-sig", newline="") as old:
            for row in csv.DictReader(old):
                key = normalize(row.get("source_text", ""))
                ko = (row.get("ko") or "").strip()
                if key and ko:
                    existing_ko[key] = ko

    entries = OrderedDict()
    with args.input_csv.open("r", encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            layer_id = (row.get("_LayerID") or "").strip()
            layer_name = (row.get("_LayerName") or "").strip()
            for field in TEXT_FIELDS:
                source = (row.get(field) or "").strip()
                key = normalize(source)
                if not key:
                    continue
                if key not in entries:
                    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]
                    entries[key] = {
                        "translation_id": f"t_{digest}",
                        "source_text": source.replace("\u00a0", " "),
                        "ko": existing_ko.get(key, ""),
                        "source_fields": set(),
                        "layer_ids": set(),
                        "layer_names": set(),
                        "occurrences": 0,
                    }
                e = entries[key]
                e["source_fields"].add(field)
                if layer_id:
                    e["layer_ids"].add(layer_id)
                if layer_name:
                    e["layer_names"].add(layer_name)
                e["occurrences"] += 1

    args.output_csv.parent.mkdir(parents=True, exist_ok=True)
    fields = ["translation_id", "source_text", "ko", "source_fields", "layer_ids", "layer_names", "occurrences", "batch"]
    with args.output_csv.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for i, e in enumerate(entries.values()):
            writer.writerow({
                "translation_id": e["translation_id"],
                "source_text": e["source_text"],
                "ko": e["ko"],
                "source_fields": ";".join(sorted(e["source_fields"])),
                "layer_ids": ";".join(sorted(e["layer_ids"])),
                "layer_names": ";".join(sorted(e["layer_names"])),
                "occurrences": e["occurrences"],
                "batch": f"B{i // args.batch_size + 1:03d}",
            })
    print(f"Unique narrative strings: {len(entries)}")
    print(f"Batches ({args.batch_size} strings max): {(len(entries) + args.batch_size - 1) // args.batch_size}")
    print(f"Wrote: {args.output_csv}")

if __name__ == "__main__":
    main()
