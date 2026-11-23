const net = require('net');

function isPrivateHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.lan')) return true;
  const family = net.isIP(host);
  if (family === 4) {
    const [first, second] = host.split('.').map(Number);
    return first === 10 || first === 127 || (first === 192 && second === 168) ||
      (first === 172 && second >= 16 && second <= 31) || (first === 169 && second === 254);
  }
  if (family === 6) return host === '::1' || /^(fc|fd|fe80:)/i.test(host);
  return false;
}

function normalizeServerUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw new Error('Alamat server tidak valid. Masukkan URL seperti http://192.168.1.10:3000.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Alamat server harus menggunakan HTTP atau HTTPS dan tidak boleh berisi kredensial.');
  }
  if (url.protocol === 'http:' && !isPrivateHost(url.hostname)) {
    throw new Error('Untuk server internet, gunakan alamat HTTPS. HTTP hanya diizinkan untuk jaringan lokal.');
  }
  return url.origin;
}

module.exports = { normalizeServerUrl };
