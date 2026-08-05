export interface AuthEnv {
  ADMIN_TOKEN?: string;
  SIRAYA_METADATA: D1Database;
}

export interface AdminIdentity {
  id: number;
  username: string;
  method: "session" | "token";
}

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  active: number;
  failed_attempts: number;
  locked_until: string | null;
}

const COOKIE_NAME = "siraya_admin_session";
const SESSION_SECONDS = 8 * 60 * 60;

export async function authenticateAdmin(request: Request, env: AuthEnv): Promise<AdminIdentity | null> {
  const bearer = bearerToken(request);
  if (bearer && env.ADMIN_TOKEN && timingSafeEqual(bearer, env.ADMIN_TOKEN)) {
    return { id: 0, username: "token-admin", method: "token" };
  }
  const token = cookieValue(request, COOKIE_NAME);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.SIRAYA_METADATA.prepare(`SELECT u.id, u.username
    FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`)
    .bind(tokenHash, new Date().toISOString()).first<{ id: number; username: string }>();
  if (!row) return null;
  await env.SIRAYA_METADATA.prepare("UPDATE admin_sessions SET last_seen_at = ? WHERE token_hash = ?")
    .bind(new Date().toISOString(), tokenHash).run();
  return { ...row, method: "session" };
}

export async function login(request: Request, env: AuthEnv): Promise<Response> {
  try {
  const input = await request.json().catch(() => ({})) as Record<string, unknown>;
  const username = String(input.username ?? "").trim();
  const password = String(input.password ?? "");
  if (!username || !password) return authJson({ error: "invalid_credentials" }, 401);
  const user = await env.SIRAYA_METADATA.prepare("SELECT * FROM admin_users WHERE username = ?")
    .bind(username).first<UserRow>();
  const now = new Date();
  if (!user || !user.active || (user.locked_until && new Date(user.locked_until) > now)) {
    return authJson({ error: "invalid_credentials" }, 401);
  }
  const expected = await pbkdf2(password, user.password_salt, user.password_iterations);
  if (!timingSafeEqual(expected, user.password_hash)) {
    const failures = user.failed_attempts + 1;
    const lockedUntil = failures >= 5 ? new Date(now.getTime() + 15 * 60 * 1000).toISOString() : null;
    await env.SIRAYA_METADATA.prepare("UPDATE admin_users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?")
      .bind(failures >= 5 ? 0 : failures, lockedUntil, now.toISOString(), user.id).run();
    return authJson({ error: "invalid_credentials" }, 401);
  }
  let sessionToken: string;
  let tokenHash: string;
  try {
    sessionToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
    tokenHash = await sha256(sessionToken);
  } catch {
    return authJson({ error: "session_token_failed" }, 500);
  }
  const expiresAt = new Date(now.getTime() + SESSION_SECONDS * 1000).toISOString();
  try {
    await env.SIRAYA_METADATA.prepare(`INSERT INTO admin_sessions
      (token_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(tokenHash, user.id, now.toISOString(), expiresAt, now.toISOString()).run();
  } catch {
    return authJson({ error: "session_create_failed" }, 500);
  }
  try {
    await env.SIRAYA_METADATA.prepare(`UPDATE admin_users SET failed_attempts = 0, locked_until = NULL,
      last_login_at = ?, updated_at = ? WHERE id = ?`)
      .bind(now.toISOString(), now.toISOString(), user.id).run();
    await env.SIRAYA_METADATA.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?")
      .bind(now.toISOString()).run();
  } catch {
    await env.SIRAYA_METADATA.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(tokenHash).run();
    return authJson({ error: "session_finalize_failed" }, 500);
  }
  try {
    const response = authJson({ ok: true, username: user.username, expiresAt });
    response.headers.append("set-cookie", `${COOKIE_NAME}=${sessionToken}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`);
    return response;
  } catch {
    await env.SIRAYA_METADATA.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(tokenHash).run();
    return authJson({ error: "session_cookie_failed" }, 500);
  }
  } catch (error) {
    console.error("Admin login failed", error);
    return authJson({ error: "login_failed" }, 500);
  }
}

export async function logout(request: Request, env: AuthEnv): Promise<Response> {
  const token = cookieValue(request, COOKIE_NAME);
  if (token) {
    await env.SIRAYA_METADATA.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  }
  const response = authJson({ ok: true });
  response.headers.append("set-cookie", `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`);
  return response;
}

export function renderAdminPortal(identity: AdminIdentity | null): Response {
  const body = identity ? `
    <main class="portal">
      <p class="eyebrow">SIRAYA internal</p>
      <h1>Model administration</h1>
      <p class="welcome">Signed in as <strong>${escapeHtml(identity.username)}</strong></p>
      <div class="actions">
        <a class="primary" href="/models?manage=1">Manage models</a>
        <a href="/docs/metadata">Administration guide</a>
        <button id="logout" type="button">Sign out</button>
      </div>
    </main>
    <script>document.getElementById("logout").addEventListener("click", async () => {
      await fetch("/admin/auth/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      location.reload();
    });</script>` : `
    <main class="login">
      <p class="eyebrow">SIRAYA internal</p>
      <h1>Sign in</h1>
      <p>Use your model administration account.</p>
      <form id="login-form">
        <label>Username<input name="username" autocomplete="username" required></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
        <p id="feedback" role="status"></p>
        <button type="submit">Sign in</button>
      </form>
      <a class="public-link" href="/models">Return to public models</a>
    </main>
    <script>document.getElementById("login-form").addEventListener("submit", async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const response = await fetch("/admin/auth/login", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: form.get("username"), password: form.get("password") }) });
      if (response.ok) location.reload();
      else {
        const result = await response.json().catch(() => ({}));
        document.getElementById("feedback").textContent = result.error === "invalid_credentials"
          ? "Username or password was not accepted."
          : "Sign in failed (" + (result.error || response.status) + ").";
      }
    });</script>`;
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>SIRAYA Administration</title><style>${portalStyles()}</style></head><body>${body}</body></html>`, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }
  });
}

