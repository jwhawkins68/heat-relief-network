import express from 'express';
import cors from 'cors';
import 'dotenv/config';

import sitesRouter from './routes/sites.js';
import alertsRouter from './routes/alerts.js';
import orgsRouter from './routes/orgs.js';
import riskAreasRouter from './routes/risk-areas.js';
import geocodeRouter from './routes/geocode.js';
import invitesRouter from './routes/invites.js';
import residentsRouter from './routes/residents.js';
import agentsRouter from './routes/agents.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/sites', sitesRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/orgs', orgsRouter);
app.use('/api/risk-areas', riskAreasRouter);
app.use('/api/geocode', geocodeRouter);
app.use('/api/invites', invitesRouter);
app.use('/api/residents', residentsRouter);
app.use('/api/agents', agentsRouter);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`HeatSafe API listening on :${PORT}`));
