// Heat Relief Network — thin wrapper around the backend API.
// Every function returns a Promise that resolves to parsed JSON, or throws
// an Error with a readable message on failure.

async function apiRequest(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body && body.error) message = body.error;
    } catch {
      // response wasn't JSON — fall back to the generic message
    }
    throw new Error(message);
  }

  // PATCH/DELETE may return no body
  if (res.status === 204) return null;
  return res.json();
}

/**
 * GET /api/sites — search sites near a point, or all sites if no lat/lon.
 * params: { lat, lon, radius_m, type, open_only }
 */
function fetchSites(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, value);
    }
  });
  const qs = query.toString();
  return apiRequest(`/api/sites${qs ? `?${qs}` : ''}`);
}

/** GET /api/geocode/zip/:zip — resolve a ZIP code to lat/lon */
function geocodeZip(zip) {
  return apiRequest(`/api/geocode/zip/${encodeURIComponent(zip)}`);
}

/** GET /api/sites/:id — full detail including inventory */
function fetchSiteDetail(id) {
  return apiRequest(`/api/sites/${id}`);
}

/** PATCH /api/sites/:id/status — org portal status update */
function updateSiteStatus(id, status, updatedBy = null) {
  return apiRequest(`/api/sites/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, updated_by: updatedBy }),
  });
}

/** GET /api/alerts?region= */
function fetchAlerts(region) {
  const query = region ? `?region=${encodeURIComponent(region)}` : '';
  return apiRequest(`/api/alerts${query}`);
}

/** GET /api/orgs/:id/sites — sites managed by an org (admin portal) */
function fetchOrgSites(orgId) {
  return apiRequest(`/api/orgs/${orgId}/sites`);
}

/** GET /api/risk-areas?region= — areas ranked by need (heat + vulnerability + resource gap) */
function fetchRiskAreas(region) {
  const query = region ? `?region=${encodeURIComponent(region)}` : '';
  return apiRequest(`/api/risk-areas${query}`);
}

/**
 * The `region` filter on /api/alerts and /api/risk-areas matches on COUNTY name
 * (e.g. "Harris County"), not city name — see CLAUDE.md "Region = county".
 * Returns the distinct counties actually present in the data, so the UI never
 * hardcodes a county list.
 */
async function fetchCounties() {
  const areas = await fetchRiskAreas();
  return [...new Set(areas.map((a) => a.region).filter(Boolean))].sort();
}

/** Fill a <datalist> with the counties available in the data. Never throws. */
async function populateCountyList(datalistId = 'county-list') {
  const list = document.getElementById(datalistId);
  if (!list) return;
  try {
    const counties = await fetchCounties();
    list.innerHTML = counties
      .map((c) => `<option value="${c.replace(/"/g, '&quot;')}"></option>`)
      .join('');
  } catch (err) {
    console.warn('Could not load county list:', err);
  }
}

/** POST /api/risk-areas/:id/recompute — recompute one area's base vulnerability score */
function recomputeRiskArea(id) {
  return apiRequest(`/api/risk-areas/${id}/recompute`, { method: 'POST' });
}

// ─────────────────────────────────────────────
// Priority Access (SCRUM-29)
// ─────────────────────────────────────────────

/** GET /api/invites/:code/validate — check an invite code without consuming it */
function validateInvite(code) {
  return apiRequest(`/api/invites/${encodeURIComponent(code)}/validate`);
}

/**
 * POST /api/residents/register — redeem an invite and register a resident.
 * Resolves to { resident, priority, recommendations, fallback_sites, note }.
 * Rejects with an Error carrying `.fieldErrors` when the server returns
 * per-field validation messages.
 */
async function registerResident(payload) {
  const res = await fetch(`${API_BASE}/api/residents/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `Registration failed (${res.status})`);
    if (body.errors) err.fieldErrors = body.errors;
    throw err;
  }
  return body;
}

/** POST /api/invites — issue a new single-use invite code for an org */
function issueInvite(orgId, label) {
  return apiRequest('/api/invites', {
    method: 'POST',
    body: JSON.stringify({ org_id: orgId, issued_to_label: label || null }),
  });
}

/** GET /api/residents?tier=&city= — priority-ranked queue (income is redacted server-side) */
function fetchResidents(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') query.set(k, v);
  });
  const qs = query.toString();
  return apiRequest(`/api/residents${qs ? `?${qs}` : ''}`);
}
