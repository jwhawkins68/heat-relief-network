// Heat Relief Network — org/admin portal.
// Lets an org update the open/closed/full status of the sites it manages.
//
// NOTE: the backend has no auth on these routes yet (see README "What's
// stubbed"). Once auth is added, replace the manual org-id field below with
// the logged-in org's id, and pass the authenticated user's id as
// `updated_by` instead of leaving it null.

const STATUS_OPTIONS = ['open', 'closed', 'full', 'unknown'];

function statusOptionsHtml(current) {
  return STATUS_OPTIONS.map(
    (status) => `<option value="${status}" ${status === current ? 'selected' : ''}>${status}</option>`
  ).join('');
}

async function loadOrgSites(orgId) {
  const container = document.getElementById('org-sites-container');
  container.innerHTML = '<p class="empty-state">Loading sites…</p>';

  try {
    const sites = await fetchOrgSites(orgId);

    if (sites.length === 0) {
      container.innerHTML = '<p class="empty-state">No sites found for this organization ID.</p>';
      return;
    }

    container.innerHTML = `
      <table class="admin-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Status</th>
            <th>Last updated</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${sites.map((site) => `
            <tr data-site-id="${site.id}">
              <td>${escapeHtml(site.name)}</td>
              <td>${escapeHtml(site.type)}</td>
              <td>
                <div class="row-status">
                  <select class="status-select">${statusOptionsHtml(site.status)}</select>
                  <button type="button" class="secondary save-status-btn">Save</button>
                  <span class="save-msg"></span>
                </div>
              </td>
              <td class="updated-at">${site.status_updated_at ? new Date(site.status_updated_at).toLocaleString() : '—'}</td>
              <td></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    container.querySelectorAll('.save-status-btn').forEach((btn) => {
      btn.addEventListener('click', () => saveStatus(btn));
    });
  } catch (err) {
    container.innerHTML = `<p class="error-state">Couldn't load sites: ${err.message}. Is the backend running at ${API_BASE}?</p>`;
  }
}