export async function passwordRecord(password: string, iterations = 100000): Promise<{ hash: string; salt: string; iterations: number }> {
  const salt = randomToken(18);
  return { hash: await pbkdf2(password, salt, iterations), salt, iterations };
}

function portalStyles(): string {
  return `:root{--ink:#17211d;--muted:#63706b;--line:#d8e0dc;--teal:#0f766e;--coral:#c7503c}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;background:#f5f8f6;color:var(--ink);font:15px/1.5 Inter,system-ui,sans-serif}.login,.portal{width:min(440px,100%);padding:30px;border:1px solid var(--line);border-radius:8px;background:#fff;box-shadow:0 18px 50px rgba(23,33,29,.12)}.eyebrow{margin:0 0 8px;color:var(--coral);font-size:12px;font-weight:800;text-transform:uppercase}h1{margin:0 0 8px;font-size:30px}p{color:var(--muted)}form{display:grid;gap:16px;margin-top:22px}label{display:grid;gap:6px;font-size:13px;font-weight:700}input{height:42px;padding:0 11px;border:1px solid #bdc9c3;border-radius:6px;font:inherit}button,.actions a{min-height:40px;padding:9px 14px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--ink);font:inherit;font-weight:750;text-decoration:none;cursor:pointer}form button,.actions .primary{border-color:var(--teal);background:var(--teal);color:#fff}#feedback{min-height:22px;margin:0;color:var(--coral);font-size:13px}.public-link{display:inline-block;margin-top:18px;color:var(--teal)}.actions{display:grid;gap:10px;margin-top:24px}.welcome{margin-bottom:0}`;
}

async function pbkdf2(password: string, salt: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations }, key, 256);
  return bytesToBase64Url(new Uint8Array(bits));
}

async function sha256(value: string): Promise<string> {
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

function randomToken(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function timingSafeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let diff = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) diff |= (a[index % a.length] ?? 0) ^ (b[index % b.length] ?? 0);
  return diff === 0;
}

function cookieValue(request: Request, name: string): string | undefined {
  const cookies = request.headers.get("cookie") ?? "";
  return cookies.split(";").map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
}

function bearerToken(request: Request): string | undefined {
  return request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
}

function authJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
