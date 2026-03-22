import pg from 'pg';

const { Client } = pg;

async function migrate() {
  const client = new Client({
    host: process.env.OPENCLAW_DB_HOST || 'localhost',
    port: parseInt(process.env.OPENCLAW_DB_PORT || '5432'),
    database: process.env.OPENCLAW_DB_NAME || 'openclaw',
    user: process.env.OPENCLAW_DB_USER || 'openclaw',
    password: process.env.OPENCLAW_DB_PASSWORD || 'openclaw123',
  });

  try {
    await client.connect();
    console.log('Connected to database');

    // Read SQL file
    const fs = await import('fs');
    const sql = fs.readFileSync('./db/schema/009_user_data_isolation.sql', 'utf-8');
    
    console.log('Running migration...');
    await client.query(sql);
    console.log('Migration completed successfully!');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

migrate();
