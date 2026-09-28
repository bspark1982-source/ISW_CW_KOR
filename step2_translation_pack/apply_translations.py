#!/usr/bin/env python3
"""Overlay Korean translations onto local GeoJSON while preserving source data.

Expected files in --input-dir: layer_65.geojson, layer_37.geojson, etc.
The source GeoJSON is never modified. Korean narrative values are added as
Blurb_ko, Additional_Context_ko, Associated_People_ko. Known static terms are
localized from static_ko.json. Untranslated strings remain absent in *_ko so
that the frontend can intentionally fall back to English.
"""
from __future__ import annotations
import argparse
import csv
import json
import re
import unicodedata
from pathlib import Path

TEXT_FIELDS = ("Blurb", "Additional_Context", "Associated_People")
COUNTRY_FIELDS = ("COUNTRY", "COUNTRYAFF", "Country", "Country_Name", "Region", "Target_Country", "World_Countries_Equivalent")
STATIC_FIELDS = {
    "Location": "locations",
    "Russian_Organization": "russianOrganizations",
    "Russian_Program": "programs",
    "Format": "formats",
}

def normalize(value) -> str:
    value = unicodedata.normalize("NFC", str(value or "")).replace("\u00a0", " ")
    return re.sub(r"\s+", " ", value).strip()

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input-dir", type=Path, required=True)
    ap.add_argument("--output-dir", type=Path, required=True)
    ap.add_argument("--manifest", type=Path, default=Path("translation_manifest.csv"))
    ap.add_argument("--static", type=Path, default=Path("static_ko.json"))
    args = ap.parse_args()
    if not args.input_dir.is_dir():
        raise SystemExit(f"Input directory not found: {args.input_dir}")
    if not args.manifest.is_file():
        raise SystemExit(f"Translation manifest not found: {args.manifest}")
    if not args.static.is_file():
        raise SystemExit(f"Static translation file not found: {args.static}")

    translations = {}
    with args.manifest.open("r", encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            ko = (row.get("ko") or "").strip()
            src = normalize(row.get("source_text"))
            if src and ko:
                translations[src] = ko
    static = json.loads(args.static.read_text(encoding="utf-8"))
    country_names = static.get("countryNames", {})
    layer_names = static.get("layers", {})
    args.output_dir.mkdir(parents=True, exist_ok=True)

    files = sorted(args.input_dir.glob("*.geojson"))
    if not files:
        raise SystemExit(f"No .geojson files found in {args.input_dir}")
    total_features = 0
    translated_cells = 0
    missing_narrative = set()
    for path in files:
        data = json.loads(path.read_text(encoding="utf-8"))
        features = data.get("features")
        if not isinstance(features, list):
            print(f"Skip (not a FeatureCollection): {path.name}")
            continue
        for feature in features:
            props = feature.setdefault("properties", {})
            total_features += 1
            layer_id = normalize(props.get("_LayerID"))
            if layer_id and layer_id in layer_names:
                props["_LayerName_ko"] = layer_names[layer_id]
                translated_cells += 1
            for field in TEXT_FIELDS:
                src = normalize(props.get(field))
                if not src:
                    continue
                ko = translations.get(src)
                if ko:
                    props[f"{field}_ko"] = ko
                    translated_cells += 1
                else:
                    missing_narrative.add(src)
            for field in COUNTRY_FIELDS:
                src = normalize(props.get(field))
                if src and src in country_names:
                    props[f"{field}_ko"] = country_names[src]
                    translated_cells += 1
            for field, static_key in STATIC_FIELDS.items():
                src = normalize(props.get(field))
                ko = static.get(static_key, {}).get(src)
                if src and ko:
                    props[f"{field}_ko"] = ko
                    translated_cells += 1
        out = args.output_dir / path.name
        out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"Wrote {out}")
    print(f"Features processed: {total_features}")
    print(f"Korean fields added: {translated_cells}")
    print(f"Narrative strings still untranslated: {len(missing_narrative)}")

if __name__ == "__main__":
    main()
