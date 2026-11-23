const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { app } = require('electron');
const Database = require('better-sqlite3');
const XLSX = require('xlsx');
const categoryGroups = require('../shared/document-categories.json');

const FILE_FORMATS = {
  pdf: 'PDF',
  xls: 'XLS',
  xlsx: 'XLSX',
  doc: 'DOC',
  docx: 'DOCX',
};

const DOCUMENT_CATEGORIES = categoryGroups.flatMap((group) => group.items);

function getAppStorageRoot() {
  const root = path.join(app.getPath('userData'), 'e-arsip-instansi');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(root, 'files'), { recursive: true });
  return root;
}

let databaseInstance = null;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(storedPassword, password) {
  if (!storedPassword.startsWith('scrypt:')) {
    return storedPassword === password;
  }

  const [, salt, storedHash] = storedPassword.split(':');
  if (!salt || !storedHash) return false;

  const expected = Buffer.from(storedHash, 'hex');
  if (!expected.length) return false;

  const actual = crypto.scryptSync(password, salt, expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

function hashRecoveryCode(code) {
  return crypto.createHash('sha256').update(String(code).replace(/-/g, '').toUpperCase()).digest('hex');
}

function createRecoveryCode() {
  return crypto.randomBytes(16).toString('hex').toUpperCase().match(/.{1,4}/g).join('-');
}

function verifyRecoveryCode(storedHash, recoveryCode) {
  if (!storedHash || !recoveryCode) return false;
  const expected = Buffer.from(storedHash, 'hex');
  const actual = Buffer.from(hashRecoveryCode(recoveryCode), 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}

function validateDocumentMetadata({ category, yearPeriod }) {
  if (!DOCUMENT_CATEGORIES.includes(category)) {
    throw new Error(`Kategori dokumen "${category || '(kosong)'}" tidak dikenali oleh aplikasi ini. Tutup lalu buka kembali aplikasi versi terbaru agar daftar kategori diperbarui.`);
  }
  if (!Number.isInteger(yearPeriod) || yearPeriod < 1900 || yearPeriod > 9999) {
    throw new Error('Periode/tahun harus berupa angka antara 1900 dan 9999.');
  }
}

function getFileFormat(fileName) {
  const extension = path.extname(String(fileName || '')).slice(1).toLowerCase();
  return FILE_FORMATS[extension] || (extension ? extension.toUpperCase().slice(0, 16) : 'FILE');
}

async function validateSourceFile(fileName, sourcePath, expectedFormat) {
  const format = getFileFormat(fileName);
  if (expectedFormat && expectedFormat !== format) {
    throw new Error(`Format file tidak cocok. File yang dipilih terdeteksi sebagai ${format}.`);
  }

  const absolutePath = path.resolve(String(sourcePath || ''));
  let stat;
  try {
    stat = await fs.promises.stat(absolutePath);
  } catch {
    throw new Error('File sumber tidak dapat diakses. Pilih ulang file dari perangkat.');
  }
  if (!stat.isFile() || stat.size === 0) {
    throw new Error('File kosong dan tidak dapat disimpan.');
  }

  const fileHandle = await fs.promises.open(absolutePath, 'r');
  const header = Buffer.alloc(Math.min(1024, stat.size));
  try {
    await fileHandle.read(header, 0, header.length, 0);
  } finally {
    await fileHandle.close();
  }

  if (!Object.hasOwn(FILE_FORMATS, path.extname(String(fileName || '')).slice(1).toLowerCase())) {
    return {
      format,
      fileSize: stat.size,
      sourcePath: absolutePath,
      modifiedAt: stat.mtimeMs,
    };
  }

  const pdfHeaderOffset = header.indexOf(Buffer.from('%PDF-'));
  const isPdf = format === 'PDF' && pdfHeaderOffset >= 0 && pdfHeaderOffset <= 1024;
  const isCompoundDocument = ['XLS', 'DOC'].includes(format) && header.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  const isOpenXml = ['XLSX', 'DOCX'].includes(format) && header.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  if (!isPdf && !isCompoundDocument && !isOpenXml) {
    throw new Error(`Isi file tidak sesuai dengan format ${format}. Periksa file lalu pilih ulang.`);
  }

  if (format === 'XLS' || format === 'XLSX') {
    try {
      const workbook = XLSX.readFile(absolutePath, { bookSheets: true });
      if (!workbook.SheetNames.length) throw new Error('Buku kerja tidak memiliki lembar.');
    } catch {
      throw new Error(`File tidak dapat dibaca sebagai dokumen ${format}.`);
    }
  }

  if (format === 'DOCX') {
    const zipHandle = await fs.promises.open(absolutePath, 'r');
    try {
      const tailLength = Math.min(stat.size, 65_557);
      const tail = Buffer.alloc(tailLength);
      await zipHandle.read(tail, 0, tail.length, stat.size - tailLength);
      let endRecordOffset = -1;
      for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
        if (tail.readUInt32LE(offset) === 0x06054b50) {
          endRecordOffset = offset;
          break;
        }
      }
      if (endRecordOffset < 0) throw new Error('ZIP footer tidak ditemukan.');

      const entryCount = tail.readUInt16LE(endRecordOffset + 10);
      const centralDirectorySize = tail.readUInt32LE(endRecordOffset + 12);
      let entryOffset = tail.readUInt32LE(endRecordOffset + 16);
      if (entryCount === 0xffff || centralDirectorySize === 0xffffffff || entryOffset === 0xffffffff) {
        throw new Error('Dokumen DOCX menggunakan ZIP64 yang tidak didukung.');
      }

      const centralDirectoryEnd = entryOffset + centralDirectorySize;
      if (centralDirectoryEnd > stat.size) throw new Error('Indeks ZIP dokumen rusak.');
      const requiredEntries = new Set(['[Content_Types].xml', 'word/document.xml']);
      for (let index = 0; index < entryCount && requiredEntries.size; index += 1) {
        const headerBuffer = Buffer.alloc(46);
        const headerRead = await zipHandle.read(headerBuffer, 0, headerBuffer.length, entryOffset);
        if (headerRead.bytesRead !== headerBuffer.length || headerBuffer.readUInt32LE(0) !== 0x02014b50) {
          throw new Error('Indeks ZIP dokumen tidak valid.');
        }

        const nameLength = headerBuffer.readUInt16LE(28);
        const extraLength = headerBuffer.readUInt16LE(30);
        const commentLength = headerBuffer.readUInt16LE(32);
        const nameBuffer = Buffer.alloc(nameLength);
        const nameRead = await zipHandle.read(nameBuffer, 0, nameBuffer.length, entryOffset + 46);
        if (nameRead.bytesRead !== nameBuffer.length) throw new Error('Nama file dalam dokumen terpotong.');
        requiredEntries.delete(nameBuffer.toString('utf8'));
        entryOffset += 46 + nameLength + extraLength + commentLength;
        if (entryOffset > centralDirectoryEnd) throw new Error('Indeks ZIP dokumen melewati batas file.');
      }

      if (requiredEntries.size) throw new Error('Bagian wajib DOCX tidak ditemukan.');
    } catch {
      throw new Error('Isi file bukan dokumen DOCX yang valid atau rusak. Simpan ulang sebagai dokumen Word (.docx), lalu pilih kembali.');
    } finally {
      await zipHandle.close();
    }
  }

  return {
    format,
    fileSize: stat.size,
    sourcePath: absolutePath,
    modifiedAt: stat.mtimeMs,
  };
}

function createTables() {
  const db = databaseInstance;

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      recovery_code_hash TEXT
    );

    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      format TEXT NOT NULL,
      year_period INTEGER NOT NULL,
      status TEXT NOT NULL,
      file_path TEXT NOT NULL,
      sha256 TEXT,
      file_size INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS document_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      version_number INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      sha256 TEXT,
      file_size INTEGER,
      created_by TEXT NOT NULL DEFAULT 'system',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(document_id, version_number),
      FOREIGN KEY (document_id) REFERENCES documents(id)
    );
  `);

  const userColumns = new Set(db.pragma('table_info(users)').map((column) => column.name));
  if (!userColumns.has('recovery_code_hash')) {
    db.exec('ALTER TABLE users ADD COLUMN recovery_code_hash TEXT');
  }

  const columns = new Set(db.pragma('table_info(documents)').map((column) => column.name));
  if (!columns.has('user_id')) db.exec('ALTER TABLE documents ADD COLUMN user_id INTEGER REFERENCES users(id)');
  if (!columns.has('sha256')) db.exec('ALTER TABLE documents ADD COLUMN sha256 TEXT');
  if (!columns.has('file_size')) db.exec('ALTER TABLE documents ADD COLUMN file_size INTEGER');
  const firstUser = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get();
  if (firstUser) {
    db.prepare('UPDATE documents SET user_id = ? WHERE user_id IS NULL').run(firstUser.id);
  }
  db.exec('CREATE INDEX IF NOT EXISTS documents_user_id_idx ON documents(user_id)');
}

function isManagedStoredFile(filePath, filesRoot) {
  const resolvedPath = path.resolve(String(filePath || ''));
  const relativePath = path.relative(filesRoot, resolvedPath);
  return relativePath &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath);
}

function removeUnreferencedManagedFiles(filePaths) {
  const db = databaseInstance;
  const filesRoot = path.resolve(getAppStorageRoot(), 'files');
  const documentReference = db.prepare('SELECT COUNT(*) AS total FROM documents WHERE file_path = ?');
  const versionReference = db.prepare('SELECT COUNT(*) AS total FROM document_versions WHERE file_path = ?');

  for (const filePath of new Set(filePaths.filter(Boolean))) {
    const resolvedPath = path.resolve(filePath);
    if (!isManagedStoredFile(resolvedPath, filesRoot)) continue;
    if (documentReference.get(filePath).total || versionReference.get(filePath).total) continue;
    try {
      fs.unlinkSync(resolvedPath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn(`File dokumen lama tidak dapat dihapus dari penyimpanan: ${resolvedPath}`, error);
      }
    }
  }
}

function removeObsoleteCategoryDocuments() {
  const db = databaseInstance;
  const placeholders = DOCUMENT_CATEGORIES.map(() => '?').join(', ');
  const obsoleteDocuments = db.prepare(
    `SELECT id, file_path FROM documents WHERE category NOT IN (${placeholders})`,
  ).all(...DOCUMENT_CATEGORIES);
  if (!obsoleteDocuments.length) return 0;

  const obsoleteVersionPaths = db.prepare(
    `SELECT versions.file_path
     FROM document_versions AS versions
     JOIN documents ON documents.id = versions.document_id
     WHERE documents.category NOT IN (${placeholders})`,
  ).all(...DOCUMENT_CATEGORIES).map((version) => version.file_path);
  const obsoleteFilePaths = [
    ...obsoleteDocuments.map((document) => document.file_path),
    ...obsoleteVersionPaths,
  ];

  const removeObsolete = db.transaction(() => {
    db.prepare(
      `DELETE FROM document_versions WHERE document_id IN (
        SELECT id FROM documents WHERE category NOT IN (${placeholders})
      )`,
    ).run(...DOCUMENT_CATEGORIES);
    db.prepare(`DELETE FROM documents WHERE category NOT IN (${placeholders})`).run(...DOCUMENT_CATEGORIES);
  });
  removeObsolete();
  removeUnreferencedManagedFiles(obsoleteFilePaths);
  console.info(`Dokumen kategori yang tidak lagi didukung dihapus: ${obsoleteDocuments.length}.`);
  return obsoleteDocuments.length;
}

function migrateRenamedCategories() {
  const db = databaseInstance;
  const migrations = [
    {
      category: 'LKjIP',
      aliases: ['Laporan Kinerja Instansi Pemerintah (LKjIP)', 'LKJIP'],
    },
    {
      category: 'Tindak Lanjut Rekomendasi Hasil Evaluasi (AKIP) Tahunan',
      aliases: [
        'Tindak Lanjut Rekomendasi Hasil Evaluasi AKIP Tahunan',
        'Tindak Lanjut Rekomendasi Hasil Evaluasi Akuntabilitas Kinerja Instansi Pemerintah (AKIP) Tahunan',
      ],
    },
    {
      category: 'Dokumen Dukung Lainnya',
      aliases: ['Data Dukung Lainnya'],
    },
  ];
  const migrate = db.transaction(() => {
    for (const migration of migrations) {
      const placeholders = migration.aliases.map(() => '?').join(', ');
      db.prepare(`UPDATE documents SET category = ? WHERE category IN (${placeholders})`)
        .run(migration.category, ...migration.aliases);
    }
  });
  migrate();
}

function resolveRestoredFile(filePath, expectedHash, expectedSize) {
  if (fs.existsSync(filePath)) return filePath;
  const candidate = path.join(getAppStorageRoot(), 'files', path.basename(filePath));
  if (!fs.existsSync(candidate)) return null;

  try {
    const stat = fs.statSync(candidate);
    if (expectedSize != null && stat.size !== Number(expectedSize)) return null;
    if (expectedHash) {
      const actualHash = crypto.createHash('sha256').update(fs.readFileSync(candidate)).digest('hex');
      if (actualHash !== expectedHash) return null;
    }
    return candidate;
  } catch {
    return null;
  }
}

function relinkStoredFiles() {
  const db = databaseInstance;
  for (const document of db.prepare('SELECT id, file_path, sha256, file_size FROM documents').all()) {
    const resolvedPath = resolveRestoredFile(document.file_path, document.sha256, document.file_size);
    if (resolvedPath && resolvedPath !== document.file_path) {
      db.prepare('UPDATE documents SET file_path = ? WHERE id = ?').run(resolvedPath, document.id);
    }
  }

}

function connectDatabase() {
  if (databaseInstance) {
    return databaseInstance;
  }

  const storageRoot = getAppStorageRoot();
  const dbPath = path.join(storageRoot, 'e-arsip-instansi.db');
  databaseInstance = new Database(dbPath);
  databaseInstance.pragma('journal_mode = WAL');
  databaseInstance.pragma('synchronous = NORMAL');

  createTables();
  migrateRenamedCategories();
  removeObsoleteCategoryDocuments();
  relinkStoredFiles();

  return databaseInstance;
}

function findUserByUsername(username, password) {
  const db = connectDatabase();
  const user = db.prepare('SELECT id, username, password FROM users WHERE username = ?').get(username);
  if (!user || !verifyPassword(user.password, password)) return null;

  if (!user.password.startsWith('scrypt:')) {
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashPassword(password), user.id);
  }

  return { id: user.id, username: user.username };
}

function createUser(username, password) {
  const db = connectDatabase();
  const recoveryCode = createRecoveryCode();
  try {
    const result = db.prepare('INSERT INTO users (username, password, recovery_code_hash) VALUES (?, ?, ?)').run(
      username,
      hashPassword(password),
      hashRecoveryCode(recoveryCode),
    );
    const user = { id: result.lastInsertRowid, username, recoveryCode };
    const hasPreviousAccounts = db.prepare('SELECT COUNT(*) AS total FROM users WHERE id != ?').get(user.id).total > 0;
    if (!hasPreviousAccounts) {
      db.prepare('UPDATE documents SET user_id = ? WHERE user_id IS NULL').run(user.id);
    }
    return user;
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return null;
    throw error;
  }
}

function generateRecoveryCode(userId) {
  const db = connectDatabase();
  const recoveryCode = createRecoveryCode();
  const result = db.prepare('UPDATE users SET recovery_code_hash = ? WHERE id = ?')
    .run(hashRecoveryCode(recoveryCode), userId);
  return result.changes ? recoveryCode : null;
}

function resetPasswordWithRecoveryCode(username, recoveryCode, newPassword) {
  const db = connectDatabase();
  const user = db.prepare('SELECT id, recovery_code_hash FROM users WHERE username = ?').get(username);
  if (!user || !verifyRecoveryCode(user.recovery_code_hash, recoveryCode)) return false;

  return db.prepare('UPDATE users SET password = ?, recovery_code_hash = NULL WHERE id = ?')
    .run(hashPassword(newPassword), user.id).changes > 0;
}

function resetPassword(username, newPassword) {
  const db = connectDatabase();
  const result = db.prepare('UPDATE users SET password = ? WHERE username = ?').run(hashPassword(newPassword), username);
  return result.changes > 0;
}

function createDirectoryIfNeeded(targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
}

async function writeUploadedFile(fileName, sourcePath, expectedFormat, userId, onProgress) {
  onProgress?.({ phase: 'validating', copiedBytes: 0, totalBytes: 0 });
  const source = await validateSourceFile(fileName, sourcePath, expectedFormat);
  const storageRoot = getAppStorageRoot();
  const safeName = `${Date.now()}-${crypto.randomUUID()}-${String(fileName || 'dokumen').replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
  const filePath = path.join(storageRoot, 'files', String(userId), safeName);

  createDirectoryIfNeeded(filePath);
  const hash = crypto.createHash('sha256');
  let copiedBytes = 0;
  let lastReportedBytes = 0;
  let lastReportedAt = 0;
  const hashAndProgress = new Transform({
    transform(chunk, encoding, callback) {
      hash.update(chunk);
      copiedBytes += chunk.length;
      const now = Date.now();
      if (copiedBytes === source.fileSize || copiedBytes - lastReportedBytes >= 1024 * 1024 || now - lastReportedAt >= 150) {
        try {
          onProgress?.({ phase: 'copying', copiedBytes, totalBytes: source.fileSize });
        } catch {
          // Progress reporting must not interrupt the file copy.
        }
        lastReportedBytes = copiedBytes;
        lastReportedAt = now;
      }
      callback(null, chunk);
    },
  });

  try {
    onProgress?.({ phase: 'copying', copiedBytes: 0, totalBytes: source.fileSize });
    await pipeline(
      fs.createReadStream(source.sourcePath),
      hashAndProgress,
      fs.createWriteStream(filePath, { flags: 'wx' }),
    );
    const finalStat = await fs.promises.stat(source.sourcePath);
    if (finalStat.size !== source.fileSize || finalStat.mtimeMs !== source.modifiedAt || copiedBytes !== source.fileSize) {
      throw new Error('File sumber berubah saat sedang disalin. Pilih file kembali lalu coba ulang.');
    }
    onProgress?.({ phase: 'complete', copiedBytes, totalBytes: source.fileSize });
    return { filePath, format: source.format, sha256: hash.digest('hex'), fileSize: copiedBytes };
  } catch (error) {
    await fs.promises.rm(filePath, { force: true });
    throw error;
  }
}

async function createDocument(payload = {}, userId, onProgress) {
  const db = connectDatabase();
  const title = String(payload.title || 'Dokumen Baru').trim();
  const category = String(payload.category || '').trim();
  const yearPeriod = Number(payload.year_period);
  const fileName = path.basename(String(payload.file_name || ''));
  validateDocumentMetadata({ category, yearPeriod });
  if (!payload.source_path || !fileName) {
    throw new Error('Dokumen wajib memiliki file lampiran yang valid.');
  }

  const storedFile = await writeUploadedFile(fileName, payload.source_path, payload.format, userId, onProgress);
  const transaction = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO documents (user_id, title, category, format, year_period, status, file_path, sha256, file_size)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, title, category, storedFile.format, yearPeriod, 'Final TTE', storedFile.filePath, storedFile.sha256, storedFile.fileSize);
    const documentId = result.lastInsertRowid;
    return db.prepare('SELECT * FROM documents WHERE id = ? AND user_id = ?').get(documentId, userId);
  });

  try {
    return transaction();
  } catch (error) {
    fs.rmSync(storedFile.filePath, { force: true });
    throw error;
  }
}

