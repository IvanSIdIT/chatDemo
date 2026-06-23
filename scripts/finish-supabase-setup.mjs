import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const supabaseUrl = process.env.VITE_SUPABASE_URL ?? "https://dggoaoplgmvnyohakvkp.supabase.co";
const publishableKey =
  process.env.VITE_SUPABASE_ANON_KEY ?? "sb_publishable_onls3qjgaV18UqZ10m7fKQ_42KBXKVE";
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!secretKey) {
  console.error("SUPABASE_SECRET_KEY is required.");
  process.exit(1);
}

const testUsers = [
  { email: "worker.iwan@example.com", password: "Worker123!", role: "worker" },
  { email: "manager.iwan@example.com", password: "Manager123!", role: "manager" },
];

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationPaths = [
  join(__dirname, "../supabase/migrations/20250623000000_create_accounts.sql"),
  join(__dirname, "../supabase/migrations/20250623100000_create_employee_messages.sql"),
  join(__dirname, "../supabase/migrations/20250623110000_fix_worker_rls_role_check.sql"),
];

function adminHeaders() {
  return {
    apikey: secretKey,
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/json",
  };
}

async function request(path, options = {}) {
  const response = await fetch(`${supabaseUrl}${path}`, {
    ...options,
    headers: {
      ...adminHeaders(),
      ...(options.headers ?? {}),
    },
  });

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  return { ok: response.ok, status: response.status, body };
}

async function accountsTableExists() {
  const result = await request("/rest/v1/accounts?select=id&limit=1");
  return result.status !== 404 && !result.body?.code?.includes("PGRST205");
}

async function runMigrationWithPg() {
  let pg;
  try {
    pg = await import("pg");
  } catch {
    console.log("pg package not installed, skipping direct SQL migration.");
    return false;
  }

  const password = process.env.SUPABASE_DB_PASSWORD ?? secretKey;
  const regions = [
    "eu-central-1",
    "us-east-1",
    "us-west-1",
    "ap-southeast-1",
    "eu-west-1",
    "eu-west-2",
    "ap-northeast-1",
  ];

  const hosts = [
    ...regions.map(
      (region) => `aws-0-${region}.pooler.supabase.com:6543/postgres?user=postgres.dggoaoplgmvnyohakvkp`,
    ),
    `db.dggoaoplgmvnyohakvkp.supabase.co:5432/postgres?user=postgres`,
    `db.dggoaoplgmvnyohakvkp.supabase.co:6543/postgres?user=postgres`,
  ];

  for (const host of hosts) {
    const connectionString = `postgresql://postgres:${encodeURIComponent(password)}@${host}`;
    const client = new pg.default.Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });

    try {
      await client.connect();
      for (const migrationPath of migrationPaths) {
        const migrationSql = readFileSync(migrationPath, "utf8");
        await client.query(migrationSql);
        console.log(`Applied ${migrationPath}`);
      }
      await client.end();
      console.log(`Migrations applied via database connection (${host}).`);
      return true;
    } catch (error) {
      try {
        await client.end();
      } catch {
        // ignore
      }
      console.log(`DB connection failed for ${host}: ${error.message}`);
    }
  }

  return false;
}

async function listUsers() {
  const result = await request("/auth/v1/admin/users");
  if (!result.ok) {
    throw new Error(`Failed to list users: ${JSON.stringify(result.body)}`);
  }
  return result.body?.users ?? [];
}

async function createOrUpdateUser(user) {
  const existing = (await listUsers()).find((entry) => entry.email === user.email);

  if (existing) {
    const update = await request(`/auth/v1/admin/users/${existing.id}`, {
      method: "PUT",
      body: JSON.stringify({
        email_confirm: true,
        password: user.password,
        user_metadata: { role: user.role },
      }),
    });

    if (!update.ok) {
      throw new Error(`Failed to update ${user.email}: ${JSON.stringify(update.body)}`);
    }

    console.log(`Updated existing user: ${user.email}`);
    return existing.id;
  }

  const create = await request("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email: user.email,
      password: user.password,
      email_confirm: true,
      user_metadata: { role: user.role },
    }),
  });

  if (!create.ok) {
    throw new Error(`Failed to create ${user.email}: ${JSON.stringify(create.body)}`);
  }

  console.log(`Created user: ${user.email}`);
  return create.body.id;
}

async function ensureAccountRows() {
  const users = await listUsers();
  const targetEmails = new Set(testUsers.map((user) => user.email));

  for (const user of users) {
    if (!targetEmails.has(user.email)) {
      continue;
    }

    const role = user.user_metadata?.role;
    if (!role) {
      continue;
    }

    const existing = await request(`/rest/v1/accounts?id=eq.${user.id}&select=id`);
    if (existing.ok && Array.isArray(existing.body) && existing.body.length > 0) {
      console.log(`Account row already exists for ${user.email}`);
      continue;
    }

    const insert = await request("/rest/v1/accounts", {
      method: "POST",
      headers: {
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        id: user.id,
        email: user.email,
        role,
      }),
    });

    if (!insert.ok) {
      throw new Error(`Failed to insert account for ${user.email}: ${JSON.stringify(insert.body)}`);
    }

    console.log(`Inserted account row for ${user.email}`);
  }
}

async function verifyLogin(user) {
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: user.email,
      password: user.password,
    }),
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Login failed for ${user.email}: ${JSON.stringify(body)}`);
  }

  const account = await fetch(
    `${supabaseUrl}/rest/v1/accounts?id=eq.${body.user.id}&select=role`,
    {
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${body.access_token}`,
      },
    },
  );

  const accountBody = account.ok ? await account.json() : [];
  const role = accountBody[0]?.role ?? body.user.user_metadata?.role ?? "missing";
  console.log(`Verified ${user.email} -> role ${role}`);
}

async function main() {
  console.log("Checking accounts table...");
  if (!(await accountsTableExists())) {
    console.log("Accounts table missing, applying migration...");
    const migrated = await runMigrationWithPg();
    if (!migrated) {
      console.log(
        "Warning: could not apply migration automatically. Continuing with user_metadata roles.",
      );
    }
  } else {
    console.log("Accounts table already exists.");
  }

  console.log("Creating test users...");
  for (const user of testUsers) {
    await createOrUpdateUser(user);
  }

  console.log("Ensuring account rows...");
  if (await accountsTableExists()) {
    await ensureAccountRows();
  } else {
    console.log("Skipping account rows because accounts table is not available yet.");
  }

  console.log("Verifying logins...");
  for (const user of testUsers) {
    await verifyLogin(user);
  }

  console.log("Supabase setup complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
