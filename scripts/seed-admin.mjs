import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Use bcryptjs from api-server node_modules
const bcrypt = require(path.join(__dirname, "../artifacts/api-server/node_modules/bcryptjs"));
const { Client } = require(path.join(__dirname, "../lib/db/node_modules/pg"));

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const email = "admin@codigosnetflix";
const password = "codigos2026";
const hash = await bcrypt.hash(password, 10);

await client.query("DELETE FROM admin_users");
await client.query(
  "INSERT INTO admin_users (email, password_hash) VALUES ($1, $2)",
  [email, hash]
);

console.log("✅ Admin creado exitosamente:", email);
await client.end();