async function updateDocument(payload = {}, userId, onProgress) {
  const db = connectDatabase();
  if (!payload.id) {
    return null;
  }

  const existing = db.prepare('SELECT * FROM documents WHERE id = ? AND user_id = ?').get(payload.id, userId);
  if (!existing) {
    return null;
  }

  const fileName = path.basename(String(payload.file_name || ''));
  const title = String(payload.title || existing.title).trim();
  const category = String(payload.category || existing.category).trim();
  const yearPeriod = Number(payload.year_period || existing.year_period);
  validateDocumentMetadata({ category, yearPeriod });
  if (!payload.source_path && !fs.existsSync(existing.file_path)) {
    throw new Error('File dokumen hilang. Pilih file pengganti sebelum memperbarui dokumen.');
  }

  const storedFile = payload.source_path
    ? await writeUploadedFile(fileName, payload.source_path, payload.format, userId, onProgress)
    : null;
  const nextFormat = storedFile?.format || getFileFormat(existing.file_path) || existing.format;
  const nextFilePath = storedFile?.filePath || existing.file_path;
  const nextSha256 = storedFile?.sha256 || existing.sha256;
  const nextFileSize = storedFile?.fileSize || existing.file_size;
  const transaction = db.transaction(() => {
    db.prepare(`
      UPDATE documents
      SET title = ?, category = ?, format = ?, year_period = ?, file_path = ?, sha256 = ?, file_size = ?
      WHERE id = ? AND user_id = ?
    `).run(
      title,
      category,
      nextFormat,
      yearPeriod,
      nextFilePath,
      nextSha256,
      nextFileSize,
      payload.id,
      userId,
    );

    return db.prepare('SELECT * FROM documents WHERE id = ? AND user_id = ?').get(payload.id, userId);
  });

  let updatedDocument;
  try {
    updatedDocument = transaction();
  } catch (error) {
    if (storedFile) fs.rmSync(storedFile.filePath, { force: true });
    throw error;
  }

  if (storedFile && existing.file_path !== storedFile.filePath) {
    const filesDirectory = path.join(getAppStorageRoot(), 'files', String(userId));
    const resolvedPath = path.resolve(existing.file_path);
    const relativePath = path.relative(filesDirectory, resolvedPath);
    const isManagedFile = relativePath &&
      relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath);
    const isReferenced = db.prepare('SELECT COUNT(*) as total FROM documents WHERE file_path = ?').get(existing.file_path).total > 0;
    if (isManagedFile && !isReferenced) {
      try {
        fs.rmSync(resolvedPath, { force: true });
      } catch {
        // A failed cleanup must not invalidate the successfully updated document.
      }
    }
  }

  return updatedDocument;
}

