// Heat Relief Network — shared ZIP -> lat/lon resolution.
//
// Extracted from routes/geocode.js so the resident registration flow and the
// public geocode endpoint resolve ZIPs the exact same way.

// The pilot region's own ZIPs (matching the seeded sites/areas) are answered
// locally first, so ZIP search still works for the Texas pilot cities even if
// the free geocoding API below is unreachable (offline dev, flaky network).
const KNOWN_ZIPS = {
  '77051': { lat: 29.669321, lon: -95.371847, city: 'Houston', state: 'TX' },
  '77017': { lat: 29.687567, lon: -95.274892, city: 'Houston', state: 'TX' },
  '77021': { lat: 29.698517, lon: -95.338475, city: 'Houston', state: 'TX' },
  '75215': { lat: 32.770411, lon: -96.766835, city: 'Dallas', state: 'TX' },
  '75210': { lat: 32.779635, lon: -96.761973, city: 'Dallas', state: 'TX' },
  '76104': { lat: 32.733204, lon: -97.318374, city: 'Fort Worth', state: 'TX' },
  '78744': { lat: 30.187922, lon: -97.742174, city: 'Austin', state: 'TX' },
  '78723': { lat: 30.314870, lon: -97.674011, city: 'Austin', state: 'TX' },
  '78207': { lat: 29.404375, lon: -98.530072, city: 'San Antonio', state: 'TX' },
  '78210': { lat: 29.387860, lon: -98.498765, city: 'San Antonio', state: 'TX' },
};

class ZipLookupError extends Error {
  constructor(message, status = 404) {
    super(message);
    this.name = 'ZipLookupError';
    this.status = status;
  }
}

/**
 * Resolve a 5-digit US ZIP to { zip, lat, lon, city, state, source }.
 * Throws ZipLookupError with a .status for the route layer to use.
 */
async function resolveZip(rawZip) {
  const zip = String(rawZip || '').trim();
  if (!/^\d{5}$/.test(zip)) {
    throw new ZipLookupError('Enter a 5-digit ZIP code', 400);
  }

  if (KNOWN_ZIPS[zip]) {
    return { zip, ...KNOWN_ZIPS[zip], source: 'local' };
  }

  let data;
  try {
    const r = await fetch(`http://api.zippopotam.us/us/${zip}`);
    if (!r.ok) throw new ZipLookupError(`Couldn't find ZIP code ${zip}`, 404);
    data = await r.json();
  } catch (err) {
    if (err instanceof ZipLookupError) throw err;
    throw new ZipLookupError('ZIP lookup service is unavailable right now', 502);
  }

  const place = data.places && data.places[0];
  if (!place) throw new ZipLookupError(`Couldn't find ZIP code ${zip}`, 404);

  return {
    zip,
    lat: Number(place.latitude),
    lon: Number(place.longitude),
    city: place['place name'],
    state: place['state abbreviation'],
    source: 'zippopotam',
  };
}

export { resolveZip, ZipLookupError, KNOWN_ZIPS };
