#!/usr/bin/env python3
"""Build the static data files the Korean map site loads.

Inputs (committed snapshots, never modified):
  arcgis_geojson/*.geojson            ISW FeatureServer layers 4, 37, 45, 46, 65, 67
  step2_translation_pack/*.json|csv   Korean narrative + static dictionaries

Outputs (site/data/):
  geo.topo.json   simplified polygons: countries (45), taiwan (4), caspian (46)
  records.json    Korean display records for training events (67, grouped by
                  country), cooperation agreements (65) and Russia Houses (37)

Layer 67 stores one copy of the full country outline per training event
(15 MB). Its outlines are the layer 45 outlines, so the events are joined to
layer 45 by the (unique) COUNTRY name and shipped without geometry.
"""
from __future__ import annotations

import csv
import json
import re
import subprocess
import sys
import tempfile
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "arcgis_geojson"
PACK = ROOT / "step2_translation_pack"
OUT = ROOT / "site" / "data"

# Field order matches the pie chart in ISW's popup configuration.
PROGRAM_FIELDS = ["InterNovosti", "InteRussia", "New_Media_Workshop", "RT_Academy", "RT_School", "SputnikPro"]
PROGRAM_NAMES = ["InterNovosti", "InteRussia", "New Media Workshop", "RT Academy", "RT School", "SputnikPro"]
MONTHS = {m: i for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}


def normalize(value) -> str:
    value = unicodedata.normalize("NFC", str(value or "")).replace(" ", " ")
    return re.sub(r"\s+", " ", value).strip()


def load(name: str) -> list[dict]:
    path = next(SRC.glob(f"{name}_*.geojson"))
    return json.loads(path.read_text(encoding="utf-8"))["features"]


def format_date(value) -> str:
    """'07/2026' -> '2026년 7월', 'Sep-25' -> '2025년 9월'; anything else as-is."""
    s = normalize(value)
    if m := re.fullmatch(r"(\d{1,2})/(\d{4})", s):
        return f"{m[2]}년 {int(m[1])}월"
    if (m := re.fullmatch(r"([A-Za-z]{3})-(\d{2})", s)) and m[1].title() in MONTHS:
        return f"20{m[2]}년 {MONTHS[m[1].title()]}월"
    return s