function deleteDocument(id, userId) {
  const db = connectDatabase();
  const document = db.prepare('SELECT * FROM documents WHERE id = ? AND user_id = ?').get(id, userId);
  if (!document) {
    return false;
  }

  const versionPaths = db.prepare('SELECT file_path FROM document_versions WHERE document_id = ?').all(id).map((version) => version.file_path);
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM document_versions WHERE document_id = ?').run(id);
    return db.prepare('DELETE FROM documents WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
  });
  if (!transaction()) return false;

  removeUnreferencedManagedFiles([document.file_path, ...versionPaths]);

  return true;
}

function getDocumentById(id, userId) {
  const db = connectDatabase();
  const document = db.prepare('SELECT * FROM documents WHERE id = ? AND user_id = ?').get(id, userId);
  return document ? { ...document, file_name: getDisplayFileName(document.file_path) } : document;
}

function getDisplayFileName(filePath) {
  const fileName = path.basename(String(filePath || ''));
  return fileName.replace(/^\d+-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}-(?=.)/i, '');
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function verifyDocumentFile(id, userId) {
  const db = connectDatabase();
  const document = getDocumentById(id, userId);
  if (!document || !document.file_path) {
    return { success: false, code: 'FILE_MISSING', message: 'Catatan dokumen ditemukan, tetapi file lampirannya tidak tersedia.' };
  }

  let stat;
  try {
    stat = fs.statSync(document.file_path);
  } catch {
    return {
      success: false,
      code: 'FILE_MISSING',
      message: `File untuk dokumen "${document.title}" tidak ditemukan. Catatan tetap tersimpan. Pilih file pengganti untuk memulihkan dokumen.`,
    };
  }
  if (!stat.isFile()) {
    return {
      success: false,
      code: 'FILE_MISSING',
      message: `Lampiran untuk dokumen "${document.title}" bukan file yang dapat dibuka. Catatan tetap tersimpan. Pilih file pengganti untuk memulihkan dokumen.`,
    };
  }

  if (document.file_size !== null && document.file_size !== undefined && stat.size !== Number(document.file_size)) {
    return {
      success: false,
      code: 'FILE_CHANGED',
      message: `Ukuran file "${document.title}" berubah dari ukuran saat diunggah. File tidak dibuka atau diunduh demi menjaga integritas dokumen.`,
    };
  }

  let actualHash;
  try {
    actualHash = await hashFile(document.file_path);
  } catch {
    return { success: false, code: 'FILE_READ_FAILED', message: `File "${document.title}" tidak dapat dibaca. Periksa izin penyimpanan atau pilih file pengganti.` };
  }

  if (document.sha256 && actualHash !== document.sha256) {
    return {
      success: false,
      code: 'FILE_CHANGED',
      message: `Isi file "${document.title}" berbeda dari file saat diunggah. File tidak dibuka atau diunduh demi menjaga integritas dokumen.`,
    };
  }

  if (!document.sha256) {
    db.prepare('UPDATE documents SET sha256 = ?, file_size = ? WHERE id = ?').run(actualHash, stat.size, id);
  }

  return { success: true, document: { ...document, sha256: actualHash, file_size: stat.size } };
}

