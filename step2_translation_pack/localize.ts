import narrativeKo from "./narrative_ko.json";
import staticKo from "./static_ko.json";

const NARRATIVE_FIELDS = new Set([
  "Blurb",
  "Additional_Context",
  "Associated_People",
]);
const COUNTRY_FIELDS = new Set([
  "COUNTRY",
  "COUNTRYAFF",
  "Country",
  "Country_Name",
  "Region",
  "Target_Country",
  "World_Countries_Equivalent",
]);
const STATIC_FIELD_GROUP: Record<string, string> = {
  Location: "locations",
  Russian_Organization: "russianOrganizations",
  Russian_Program: "programs",
  Format: "formats",
};

/** Normalize source strings the same way as the translation manifest. */
export function normalizeSourceText(value: string): string {
  return value.normalize("NFC").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

/** Return the Korean display value; preserve the original when no mapping exists. */
export function localizeValue(field: string, value: unknown): unknown {
  if (typeof value !== "string" || !value.trim()) return value;
  const key = normalizeSourceText(value);

  if (NARRATIVE_FIELDS.has(field)) {
    return (narrativeKo as Record<string, string>)[key] ?? value;
  }
  if (COUNTRY_FIELDS.has(field)) {
    return (staticKo.countryNames as Record<string, string>)[key] ?? value;
  }
  const group = STATIC_FIELD_GROUP[field];
  if (group) {
    const dictionary = (staticKo as Record<string, unknown>)[group] as
      | Record<string, string>
      | undefined;
    return dictionary?.[key] ?? value;
  }
  return value;
}

/** Add Korean display properties without mutating or deleting source properties. */
export function localizeProperties<T extends Record<string, unknown>>(props: T): T & Record<string, unknown> {
  const result: Record<string, unknown> = { ...props };
  for (const field of [
    ...NARRATIVE_FIELDS,
    ...COUNTRY_FIELDS,
    ...Object.keys(STATIC_FIELD_GROUP),
  ]) {
    if (field in props) result[`${field}_ko`] = localizeValue(field, props[field]);
  }
  const layerId = String(props._LayerID ?? "");
  const layerName = (staticKo.layers as Record<string, string>)[layerId];
  if (layerName) result._LayerName_ko = layerName;
  return result as T & Record<string, unknown>;
}