class Translator:
    def __init__(self) -> None:
        self.narrative: dict[str, str] = {}
        with (PACK / "translation_manifest.csv").open(encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                src, ko = normalize(row.get("source_text")), (row.get("ko") or "").strip()
                if src and ko:
                    self.narrative[src] = ko
        self.static = json.loads((PACK / "static_ko.json").read_text(encoding="utf-8"))
        self.missing: set[str] = set()

    def text(self, value) -> str:
        src = normalize(value)
        if not src:
            return ""
        if src not in self.narrative:
            self.missing.add(src)
            return src
        return self.narrative[src]

    def term(self, group: str, value) -> str:
        src = normalize(value)
        return self.static.get(group, {}).get(src, src)

    def country(self, value) -> str:
        return self.term("countryNames", value)


def clean(record: dict) -> dict:
    """Drop empty values to keep records.json small."""
    return {k: v for k, v in record.items() if v not in ("", None, [])}


def main() -> None:
    tr = Translator()
    OUT.mkdir(parents=True, exist_ok=True)

    # Countries (45): index each outline so layer 67 can be joined to it.
    countries = load("45")
    index_by_name = {f["properties"]["COUNTRY"]: i for i, f in enumerate(countries)}
    if len(index_by_name) != len(countries):
        sys.exit("Layer 45 COUNTRY names are not unique")
    country_rows = [clean({"n": tr.country(f["properties"]["COUNTRY"]),
                           "e": normalize(f["properties"]["COUNTRY"])}) for f in countries]

    # Training events (67): group by country outline.
    events: dict[int, list] = {}
    programs: dict[int, list[int]] = {}
    for f in load("67"):
        p = f["properties"]
        i = index_by_name.get(p["COUNTRY"])
        if i is None:
            sys.exit(f"Layer 67 OBJECTID {p['OBJECTID']} has no matching country outline")
        counts = [int(p.get(k) or 0) for k in PROGRAM_FIELDS]
        if any(counts):
            programs[i] = counts
        if not normalize(p.get("Blurb")):
            continue  # placeholder row for a country with no recorded events
        events.setdefault(i, []).append(clean({
            "b": tr.text(p.get("Blurb")),
            "ap": tr.text(p.get("Associated_People")),
            "ac": tr.text(p.get("Additional_Context")),
            "org": tr.term("russianOrganizations", p.get("Russian_Organization")),
            "prog": tr.term("programs", p.get("Russian_Program")),
            "partner": normalize(p.get("Partner_Organization__if_applicable_")),
            "date": format_date(p.get("Date_Held")),
            "loc": tr.term("locations", p.get("Location")),
            "fmt": tr.term("formats", p.get("Format")),
            "src": normalize(p.get("Source")),
            "tc": tr.country(p.get("Target_Country")),
            "_sort": p.get("Event__") or 0,
        }))
    for rows in events.values():
        rows.sort(key=lambda r: r.pop("_sort"), reverse=True)
    for i, rows in events.items():
        if len(rows) != max(sum(programs.get(i, [])), len(rows)):
            print(f"note: {country_rows[i]['e']}: {len(rows)} events, program total {sum(programs.get(i, []))}")

    # Cooperation agreements (65). Draw order follows the source (OBJECTID).
    agreements = []
    for f in load("65"):
        p = f["properties"]
        lon, lat = f["geometry"]["coordinates"][:2]
        agreements.append(clean({
            "x": round(lon, 5), "y": round(lat, 5),
            "t": "brics" if p.get("BRICS_") == "Y" else "ru",
            "b": tr.text(p.get("Blurb")),
            "country": tr.country(p.get("Country_Name")),
            "org": tr.term("russianOrganizations", p.get("Russian_Organization")),
            "partner": normalize(p.get("Partner_Organization")),
            "date": format_date(p.get("Date_Signed")),
            "src": normalize(p.get("Source")),
        }))

    # Russia Houses (37).
    houses = []
    for f in load("37"):
        p = f["properties"]
        lon, lat = f["geometry"]["coordinates"][:2]
        houses.append(clean({
            "x": round(lon, 5), "y": round(lat, 5),
            "country": tr.country(p.get("Country")),
            "addr": normalize(p.get("RU_House_Address")),
            "src": normalize(p.get("Source")),
            "url": normalize(p.get("Russia_House_Handle_or_URL")),
        }))

    records = {
        "programs": [tr.term("programs", n) for n in PROGRAM_NAMES],
        "countries": country_rows,
        "events": {str(k): v for k, v in sorted(events.items())},
        "programCounts": {str(k): v for k, v in sorted(programs.items())},
        "agreements": agreements,
        "houses": houses,
    }
    (OUT / "records.json").write_text(
        json.dumps(records, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # Geometry: tag countries with their index, then simplify with mapshaper.
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        for i, f in enumerate(countries):
            f["properties"] = {"i": i}
        layers = {"countries": countries,
                  "taiwan": [dict(f, properties={}) for f in load("04")],
                  "caspian": [dict(f, properties={}) for f in load("46")]}
        inputs = []
        for name, feats in layers.items():
            path = tmp / f"{name}.json"
            path.write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
            inputs.append(str(path))
        subprocess.run(
            ["npx", "--no-install", "mapshaper", "-i", *inputs, "combine-files",
             "-simplify", "weighted", "8%", "keep-shapes",
             "-o", str(OUT / "geo.topo.json"), "format=topojson", "quantization=1e5",
             "target=*"],
            check=True, cwd=ROOT)

    total = sum(len(v) for v in events.values())
    print(f"countries={len(country_rows)} events={total} in {len(events)} countries "
          f"agreements={len(agreements)} houses={len(houses)}")
    if tr.missing:
        print(f"WARNING: {len(tr.missing)} narrative strings have no Korean translation (shown in English):")
        for s in sorted(tr.missing):
            print("  -", s[:100])


if __name__ == "__main__":
    main()
