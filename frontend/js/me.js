// HeatSafe — "My info" self-service page (Checkpoint plan items A, B, C, D,
// plus resident logins).
//
// How this page decides whose record to show:
//   1. A login session in this browser (email + password, see api.js)
//        -> account summary + the resident's own record.
//   2. No session, but this browser registered before logins existed and
//      still holds that resident's UUID
//        -> the record, plus a one-time "add a login" form. Once a login is
//           added, the UUID alone stops working (backend/src/middleware/residentAuth.js).
//   3. Neither -> "Log in" prompt.
// Nothing here ever displays or asks for another resident's ID.

const LEGACY_ID_KEY = 'heatsafe_resident_id';
const state = { residentId: null };

function getLegacyResidentId() {
  try { return localStorage.getItem(LEGACY_ID_KEY) || ''; } catch { return ''; }
}
function setLegacyResidentId(id) {
  try { localStorage.setItem(LEGACY_ID_KEY, id); } catch { /* storage disabled */ }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

function setMsg(id, text, kind) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = `save-msg ${kind || ''}`.trim();
}

// ─────────────────────────────────────────────
// Field error helpers (same pattern as register.js)
// ─────────────────────────────────────────────
const PROFILE_FIELDS = [
  'full_name', 'zip', 'age', 'household_size',
  'employment_status', 'insurance_status', 'annual_income', 'consent',
];

function showFieldError(field, message) {
  const el = document.getElementById(`${field}-error`);
  const input = document.getElementById(field);
  if (el) { el.textContent = message; el.hidden = false; }
  if (input) input.classList.add('invalid');
}

function clearFieldErrors(fields) {
  fields.forEach((field) => {
    const el = document.getElementById(`${field}-error`);
    const input = document.getElementById(field);
    if (el) el.hidden = true;
    if (input) input.classList.remove('invalid');
  });
}

const TIER_LABELS = { 1: 'Highest priority', 2: 'High priority', 3: 'Standard priority' };

// ─────────────────────────────────────────────
// Panels
// ─────────────────────────────────────────────
function showSignIn(reason) {
  ['account-panel', 'claim-panel', 'checkin-panel', 'profile-panel', 'alert-banner']
    .forEach((id) => { document.getElementById(id).hidden = true; });
  if (reason) document.getElementById('signin-reason').textContent = reason;
  document.getElementById('signin-panel').hidden = false;
}

function showAccount(account) {
  document.getElementById('account-registration-id').textContent = account.registration_id;
  document.getElementById('account-email').textContent = account.email;
  document.getElementById('notify-email').checked = Boolean(account.notify_email);
  document.getElementById('account-panel').hidden = false;
  document.getElementById('claim-panel').hidden = true;
  document.getElementById('nav-login').hidden = true;
}

// ─────────────────────────────────────────────
// Loading the resident
// ─────────────────────────────────────────────
async function loadProfile(id) {
  const resident = await fetchResidentSelf(id); // throws on 401/404/network error
  state.residentId = id;

  document.getElementById('signin-panel').hidden = true;
  document.getElementById('profile-panel').hidden = false;
  document.getElementById('checkin-panel').hidden = false;

  // Older profile with no login yet: offer to add one.
  if (resident.has_login === false) {
    document.getElementById('claim-registration-id').textContent = resident.registration_id || '';
    document.getElementById('claim-panel').hidden = false;
  }

  const badge = document.getElementById('tier-badge');
  badge.textContent = TIER_LABELS[resident.priority_tier] || `Tier ${resident.priority_tier}`;
  badge.className = `tier-badge tier-${resident.priority_tier}`;

  document.getElementById('region-line').textContent = resident.region
    ? ` · Alerts for ${resident.region}`
    : ' · No county on file — alerts below may be empty until you search one on the map page.';

  document.getElementById('full_name').value = resident.full_name || '';
  document.getElementById('street_address').value = resident.street_address || '';
  document.getElementById('city').value = resident.city || '';
  document.getElementById('zip').value = resident.zip || '';
  document.getElementById('age').value = resident.age;
  document.getElementById('household_size').value = resident.household_size;
  document.getElementById('children_under_5').checked = Boolean(resident.children_under_5);
  document.getElementById('employment_status').value = resident.employment_status || '';
  document.getElementById('insurance_status').value = resident.insurance_status || '';
  document.getElementById('annual_income').value = '';
  document.getElementById('income-band-line').textContent = resident.income_band || '—';

  const reasonList = document.getElementById('reason-list');
  reasonList.innerHTML = resident.priority_tier
    ? '<li class="hint">Reasons are recalculated the next time you save a change.</li>'
    : '';

  if (resident.region) loadAlertsFor(resident.region);
  loadCheckInHistory(id);

  return resident;
}

