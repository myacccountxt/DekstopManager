require('dotenv').config();
const { startServer, pool } = require('./api');

startServer().catch(async (error) => {
  console.error('E-Arsip API failed to start:', error);
  await pool.end();
  process.exitCode = 1;
});
