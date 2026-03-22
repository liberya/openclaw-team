import crypto from "crypto";
import pg from "pg";
const { Client } = pg;

function hashPassword(password) {
  const salt = crypto.randomBytes(32);
  const key = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512");
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

async function main() {
  const client = new Client({
    host: "localhost",
    port: 5432,
    database: "openclaw",
    user: "openclaw",
    password: "openclaw123",
  });

  try {
    await client.connect();

    const result = await client.query("SELECT id, email, role FROM users WHERE role = 'admin'");
    if (result.rows.length > 0) {
      console.log("Admin user already exists:");
      console.log(result.rows);
      return;
    }

    const email = "admin@openclaw.local";
    const password = "admin123";
    const passwordHash = hashPassword(password);
    const id = crypto.randomUUID();
    const now = new Date();

    await client.query(
      `INSERT INTO users (id, email, password_hash, name, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'admin', 'active', $5, $6)`,
      [id, email, passwordHash, "Administrator", now, now]
    );

    console.log("Admin user created successfully!");
    console.log("Email:", email);
    console.log("Password:", password);
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await client.end();
  }
}

main();
