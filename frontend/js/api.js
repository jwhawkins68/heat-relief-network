// Heat Relief Network — thin wrapper around the backend API.
// Every function returns a Promise that resolves to parsed JSON, or throws
// an Error with a readable message on failure.

// Admin token for the org-facing routes. Held in sessionStorage only, so it is
// cleared when the tab closes and is never written to disk. Resident-facing
// pages never set it and never send it.
function getAdminToken() {
  try {
    return sessionStorage.getItem('hrn_admin_token') || '';
  } catch {
    return '';
  }
}

function setAdminToken(token) {
  try {
    if (token) sessionStorage.setItem('hrn_admin_token', token);
    else sessionStorage.removeItem('hrn_admin_token');
  } catch {
    // private browsing / storage disabled — the token just won't persist
  }
}

// Resident login session (email + password, see backend/src/routes/auth.js).
// Unlike the admin token this is kept in localStorage so it survives closing
// the tab — residents shouldn't have to log in on every visit. "Log out" on
// the My info page clears it, which matters on shared computers.
const RESIDENT_SESSION_KEY = 'heatsafe_session';
const RESIDENT_ID_STORAGE_KEY = 'heatsafe_resident_id';

function getResidentSession() {
  try {
    const raw = localStorage.getItem(RESIDENT_SESSION_KEY);
    const session = raw ? JSON.parse(raw) : null;
    if (session && session.expires_at && new Date(session.expires_at) < new Date()) return null;
    return session && session.token ? session : null;
  } catch {
    return null;
  }
}

function setResidentSession({ token, resident_id, registration_id, expires_at }) {
  try {
    localStorage.setItem(RESIDENT_SESSION_KEY, JSON.stringify({ token, resident_id, registration_id, expires_at }));
    // Kept for pages that only need "which resident is this browser" (map page alerts).
    localStorage.setItem(RESIDENT_ID_STORAGE_KEY, resident_id);
  } catch {
    // storage disabled — the resident will just need to log in again next visit
  }
}

function clearResidentSession() {
  try {
    localStorage.removeItem(RESIDENT_SESSION_KEY);
    localStorage.removeItem(RESIDENT_ID_STORAGE_KEY);
  } catch {
    // nothing to clear
  }
}

async function apiRequest(path, options = {}) {
  const token = getAdminToken();
  const session = getResidentSession();
  // The resident's login only goes to the routes that use it.
  const residentAuth = session && (path.startsWith('/api/residents/') || path.startsWith('/api/auth/'))
    ? { Authorization: `Bearer ${session.token}` }
    : {};

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'x-admin-token': token } : {}),
      ...residentAuth,
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    let body = null;
    try {
      body = await res.json();
    } catch {
      // response wasn't JSON — fall back to the generic message
    }
    const err = new Error((body && body.error) || `Request failed (${res.status})`);
    err.status = res.status;
    if (body && body.errors) err.fieldErrors = body.errors; // per-field form messages
    if (body && body.code) err.code = body.code;
    if (body && body.login_required) err.loginRequired = true;
    throw err;
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
function registerResident(payload) {
  return apiRequest('/api/residents/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
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

// ─────────────────────────────────────────────
// Resident self-service (Checkpoint plan items A, B, D)
// ─────────────────────────────────────────────

/** GET /api/residents/:id — a resident's own info ("My HeatSafe info" page) */
function fetchResidentSelf(id) {
  return apiRequest(`/api/residents/${encodeURIComponent(id)}`);
}

/** PATCH /api/residents/:id — resident's own profile update (errors carry .fieldErrors). */
function updateResidentSelf(id, payload) {
  return apiRequest(`/api/residents/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

/** POST /api/residents/:id/check-in — respond to a wellness check-in */
function submitCheckIn(id, status, note) {
  return apiRequest(`/api/residents/${encodeURIComponent(id)}/check-in`, {
    method: 'POST',
    body: JSON.stringify({ status, note: note || undefined }),
  });
}

/** GET /api/residents/:id/check-ins — a resident's own check-in history */
function fetchCheckIns(id) {
  return apiRequest(`/api/residents/${encodeURIComponent(id)}/check-ins`);
}

// ─────────────────────────────────────────────
// Resident accounts: login, logout, claim, password reset
// ─────────────────────────────────────────────

/** POST /api/auth/login — resolves to { token, expires_at, resident_id, registration_id } */
function loginResident(email, password) {
  return apiRequest('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
}

/** POST /api/auth/logout — always clears this browser's session, even if the server call fails */
async function logoutResident() {
  try {
    await apiRequest('/api/auth/logout', { method: 'POST' });
  } catch {
    // the session is being forgotten locally either way
  } finally {
    clearResidentSession();
  }
}

/** GET /api/auth/me — { id, registration_id, email, full_name, region, notify_email } */
function fetchMyAccount() {
  return apiRequest('/api/auth/me');
}

/** PATCH /api/auth/preferences — opt in/out of heat-alert emails */
function updateMyPreferences(notifyEmail) {
  return apiRequest('/api/auth/preferences', {
    method: 'PATCH',
    body: JSON.stringify({ notify_email: notifyEmail }),
  });
}

/** POST /api/auth/claim — add an email + password to a profile registered before accounts existed */
function claimResidentAccount(residentId, email, password) {
  return apiRequest('/api/auth/claim', {
    method: 'POST',
    body: JSON.stringify({ resident_id: residentId, email, password }),
  });
}

/** POST /api/auth/forgot — emails a reset link (same reply whether or not the email exists) */
function requestPasswordReset(email) {
  return apiRequest('/api/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) });
}

/** POST /api/auth/reset — set a new password from an emailed link; returns a fresh session */
function resetPassword(token, password) {
  return apiRequest('/api/auth/reset', { method: 'POST', body: JSON.stringify({ token, password }) });
}

// ─────────────────────────────────────────────
// Agents (SCRUM-38 / SCRUM-39)
// ─────────────────────────────────────────────

/** POST /api/agents/heat-watch/run — one watch cycle. dryRun writes nothing. */
function runHeatWatch(dryRun = false) {
  return apiRequest(`/api/agents/heat-watch/run${dryRun ? '?dry_run=true' : ''}`, { method: 'POST' });
}

/** GET /api/agents/dispatch/plan?hours= — outreach plan over scheduled shifts */
function fetchDispatchPlan(hours = 12) {
  return apiRequest(`/api/agents/dispatch/plan?hours=${encodeURIComponent(hours)}`);
}

/** POST /api/agents/site-freshness/run — judge status confidence; expire retires stale claims */
function runSiteFreshness(expire = false) {
  return apiRequest(`/api/agents/site-freshness/run${expire ? '?expire=true' : ''}`, { method: 'POST' });
}
