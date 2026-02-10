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

    // List columns
    const cols = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'challenges' ORDER BY ordinal_position;`);
    console.log('Columns in challenges table:');
    console.log(cols.rows.map(r => r.column_name).join(', '));

    // Show sample rows
    const res = await client.query(`SELECT * FROM challenges ORDER BY created_at DESC LIMIT 5;`);
    console.log('\nSample recent rows (5):');
    console.table(res.rows.map(r => {
      // Only select first 20 keys for display brevity
      const keys = Object.keys(r).slice(0, 20);
      const out = {};
      keys.forEach(k => out[k] = r[k]);
      return out;
    }));

    await client.end();
    process.exit(0);
  } catch (err) {
    console.error('Error inspecting challenges table:', err);
    process.exit(2);
  }
})();
