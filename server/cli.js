require('dotenv').config();
const { bootstrapAdmin, createInvitation, initializeDatabase, pool, resetAdminPassword } = require('./api');

async function main() {
  const [command, role, username] = process.argv.slice(2);
  await initializeDatabase();
  if (command === 'bootstrap-admin') {
    const adminUsername = await bootstrapAdmin();
    console.log(`Admin "${adminUsername}" berhasil dibuat.`);
    return;
  }
  if (command === 'reset-admin-password') {
    await resetAdminPassword();
    console.log('Password admin berhasil direset. Sesi aktif telah dicabut.');
    return;
  }
  if (command === 'invite' && role && username) {
    const inviteCode = await createInvitation(username, role);
    console.log(`Username: ${username}\nPeran: ${role}\nKode undangan (berlaku 7 hari):\n${inviteCode}`);
    return;
  }
  throw new Error('Gunakan: node server/cli.js bootstrap-admin | node server/cli.js reset-admin-password | node server/cli.js invite <admin|editor|viewer> <username>');
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
