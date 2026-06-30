'use strict';

const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const { run }  = require('./src/pipeline');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// ── Ensure required directories exist ─────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const OUTPUT_DIR  = path.join(__dirname, 'output');
[UPLOADS_DIR, OUTPUT_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ── Multer config ──────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename:    (req, file, cb) => cb(null, `${Date.now()}-${file.fieldname}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

const uploadFields = upload.fields([
  { name: 'ats',    maxCount: 1 },
  { name: 'csv',    maxCount: 1 },
  { name: 'resume', maxCount: 1 },
  { name: 'notes',  maxCount: 1 },
]);

// ── Routes ─────────────────────────────────────────────────────────────────────

app.get('/', (req, res) => res.render('index', { error: null }));

app.post('/run', uploadFields, async (req, res) => {
  const files  = req.files || {};
  const body   = req.body  || {};

  const filePath = (key) => files[key]?.[0]?.path || null;

  const sources = {
    ats:    filePath('ats'),
    csv:    filePath('csv'),
    resume: filePath('resume'),
    notes:  filePath('notes'),
    github: (body.github || '').trim() || null,
  };

  const hasSource = Object.values(sources).some(Boolean);
  if (!hasSource) {
    cleanUploads(files);
    return res.render('index', { error: 'Please provide at least one source (file upload or GitHub username).' });
  }

  let config = null;
  if (body.config === 'custom') {
    try { config = JSON.parse(fs.readFileSync(path.join(__dirname, 'configs', 'custom_config.json'), 'utf-8')); }
    catch { /* fall back to null (full canonical) */ }
  }

  const strict  = body.strict  === 'on';
  const verbose = body.verbose  === 'on';

  if (verbose) process.env.LOG_LEVEL = 'debug';

  try {
    const result = await run(sources, config, {
      strict,
      dryRun:         false,
      collectMetrics: true,
    });

    saveOutput('canonical',    result.canonical);
    if (result.output) saveOutput('projected', result.output);
    saveOutput('decision_log', result.canonical?.decision_log || []);
    saveOutput('validation',   result.validationResult || {});

    cleanUploads(files);

    const viewData = buildViewData(result);
    return res.render('result', viewData);

  } catch (err) {
    cleanUploads(files);
    return res.render('result', { result: null, error: err.message, config: body.config || 'default' });
  } finally {
    if (verbose) process.env.LOG_LEVEL = 'info';
  }
});

app.post('/run-examples', async (req, res) => {
  const ex = path.join(__dirname, 'examples');
  const sources = {
    ats:    path.join(ex, 'ats_data.json'),
    csv:    path.join(ex, 'recruiter.csv'),
    resume: path.join(ex, 'resume.txt'),
    notes:  path.join(ex, 'notes.txt'),
    github: null,
  };

  const body = req.body || {};
  let config = null;
  if (body.config === 'custom') {
    try { config = JSON.parse(fs.readFileSync(path.join(__dirname, 'configs', 'custom_config.json'), 'utf-8')); }
    catch {}
  }

  try {
    const result = await run(sources, config, { strict: false, dryRun: false, collectMetrics: true });
    saveOutput('canonical',    result.canonical);
    if (result.output) saveOutput('projected', result.output);
    saveOutput('decision_log', result.canonical?.decision_log || []);
    saveOutput('validation',   result.validationResult || {});

    const viewData = buildViewData(result);
    return res.render('result', viewData);
  } catch (err) {
    return res.render('result', { result: null, error: err.message, config: 'default' });
  }
});

// ── Download endpoints ─────────────────────────────────────────────────────────
app.get('/download/:type', (req, res) => {
  const allowed = ['canonical', 'projected', 'decision_log', 'validation'];
  const { type } = req.params;
  if (!allowed.includes(type)) return res.status(404).send('Not found');

  const file = path.join(OUTPUT_DIR, `${type}.json`);
  if (!fs.existsSync(file)) return res.status(404).send('No output yet — run the pipeline first.');
  res.download(file, `${type}.json`);
});

// ── Last-result preview (GET, reads saved output files) ────────────────────────
app.get('/last-result', (req, res) => {
  const read = (name) => {
    try { return JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, `${name}.json`), 'utf-8')); }
    catch { return null; }
  };
  const canonical = read('canonical');
  if (!canonical) return res.status(404).send('No result yet — run the pipeline first.');
  const result = {
    canonical,
    output:          read('projected'),
    validationResult: read('validation'),
    metrics:         canonical.metrics || {},
    candidateCount:  1,
  };
  res.render('result', buildViewData(result));
});

// ── Favicon ────────────────────────────────────────────────────────────────────
app.get('/favicon.ico', (req, res) => res.status(204).end());

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Normalise a pipeline result (single or multi-candidate) into view data.
 * For multi-candidate runs, exposes the highest-confidence profile as primary
 * and reports the total candidate count.
 */
function buildViewData(result) {
  return {
    result:        result,
    error:         null,
    config:        'default',
    candidateCount: result.candidateCount || 1,
  };
}

function saveOutput(name, data) {
  try {
    const serialized = JSON.stringify(data, null, 2);
    if (serialized !== undefined) {
      fs.writeFileSync(path.join(OUTPUT_DIR, `${name}.json`), serialized);
    }
  } catch {}
}

function cleanUploads(files) {
  Object.values(files).flat().forEach(f => {
    try { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch {}
  });
}

// ── Start ──────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Candidate Transformer — listening on port ${PORT}`);
});
