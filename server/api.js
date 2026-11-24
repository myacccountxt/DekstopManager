const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const multer = require('multer');
const { Pool } = require('pg');
const { rateLimit } = require('express-rate-limit');
const categoryGroups = require('../shared/document-categories.json');

const categories = new Set(categoryGroups.flatMap((group) => group.items));
const storageRoot = path.resolve(process.env.EARSIP_STORAGE_PATH || path.join(__dirname, '..', 'server-data', 'files'));
const uploadRoot = path.join(os.tmpdir(), 'e-arsip-instansi-upload');
const maxFileSize = Number(process.env.EARSIP_MAX_FILE_SIZE || 1024 * 1024 * 1024);
const sessionDays = Number(process.env.EARSIP_SESSION_DAYS || 7);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const eventClients = new Map();
const scrypt = (password, salt) => new Promise((resolve, reject) => {
  crypto.scrypt(password, salt, 64, (error, key) => (error ? reject(error) : resolve(key)));
});

async function createPasswordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scrypt(password, salt);
  return `scrypt:${salt}:${key.toString('hex')}`;
}

async function verifyPassword(stored, password) {
  const [, salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = await scrypt(password, salt);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function removeFile(filePath, context) {
  try {
    await fs.promises.rm(filePath, { force: true });
  } catch (error) {
    console.error(`Unable to clean up ${context}:`, error);
  }
}

function publicUser(user) {
  return { id: user.id, username: user.username, role: user.role };
}

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS organizations (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      organization_id BIGINT NOT NULL REFERENCES organizations(id),
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
      recovery_code_hash TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id, username)
    );
    CREATE TABLE IF NOT EXISTS invitations (
      id BIGSERIAL PRIMARY KEY,
      organization_id BIGINT NOT NULL REFERENCES organizations(id),
      username TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS documents (
      id BIGSERIAL PRIMARY KEY,
      organization_id BIGINT NOT NULL REFERENCES organizations(id),
      created_by BIGINT NOT NULL REFERENCES users(id),
      legacy_source_id TEXT,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      format TEXT NOT NULL,
      year_period INTEGER NOT NULL CHECK (year_period BETWEEN 1900 AND 9999),
      status TEXT NOT NULL DEFAULT 'Final TTE',
      file_key TEXT NOT NULL,
      file_name TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      file_size BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS documents_org_category_idx ON documents (organization_id, category);
    CREATE INDEX IF NOT EXISTS documents_org_year_idx ON documents (organization_id, year_period DESC);
    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY,
      organization_id BIGINT NOT NULL REFERENCES organizations(id),
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      document_id BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS users_org_username_ci_idx ON users (organization_id, lower(username));
    ALTER TABLE documents ADD COLUMN IF NOT EXISTS legacy_source_id TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS documents_org_legacy_source_idx
      ON documents (organization_id, legacy_source_id) WHERE legacy_source_id IS NOT NULL;
  `);
  await fs.promises.mkdir(storageRoot, { recursive: true });
  await fs.promises.mkdir(uploadRoot, { recursive: true });
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.EARSIP_TRUST_PROXY === 'true') app.set('trust proxy', 1);
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message: 'Terlalu banyak percobaan login. Tunggu 15 menit lalu coba kembali.' },
  });
  const uploader = multer({
    dest: uploadRoot,
    limits: { fileSize: maxFileSize, files: 1 },
  });

  async function requireAuth(req, res, next) {
    try {
      const token = (req.get('authorization') || '').match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1];
      if (!token) return res.status(401).json({ message: 'Sesi tidak ditemukan. Silakan masuk kembali.' });
      const result = await pool.query(
        `SELECT u.id, u.username, u.role, u.organization_id
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
        [sha256(token)],
      );
      if (!result.rowCount) return res.status(401).json({ message: 'Sesi sudah berakhir. Silakan masuk kembali.' });
      req.user = result.rows[0];
      next();
    } catch (error) {
      next(error);
    }
  }

  function requireRole(...roles) {
    return (req, res, next) => {
      if (!roles.includes(req.user.role)) return res.status(403).json({ message: 'Anda tidak memiliki izin untuk melakukan tindakan ini.' });
      next();
    };
  }

