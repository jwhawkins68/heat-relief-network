import { Router } from 'express';

const router = Router();

// The pilot region's own ZIPs (matching the seeded sites/areas) are answered
// locally first, so ZIP search still works for the Texas pilot cities even
// if the free geocoding API below is unreachable (offline dev, flaky network).
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

/**
 * GET /api/geocode/zip/:zip
 * Resolves a 5-digit US ZIP code to a lat/lon so the resident search can
 * accept a ZIP instead of requiring raw coordinates. Checks the small local
 * table above first, then falls back to the free Zippopotam.us API (no key
 * required) for any other US ZIP.
 */
router.get('/zip/:zip', async (req, res) => {
  const zip = String(req.params.zip || '').trim();
  if (!/^\d{5}$/.test(zip)) {
    return res.status(400).json({ error: 'Enter a 5-digit ZIP code' });
  }

  if (KNOWN_ZIPS[zip]) {
    return res.json({ zip, ...KNOWN_ZIPS[zip], source: 'local' });
  }

  try {
    const r = await fetch(`http://api.zippopotam.us/us/${zip}`);
    if (!r.ok) {
      return res.status(404).json({ error: `Couldn't find ZIP code ${zip}` });
    }
    const data = await r.json();
    const place = data.places && data.places[0];
    if (!place) {
      return res.status(404).json({ error: `Couldn't find ZIP code ${zip}` });
    }
    res.json({
      zip,
      lat: Number(place.latitude),
      lon: Number(place.longitude),
      city: place['place name'],
      state: place['state abbreviation'],
      source: 'zippopotam',
    });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'ZIP lookup service is unavailable right now' });
  }
});

export default router;
