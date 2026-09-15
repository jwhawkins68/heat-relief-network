// Heat Relief Network — resident-facing map + list view.
// Wires the UI to the real backend (GET /api/sites, GET /api/sites/:id,
// GET /api/alerts) instead of the mock data used in the earlier prototype.

const state = {
  sites: [],
  markers: new Map(), // site id -> Leaflet marker
  selectedSiteId: null,
};

const DEFAULT_CENTER = [39.8, -98.6]; // roughly the center of the contiguous US
const DEFAULT_ZOOM = 4;

let map;
let markerLayer;
let riskLayer;

function initMap() {
  map = L.map('map').setView(DEFAULT_CENTER, DEFAULT_ZOOM);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  riskLayer = L.layerGroup(); // not added to the map until the toggle is checked
}

/** Red-orange-yellow scale for a 0-100 priority score. */
function riskColor(score) {
  if (score >= 70) return '#b3261e'; // critical
  if (score >= 45) return '#c1440e'; // high
  if (score >= 20) return '#b4740e'; // moderate
  return '#6b8f4e'; // low
}

async function loadRiskAreas() {
  riskLayer.clearLayers();
  try {
    const areas = await fetchRiskAreas();
    areas.forEach((area) => {
      if (area.lat == null || area.lon == null) return;
      const circle = L.circle([area.lat, area.lon], {
        radius: 900,
        color: riskColor(area.priority_score),
        fillColor: riskColor(area.priority_score),
        fillOpacity: 0.35,
        weight: 1,
      }).bindPopup(
        `<strong>${escapeHtml(area.name)}</strong><br>Priority score: ${area.priority_score}` +
          (area.nearest_open_site
            ? `<br>Nearest open site: ${escapeHtml(area.nearest_open_site.name)}`
            : '<br>No open site nearby')
      );
      riskLayer.addLayer(circle);
    });
  } catch (err) {
    console.warn('Failed to load priority areas:', err.message);
  }
}

function typeLabel(type) {
  return {
    cooling_center: 'Cooling center',
    water_station: 'Water station',
    shade: 'Shade',
    splash_pad: 'Splash pad',
  }[type] || type;
}

function statusLabel(status) {
  return {
    open: 'Open',
    closed: 'Closed',
    full: 'Full',
    unknown: 'Unknown',
  }[status] || status;
}

function formatDistance(meters) {
  if (meters === undefined || meters === null) return null;
  const miles = meters / 1609.34;
  return `${miles.toFixed(1)} mi away`;
}

function readFilters() {
  const form = document.getElementById('filters-form');
  const data = new FormData(form);
  const zip = (data.get('zip') || '').trim();
  return {
    zip: zip || undefined,
    lat: data.get('lat') || undefined,
    lon: data.get('lon') || undefined,
    radius_m: data.get('radius_m') || undefined,
    type: data.get('type') || undefined,
    open_only: document.getElementById('open_only').checked ? 'true' : undefined,
  };
}

async function loadSites() {
  const listEl = document.getElementById('site-list');
  listEl.innerHTML = '<p class="empty-state">Loading sites…</p>';

  const filters = readFilters();

  // A ZIP code takes priority over manually-entered lat/lon: resolve it to
  // coordinates first (and write them into the advanced lat/lon fields, so
  // the map still re-centers on the ZIP even when zero sites are nearby).
  if (filters.zip) {
    try {
      const place = await geocodeZip(filters.zip);
      document.getElementById('lat').value = place.lat;
      document.getElementById('lon').value = place.lon;
      filters.lat = place.lat;
      filters.lon = place.lon;
    } catch (err) {
      listEl.innerHTML = `<p class="error-state">${err.message}</p>`;
      return;
    }
  }

  try {
    const sites = await fetchSites(filters);
    state.sites = sites;
    renderSiteList(sites);
    renderMarkers(sites);
  } catch (err) {
    listEl.innerHTML = `<p class="error-state">Couldn't load sites: ${err.message}. Is the backend running at ${API_BASE}?</p>`;
  }
}

function renderSiteList(sites) {
  const listEl = document.getElementById('site-list');
  listEl.innerHTML = '';

  if (sites.length === 0) {
    listEl.innerHTML = '<p class="empty-state">No sites match these filters yet.</p>';
    return;
  }

  sites.forEach((site) => {
    const card = document.createElement('div');
    card.className = 'site-card';
    card.dataset.siteId = site.id;

    const distance = formatDistance(site.distance_m);

    card.innerHTML = `
      <div class="site-card-top">
        <h3>${escapeHtml(site.name)}</h3>
        <span class="badge status-${site.status}">${statusLabel(site.status)}</span>
      </div>
      <p class="site-meta">
        <span class="badge type">${typeLabel(site.type)}</span>
        ${distance ? ` · ${distance}` : ''}
      </p>
      <p class="site-meta">${escapeHtml(site.address)}</p>
      ${site.hours_text ? `<p class="site-meta">🕒 ${escapeHtml(site.hours_text)}</p>` : ''}
      <div class="site-detail" hidden></div>
    `;

    card.addEventListener('click', () => selectSite(site.id));
    listEl.appendChild(card);
  });
}

