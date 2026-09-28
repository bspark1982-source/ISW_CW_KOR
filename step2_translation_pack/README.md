# Korean localization pack — Step 2

This pack separates Korean display strings from source attributes. It does not alter geometry, IDs, source URLs, timestamps or numeric attributes.

The supplied combined CSV contains 911 rows. Its three narrative fields contain 708 non-empty text cells, but only 449 distinct normalized strings. The pack includes Korean translations for all 449; this reduced the text submitted for translation from 125,462 to 64,604 characters (48.5% fewer characters).

## Files

- `translation_manifest.csv`: unique narrative strings from `Blurb`, `Additional_Context` and `Associated_People`. Fill the `ko` column with approved Korean translations. Each string is listed once even if it appears in multiple records/layers.
- `static_ko.json`: Korean layer/field labels and reusable country, location, organization, program and format terms.
- `make_translation_manifest.py`: regenerates the deduplicated translation CSV from `ALL_LAYERS_COMBINED.csv` after data updates.
- `apply_translations.py`: overlays translated values as `*_ko` properties on local GeoJSON files without replacing the English source properties.

## Apply to GeoJSON

Place the six source files in a folder, with `.geojson` extensions. Names may vary; the script processes every GeoJSON file in the folder.

```bash
python apply_translations.py \
  --input-dir ./geojson \
  --output-dir ./geojson_ko \
  --manifest ./translation_manifest.csv \
  --static ./static_ko.json
```

In the frontend, display `feature.properties.Blurb_ko ?? feature.properties.Blurb` (and the equivalent fields) during the translation-review phase. Before public release, untranslated English fallback values should be reviewed so the Korean interface does not silently show mixed-language text.

## Cost-control decisions

1. Translate narrative text only; do not send geometry, IDs, coordinates, source URLs, dates or numeric flags to a model.
2. Translate normalized unique strings once and reuse the result across features and layers. `translation_id` is stable for unchanged source text.
3. Use country names from the included static dictionary instead of paying to translate every country occurrence.
4. Keep brand and institutional names in a glossary; do not ask a model to re-translate a repeated name in every sentence.
5. Keep English source properties intact and add Korean overlay fields, so updates can be diffed and only newly added/changed strings need translation.
6. Batching reduces request overhead but does not itself reduce token billing; deduplication and excluding non-display fields reduce the actual translated text volume.

All narrative `ko` cells are populated. The Korean text is a first-pass translation; check proper-name transliterations and the politically sensitive descriptions against the licensed ISW source before public release. The source strings and English properties remain available for side-by-side review.
