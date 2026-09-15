// Heat Relief Network — resident registration (SCRUM-34 / SCRUM-35).
//
// Three steps on one page: validate an invite code, collect intake answers,
// then show the priority tier and matched sites without a page reload.

const state = { inviteCode: null, orgName: null };

// ─────────────────────────────────────────────
// Field error helpers
// ─────────────────────────────────────────────
function showFieldError(field, message) {
  const el = document.getElementById(`${field}-error`);
  const input = document.getElementById(field);
  if (el) {
    el.textContent = message;
    el.hidden = false;
  }
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

const INTAKE_FIELDS = [
  'full_name', 'zip', 'age', 'household_size',
  'employment_status', 'insurance_status', 'annual_income', 'consent', 'invite_code',
];

// ─────────────────────────────────────────────
// Step 1 — invite gate
// ─────────────────────────────────────────────
document.getElementById('invite-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearFieldErrors(['invite_code']);

  const btn = document.getElementById('invite-submit');
  const code = document.getElementById('invite_code').value.trim().toUpperCase();

  btn.disabled = true;
  btn.textContent = 'Checking…';

  try {
    const result = await validateInvite(code);
    state.inviteCode = result.code;
    state.orgName = result.org_name;

    document.getElementById('invited-by').innerHTML = result.org_name
      ? `Invited by <strong>${escapeHtml(result.org_name)}</strong>.`
      : 'Invite code accepted.';

    document.getElementById('invite-panel').hidden = true;
    document.getElementById('intake-panel').hidden = false;
    document.getElementById('full_name').focus();
  } catch (err) {
    showFieldError('invite_code', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Continue';
  }
});

// ─────────────────────────────────────────────
// Consent gate — submit stays disabled until it's ticked
// ─────────────────────────────────────────────
const consentBox = document.getElementById('consent');
const intakeSubmit = document.getElementById('intake-submit');
intakeSubmit.disabled = true;
consentBox.addEventListener('change', () => {
  intakeSubmit.disabled = !consentBox.checked;
  if (consentBox.checked) clearFieldErrors(['consent']);
});

// ─────────────────────────────────────────────
// Step 2 — intake submission
// ─────────────────────────────────────────────
document.getElementById('intake-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearFieldErrors(INTAKE_FIELDS);

  const msg = document.getElementById('intake-msg');
  msg.textContent = '';

  const payload = {
    invite_code: state.inviteCode,
    full_name: document.getElementById('full_name').value.trim(),
    street_address: document.getElementById('street_address').value.trim() || null,
    city: document.getElementById('city').value.trim() || null,
    zip: document.getElementById('zip').value.trim(),
    age: Number(document.getElementById('age').value),
    household_size: Number(document.getElementById('household_size').value),
    children_under_5: document.getElementById('children_under_5').checked,
    employment_status: document.getElementById('employment_status').value,
    insurance_status: document.getElementById('insurance_status').value,
    annual_income: Number(document.getElementById('annual_income').value),
    consent: consentBox.checked,
  };

  intakeSubmit.disabled = true;
  intakeSubmit.textContent = 'Registering…';

  try {
    const result = await registerResident(payload);
    renderResults(result);
  } catch (err) {
    if (err.fieldErrors) {
      Object.entries(err.fieldErrors).forEach(([field, message]) => showFieldError(field, message));
      msg.textContent = 'Please correct the highlighted fields.';
      msg.className = 'save-msg error-state';
    } else {
      msg.textContent = err.message;
      msg.className = 'save-msg error-state';
    }
  } finally {
    intakeSubmit.disabled = !consentBox.checked;
    intakeSubmit.textContent = 'Register and find my sites';
  }
});

// ─────────────────────────────────────────────
// Step 3 — results
//
// NOTE: the raw 0-100 score is deliberately NOT shown to the resident. The
// tier is what's actionable; a number invites arguing with the arithmetic and
// tells someone in heat distress nothing useful.
// ─────────────────────────────────────────────
function renderResults(result) {
  document.getElementById('intake-panel').hidden = true;
  document.getElementById('results-panel').hidden = false;

  const { resident, priority, recommendations, fallback_sites, note } = result;

  document.getElementById('results-intro').textContent =
    `Thanks, ${resident.full_name.split(' ')[0]}. Here's where you stand and where to go.`;

  const badge = document.getElementById('tier-badge');
  badge.textContent = priority.tier_label;
  badge.className = `tier-badge tier-${priority.tier}`;

  const reasonList = document.getElementById('reason-list');
  reasonList.innerHTML = '';
  priority.reasons.forEach((reason) => {
    const li = document.createElement('li');
    li.textContent = reason;
    reasonList.appendChild(li);
  });

  const container = document.getElementById('match-container');
  container.innerHTML = '';

  const groups = (recommendations || []).filter((g) => g.sites && g.sites.length);

  if (groups.length) {
    groups.forEach((group) => container.appendChild(renderGroup(group.label, group.why, group.sites)));
  } else if (fallback_sites && fallback_sites.length) {
    container.appendChild(renderGroup('Nearest open sites', 'The closest open relief sites to your ZIP code.', fallback_sites));
  } else {
    container.innerHTML = '<p class="empty-state">No open sites found nearby right now.</p>';
  }

  const noteEl = document.getElementById('match-note');
  if (note) {
    noteEl.textContent = note;
    noteEl.hidden = false;
  }

  document.getElementById('results-panel').scrollIntoView({ behavior: 'smooth' });
}

function renderGroup(label, why, sites) {
  const wrap = document.createElement('div');
  wrap.className = 'match-group';

  const h3 = document.createElement('h3');
  h3.textContent = label;
  wrap.appendChild(h3);

  const p = document.createElement('p');
  p.className = 'match-why';
  p.textContent = why;
  wrap.appendChild(p);

  sites.forEach((site) => wrap.appendChild(renderSiteCard(site)));
  return wrap;
}

function renderSiteCard(site) {
  const card = document.createElement('div');
  card.className = 'site-card';

  const top = document.createElement('div');
  top.className = 'site-card-top';

  const name = document.createElement('strong');
  name.textContent = site.name;
  top.appendChild(name);

  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = site.status === 'open' ? 'Open' : site.status;
  top.appendChild(badge);

  card.appendChild(top);

  const meta = document.createElement('div');
  meta.className = 'site-meta';
  meta.textContent = `${site.address} · ${site.distance_mi} mi away`;
  if (site.hours_text) meta.textContent += ` · ${site.hours_text}`;
  card.appendChild(meta);

  const link = document.createElement('a');
  link.href = `index.html?lat=${site.lat}&lon=${site.lon}`;
  link.textContent = 'Show on map →';
  card.appendChild(link);

  return card;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
