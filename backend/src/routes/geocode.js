import { Router } from 'express';
import { resolveZip, ZipLookupError } from '../services/zipLookup.js';

const router = Router();

/**
 * GET /api/geocode/zip/:zip
 * Resolves a 5-digit US ZIP code to a lat/lon so the resident search can
 * accept a ZIP instead of requiring raw coordinates. The lookup itself lives
 * in services/zipLookup.js so registration shares the same behaviour.
 */
router.get('/zip/:zip', async (req, res) => {
  try {
    res.json(await resolveZip(req.params.zip));
  } catch (err) {
    if (err instanceof ZipLookupError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'ZIP lookup failed' });
  }
});

export default router;
