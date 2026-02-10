const { Client } = require('pg');

(async () => {
  try {
    const DATABASE_URL = process.env.DATABASE_URL;
    if (!DATABASE_URL) {
      console.error('DATABASE_URL not set');
      process.exit(2);
    }

    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();

    const res = await client.query(`SELECT id, title, creator_transaction_hash, acceptor_transaction_hash, on_chain_status, created_at
      FROM challenges
      WHERE creator_transaction_hash IS NOT NULL OR acceptor_transaction_hash IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 100;`);

    if (res.rows.length === 0) {
      console.log('No challenges with non-null transaction hashes found.');
    } else {
      console.log('Found challenges with transaction hashes:');
      console.table(res.rows);
    }

    await client.end();
    process.exit(0);
  } catch (err) {
    console.error('Error querying DB:', err);
    process.exit(2);
  }
})();
