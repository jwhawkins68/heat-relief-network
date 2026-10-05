# Development notes

- Use `docker compose -f docker-compose.base44.yml up -d` for the preview. Port 3000 serves the bind-mounted frontend through Vite; `/api` is proxied to the internal API. Keep frontend API calls same-origin, not browser localhost.
- The `setup` service applies schema and the repository's five example priority areas transactionally only when `public.sites` does not exist. Existing database volumes are preserved. Later schema changes need explicit migrations; rerunning setup does not migrate existing tables.
- The API computes area risk scores at startup before starting its Node watch process. Frontend changes reload through Vite (polling enabled); backend changes restart through Node watch.
- There are no seeded sites, organizations, or alerts. An empty resident site list is expected, not an API failure. The existing example areas are demo data, not current heat conditions.
- No external credentials are currently needed. Twilio and weather polling are stubs; do not request their credentials just to start the app.
- Verify with `docker compose -f docker-compose.base44.yml ps`, `curl -fsS http://localhost:3000/`, `curl -fsS http://localhost:3000/api/sites`, and `curl -fsS http://localhost:3000/api/risk-areas`. All long-running services should be healthy; setup should exit 0. There is no automated test suite configured.
- The org portal has no authentication in this scaffold. Do not treat it as a secure production deployment.
