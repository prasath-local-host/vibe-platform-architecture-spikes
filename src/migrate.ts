import { createDatabase } from "./database.js";
import { migrateToLatest } from "./migrations.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const db = createDatabase(connectionString);
try {
  await migrateToLatest(db);
} finally {
  await db.destroy();
}
