/**
 * Notes app Worker: username/password auth + D1-backed notes + static assets.
 */
const SESSION_COOKIE = "notes_session";
const SESSION_TTL_SEC = 60 * 60 * 24 * 30; // 30 days
const PBKDF2_ITERATIONS = 100000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        console.error(err);
        return json({ error: "服务器错误" }, 500);
      }
    }

    // Static assets (SPA-ish: miss → index.html for navigations)
    // Production deploy embeds files via worker.bundle.js (base64) for UTF-8 safety.
    if (env.ASSETS) {
      let assetResp = await env.ASSETS.fetch(request);
      if (assetResp.status === 404 && request.method === "GET" && acceptsHtml(request)) {
        const indexReq = new Request(new URL("/index.html", url.origin), request);
        assetResp = await env.ASSETS.fetch(indexReq);
      }
      return withUtf8Charset(assetResp);
    }
    return new Response("Not found", { status: 404 });
  },
};


function withUtf8Charset(resp) {
  if (!resp) return resp;
  const ct = resp.headers.get("Content-Type") || "";
  if (!ct || ct.includes("charset=") || ct.startsWith("image/") || ct.startsWith("font/")) {
    return resp;
  }
  if (
    ct.startsWith("text/") ||
    ct.includes("javascript") ||
    ct.includes("json") ||
    ct.includes("svg") ||
    ct.includes("xml")
  ) {
    const headers = new Headers(resp.headers);
    headers.set("Content-Type", ct.split(";")[0].trim() + "; charset=utf-8");
    return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers });
  }
  return resp;
}

function acceptsHtml(request) {
  const accept = request.headers.get("Accept") || "";
  return accept.includes("text/html");
}

async function handleApi(request, env, url) {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();

  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  if (path === "/api/health" && method === "GET") {
    return json({ ok: true });
  }

  if (path === "/api/auth/register" && method === "POST") {
    return register(request, env);
  }
  if (path === "/api/auth/login" && method === "POST") {
    return login(request, env);
  }
  if (path === "/api/auth/logout" && method === "POST") {
    return logout(request, env);
  }
  if (path === "/api/auth/me" && method === "GET") {
    return me(request, env);
  }

  if (path === "/api/notes" && method === "GET") {
    return listNotes(request, env);
  }
  if (path === "/api/notes" && method === "POST") {
    return createNote(request, env);
  }

  const noteMatch = path.match(/^\/api\/notes\/([^/]+)$/);
  if (noteMatch) {
    const noteId = decodeURIComponent(noteMatch[1]);
    if (method === "GET") return getNote(request, env, noteId);
    if (method === "PUT") return updateNote(request, env, noteId);
    if (method === "DELETE") return deleteNote(request, env, noteId);
  }

  return json({ error: "未找到接口" }, 404);
}

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function jsonWithCookie(data, status, setCookie) {
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (setCookie) headers["Set-Cookie"] = setCookie;
  return new Response(JSON.stringify(data), { status, headers });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function normalizeUsername(u) {
  return String(u || "").trim();
}

function validateCredentials(username, password) {
  if (!username || username.length < 3 || username.length > 32) {
    return "用户名需 3–32 个字符";
  }
  if (!/^[a-zA-Z0-9_\u4e00-\u9fff.-]+$/.test(username)) {
    return "用户名只能包含字母、数字、下划线、中文、点或横线";
  }
  if (!password || password.length < 6 || password.length > 128) {
    return "密码需 6–128 个字符";
  }
  return null;
}

function uid(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

async function hashPassword(password, saltB64) {
  const enc = new TextEncoder();
  const salt = saltB64
    ? base64ToBytes(saltB64)
    : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );
  return {
    hash: bytesToBase64(new Uint8Array(bits)),
    salt: bytesToBase64(salt),
  };
}

async function verifyPassword(password, saltB64, expectedHash) {
  const { hash } = await hashPassword(password, saltB64);
  return timingSafeEqual(hash, expectedHash);
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function bytesToBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function base64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function getSessionSecret(env) {
  return env.SESSION_SECRET || "dev-insecure-session-secret-change-me";
}

async function signSession(payload, env) {
  const secret = getSessionSecret(env);
  const body = bytesToBase64(new TextEncoder().encode(JSON.stringify(payload)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const sigB64 = bytesToBase64(new Uint8Array(sig))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${body}.${sigB64}`;
}

async function verifySession(token, env) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const secret = getSessionSecret(env);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const expected = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body)
  );
  const expectedB64 = bytesToBase64(new Uint8Array(expected))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  if (!timingSafeEqual(sig, expectedB64)) return null;
  try {
    const padded = body.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
    const jsonStr = new TextDecoder().decode(base64ToBytes(padded + pad));
    const payload = JSON.parse(jsonStr);
    if (!payload || !payload.uid || !payload.exp) return null;
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(request) {
  const header = request.headers.get("Cookie") || "";
  const out = {};
  header.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}

function sessionCookie(token, maxAge = SESSION_TTL_SEC) {
  const secure = "Secure; ";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; ${secure}SameSite=Lax; Max-Age=${maxAge}`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

async function requireUser(request, env) {
  const cookies = parseCookies(request);
  const payload = await verifySession(cookies[SESSION_COOKIE], env);
  if (!payload) return null;
  const row = await env.DB.prepare(
    "SELECT id, username FROM users WHERE id = ?"
  )
    .bind(payload.uid)
    .first();
  return row || null;
}

async function register(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: "无效请求" }, 400);
  const username = normalizeUsername(body.username);
  const password = String(body.password || "");
  const err = validateCredentials(username, password);
  if (err) return json({ error: err }, 400);

  const existing = await env.DB.prepare(
    "SELECT id FROM users WHERE username = ? COLLATE NOCASE"
  )
    .bind(username)
    .first();
  if (existing) return json({ error: "用户名已被占用" }, 409);

  const { hash, salt } = await hashPassword(password);
  const id = uid("u");
  const now = Date.now();
  try {
    await env.DB.prepare(
      "INSERT INTO users (id, username, password_hash, salt, created_at) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(id, username, hash, salt, now)
      .run();
  } catch (e) {
    return json({ error: "用户名已被占用" }, 409);
  }

  const token = await signSession(
    { uid: id, exp: Date.now() + SESSION_TTL_SEC * 1000 },
    env
  );
  return jsonWithCookie(
    { user: { id, username } },
    201,
    sessionCookie(token)
  );
}

async function login(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: "无效请求" }, 400);
  const username = normalizeUsername(body.username);
  const password = String(body.password || "");
  if (!username || !password) return json({ error: "请输入用户名和密码" }, 400);

  const user = await env.DB.prepare(
    "SELECT id, username, password_hash, salt FROM users WHERE username = ? COLLATE NOCASE"
  )
    .bind(username)
    .first();
  if (!user) return json({ error: "用户名或密码错误" }, 401);

  const ok = await verifyPassword(password, user.salt, user.password_hash);
  if (!ok) return json({ error: "用户名或密码错误" }, 401);

  const token = await signSession(
    { uid: user.id, exp: Date.now() + SESSION_TTL_SEC * 1000 },
    env
  );
  return jsonWithCookie(
    { user: { id: user.id, username: user.username } },
    200,
    sessionCookie(token)
  );
}

async function logout(request, env) {
  return jsonWithCookie({ ok: true }, 200, clearSessionCookie());
}

async function me(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ user: null }, 200);
  return json({ user: { id: user.id, username: user.username } });
}