function getDocuments(userId, filters = {}) {
  const db = connectDatabase();
  const { category, yearPeriod, search } = filters;
  const categoryPlaceholders = DOCUMENT_CATEGORIES.map(() => '?').join(', ');
  let query = `SELECT * FROM documents WHERE user_id = ? AND category IN (${categoryPlaceholders})`;
  const params = [userId, ...DOCUMENT_CATEGORIES];

  if (category) {
    query += ' AND category = ?';
    params.push(category);
  }

  if (yearPeriod) {
    query += ' AND year_period = ?';
    params.push(Number(yearPeriod));
  }

  if (search) {
    query += ' AND (title LIKE ? OR category LIKE ?)';
    const term = `%${String(search)}%`;
    params.push(term, term);
  }

  query += ' ORDER BY year_period DESC, created_at DESC';

  return db.prepare(query).all(...params).map((document) => {
    let fileState = 'missing';
    try {
      const stat = fs.statSync(document.file_path);
      fileState = !stat.isFile()
        ? 'missing'
        : document.file_size != null && stat.size !== Number(document.file_size)
        ? 'changed'
        : document.sha256
          ? 'available'
          : 'unverified';
    } catch {
      fileState = 'missing';
    }
    return {
      ...document,
      file_name: getDisplayFileName(document.file_path),
      file_available: fileState !== 'missing',
      file_state: fileState,
    };
  });
}

module.exports = {
  connectDatabase,
  createUser,
  createDocument,
  deleteDocument,
  findUserByUsername,
  generateRecoveryCode,
  getDocumentById,
  getDocuments,
  resetPassword,
  resetPasswordWithRecoveryCode,
  updateDocument,
  verifyDocumentFile,
  writeUploadedFile,
};
