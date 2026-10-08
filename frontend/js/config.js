// Heat Relief Network — frontend config
//
// Base URL of the backend API. Derived from whatever host the browser used
// to load this page (localhost, 127.0.0.1, or a LAN IP like 10.80.182.162)
// rather than hardcoded to "localhost" — the backend always runs on the same
// machine as the frontend, just a different port, so this keeps working
// when a phone or another laptop on the network loads the frontend by the
// server's LAN IP instead of localhost. If the backend ever runs on a
// different host, or a different port, override that here instead.
const API_BASE = `http://${window.location.hostname}:4000`;