// ─────────────────────────────────────────────
// Alerts for the resident's own county
// ─────────────────────────────────────────────
async function loadAlertsFor(region) {
  const banner = document.getElementById('alert-banner');
  try {
    const alerts = await fetchAlerts(region);
    if (!alerts.length) { banner.hidden = true; banner.innerHTML = ''; return; }
    banner.innerHTML = alerts.map((alert) => `
      <div class="alert-card ${escapeHtml(alert.severity)}">
        <div>${escapeHtml(alert.message)}</div>
        <div class="alert-meta">${escapeHtml(alert.region)} · ${escapeHtml(alert.severity)} · source: ${escapeHtml(alert.source)}</div>
      </div>`).join('');
    banner.classList.add('has-alerts');
    banner.hidden = false;
  } catch (err) {
    banner.hidden = true;
    console.warn('Failed to load alerts:', err.message);
  }
}

// ─────────────────────────────────────────────
// Wellness check-in
// ─────────────────────────────────────────────
async function loadCheckInHistory(id) {
  const list = document.getElementById('checkin-history');
  try {
    const history = await fetchCheckIns(id);
    if (!history.length) {
      list.innerHTML = '<li class="hint">No check-ins yet.</li>';
      return;
    }
    list.innerHTML = history.map((c) => `
      <li>
        <span class="badge status-${escapeHtml(c.status)}">${c.status === 'ok' ? "I'm safe" : 'Need help'}</span>
        ${new Date(c.responded_at).toLocaleString()}${c.note ? ` — ${escapeHtml(c.note)}` : ''}
      </li>`).join('');
  } catch (err) {
    list.innerHTML = `<li class="error-state">Couldn't load check-in history: ${escapeHtml(err.message)}</li>`;
  }
}

async function respondToCheckIn(status) {
  const okBtn = document.getElementById('checkin-ok-btn');
  const helpBtn = document.getElementById('checkin-help-btn');

  okBtn.disabled = true;
  helpBtn.disabled = true;
  setMsg('checkin-msg', 'Saving…');

  try {
    await submitCheckIn(state.residentId, status);
    setMsg('checkin-msg', status === 'ok'
      ? "Thanks — you're marked as safe."
      : "Got it — you're marked as needing help. A coordinator will see this on their queue.", 'ok');
    loadCheckInHistory(state.residentId);
  } catch (err) {
    if (err.loginRequired) return showSignIn('Your login has expired. Please log in again.');
    setMsg('checkin-msg', `Couldn't save that: ${err.message}`, 'error');
  } finally {
    okBtn.disabled = false;
    helpBtn.disabled = false;
  }
}

// ─────────────────────────────────────────────
// Profile edit
// ─────────────────────────────────────────────
const consentBox = document.getElementById('consent');
const profileSubmit = document.getElementById('profile-submit');
consentBox.addEventListener('change', () => {
  profileSubmit.disabled = !consentBox.checked;
  if (consentBox.checked) clearFieldErrors(['consent']);
});

document.getElementById('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearFieldErrors(PROFILE_FIELDS);

  const msg = document.getElementById('profile-msg');
  const incomeRaw = document.getElementById('annual_income').value;

  const payload = {
    full_name: document.getElementById('full_name').value.trim(),
    street_address: document.getElementById('street_address').value.trim() || null,
    city: document.getElementById('city').value.trim() || null,
    zip: document.getElementById('zip').value.trim(),
    age: Number(document.getElementById('age').value),
    household_size: Number(document.getElementById('household_size').value),
    children_under_5: document.getElementById('children_under_5').checked,
    employment_status: document.getElementById('employment_status').value,
    insurance_status: document.getElementById('insurance_status').value,
    consent: consentBox.checked,
  };
  if (incomeRaw.trim() !== '') payload.annual_income = Number(incomeRaw);

  profileSubmit.disabled = true;
  profileSubmit.textContent = 'Saving…';
  msg.textContent = '';

  try {
    const result = await updateResidentSelf(state.residentId, payload);
    setMsg('profile-msg', 'Saved.', 'ok');

    const badge = document.getElementById('tier-badge');
    badge.textContent = TIER_LABELS[result.priority.tier] || `Tier ${result.priority.tier}`;
    badge.className = `tier-badge tier-${result.priority.tier}`;

    document.getElementById('income-band-line').textContent = result.resident.income_band || '—';
    document.getElementById('annual_income').value = '';

    const reasonList = document.getElementById('reason-list');
    reasonList.innerHTML = '';
    result.priority.reasons.forEach((reason) => {
      const li = document.createElement('li');
      li.textContent = reason;
      reasonList.appendChild(li);
    });

    document.getElementById('region-line').textContent = result.resident.region
      ? ` · Alerts for ${result.resident.region}`
      : ' · No county on file for this address yet.';
    if (result.resident.region) loadAlertsFor(result.resident.region);
  } catch (err) {
    if (err.loginRequired) return showSignIn('Your login has expired. Please log in again.');
    if (err.fieldErrors) {
      Object.entries(err.fieldErrors).forEach(([field, message]) => showFieldError(field, message));
      msg.textContent = 'Please correct the highlighted fields.';
    } else {
      msg.textContent = err.message;
    }
    msg.className = 'save-msg error';
  } finally {
    profileSubmit.disabled = !consentBox.checked;
    profileSubmit.textContent = 'Save changes';
  }
});

