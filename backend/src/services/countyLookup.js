// HeatSafe — city/state -> county lookup, pilot cities only.
//
// WHY THIS EXISTS: alerts.region and areas.region are always a COUNTY name
// (see CLAUDE.md "Region = county"), but zipLookup.js only resolves a ZIP to
// city/state — that's all the free zippopotam.us API and our local
// KNOWN_ZIPS table return. Something has to bridge "Houston" -> "Harris
// County" so a resident's own registered address can drive their alert
// banner instead of asking them to type their county by hand every visit.
//
// SCOPE: covers exactly the five pilot metros seeded in seed_areas.sql.
// Outside them this returns null and callers fall back to manual county
// entry — a documented gap, not a silently wrong guess. Replace with a real
// ZIP/tract -> county dataset (e.g. a Census gazetteer file) before this
// covers more than the pilot.

const CITY_COUNTY = {
  'houston|tx': 'Harris County',
  'dallas|tx': 'Dallas County',
  'fort worth|tx': 'Tarrant County',
  'austin|tx': 'Travis County',
  'san antonio|tx': 'Bexar County',
};

function resolveCounty(city, state) {
  if (!city || !state) return null;
  const key = `${String(city).trim().toLowerCase()}|${String(state).trim().toLowerCase()}`;
  return CITY_COUNTY[key] || null;
}

export { resolveCounty };
