import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { admin, publicConfig } from './supabase.js';
import { buildAnalytics } from './analytics.js';

const app = express();
const root = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4000);

app.use(express.json());
app.use((req, res, next) => {
  // The mobile app (and Expo web) call the API from other origins.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Only the publishable key is exposed to the browser.
app.get('/config.js', (_req, res) => {
  res.type('application/javascript').send(`window.WHATUSPENT_CONFIG = ${JSON.stringify(publicConfig)};`);
});

app.use(express.static(join(root, '..', 'public'), { extensions: ['html'] }));
// Browser build of supabase-js, served from node_modules so it always matches the server's version.
app.get('/vendor/supabase.js', (_req, res) =>
  res.sendFile(join(root, '..', 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js')),
);

// Verifies the Supabase access token sent by the app / dashboard.
async function requireUser(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: 'Invalid or expired session' });
  req.user = data.user;
  next();
}

const asyncRoute = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(err);
    res.status(500).json({ error: err.message ?? 'Server error' });
  });

app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Files in the public app-releases bucket (APK, promo video, screenshots).
app.get(
  '/api/releases',
  asyncRoute(async (_req, res) => {
    const { data, error } = await admin.storage
      .from('app-releases')
      .list('', { sortBy: { column: 'created_at', order: 'desc' } });
    if (error) throw error;
    const files = data
      .filter((f) => f.id) // skip folders
      .map((f) => ({
        name: f.name,
        size: f.metadata?.size ?? null,
        mimetype: f.metadata?.mimetype ?? null,
        createdAt: f.created_at,
        url: admin.storage.from('app-releases').getPublicUrl(f.name).data.publicUrl,
      }));
    res.json({ files });
  }),
);

app.get(
  '/api/analytics',
  requireUser,
  asyncRoute(async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 365);
    const since = new Date(Date.now() - Math.max(days * 2, 190) * 864e5).toISOString();

    const [tx, cats, profile] = await Promise.all([
      admin.from('transactions').select('*').eq('user_id', req.user.id).gte('occurred_at', since),
      admin.from('categories').select('*').or(`user_id.is.null,user_id.eq.${req.user.id}`),
      admin.from('profiles').select('*').eq('id', req.user.id).maybeSingle(),
    ]);
    for (const r of [tx, cats, profile]) if (r.error) throw r.error;

    // Balance needs all-time totals, not just the window above.
    const { data: all, error } = await admin
      .from('transactions')
      .select('kind, amount')
      .eq('user_id', req.user.id)
      .lt('occurred_at', since);
    if (error) throw error;
    const older = all.map((t) => ({ ...t, occurred_at: '1970-01-01T00:00:00Z' }));

    res.json(
      buildAnalytics({
        transactions: [...tx.data, ...older],
        categories: cats.data,
        profile: profile.data,
        days,
      }),
    );
  }),
);

// Short-lived link to a private receipt.
app.get(
  '/api/receipts/:id/url',
  requireUser,
  asyncRoute(async (req, res) => {
    const { data: tx, error } = await admin
      .from('transactions')
      .select('receipt_path')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .maybeSingle();
    if (error) throw error;
    if (!tx?.receipt_path) return res.status(404).json({ error: 'No receipt' });
    const { data, error: signErr } = await admin.storage.from('receipts').createSignedUrl(tx.receipt_path, 300);
    if (signErr) throw signErr;
    res.json({ url: data.signedUrl });
  }),
);

app.listen(PORT, () => {
  console.log(`WhatUSpent server running on http://localhost:${PORT}`);
});
