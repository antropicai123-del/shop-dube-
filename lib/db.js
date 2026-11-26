const { Pool, types } = require('pg');

// Return DATE columns as plain 'YYYY-MM-DD' text (no timezone surprises)
types.setTypeParser(1082, v => v);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

module.exports = { pool };
