import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const dbPassword = process.env.SUPABASE_DB_PASSWORD ?? secretKey;

if (!supabaseUrl || !dbPassword) {
  console.error("VITE_SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_DB_PASSWORD) are required.");
  process.exit(1);
}

const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationPath = join(
  __dirname,
  "../supabase/migrations/20250624100000_hybrid_search_document_chunks.sql",
);

const hosts = [
  `aws-0-eu-central-1.pooler.supabase.com:6543/postgres?user=postgres.${projectRef}`,
  `aws-0-us-east-1.pooler.supabase.com:6543/postgres?user=postgres.${projectRef}`,
  `db.${projectRef}.supabase.co:5432/postgres?user=postgres`,
  `db.${projectRef}.supabase.co:6543/postgres?user=postgres`,
];

async function keywordFunctionExists(client) {
  const result = await client.query(
    `select 1 from pg_proc where proname = 'match_chunks_keyword' limit 1`,
  );
  return result.rowCount > 0;
}

async function main() {
  let pg;
  try {
    pg = await import("pg");
  } catch {
    console.error("Install pg first: npm install pg");
    process.exit(1);
  }

  const migrationSql = readFileSync(migrationPath, "utf8");

  for (const host of hosts) {
    const connectionString = `postgresql://postgres:${encodeURIComponent(dbPassword)}@${host}`;
    const client = new pg.default.Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });

    try {
      await client.connect();
      const exists = await keywordFunctionExists(client);
      if (exists) {
        console.log("match_chunks_keyword already exists.");
        await client.end();
        return;
      }

      await client.query(migrationSql);
      console.log(`Applied hybrid search migration via ${host}`);
      await client.end();
      return;
    } catch (error) {
      try {
        await client.end();
      } catch {
        // ignore
      }
      console.log(`Connection failed for ${host}: ${error.message}`);
    }
  }

  console.error(
    "Could not apply hybrid migration. Add SUPABASE_DB_PASSWORD to .env (Database password from Supabase Dashboard), then rerun: node --env-file=.env scripts/apply-hybrid-migration.mjs",
  );
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
