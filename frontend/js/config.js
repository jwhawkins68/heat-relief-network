// Heat Relief Network — frontend config
//
// Base URL of the backend API.
//
// Defaults to the page's own origin: whatever serves this folder proxies
// "/api/*" (and "/health") through to the backend — see frontend/README.md —
// so the app works from any host without hardcoding one.
//
// To talk to a separate API host instead (e.g. backend on :4000 while this
// folder is served by `npx serve .`), set window.HRN_API_BASE before this
// script loads, e.g. window.HRN_API_BASE = 'http://localhost:4000';
const API_BASE = window.HRN_API_BASE ?? '';
