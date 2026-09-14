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

/** POST /api/risk-areas/:id/recompute — recompute one area's base vulnerability score */
function recomputeRiskArea(id) {
  return apiRequest(`/api/risk-areas/${id}/recompute`, { method: 'POST' });
}
