const supabaseUrl = process.env.VITE_SUPABASE_URL ?? "https://dggoaoplgmvnyohakvkp.supabase.co";
const publishableKey =
  process.env.VITE_SUPABASE_ANON_KEY ?? "sb_publishable_onls3qjgaV18UqZ10m7fKQ_42KBXKVE";
const secretKey = process.env.SUPABASE_SECRET_KEY;

const testUsers = [
  { email: "worker@factory.com", password: "Worker123!", role: "worker" },
  { email: "manager@factory.com", password: "Manager123!", role: "manager" },
];

async function authRequest(path, options = {}) {
  const response = await fetch(`${supabaseUrl}/auth/v1${path}`, {
    ...options,
    headers: {
      apikey: publishableKey,
      "Content-Type": "application/json",
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

async function adminRequest(path, options = {}) {
  if (!secretKey) {
    return { ok: false, status: 0, body: null };
  }

  const response = await fetch(`${supabaseUrl}/auth/v1${path}`, {
    ...options,
    headers: {
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
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

async function ensureTestUsers() {
  for (const user of testUsers) {
    const signIn = await authRequest("/token?grant_type=password", {
      method: "POST",
      body: JSON.stringify({ email: user.email, password: user.password }),
    });

    if (signIn.ok) {
      console.log(`User already exists and can sign in: ${user.email}`);
      continue;
    }

    const signUp = await authRequest("/signup", {
      method: "POST",
      body: JSON.stringify({
        email: user.email,
        password: user.password,
        data: { role: user.role },
      }),
    });

    if (!signUp.ok) {
      console.error(`Failed to create ${user.email}:`, signUp.body);
      continue;
    }

    if (signUp.body?.user && !signUp.body?.session) {
      console.log(`Created ${user.email} — confirm email before login if required.`);
    } else {
      console.log(`Created ${user.email}`);
    }
  }
}

async function confirmUsersWithSecretKey() {
  if (!secretKey) {
    return;
  }

  const list = await adminRequest("/admin/users");
  if (!list.ok) {
    console.log("Could not list users for auto-confirm.");
    return;
  }

  const emails = new Set(testUsers.map((user) => user.email));
  const users = list.body?.users ?? [];

  for (const user of users) {
    if (!emails.has(user.email)) {
      continue;
    }

    const confirm = await adminRequest(`/admin/users/${user.id}`, {
      method: "PUT",
      body: JSON.stringify({ email_confirm: true }),
    });

    if (confirm.ok) {
      console.log(`Confirmed email for ${user.email}`);
    }
  }
}

async function main() {
  console.log("Creating test users via Supabase Auth...");
  await ensureTestUsers();
  await confirmUsersWithSecretKey();
  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