function renderMarkers(sites) {
  markerLayer.clearLayers();
  state.markers.clear();

  const bounds = [];

  sites.forEach((site) => {
    if (site.lat === null || site.lon === null || site.lat === undefined || site.lon === undefined) {
      return;
    }

    const marker = L.marker([site.lat, site.lon])
      .addTo(markerLayer)
      .bindPopup(`<strong>${escapeHtml(site.name)}</strong><br>${escapeHtml(site.address)}<br>${statusLabel(site.status)}`);

    marker.on('click', () => selectSite(site.id, { fromMarker: true }));

    state.markers.set(site.id, marker);
    bounds.push([site.lat, site.lon]);
  });

  if (bounds.length === 1) {
    map.setView(bounds[0], 13);
  } else if (bounds.length > 1) {
    map.fitBounds(bounds, { padding: [30, 30] });
  } else {
    const filters = readFilters();
    if (filters.lat && filters.lon) {
      map.setView([Number(filters.lat), Number(filters.lon)], 12);
    }
  }
}

async function selectSite(id, { fromMarker = false } = {}) {
  state.selectedSiteId = id;

  document.querySelectorAll('.site-card').forEach((el) => {
    el.classList.toggle('selected', el.dataset.siteId === id);
  });

  const marker = state.markers.get(id);
  if (marker) {
    map.panTo(marker.getLatLng());
    marker.openPopup();
  }

  const card = document.querySelector(`.site-card[data-site-id="${id}"]`);
  if (!card) return;

  if (fromMarker) {
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  const detailEl = card.querySelector('.site-detail');

  if (!detailEl.hidden) {
    if (fromMarker) return; // keep it open when triggered from the map
    detailEl.hidden = true; // clicking an already-open card closes it
    return;
  }

  detailEl.hidden = false;
  detailEl.innerHTML = 'Loading details…';

  try {
    const site = await fetchSiteDetail(id);
    detailEl.innerHTML = renderSiteDetail(site);
  } catch (err) {
    detailEl.innerHTML = `<span class="error-state">Couldn't load details: ${err.message}</span>`;
  }
}

function renderSiteDetail(site) {
  const inventoryRows = (site.inventory || [])
    .map((item) => `<li>${escapeHtml(item.item)}: <strong>${escapeHtml(item.level)}</strong></li>`)
    .join('');

  return `
    ${site.capacity ? `<p><strong>Capacity:</strong> ${site.capacity}</p>` : ''}
    ${site.languages && site.languages.length ? `<p><strong>Languages:</strong> ${site.languages.map(escapeHtml).join(', ')}</p>` : ''}
    ${site.accessibility && site.accessibility.length ? `<p><strong>Accessibility:</strong> ${site.accessibility.map(escapeHtml).join(', ')}</p>` : ''}
    ${inventoryRows ? `<p><strong>Supplies:</strong></p><ul>${inventoryRows}</ul>` : '<p class="hint">No supply data reported for this site yet.</p>'}
    ${site.status_updated_at ? `<p class="hint">Status last updated ${new Date(site.status_updated_at).toLocaleString()}</p>` : ''}
  `;
}

async function loadAlerts(region) {
  const banner = document.getElementById('alert-banner');
  if (!region) {
    banner.classList.remove('has-alerts');
    banner.innerHTML = '';
    return;
  }

  try {
    const alerts = await fetchAlerts(region);
    if (alerts.length === 0) {
      banner.classList.remove('has-alerts');
      banner.innerHTML = '';
      return;
    }
    banner.innerHTML = alerts
      .map(
        (alert) => `
        <div class="alert-card ${alert.severity}">
          <div>${escapeHtml(alert.message)}</div>
          <div class="alert-meta">${escapeHtml(alert.region)} · ${escapeHtml(alert.severity)} · source: ${escapeHtml(alert.source)}</div>
        </div>`
      )
      .join('');
    banner.classList.add('has-alerts');
  } catch (err) {
    // Alerts are best-effort — don't block the rest of the page on failure.
    banner.classList.remove('has-alerts');
    banner.innerHTML = '';
    console.warn('Failed to load alerts:', err.message);
  }
}

function useMyLocation() {
  if (!navigator.geolocation) {
    alert('Geolocation is not supported by this browser.');
    return;
  }
  const btn = document.getElementById('use-location-btn');
  btn.disabled = true;
  btn.textContent = 'Locating…';

  navigator.geolocation.getCurrentPosition(
    (position) => {
      document.getElementById('lat').value = position.coords.latitude.toFixed(5);
      document.getElementById('lon').value = position.coords.longitude.toFixed(5);
      btn.disabled = false;
      btn.textContent = '📍 Use my location';
      map.setView([position.coords.latitude, position.coords.longitude], 12);
      loadSites();
    },
    (err) => {
      btn.disabled = false;
      btn.textContent = '📍 Use my location';
      alert(`Couldn't get your location: ${err.message}`);
    }
  );
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

/**
 * Prefill the search form from the URL, so a "Show on map" link from the
 * registration results lands on the right place instead of the default view.
 */
function applyDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const lat = params.get('lat');
  const lon = params.get('lon');
  const zip = params.get('zip');

  if (zip) document.getElementById('zip').value = zip;
  if (lat && lon) {
    document.getElementById('lat').value = lat;
    document.getElementById('lon').value = lon;
  }
  return Boolean((lat && lon) || zip);
}

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  applyDeepLink();
  loadSites();

  document.getElementById('filters-form').addEventListener('submit', (e) => {
    e.preventDefault();
    loadSites();
    loadAlerts(document.getElementById('region').value.trim());
  });

  document.getElementById('use-location-btn').addEventListener('click', useMyLocation);

  document.getElementById('show_risk_areas').addEventListener('change', (e) => {
    if (e.target.checked) {
      riskLayer.addTo(map);
      if (riskLayer.getLayers().length === 0) loadRiskAreas();
    } else {
      map.removeLayer(riskLayer);
    }
  });
});
