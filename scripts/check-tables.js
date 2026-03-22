import pg from 'pg';

const { Client } = pg;

async function checkTables() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'openclaw',
    user: 'openclaw',
    password: 'openclaw123',
  });

  try {
    await client.connect();
    
    // Check tables
    const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name LIKE 'user_%'
      ORDER BY table_name
    `);
    
    console.log('User-related tables:');
    tables.rows.forEach(t => console.log('  - ' + t.table_name));
    
    // Check RLS policies
    const policies = await client.query(`
      SELECT tablename, policyname 
      FROM pg_policies 
      WHERE tablename LIKE 'user_%'
      ORDER BY tablename, policyname
    `);
    
    console.log('\nRLS Policies:');
    policies.rows.forEach(p => console.log(`  - ${p.tablename}: ${p.policyname}`));
    
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

checkTables();
