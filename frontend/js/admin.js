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

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('org-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const orgId = document.getElementById('org_id').value.trim();
    if (orgId) loadOrgSites(orgId);
  });
});
