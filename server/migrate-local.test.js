const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const Database = require('better-sqlite3');
const { test } = require('node:test');

const projectRoot = path.resolve(__dirname, '..');

function runMigration(environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'migrate-local.js')], {
      cwd: projectRoot,
      env: { ...process.env, ...environment },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });
}

test('local archive import uploads once and skips the same source on retry', async () => {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'e-arsip-migration-test-'));
  const databasePath = path.join(tempRoot, 'local.db');
  const attachmentPath = path.join(tempRoot, 'report.pdf');
  const attachment = Buffer.from('local archive fixture');
  await fs.promises.writeFile(attachmentPath, attachment);

  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      format TEXT NOT NULL,
      year_period INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER,
      sha256 TEXT
    )
  `);
  database.prepare(`
    INSERT INTO documents (id, title, category, format, year_period, file_path, file_size, sha256)
    VALUES (1, 'Arsip Uji', 'Anggaran', 'PDF', 2026, ?, ?, ?)
  `).run(attachmentPath, attachment.length, crypto.createHash('sha256').update(attachment).digest('hex'));
  database.close();

  const seenSources = new Set();
  let uploadCount = 0;
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/auth/login') {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ token: 'test-token' }));
      });
      return;
    }
    if (req.method === 'POST' && req.url === '/api/documents') {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const sourceId = req.headers['x-legacy-source-id'];
        const body = Buffer.concat(chunks).toString('utf8');
        assert.equal(req.headers.authorization, 'Bearer test-token');
        assert.match(sourceId, /^[a-f0-9]{64}$/);
        assert.match(body, /local archive fixture/);
        uploadCount += 1;
        const skipped = seenSources.has(sourceId);
        seenSources.add(sourceId);
        res.writeHead(skipped ? 200 : 201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, skipped }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    const environment = {
      EARSIP_API_URL: `http://127.0.0.1:${address.port}`,
      EARSIP_ADMIN_USERNAME: 'test-admin',
      EARSIP_ADMIN_PASSWORD: 'test-password',
      EARSIP_LOCAL_DB: databasePath,
    };
    const firstRun = await runMigration(environment);
    assert.equal(firstRun.code, 0, firstRun.output);
    assert.match(firstRun.output, /Diimpor baru: 1/);

    const retry = await runMigration(environment);
    assert.equal(retry.code, 0, retry.output);
    assert.match(retry.output, /dilewati\/sudah ada: 1/);
    assert.equal(uploadCount, 2);
  } finally {
    server.close();
    await once(server, 'close');
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});