// ─────────────────────────────────────────────
// Account: alert-email preference, log out
// ─────────────────────────────────────────────
document.getElementById('notify-email').addEventListener('change', async (e) => {
  const wanted = e.target.checked;
  setMsg('notify-msg', 'Saving…');
  try {
    await updateMyPreferences(wanted);
    setMsg('notify-msg', wanted ? "You'll get heat-alert emails." : "Alert emails are off.", 'ok');
  } catch (err) {
    e.target.checked = !wanted;
    setMsg('notify-msg', `Couldn't save that: ${err.message}`, 'error');
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await logoutResident();
  window.location.href = 'login.html';
});

// ─────────────────────────────────────────────
// Add a login to an older profile (one time)
// ─────────────────────────────────────────────
document.getElementById('claim-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  ['claim-email-error', 'claim-password-error'].forEach((id) => { document.getElementById(id).hidden = true; });

  const password = document.getElementById('claim-password').value;
  if (password !== document.getElementById('claim-password-confirm').value) {
    setMsg('claim-msg', "Passwords don't match.", 'error');
    return;
  }

  const btn = document.getElementById('claim-submit');
  btn.disabled = true;
  setMsg('claim-msg', 'Saving…');
  try {
    const session = await claimResidentAccount(
      state.residentId,
      document.getElementById('claim-email').value.trim(),
      password
    );
    setResidentSession(session);
    showAccount(await fetchMyAccount());
    setMsg('notify-msg', "Login added. We've emailed your Registration ID and nearest cooling centers.", 'ok');
  } catch (err) {
    if (err.fieldErrors) {
      Object.entries(err.fieldErrors).forEach(([field, message]) => {
        const el = document.getElementById(`claim-${field}-error`);
        if (el) { el.textContent = message; el.hidden = false; }
      });
    }
    setMsg('claim-msg', err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

// ─────────────────────────────────────────────
// Older-profile lookup by original ID (different browser / cleared storage)
// ─────────────────────────────────────────────
document.getElementById('lookup-btn').addEventListener('click', async () => {
  const msg = document.getElementById('lookup-msg');
  const id = document.getElementById('lookup-id').value.trim();

  if (!id) {
    msg.textContent = 'Enter your original HeatSafe ID.';
    msg.hidden = false;
    return;
  }

  try {
    await loadProfile(id);
    setLegacyResidentId(id);
    msg.hidden = true;
  } catch (err) {
    msg.textContent = err.loginRequired
      ? 'That profile already has a login. Use "Log in" above with its email and password.'
      : `Couldn't find that record: ${err.message}`;
    msg.hidden = false;
  }
});

// ─────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('checkin-ok-btn').addEventListener('click', () => respondToCheckIn('ok'));
  document.getElementById('checkin-help-btn').addEventListener('click', () => respondToCheckIn('need_help'));

  if (getResidentSession()) {
    try {
      const account = await fetchMyAccount();
      showAccount(account);
      await loadProfile(account.id);
      return;
    } catch (err) {
      clearResidentSession();
      return showSignIn(err.loginRequired
        ? 'Your login has expired. Please log in again.'
        : `Couldn't load your info: ${err.message}. Try logging in again.`);
    }
  }

  const legacyId = getLegacyResidentId();
  if (legacyId) {
    try {
      await loadProfile(legacyId);
      return;
    } catch (err) {
      return showSignIn(err.loginRequired
        ? 'This profile has a login now. Log in with your email and password.'
        : `Couldn't load your saved info: ${err.message}.`);
    }
  }

  showSignIn();
});
