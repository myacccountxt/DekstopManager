require('dotenv').config();
const axios = require('axios');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const categoryGroups = require('../shared/document-categories.json');
const { normalizeServerUrl } = require('../shared/server-url');

const categories = new Set(categoryGroups.flatMap((group) => group.items));
const serverUrl = normalizeServerUrl(process.env.EARSIP_API_URL || 'http://127.0.0.1:3000');
const databasePath = path.resolve(process.env.EARSIP_LOCAL_DB || path.join(
  process.env.APPDATA || '',
  'e-arsip-instansi',
  'e-arsip-instansi',
  'e-arsip-instansi.db',
));

function getDisplayFileName(filePath) {
  const fileName = path.basename(String(filePath || ''));
  return fileName.replace(/^\d+-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}-(?=.)/i, '');
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function main() {
  const username = process.env.EARSIP_ADMIN_USERNAME;
  const password = process.env.EARSIP_ADMIN_PASSWORD;
  if (!username || !password) throw new Error('Atur EARSIP_ADMIN_USERNAME dan EARSIP_ADMIN_PASSWORD untuk login sebagai admin.');
  if (!fs.existsSync(databasePath)) throw new Error(`Database lokal tidak ditemukan: ${databasePath}`);

  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  let failures = 0;
  try {
    const login = await axios.post(`${serverUrl}/api/auth/login`, { username, password }, { timeout: 15_000, maxRedirects: 0 });
    const token = login.data.token;
    const documents = database.prepare(`
      SELECT id, title, category, format, year_period, file_path, file_size, sha256
        FROM documents ORDER BY id
    `).all();
    const headers = { Authorization: `Bearer ${token}` };
    const sourcePathDigest = crypto.createHash('sha256').update(databasePath.toLowerCase()).digest('hex');
    let imported = 0;
    let skipped = 0;

    for (let index = 0; index < documents.length; index += 1) {
      const document = documents[index];
      const sourceFile = path.resolve(String(document.file_path || ''));
      const fileName = getDisplayFileName(sourceFile);
      const sourceStat = document.file_path && fs.existsSync(sourceFile) ? await fs.promises.stat(sourceFile) : null;
      if (!sourceStat?.isFile() || !categories.has(document.category)) {
        console.warn(`[${index + 1}/${documents.length}] Dilewati (lampiran hilang atau kategori tidak didukung): ${document.title}`);
        skipped += 1;
        continue;
      }
      if ((document.file_size != null && Number(document.file_size) !== sourceStat.size) ||
        (document.sha256 && await hashFile(sourceFile) !== document.sha256)) {
        console.warn(`[${index + 1}/${documents.length}] Dilewati (integritas lampiran lokal berubah): ${document.title}`);
        skipped += 1;
        continue;
      }

      const year = Number(document.year_period);
      if (!Number.isInteger(year) || year < 1900 || year > 9999) {
        console.warn(`[${index + 1}/${documents.length}] Dilewati (periode tidak valid): ${document.title}`);
        skipped += 1;
        continue;
      }

      const form = new FormData();
      form.append('title', String(document.title || fileName).slice(0, 300));
      form.append('category', document.category);
      form.append('year_period', String(year));
      form.append('format', String(document.format || path.extname(fileName).slice(1).toUpperCase() || 'FILE'));
      form.append('file', fs.createReadStream(sourceFile), { filename: fileName });
      const sourceId = crypto.createHash('sha256')
        .update(`${sourcePathDigest}:${document.id}`)
        .digest('hex');

      try {
        const response = await axios.post(`${serverUrl}/api/documents`, form, {
          headers: { ...headers, ...form.getHeaders(), 'X-Legacy-Source-Id': sourceId },
          maxBodyLength: Infinity,
          maxRedirects: 0,
          timeout: 0,
        });
        if (response.data.skipped) skipped += 1;
        else imported += 1;
        console.log(`[${index + 1}/${documents.length}] ${response.data.skipped ? 'Sudah diimpor' : 'Diimpor'}: ${document.title}`);
      } catch (error) {
        failures += 1;
        console.error(`[${index + 1}/${documents.length}] Gagal: ${document.title} — ${error.response?.data?.message || error.message}`);
      }
    }

    console.log(`Selesai. Diimpor baru: ${imported}; dilewati/sudah ada: ${skipped}; gagal: ${failures}.`);
    if (failures) process.exitCode = 1;
  } finally {
    database.close();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