async function saveStatus(btn) {
  const row = btn.closest('tr');
  const siteId = row.dataset.siteId;
  const select = row.querySelector('.status-select');
  const msg = row.querySelector('.save-msg');

  btn.disabled = true;
  msg.textContent = 'Saving…';
  msg.className = 'save-msg';

  try {
    // updated_by is left null until real org-user auth exists — see NOTE above.
    const result = await updateSiteStatus(siteId, select.value, null);
    row.querySelector('.updated-at').textContent = new Date(result.status_updated_at).toLocaleString();
    msg.textContent = 'Saved';
    msg.className = 'save-msg ok';
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'save-msg error';
  } finally {
    btn.disabled = false;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

// ---- Priority areas (heat-risk matching feature) ----

function priorityBand(score) {
  if (score >= 70) return { label: 'Critical', className: 'status-closed' };
  if (score >= 45) return { label: 'High', className: 'status-full' };
  if (score >= 20) return { label: 'Moderate', className: 'status-unknown' };
  return { label: 'Low', className: 'status-open' };
}

function formatMiles(meters) {
  if (meters === undefined || meters === null) return null;
  return `${(meters / 1609.34).toFixed(1)} mi`;
}

async function loadRiskAreas(region) {
  const container = document.getElementById('risk-areas-container');
  container.innerHTML = '<p class="empty-state">Loading priority areas…</p>';

  try {
    const areas = await fetchRiskAreas(region);

    if (areas.length === 0) {
      container.innerHTML = '<p class="empty-state">No areas found. Seed some with backend/src/db/seed_areas.sql.</p>';
      return;
    }

    container.innerHTML = `
      <table class="admin-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Area</th>
            <th>Priority</th>
            <th>Heat index</th>
            <th>Nearest open site</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${areas.map((area, i) => {
            const band = priorityBand(area.priority_score);
            const nearest = area.nearest_open_site;
            const distance = nearest ? formatMiles(nearest.distance_m) : null;
            return `
              <tr data-area-id="${area.id}">
                <td>${i + 1}</td>
                <td>
                  ${escapeHtml(area.name)}
                  <div class="hint">pop. ${area.population ?? '—'} · ${area.pct_elderly ?? '—'}% elderly · ${area.pct_no_ac ?? '—'}% no AC</div>
                </td>
                <td>
                  <span class="badge ${band.className}">${band.label}</span>
                  <div class="hint">${area.priority_score}</div>
                </td>
                <td>${area.heat_index_f ? `${area.heat_index_f}°F` : '—'}</td>
                <td>
                  ${nearest
                    ? `${escapeHtml(nearest.name)}<div class="hint">${distance} away</div>`
                    : '<span class="error-state">None open nearby</span>'}
                </td>
                <td>
                  <button type="button" class="secondary recompute-btn">Recompute</button>
                  <span class="save-msg"></span>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    `;

    container.querySelectorAll('.recompute-btn').forEach((btn) => {
      btn.addEventListener('click', () => recomputeArea(btn));
    });
  } catch (err) {
    container.innerHTML = `<p class="error-state">Couldn't load priority areas: ${err.message}. Is the backend running at ${API_BASE}?</p>`;
  }
}

async function recomputeArea(btn) {
  const row = btn.closest('tr');
  const areaId = row.dataset.areaId;
  const msg = row.querySelector('.save-msg');

  btn.disabled = true;
  msg.textContent = 'Recomputing…';
  msg.className = 'save-msg';

  try {
    await recomputeRiskArea(areaId);
    msg.textContent = 'Updated';
    msg.className = 'save-msg ok';
    // Reload the full ranking since this area's position may have changed.
    loadRiskAreas(document.getElementById('risk-region').value.trim());
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'save-msg error';
    btn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  populateCountyList();

  document.getElementById('org-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const orgId = document.getElementById('org_id').value.trim();
    if (orgId) loadOrgSites(orgId);
  });

  document.getElementById('load-risk-areas-btn').addEventListener('click', () => {
    loadRiskAreas(document.getElementById('risk-region').value.trim());
  });
});

// ─────────────────────────────────────────────
// Priority access — invites & resident queue (SCRUM-36)
//
// PRIVACY: this view renders `income_band` only. The backend never sends the
// raw annual_income figure to the browser — see docs/NEED-SCORING.md.
// ─────────────────────────────────────────────

const EMPLOYMENT_LABELS = {
  outdoor_worker: 'Outdoor worker',
  unemployed: 'Not working',
  unable_to_work: 'Unable to work',
  retired: 'Retired',
  part_time: 'Part-time',
  student: 'Student',
  full_time_indoor: 'Full-time indoor',
};

const INSURANCE_LABELS = {
  personal: 'Personal/employer',
  government_assistance: 'Govt assistance',
  none: 'Uninsured',
};

const TIER_LABELS = {
  1: 'P1 — Urgent',
  2: 'P2 — Elevated',
  3: 'P3 — Standard',
};

async function handleIssueInvite() {
  const orgId = document.getElementById('org_id').value.trim();
  const msg = document.getElementById('invite-msg');
  const resultWrap = document.getElementById('invite-result');

  msg.className = 'save-msg';
  msg.textContent = '';

  if (!orgId) {
    resultWrap.hidden = true;
    msg.className = 'save-msg error-state';
    msg.textContent = 'Enter your organization ID at the top of the page first.';
    return;
  }

  const btn = document.getElementById('issue-invite-btn');
  btn.disabled = true;
  btn.textContent = 'Issuing…';

  try {
    const label = document.getElementById('invite_label').value.trim();
    const invite = await issueInvite(orgId, label);
    document.getElementById('invite-code-value').textContent = invite.code;
    resultWrap.hidden = false;
    msg.textContent = `Expires ${new Date(invite.expires_at).toLocaleDateString()}.`;
    document.getElementById('invite_label').value = '';
  } catch (err) {
    resultWrap.hidden = true;
    msg.className = 'save-msg error-state';
    msg.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Issue invite code';
  }
}

async function loadResidentQueue() {
  const container = document.getElementById('resident-queue-container');
  container.innerHTML = '<p class="empty-state">Loading residents…</p>';

  try {
    const residents = await fetchResidents({
      tier: document.getElementById('queue-tier').value,
      city: document.getElementById('queue-city').value.trim(),
    });

    if (!residents.length) {
      container.innerHTML = '<p class="empty-state">No registered residents match these filters yet.</p>';
      return;
    }

    const rows = residents.map((r) => `
      <tr>
        <td><span class="tier-badge tier-${r.priority_tier}">${TIER_LABELS[r.priority_tier]}</span></td>
        <td>${escapeHtml(r.full_name)}</td>
        <td>${escapeHtml(r.city || '—')} ${escapeHtml(r.zip)}</td>
        <td>${r.age}</td>
        <td>${r.household_size}${r.children_under_5 ? ' <span title="Child under 5 in household">👶</span>' : ''}</td>
        <td>${EMPLOYMENT_LABELS[r.employment_status] || r.employment_status}</td>
        <td>${INSURANCE_LABELS[r.insurance_status] || r.insurance_status}</td>
        <td>${escapeHtml(r.income_band)}</td>
        <td>${new Date(r.created_at).toLocaleDateString()}</td>
      </tr>`).join('');

    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Priority</th><th>Name</th><th>City / ZIP</th><th>Age</th>
            <th>Household</th><th>Employment</th><th>Insurance</th>
            <th>Income band</th><th>Registered</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="hint" style="margin-bottom:0;">
        ${residents.length} resident${residents.length === 1 ? '' : 's'}, highest need first.
        Income is shown as a band only.
      </p>`;
  } catch (err) {
    container.innerHTML = `<p class="error-state">Couldn't load residents: ${escapeHtml(err.message)}</p>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('issue-invite-btn').addEventListener('click', handleIssueInvite);
  document.getElementById('load-queue-btn').addEventListener('click', loadResidentQueue);

  document.getElementById('copy-invite-btn').addEventListener('click', async () => {
    const code = document.getElementById('invite-code-value').textContent;
    const msg = document.getElementById('invite-msg');
    try {
      await navigator.clipboard.writeText(code);
      msg.className = 'save-msg';
      msg.textContent = 'Copied.';
    } catch {
      msg.className = 'save-msg';
      msg.textContent = 'Select the code above to copy it.';
    }
  });
});
