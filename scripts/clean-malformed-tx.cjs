#!/usr/bin/env node
// Script: clean-malformed-tx.cjs
// Purpose: Find challenge rows where creator_transaction_hash or acceptor_transaction_hash
// were stored as literal 'undefined' or other obvious malformed strings and set them to NULL.

const { Client } = require('pg');
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Please set DATABASE_URL env var');
  process.exit(2);
}

(async () => {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const res = await client.query(`SELECT id, creator_transaction_hash, acceptor_transaction_hash FROM challenges WHERE creator_transaction_hash IS NOT NULL OR acceptor_transaction_hash IS NOT NULL`);
    console.log(`Found ${res.rowCount} rows with non-null tx hash fields`);
    let cleaned = 0;
    for (const row of res.rows) {
      const updates = {};
      if (row.creator_transaction_hash && typeof row.creator_transaction_hash === 'string') {
        const v = row.creator_transaction_hash.trim().toLowerCase();
        if (v === 'undefined' || v === 'null' || !/^0x[0-9a-f]{64}$/.test(v)) {
          updates.creator_transaction_hash = null;
        }
      }
      if (row.acceptor_transaction_hash && typeof row.acceptor_transaction_hash === 'string') {
        const v = row.acceptor_transaction_hash.trim().toLowerCase();
        if (v === 'undefined' || v === 'null' || !/^0x[0-9a-f]{64}$/.test(v)) {
          updates.acceptor_transaction_hash = null;
        }
      }
      const keys = Object.keys(updates);
      if (keys.length) {
        const sets = keys.map((k, i) => `${k} = $${i+1}`).join(', ');
        const vals = keys.map(k => updates[k]);
        await client.query(`UPDATE challenges SET ${sets} WHERE id = $${keys.length+1}`, [...vals, row.id]);
        cleaned++;
        console.log(`Cleaned challenge ${row.id}`);
      }
    }
    console.log(`Finished. Cleaned ${cleaned} rows.`);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
})();
