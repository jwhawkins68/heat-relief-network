import express from 'express';
import cors from 'cors';
import 'dotenv/config';

import sitesRouter from './routes/sites.js';
import alertsRouter from './routes/alerts.js';
import orgsRouter from './routes/orgs.js';
import riskAreasRouter from './routes/risk-areas.js';
import geocodeRouter from './routes/geocode.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/sites', sitesRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/orgs', orgsRouter);
app.use('/api/risk-areas', riskAreasRouter);
app.use('/api/geocode', geocodeRouter);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Heat Relief Network API listening on :${PORT}`));
