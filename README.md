# 러시아의 인지전 인프라 — 인터랙티브 지도 (한국어판)

Korean edition of ISW's interactive map
[*Russia's Cognitive Warfare Infrastructure*](https://experience.arcgis.com/experience/4a6cab62740646d48b36cbbce9d47814/page/Page),
translated and published with ISW's permission. It is built without Esri ArcGIS:
a static site (D3 + SVG, Robinson projection) that GitHub Pages can host as is.

## Layout

| Path | Contents |
|---|---|
| `site/` | The published website (HTML/CSS/JS, data, marker icons, vendored libraries) |
| `site/data/geo.topo.json` | Simplified country, Taiwan and Caspian Sea outlines (layers 45, 4, 46) |
| `site/data/records.json` | Korean display records: training events (67), cooperation agreements (65), Russia Houses (37) |
| `arcgis_geojson/` | Saved copies of the ISW FeatureServer layers (source data, unmodified) |
| `step2_translation_pack/` | Korean translations (narrative strings + static dictionaries) |
| `scripts/` | Build scripts that turn the two folders above into `site/data/` |

The build shrinks the 24 MB of source GeoJSON to about 0.5 MB. Layer 67 repeats a full country
outline for every training event, so events are joined to the countries layer (45) by `COUNTRY`
name and shipped without geometry.

## Rebuild the data

Needed only when the source GeoJSON or translations change. Requires Python 3 and Node 18+.

```bash
npm install
npm run build     # writes site/data/* and site/vendor/*
npm run serve     # http://localhost:8000
```

The build prints a warning listing any narrative string that has no Korean translation
(it is then shown in English). Add the translation to
`step2_translation_pack/translation_manifest.csv` and rebuild.

## Publish on GitHub Pages

1. Merge into `main`.
2. Repository **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The `Deploy to GitHub Pages` workflow publishes `site/` on every push to `main` that touches it
   (or run it manually from the Actions tab).

The site is served at `https://<owner>.github.io/<repo>/`. No server, database or
third-party hosting is needed.

## Notes

- Symbology (colors, class breaks, marker icons), popup contents and layer order follow
  ISW's web map configuration. Training-event popups additionally show the translated
  *관련 인물* (Associated People) and *추가 설명* (Additional Context) fields and the event
  location/format.
- Source URLs are shown exactly as ISW publishes them (deliberately defanged, e.g. `dot`),
  so they are not clickable.
- Partner organization names, street addresses and analyst names are kept in their original
  spelling.