async function saveFile(file, organizationId) {
    const originalName = path.basename(String(file.originalname || 'dokumen')).replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').slice(0, 240) || 'dokumen';
    const ext = path.extname(originalName).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 16);
    const fileKey = path.join(String(organizationId), `${crypto.randomUUID()}${ext}`);
    const target = path.resolve(storageRoot, fileKey);
    if (!target.startsWith(`${storageRoot}${path.sep}`)) throw new Error('Lokasi penyimpanan file tidak valid.');
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.copyFile(file.path, target);
    await fs.promises.unlink(file.path).catch(() => {});

    try {
      return { fileKey, fileName: originalName, sha256: await hashFile(target), fileSize: file.size };
    } catch (error) {
      await removeFile(target, 'uploaded file after checksum failure');
      throw error;
    }
  }

  async function hashFile(filePath) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
    return hash.digest('hex');
  }

  function filePathFor(fileKey) {
    const target = path.resolve(storageRoot, fileKey);
    if (!target.startsWith(`${storageRoot}${path.sep}`)) throw new Error('Lokasi file tidak valid.');
    return target;
  }

  function publishDocumentChange(organizationId, action) {
    for (const client of eventClients.get(String(organizationId)) || []) {
      try {
        client.write(`event: documents.changed\ndata: ${JSON.stringify({ action })}\n\n`);
      } catch (error) {
        console.error('Unable to notify a document event client:', error);
        client.end();
      }
    }
  }

  app.get('/api/health', async (_, res, next) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/auth/register', async (req, res, next) => {
    const { username, password, confirmPassword, inviteCode } = req.body || {};
    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(String(username || ''))) {
      return res.status(400).json({ message: 'Username harus 3-32 karakter dan hanya boleh berisi huruf, angka, titik, garis bawah, atau tanda hubung.' });
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 256 || password !== confirmPassword) {
      return res.status(400).json({ message: 'Password minimal 8 karakter dan konfirmasi harus sesuai.' });
    }
    if (typeof inviteCode !== 'string' || inviteCode.length < 20) {
      return res.status(400).json({ message: 'Kode undangan tidak valid.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const invitation = await client.query(
        `SELECT id, organization_id, username, role FROM invitations
          WHERE token_hash = $1 AND expires_at > NOW() AND used_at IS NULL
          FOR UPDATE`,
        [sha256(inviteCode)],
      );
      const invite = invitation.rows[0];
      if (!invite || invite.username.toLowerCase() !== username.toLowerCase()) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Kode undangan tidak valid, kedaluwarsa, atau tidak sesuai dengan username.' });
      }
      const passwordHash = await createPasswordHash(password);
      const inserted = await client.query(
        `INSERT INTO users (organization_id, username, password_hash, role)
         VALUES ($1, $2, $3, $4) RETURNING id, username, role`,
        [invite.organization_id, username, passwordHash, invite.role],
      );
      await client.query('UPDATE invitations SET used_at = NOW() WHERE id = $1', [invite.id]);
      await client.query('COMMIT');
      res.status(201).json({ success: true, user: publicUser(inserted.rows[0]) });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') return res.status(409).json({ message: 'Username sudah digunakan.' });
      next(error);
    } finally {
      client.release();
    }
  });

  app.post('/api/auth/login', loginLimiter, async (req, res, next) => {
    try {
      const { username, password } = req.body || {};
      if (typeof username !== 'string' || !username.trim() ||
        typeof password !== 'string' || !password.length || password.length > 256) {
        return res.status(400).json({ message: 'Username dan password wajib diisi; password maksimal 256 karakter.' });
      }
      const result = await pool.query(
        'SELECT id, username, role, organization_id, password_hash FROM users WHERE lower(username) = lower($1)',
        [username.trim()],
      );
      const user = result.rows[0];
      if (!user || !(await verifyPassword(user.password_hash, String(password)))) {
        return res.status(401).json({ message: 'Username atau password salah.' });
      }
      const token = crypto.randomBytes(32).toString('base64url');
      await pool.query(
        `INSERT INTO sessions (user_id, token_hash, expires_at)
         VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 day'))`,
        [user.id, sha256(token), sessionDays],
      );
      res.json({ success: true, token, user: publicUser(user) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/auth/logout', requireAuth, async (req, res, next) => {
    try {
      await pool.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(req.get('authorization').slice(7))]);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/auth/reset-password', async (req, res, next) => {
    const { username, currentPassword, recoveryCode, newPassword, confirmPassword } = req.body || {};
    if (!username || (!currentPassword && !recoveryCode) || typeof newPassword !== 'string' ||
      newPassword.length < 8 || newPassword.length > 256 || newPassword !== confirmPassword) {
      return res.status(400).json({ message: 'Periksa username, kata sandi/kode pemulihan, dan konfirmasi password.' });
    }
    try {
      const result = await pool.query(
        'SELECT id, password_hash, recovery_code_hash FROM users WHERE lower(username) = lower($1)',
        [String(username).trim()],
      );
      const user = result.rows[0];
      if (!user) return res.status(400).json({ message: 'Username atau kredensial pemulihan salah.' });
      const expectedCode = Buffer.from(user.recovery_code_hash || '', 'hex');
      const suppliedCode = Buffer.from(sha256(String(recoveryCode || '').replace(/-/g, '').toUpperCase()), 'hex');
      const valid = currentPassword
        ? await verifyPassword(user.password_hash, currentPassword)
        : expectedCode.length === suppliedCode.length && crypto.timingSafeEqual(expectedCode, suppliedCode);
      if (!valid) return res.status(400).json({ message: 'Username atau kode pemulihan salah/kedaluwarsa.' });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'UPDATE users SET password_hash = $1, recovery_code_hash = NULL WHERE id = $2',
          [await createPasswordHash(newPassword), user.id],
        );
        await client.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      res.json({ success: true, message: 'Password berhasil diubah.' });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/auth/recovery-code', requireAuth, async (req, res, next) => {
    try {
      const code = crypto.randomBytes(16).toString('hex').toUpperCase().match(/.{1,4}/g).join('-');
      await pool.query('UPDATE users SET recovery_code_hash = $1 WHERE id = $2', [
        sha256(code.replace(/-/g, '')),
        req.user.id,
      ]);
      res.json({ success: true, recoveryCode: code });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

  app.post('/api/admin/invitations', requireAuth, requireRole('admin'), async (req, res, next) => {
    const { username, role = 'editor' } = req.body || {};
    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(String(username || '')) || !['admin', 'editor', 'viewer'].includes(role)) {
      return res.status(400).json({ message: 'Username atau peran undangan tidak valid.' });
    }
    try {
      const token = crypto.randomBytes(32).toString('base64url');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO invitations (organization_id, username, role, token_hash, expires_at)
           VALUES ($1, $2, $3, $4, NOW() + INTERVAL '7 days')`,
          [req.user.organization_id, username, role, sha256(token)],
        );
        await client.query(
          'INSERT INTO audit_logs (organization_id, user_id, action) VALUES ($1, $2, $3)',
          [req.user.organization_id, req.user.id, 'invitation.created'],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      res.status(201).json({ success: true, inviteCode: token, expiresInDays: 7 });
    } catch (error) {
      if (error.code === '23505') return res.status(409).json({ message: 'Username undangan sudah digunakan.' });
      next(error);
    }
  });

  app.get('/api/events/documents', requireAuth, (req, res) => {
    const orgId = String(req.user.organization_id);
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    if (!eventClients.has(orgId)) eventClients.set(orgId, new Set());
    eventClients.get(orgId).add(res);
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 25_000);
    res.on('close', () => {
      clearInterval(heartbeat);
      eventClients.get(orgId)?.delete(res);
      if (!eventClients.get(orgId)?.size) eventClients.delete(orgId);
    });
  });

  app.get('/api/documents', requireAuth, async (req, res, next) => {
    try {
      const conditions = ['organization_id = $1'];
      const params = [req.user.organization_id];
      if (req.query.category) {
        conditions.push(`category = $${params.push(String(req.query.category))}`);
      }
      if (req.query.yearPeriod) {
        const year = Number(req.query.yearPeriod);
        if (!Number.isInteger(year) || year < 1900 || year > 9999) return res.status(400).json({ message: 'Periode tidak valid.' });
        conditions.push(`year_period = $${params.push(year)}`);
      }
      if (req.query.search) {
        const term = `%${String(req.query.search).slice(0, 200)}%`;
        const firstParameter = params.length + 1;
        params.push(term, term);
        conditions.push(`(title ILIKE $${firstParameter} OR category ILIKE $${firstParameter + 1})`);
      }
      const result = await pool.query(
        `SELECT id, created_by, title, category, format, year_period, status,
                file_name, sha256, file_size, created_at, updated_at
           FROM documents WHERE ${conditions.join(' AND ')}
          ORDER BY year_period DESC, created_at DESC`,
        params,
      );
      res.json(result.rows.map((doc) => ({
        ...doc,
        file_available: true,
        file_state: 'available',
      })));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/documents', requireAuth, requireRole('admin', 'editor'), uploader.single('file'), async (req, res, next) => {
    let saved;
    try {
      const { title, category, year_period: yearPeriod, format } = req.body || {};
      const year = Number(yearPeriod);
      if (!req.file || !String(title || '').trim() || !categories.has(category) || !Number.isInteger(year) || year < 1900 || year > 9999) {
        if (req.file) await removeFile(req.file.path, 'invalid upload');
        return res.status(400).json({ message: 'Judul, kategori, periode, dan file lampiran yang valid wajib diisi.' });
      }
      const legacySourceId = req.get('x-legacy-source-id');
      if (legacySourceId && req.user.role !== 'admin') {
        await removeFile(req.file.path, 'unauthorized import');
        return res.status(403).json({ message: 'Hanya admin yang dapat mengimpor arsip lama.' });
      }
      if (legacySourceId) {
        if (!/^[a-f0-9]{64}$/.test(legacySourceId)) {
          await removeFile(req.file.path, 'invalid import');
          return res.status(400).json({ message: 'ID sumber impor tidak valid.' });
        }
        const priorImport = await pool.query(
          `SELECT id, created_by, title, category, format, year_period, status,
                  file_name, sha256, file_size, created_at, updated_at
             FROM documents WHERE organization_id = $1 AND legacy_source_id = $2`,
          [req.user.organization_id, legacySourceId],
        );
        if (priorImport.rowCount) {
          await removeFile(req.file.path, 'duplicate import upload');
          return res.json({
            success: true,
            skipped: true,
            document: { ...priorImport.rows[0], file_available: true, file_state: 'available' },
          });
        }
      }
      saved = await saveFile(req.file, req.user.organization_id);
      const docFormat = String(format || path.extname(saved.fileName).slice(1).toUpperCase() || 'FILE').slice(0, 16);
      const client = await pool.connect();
      let document;
      try {
        await client.query('BEGIN');
        const result = await client.query(
          `INSERT INTO documents
             (organization_id, created_by, legacy_source_id, title, category, format, year_period, file_key, file_name, sha256, file_size)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING id, created_by, title, category, format, year_period, status,
                     file_name, sha256, file_size, created_at, updated_at`,
          [req.user.organization_id, req.user.id, legacySourceId || null, String(title).trim().slice(0, 300), category, docFormat, year, saved.fileKey, saved.fileName, saved.sha256, saved.fileSize],
        );
        document = result.rows[0];
        await client.query(
          'INSERT INTO audit_logs (organization_id, user_id, action, document_id) VALUES ($1, $2, $3, $4)',
          [req.user.organization_id, req.user.id, legacySourceId ? 'document.imported' : 'document.created', document.id],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      publishDocumentChange(req.user.organization_id, 'created');
      res.status(201).json({ success: true, document: { ...document, file_available: true, file_state: 'available' } });
    } catch (error) {
      if (req.file) await removeFile(req.file.path, 'failed upload request');
      if (saved) await removeFile(filePathFor(saved.fileKey), 'failed document record');
      next(error);
    }
  });

  app.put('/api/documents/:id', requireAuth, requireRole('admin', 'editor'), uploader.single('file'), async (req, res, next) => {
    let saved;
    try {
      const { title, category, year_period: yearPeriod, format } = req.body || {};
      const year = Number(yearPeriod);
      if (!String(title || '').trim() || !categories.has(category) || !Number.isInteger(year) || year < 1900 || year > 9999) {
        if (req.file) await removeFile(req.file.path, 'invalid document update');
        return res.status(400).json({ message: 'Judul, kategori, dan periode dokumen tidak valid.' });
      }
      const client = await pool.connect();
      let document;
      let previousFileKey;
      try {
        await client.query('BEGIN');
        const previous = await client.query(
          'SELECT file_key, file_size, sha256, title FROM documents WHERE id = $1 AND organization_id = $2 FOR UPDATE',
          [req.params.id, req.user.organization_id],
        );
        if (!previous.rowCount) {
          await client.query('ROLLBACK');
          if (req.file) await removeFile(req.file.path, 'missing document update');
          return res.status(404).json({ message: 'Dokumen tidak ditemukan.' });
        }
        previousFileKey = previous.rows[0].file_key;
        if (!req.file) {
          const currentPath = filePathFor(previousFileKey);
          const stat = await fs.promises.stat(currentPath).catch(() => null);
          if (!stat || !stat.isFile()) {
            await client.query('ROLLBACK');
            return res.status(410).json({ code: 'FILE_MISSING', message: `Lampiran "${previous.rows[0].title}" tidak ditemukan. Unggah file pengganti.` });
          }
          if (stat.size !== Number(previous.rows[0].file_size) || await hashFile(currentPath) !== previous.rows[0].sha256) {
            await client.query('ROLLBACK');
            return res.status(410).json({ code: 'FILE_CHANGED', message: `Lampiran "${previous.rows[0].title}" berubah. Unggah file pengganti.` });
          }
        }
        if (req.file) saved = await saveFile(req.file, req.user.organization_id);
        const result = await client.query(
          `UPDATE documents
              SET title = $1, category = $2, year_period = $3,
                  format = COALESCE($4, format),
                  file_key = COALESCE($5, file_key),
                  file_name = COALESCE($6, file_name),
                  sha256 = COALESCE($7, sha256),
                  file_size = COALESCE($8, file_size),
                  updated_at = NOW()
            WHERE id = $9 AND organization_id = $10
            RETURNING id, created_by, title, category, format, year_period, status,
                      file_name, sha256, file_size, created_at, updated_at`,
          [
            String(title).trim().slice(0, 300),
            category,
            year,
            saved ? String(format || path.extname(saved.fileName).slice(1).toUpperCase() || 'FILE').slice(0, 16) : null,
            saved?.fileKey || null,
            saved?.fileName || null,
            saved?.sha256 || null,
            saved?.fileSize || null,
            req.params.id,
            req.user.organization_id,
          ],
        );
        document = result.rows[0];
        await client.query(
          'INSERT INTO audit_logs (organization_id, user_id, action, document_id) VALUES ($1, $2, $3, $4)',
          [req.user.organization_id, req.user.id, 'document.updated', document.id],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      if (saved) {
        await removeFile(filePathFor(previousFileKey), 'replaced document file');
      }
      publishDocumentChange(req.user.organization_id, 'updated');
      res.json({ success: true, document: { ...document, file_available: true, file_state: 'available' } });
    } catch (error) {
      if (req.file) await removeFile(req.file.path, 'failed document update');
      if (saved) await removeFile(filePathFor(saved.fileKey), 'failed updated document');
      next(error);
    }
  });

  app.delete('/api/documents/:id', requireAuth, requireRole('admin', 'editor'), async (req, res, next) => {
    try {
      const client = await pool.connect();
      let fileKey;
      try {
        await client.query('BEGIN');
        const result = await client.query(
          'DELETE FROM documents WHERE id = $1 AND organization_id = $2 RETURNING file_key',
          [req.params.id, req.user.organization_id],
        );
        if (!result.rowCount) {
          await client.query('ROLLBACK');
          return res.status(404).json({ message: 'Dokumen tidak ditemukan.' });
        }
        fileKey = result.rows[0].file_key;
        await client.query(
          'INSERT INTO audit_logs (organization_id, user_id, action, document_id) VALUES ($1, $2, $3, $4)',
          [req.user.organization_id, req.user.id, 'document.deleted', req.params.id],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      await removeFile(filePathFor(fileKey), 'deleted document file');
      publishDocumentChange(req.user.organization_id, 'deleted');
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/documents/:id/download', requireAuth, async (req, res, next) => {
    let document;
    try {
      let result;
      try {
        result = await pool.query(
          'SELECT * FROM documents WHERE id = $1 AND organization_id = $2',
          [req.params.id, req.user.organization_id],
        );
      } catch (error) {
        console.error('Unable to find document for download:', { id: req.params.id, error });
        return res.status(503).json({ code: 'DOCUMENT_LOOKUP_FAILED', message: 'Server tidak dapat membaca data dokumen dari database. Periksa koneksi database lalu coba kembali.' });
      }
      document = result.rows[0];
      if (!document) return res.status(404).json({ message: 'Dokumen tidak ditemukan.' });
      let filePath;
      try {
        filePath = filePathFor(document.file_key);
      } catch (error) {
        console.error('Invalid stored document path:', { id: document.id, error });
        return res.status(500).json({ code: 'FILE_PATH_INVALID', message: 'Lokasi lampiran di server tidak valid. Hubungi administrator.' });
      }
      let stat;
      try {
        stat = await fs.promises.stat(filePath);
      } catch (error) {
        if (error.code === 'ENOENT') {
          return res.status(410).json({ code: 'FILE_MISSING', message: `Lampiran "${document.title}" tidak ditemukan di server. Periksa volume penyimpanan atau unggah file pengganti.` });
        }
        console.error('Unable to access document file:', { id: document.id, code: error.code, error });
        return res.status(500).json({ code: 'FILE_READ_FAILED', message: `Server tidak dapat membaca lampiran "${document.title}". Periksa izin dan ruang penyimpanan server.` });
      }
      if (!stat || !stat.isFile()) {
        return res.status(410).json({ code: 'FILE_MISSING', message: `Lampiran "${document.title}" tidak ditemukan. Unggah file pengganti.` });
      }
      let actualHash;
      try {
        actualHash = await hashFile(filePath);
      } catch (error) {
        console.error('Unable to verify document file:', { id: document.id, code: error.code, error });
        return res.status(500).json({ code: 'FILE_READ_FAILED', message: `Server tidak dapat memverifikasi lampiran "${document.title}". Periksa izin dan ruang penyimpanan server.` });
      }
      if (stat.size !== Number(document.file_size) || actualHash !== document.sha256) {
        return res.status(410).json({ code: 'FILE_CHANGED', message: `Lampiran "${document.title}" berubah. Unggah file pengganti.` });
      }
      try {
        await pool.query(
          'INSERT INTO audit_logs (organization_id, user_id, action, document_id) VALUES ($1, $2, $3, $4)',
          [req.user.organization_id, req.user.id, 'document.downloaded', document.id],
        );
      } catch (error) {
        console.error('Unable to record document download:', { id: document.id, error });
        return res.status(503).json({ code: 'AUDIT_LOG_FAILED', message: 'Server tidak dapat mencatat aktivitas unduhan. Periksa koneksi database lalu coba kembali.' });
      }
      res.download(filePath, document.file_name, (error) => {
        if (!error) return;
        console.error('Document download response failed:', { id: document.id, code: error.code, error });
        if (!res.headersSent) {
          res.status(500).json({ code: 'FILE_TRANSFER_FAILED', message: 'Server gagal mengirim lampiran. Periksa koneksi dan penyimpanan server.' });
          return;
        }
        res.destroy(error);
      });
    } catch (error) {
      console.error('Document download request failed:', { id: req.params.id, error });
      if (res.headersSent) {
        res.destroy();
        return;
      }
      next(error);
    }
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof multer.MulterError) {
      const message = error.code === 'LIMIT_FILE_SIZE'
        ? `Ukuran file melebihi batas ${Math.floor(maxFileSize / (1024 * 1024))} MB.`
        : 'Unggahan file tidak valid.';
      return res.status(400).json({ message });
    }
    console.error('API request failed:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server. Silakan coba kembali.' });
  });

  return app;
}

async function createInvitation(username, role = 'editor') {
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(String(username || '')) || !['admin', 'editor', 'viewer'].includes(role)) {
    throw new Error('Username atau peran undangan tidak valid.');
  }
  const organization = await pool.query('SELECT id FROM organizations ORDER BY id LIMIT 1');
  if (!organization.rowCount) throw new Error('Instansi belum disiapkan. Jalankan bootstrap-admin terlebih dahulu.');
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query(
    `INSERT INTO invitations (organization_id, username, role, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + INTERVAL '7 days')`,
    [organization.rows[0].id, username, role, sha256(token)],
  );
  return token;
}

async function bootstrapAdmin() {
  const username = process.env.EARSIP_ADMIN_USERNAME;
  const password = process.env.EARSIP_ADMIN_PASSWORD;
  if (!username || !password || password.length < 8) {
    throw new Error('Atur EARSIP_ADMIN_USERNAME dan EARSIP_ADMIN_PASSWORD (minimal 8 karakter) sebelum bootstrap.');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let organization = await client.query('SELECT id FROM organizations ORDER BY id LIMIT 1 FOR UPDATE');
    if (!organization.rowCount) {
      organization = await client.query(
        'INSERT INTO organizations (name) VALUES ($1) RETURNING id',
        [process.env.EARSIP_ORGANIZATION_NAME || 'E-Arsip Instansi'],
      );
    }
    const existing = await client.query('SELECT id FROM users WHERE organization_id = $1 AND role = $2', [organization.rows[0].id, 'admin']);
    if (existing.rowCount) throw new Error('Admin sudah tersedia. Bootstrap dibatalkan.');
    const result = await client.query(
      `INSERT INTO users (organization_id, username, password_hash, role)
       VALUES ($1, $2, $3, 'admin') RETURNING username`,
      [organization.rows[0].id, username, await createPasswordHash(password)],
    );
    await client.query('COMMIT');
    return result.rows[0].username;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function resetAdminPassword() {
  const username = String(process.env.EARSIP_ADMIN_USERNAME || '').trim();
  const password = process.env.EARSIP_ADMIN_RESET_PASSWORD;
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username) ||
    typeof password !== 'string' || password.length < 8 || password.length > 256) {
    throw new Error('Atur EARSIP_ADMIN_USERNAME dan EARSIP_ADMIN_RESET_PASSWORD (8-256 karakter) sebelum reset.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      'SELECT id FROM users WHERE lower(username) = lower($1) AND role = $2 FOR UPDATE',
      [username, 'admin'],
    );
    if (result.rowCount !== 1) {
      throw new Error(result.rowCount ? 'Username cocok dengan lebih dari satu admin; reset dibatalkan.' : 'Admin dengan username tersebut tidak ditemukan; reset dibatalkan.');
    }

    const userId = result.rows[0].id;
    await client.query(
      'UPDATE users SET password_hash = $1, recovery_code_hash = NULL WHERE id = $2',
      [await createPasswordHash(password), userId],
    );
    await client.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function startServer() {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  return initializeDatabase().then(() => createApp().listen(port, host, () => {
    console.log(`E-Arsip API listening on ${host}:${port}`);
  }));
}

module.exports = { bootstrapAdmin, createApp, createInvitation, initializeDatabase, pool, resetAdminPassword, startServer };