async function listNotes(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: "请先登录" }, 401);
  const { results } = await env.DB.prepare(
    "SELECT id, title, body, created_at AS createdAt, updated_at AS updatedAt FROM notes WHERE user_id = ? ORDER BY updated_at DESC"
  )
    .bind(user.id)
    .all();
  return json({ notes: results || [] });
}

async function createNote(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: "请先登录" }, 401);
  const body = (await readJson(request)) || {};
  const id = uid("n");
  const now = Date.now();
  const title = String(body.title || "").slice(0, 200);
  const text = String(body.body || "");
  await env.DB.prepare(
    "INSERT INTO notes (id, user_id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(id, user.id, title, text, now, now)
    .run();
  return json(
    { note: { id, title, body: text, createdAt: now, updatedAt: now } },
    201
  );
}

async function getNote(request, env, noteId) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: "请先登录" }, 401);
  const note = await env.DB.prepare(
    "SELECT id, title, body, created_at AS createdAt, updated_at AS updatedAt FROM notes WHERE id = ? AND user_id = ?"
  )
    .bind(noteId, user.id)
    .first();
  if (!note) return json({ error: "笔记不存在" }, 404);
  return json({ note });
}

async function updateNote(request, env, noteId) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: "请先登录" }, 401);
  const body = (await readJson(request)) || {};
  const existing = await env.DB.prepare(
    "SELECT id FROM notes WHERE id = ? AND user_id = ?"
  )
    .bind(noteId, user.id)
    .first();
  if (!existing) return json({ error: "笔记不存在" }, 404);
  const title = String(body.title ?? "").slice(0, 200);
  const text = String(body.body ?? "");
  const now = Date.now();
  await env.DB.prepare(
    "UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ? AND user_id = ?"
  )
    .bind(title, text, now, noteId, user.id)
    .run();
  return json({
    note: { id: noteId, title, body: text, updatedAt: now },
  });
}

async function deleteNote(request, env, noteId) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: "请先登录" }, 401);
  const result = await env.DB.prepare(
    "DELETE FROM notes WHERE id = ? AND user_id = ?"
  )
    .bind(noteId, user.id)
    .run();
  if (!result.meta || result.meta.changes === 0) {
    return json({ error: "笔记不存在" }, 404);
  }
  return json({ ok: true });
}
