// Heat Relief Network — org/admin portal.
// Lets an org update the open/closed/full status of the sites it manages.
//
// ACCESS: the admin routes are gated by a shared organization token
// (ADMIN_TOKEN on the server, sent as the x-admin-token header — see
// backend/src/middleware/requireAdmin.js). This is a shared secret, not
// per-user auth: when real org user accounts land, replace the manual org-id
// field below with the logged-in org's id and pass the authenticated user's
// id as `updated_by` instead of leaving it null.

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
    throw err; // let the sign-in handler clear a rejected token
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

  document.getElementById('org-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('admin-auth-msg');
    const orgId = document.getElementById('org_id').value.trim();
    setAdminToken(document.getElementById('admin_token').value.trim());
    if (!orgId) return;

    msg.textContent = '';
    try {
      await loadOrgSites(orgId);
    } catch (err) {
      // A bad token clears itself so the next attempt starts clean.
      setAdminToken('');
      msg.textContent = err.message || 'Could not sign in.';
    }
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

// ─────────────────────────────────────────────
// Agents — Heat Watch (SCRUM-38) and Dispatch Planner (SCRUM-39)
//
// Both render their REASONS, not just their conclusions. An agent that
// escalates a neighbourhood to "emergency" without showing its working is not
// something a coordinator should act on.
// ─────────────────────────────────────────────

const SEVERITY_TIER = { emergency: 1, warning: 2, advisory: 3 };

function agentBusy(on, label) {
  ['heat-watch-preview-btn', 'heat-watch-run-btn', 'dispatch-btn'].forEach((id) => {
    document.getElementById(id).disabled = on;
  });
  if (on) {
    document.getElementById('agent-output').innerHTML =
      `<p class="empty-state">${escapeHtml(label)}</p>`;
  }
}

function reasonList(reasons) {
  return `<ul class="reason-list">${reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`;
}

function renderHeatWatch(result) {
  const out = document.getElementById('agent-output');
  const head = `
    <p class="hint">
      ${result.dry_run ? '<strong>Preview only — nothing was written.</strong> ' : ''}
      Assessed ${result.areas_assessed} areas · ${result.areas_alerting} alerting ·
      ${result.alerts_created} alert(s) created ·
      ${result.alerts_suppressed_as_duplicate} suppressed as duplicates.
      ${result.note ? `<br><em>${escapeHtml(result.note)}</em>` : ''}
    </p>`;

  const acting = result.assessments.filter((a) => a.severity);
  const quiet = result.assessments.filter((a) => !a.severity);

  if (!acting.length) {
    out.innerHTML = head + '<p class="empty-state">No area crossed an alert threshold. Nothing to do.</p>'
      + quietBlock(quiet);
    return;
  }

  acting.sort((a, b) => (SEVERITY_TIER[a.severity] || 9) - (SEVERITY_TIER[b.severity] || 9));

  const cards = acting.map((a) => `
    <div class="site-card">
      <div class="site-card-top">
        <strong>${escapeHtml(a.area)}</strong>
        <span class="tier-badge tier-${SEVERITY_TIER[a.severity] || 3}">${a.severity.toUpperCase()}</span>
      </div>
      <div class="site-meta">
        ${escapeHtml(a.region || '—')} · ${a.heat_index_f ?? '?'}°F · vulnerability ${a.risk_score ?? '?'}
        · ${a.open_site_nearby ? 'open site nearby' : '<strong>no open site nearby</strong>'}
        ${a.escalated ? ' · <strong>escalated</strong>' : ''}
        ${a.alert_created ? ' · alert written' : ''}
      </div>
      ${reasonList(a.reasons)}
      ${a.contacts.length ? `
        <p class="hint" style="margin:0.5rem 0 0.25rem;"><strong>Contact first (${a.contacts.length}):</strong></p>
        <ol class="reason-list">
          ${a.contacts.slice(0, 8).map((c) =>
            `<li>Tier ${c.priority_tier} · ${escapeHtml(c.full_name)} · ${escapeHtml(c.city || '')} ${escapeHtml(c.zip)} · ${c.distance_mi} mi</li>`
          ).join('')}
        </ol>
        ${a.contacts.length > 8 ? `<p class="hint">…and ${a.contacts.length - 8} more.</p>` : ''}` : ''}
    </div>`).join('');

  out.innerHTML = head + cards + quietBlock(quiet);
}

function quietBlock(quiet) {
  if (!quiet.length) return '';
  return `
    <p class="hint" style="margin-top:1rem;"><strong>No action needed (${quiet.length}):</strong></p>
    <ul class="reason-list">
      ${quiet.map((a) => `<li>${escapeHtml(a.area)} — ${escapeHtml(a.reasons[0] || '')}</li>`).join('')}
    </ul>`;
}

function renderDispatch(plan) {
  const out = document.getElementById('agent-output');
  const head = `
    <p class="hint">
      ${plan.shifts_considered} scheduled shift(s) in the next ${plan.window_hours}h ·
      ${plan.assignments_made} assignment(s) · ${plan.residents_planned} resident(s) planned.
      ${plan.note ? `<br><em>${escapeHtml(plan.note)}</em>` : ''}
    </p>`;

  const gaps = plan.coverage_gaps.length ? `
    <div class="admin-panel" style="background:#FDE8E4;border-color:#F4C9C0;margin:0.75rem 0;">
      <strong>Coverage gaps — high-need areas with nobody scheduled (${plan.coverage_gaps.length})</strong>
      <ul class="reason-list">
        ${plan.coverage_gaps.map((g) =>
          `<li><strong>${escapeHtml(g.area)}</strong> (${escapeHtml(g.region || '—')}) — ${escapeHtml(g.why)}</li>`
        ).join('')}
      </ul>
    </div>` : '';

  const assignments = plan.assignments.length ? plan.assignments.map((a) => `
    <div class="site-card">
      <div class="site-card-top">
        <strong>${escapeHtml(a.volunteer)}</strong>
        <span class="badge">${escapeHtml(a.area)}</span>
      </div>
      <div class="site-meta">
        ${new Date(a.shift_start).toLocaleString()} – ${new Date(a.shift_end).toLocaleTimeString()}
        · ${escapeHtml(a.site.name)} · ${escapeHtml(a.site.address)}
      </div>
      <p class="hint" style="margin:0.35rem 0;">${escapeHtml(a.why)}</p>
      ${a.warning ? `<p class="error-state" style="margin:0.35rem 0;">${escapeHtml(a.warning)}</p>` : ''}
      ${a.check_ins.length ? `
        <p class="hint" style="margin:0.5rem 0 0.25rem;"><strong>Check in on:</strong></p>
        <ol class="reason-list">
          ${a.check_ins.map((c) =>
            `<li>Tier ${c.priority_tier} · ${escapeHtml(c.full_name)} · ${c.distance_mi} mi</li>`).join('')}
        </ol>`
        : '<p class="hint">No registered residents in range for this shift.</p>'}
    </div>`).join('')
    : '<p class="empty-state">No shifts are scheduled in this window, so there is nothing to plan.</p>';

  const unmatched = plan.unmatched_shifts.length ? `
    <p class="hint" style="margin-top:1rem;"><strong>Shifts outside the pilot region (${plan.unmatched_shifts.length}):</strong></p>
    <ul class="reason-list">
      ${plan.unmatched_shifts.map((u) =>
        `<li>${escapeHtml(u.volunteer)} at ${escapeHtml(u.site)} — ${escapeHtml(u.why)}</li>`).join('')}
    </ul>` : '';

  out.innerHTML = head + gaps + assignments + unmatched;
}

async function callAgent(fn, label, render) {
  agentBusy(true, label);
  try {
    render(await fn());
  } catch (err) {
    document.getElementById('agent-output').innerHTML =
      `<p class="error-state">${escapeHtml(err.message)}</p>`;
  } finally {
    agentBusy(false);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('heat-watch-preview-btn').addEventListener('click', () =>
    callAgent(() => runHeatWatch(true), 'Previewing heat watch…', renderHeatWatch));

  document.getElementById('heat-watch-run-btn').addEventListener('click', () =>
    callAgent(() => runHeatWatch(false), 'Running heat watch…', renderHeatWatch));

  document.getElementById('dispatch-btn').addEventListener('click', () => {
    const hours = Number(document.getElementById('dispatch-hours').value) || 12;
    callAgent(() => fetchDispatchPlan(hours), 'Building outreach plan…', renderDispatch);
  });
});
