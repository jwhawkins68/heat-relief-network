# Data sources & provenance

Every number the scoring engine consumes, where it comes from, and how to refresh it.
The project's rule: **no invented values in the live product.** If a real source doesn't
exist for a field, the gap is documented here rather than filled with a plausible number.

## Region key: county, not city

`areas.region`, `alerts.region`, and `users.notify_region` all hold a **county name**
("Harris County"), never a city name. The filter is an exact match, so "Houston" returns
nothing by design. The resident and admin UIs both offer a county picker
(`<datalist id="county-list">`) populated at page load from the counties actually present
in the data, so no county list is ever hardcoded in the frontend.

Service region: Harris, Dallas, Tarrant, Travis, and Bexar counties.

## `areas` table

| Field | Source | Status |
|---|---|---|
| `population` | Census ACS 5-year, `B01003_001E`, by ZCTA | **Pending pull** |
| `pct_elderly` | Census ACS 5-year profile, `DP05_0024PE` (65 and over), by ZCTA | **Pending pull** |
| `pct_low_income` | Census ACS 5-year profile, `DP03_0128PE` (below poverty level), by ZCTA | **Pending pull** |
| `heat_index_f` | NWS / Open-Meteo — SCRUM-23–25 | Provisional until that epic lands |
| `pct_no_ac` | **No free authoritative source at this geography.** | Documented gap — see below |

### The ACS pull

ZCTAs in the service region: `77051`, `75215`, `76104`, `78724`, `78207`.

```bash
curl "https://api.census.gov/data/2023/acs/acs5/profile?get=NAME,DP05_0024PE,DP03_0128PE&for=zip%20code%20tabulation%20area:77051"
curl "https://api.census.gov/data/2023/acs/acs5?get=NAME,B01003_001E&for=zip%20code%20tabulation%20area:77051"
```

No API key is required at this volume. The ACS 5-year release is the right table — the
1-year release doesn't cover geographies this small.

**Status: not yet run.** `api.census.gov` is outside the network allowlist of the
environment this was set up from, so the values currently in `seed_areas.sql` are still
the hand-seeded originals. Run the two commands above from a machine with open network
access (any normal terminal works) and replace the values, or ask Claude Code to do it —
its shell runs locally and is not subject to that allowlist.

### Why `pct_no_ac` has no source

There is no free, authoritative dataset for air-conditioning access at ZCTA level. The
ACS doesn't ask. The seeded values are low across the board because central AC is
near-universal in Texas housing, which makes poverty and elderly population the dominant
vulnerability drivers here. **This field is the one acknowledged estimate in the model.**
It is weighted lowest in `riskScore.js` for that reason. Options, in order of honesty:
drop the field from the score, or source it from a local heat-vulnerability index if a
partner agency has one.

## `sites` table

11 real, publicly documented locations — public library branches operating as designated
cooling centers, city recreation/community centers, and public parks. Names, addresses,
and coordinates were verified against each city's library/parks department site and the
Census Bureau geocoder.

`status` is seeded `unknown` and `hours_text` left blank on purpose: the product's own
design has an org admin set real status through the portal rather than the seed guessing
it. **Before launch, a real operator has to set actual statuses and hours** — a resident
looking at a map of "unknown" is not being served.

## `orgs` table

One organization owns the seeded sites. Its `contact_email` and `contact_phone` are
deliberately `NULL` — the previous values were placeholder addresses that didn't reach a
real mailbox. **Blocking for launch:** the real operating organization's name, type, and
contact details.

## `residents` table

Real people's age, household size, employment status, insurance status, and income
relative to the federal poverty level. Collected under invite only.

- Raw `annual_income` is never returned by the API — only a coarse band. See
  `docs/NEED-SCORING.md`.
- The queue is behind the admin token gate (`requireAdmin`).
- Any rows registered against the old demo invite codes are test data and must be
  truncated before the system takes real registrations.
