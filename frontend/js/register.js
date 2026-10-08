// Heat Relief Network — resident registration (SCRUM-34 / SCRUM-35).
//
// Three steps on one page: validate an invite code, collect intake answers,
// then show the priority tier and matched sites without a page reload.

const state = { inviteCode: null, orgName: null };

// Registration creates a login (email + password) and returns a session, so
// the resident lands logged in. setResidentSession lives in api.js.

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
  'email', 'password', 'password_confirm',
];

// ─────────────────────────────────────────────
// Step 1 — invite gate
// ─────────────────────────────────────────────
// Each cooling center's registration code. The dropdown shows the center on the
// left and its code on the right; picking one is all a resident has to do.
// NOTE: these are single-use codes (one resident each), and because they are
// listed here anyone who opens this page can see them.
const INVITE_OPTIONS = [
  { site: 'Sunnyside Community Center & Park',  city: 'Houston',     code: 'AUMLRGTJ' },
  { site: 'Park Place Regional Library',        city: 'Houston',     code: 'RY7VPCR4' },
  { site: 'Young Neighborhood Library',         city: 'Houston',     code: 'C3786LMD' },
  { site: 'Martin Luther King Jr. Branch Library', city: 'Dallas',   code: '8KTBKP9C' },
  { site: 'Ella Mae Shamblee Library',          city: 'Fort Worth',  code: '9M4J4R4H' },
  { site: 'Southeast Branch Library',           city: 'Austin',      code: '3VUJVDKG' },
  { site: 'Dottie Jordan Recreation Center',    city: 'Austin',      code: 'Q568RSC6' },
  { site: 'BiblioTech West',                    city: 'San Antonio', code: 'E2BH7FC7' },
];

function optionLabel(o, suffix) {
  return `${o.site} (${o.city})  —  ${o.code}${suffix || ''}`;
}

function fillInviteSelect() {
  const select = document.getElementById('invite_code');
  INVITE_OPTIONS.forEach((o) => {
    const opt = document.createElement('option');
    opt.value = o.code;
    opt.textContent = optionLabel(o);
    select.appendChild(opt);
  });

  // A link like register.html?code=S5BZ8HC9 preselects that center.
  const wanted = (new URLSearchParams(window.location.search).get('code') || '').toUpperCase();
  if (INVITE_OPTIONS.some((o) => o.code === wanted)) select.value = wanted;

  // Grey out codes that were already used or have expired, so a resident
  // doesn't pick a dead one. If the check itself fails, leave everything enabled.
  INVITE_OPTIONS.forEach(async (o) => {
    try {
      await validateInvite(o.code);
    } catch (err) {
      if (err.status === 404 || err.status === 409) {
        const opt = Array.from(select.options).find((x) => x.value === o.code);
        if (opt) {
          opt.disabled = true;
          opt.textContent = optionLabel(o, err.status === 404 ? '  (code not found)' : '  (already used or expired)');
          if (select.value === o.code) select.value = '';
        }
      }
    }
  });
}
fillInviteSelect();

document.getElementById('invite-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearFieldErrors(['invite_code']);

  const btn = document.getElementById('invite-submit');
  const code = document.getElementById('invite_code').value.trim().toUpperCase();
  if (!code) {
    showFieldError('invite_code', 'Please choose your cooling center.');
    return;
  }

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

  const password = document.getElementById('password').value;
  if (password !== document.getElementById('password_confirm').value) {
    showFieldError('password_confirm', "Passwords don't match");
    msg.textContent = 'Please correct the highlighted fields.';
    msg.className = 'save-msg error-state';
    return;
  }

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
    email: document.getElementById('email').value.trim(),
    password,
  };

  intakeSubmit.disabled = true;
  intakeSubmit.textContent = 'Registering…';

  try {
    const result = await registerResident(payload);
    renderResults(result);
  } catch (err) {
    if (err.code === 'email_taken') {
      // Your invite code was NOT used up — the server checks this first.
      showFieldError('email', err.message);
      msg.innerHTML = 'That email already has a HeatSafe profile. <a href="login.html">Log in</a> instead.';
      msg.className = 'save-msg error-state';
      document.getElementById('email').focus();
    } else if (err.fieldErrors) {
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

  if (result.session) {
    setResidentSession({
      ...result.session,
      resident_id: resident.id,
      registration_id: resident.registration_id,
    });
  }

  if (resident.registration_id) {
    document.getElementById('registration-id').textContent = resident.registration_id;
    document.getElementById('registration-id-note').textContent =
      `We've emailed it to ${resident.email}, along with the cooling centers nearest you. ` +
      'Give this ID to a caseworker or cooling-center staff so they can find your record.';
    document.getElementById('registration-id-box').hidden = false;
  }

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
