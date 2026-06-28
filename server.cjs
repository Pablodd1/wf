/**
 * Railway Production Server
 * Replaces Vercel serverless functions with Express routes
 * Serves built frontend + handles API endpoints
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

// API handlers
const listingsHandler = require('./api/listings');
const statsHandler = require('./api/stats');
const monthlyPricesHandler = require('./api/monthly-prices');
const insightDetailsHandler = require('./api/insight-details');
const catalogHandler = require('./api/catalog');
const bulkActionHandler = require('./api/bulk-action');
const updateRecordHandler = require('./api/update-record');
const exportExcelHandler = require('./api/export-excel');
const greenApiWebhookHandler = require('./api/green-api-webhook');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── API Routes ───────────────────────────────────────────────────────

// Health check (Railway uses this)
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', platform: 'railway', timestamp: new Date().toISOString() });
});

// Listings
app.get('/api/listings', (req, res) => listingsHandler(req, res));

// Stats
app.get('/api/stats', (req, res) => statsHandler(req, res));

// Monthly prices for chart
app.get('/api/monthly-prices', (req, res) => monthlyPricesHandler(req, res));

// Insight details (outlier detection)
app.get('/api/insight-details', (req, res) => insightDetailsHandler(req, res));

// Catalog lookup
app.get('/api/catalog', (req, res) => catalogHandler(req, res));

// Bulk actions (approve/recycle/review)
app.post('/api/bulk-action', (req, res) => bulkActionHandler(req, res));

// Update single record
app.post('/api/update-record', (req, res) => updateRecordHandler(req, res));

// Export Excel
app.post('/api/export-excel', (req, res) => exportExcelHandler(req, res));

// Green API webhook (WhatsApp)
app.post('/api/green-api-webhook', (req, res) => greenApiWebhookHandler(req, res));

// ─── Static Files ─────────────────────────────────────────────────────

// Serve built frontend
app.use(express.static(path.join(__dirname, 'dist')));

// SPA fallback — all routes → index.html (React Router handles routing)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚂 WatchFacts running on Railway — Port ${PORT}`);
  console.log(`📊 API: /api/stats, /api/listings, /api/catalog`);
  console.log(`📱 Webhook: /api/green-api-webhook`);
  console.log(`💾 DB: Supabase`);
});
