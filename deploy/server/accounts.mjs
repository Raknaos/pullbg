/** Server accounts + cookie sessions. JSON on disk, scrypt passwords. */
import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const scryptP = promisify(scrypt);
const DATA_DIR = process.env.PULLBG_DATA_DIR || "/var/lib/pullbg";
const USERS = path.join(DATA_DIR, "users.json");
const SESSIONS = path.join(DATA_DIR, "sessions.json");
const COOKIE = "cutbg";
const TTL_MS = 1000 * 60 * 60 * 24 * 30;

await mkdir(DATA_DIR, { recursive: true });

async function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

let writeChain = Promise.resolve();
function writeJson(file, data) {
  writeChain = writeChain.then(() => writeFile(file, JSON.stringify(data), "utf8"));
  return writeChain;
}

async function hashPass(password) {
  const salt = randomBytes(16).toString("hex");
  const buf = await scryptP(password, salt, 32);
  return `scrypt:${salt}:${buf.toString("hex")}`;
}

async function checkPass(password, stored) {
  const [, salt, hex] = String(stored || "").split(":");
  if (!salt || !hex) return false;
  const buf = await scryptP(password, salt, 32);
  const a = Buffer.from(hex, "hex");
  if (a.length !== buf.length) return false;
  return timingSafeEqual(a, buf);
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function publicUser(u) {
  if (!u) return null;
  return { email: u.email, plan: u.plan || "free", planUntil: u.planUntil || null };
}

export async function findUser(email) {
  const users = await readJson(USERS, []);
  return users.find((u) => u.email === email) || null;
}

export async function userFromReq(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const sessions = await readJson(SESSIONS, {});
  const s = sessions[token];
  if (!s || s.exp < Date.now()) return null;
  return findUser(s.email);
}

function cookieFlags(req) {
  const proto = req.get("x-forwarded-proto") || (req.secure ? "https" : "http");
  const secure = proto === "https" ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(TTL_MS / 1000)}${secure}`;
}

export async function setSession(res, req, email) {
  const token = randomBytes(24).toString("hex");
  const sessions = await readJson(SESSIONS, {});
  sessions[token] = { email, exp: Date.now() + TTL_MS };
  await writeJson(SESSIONS, sessions);
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; ${cookieFlags(req)}`);
}

export async function clearSession(req, res) {
  const token = parseCookies(req)[COOKIE];
  if (token) {
    const sessions = await readJson(SESSIONS, {});
    delete sessions[token];
    await writeJson(SESSIONS, sessions);
  }
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export async function signupUser(email, password) {
  email = String(email || "").trim().toLowerCase();
  if (!email.includes("@") || String(password || "").length < 6) {
    throw Object.assign(new Error("Email valide et mot de passe ≥ 6 caractères."), { status: 400 });
  }
  const users = await readJson(USERS, []);
  if (users.some((u) => u.email === email)) {
    throw Object.assign(new Error("Ce compte existe déjà."), { status: 409 });
  }
  const user = {
    email,
    pass: await hashPass(password),
    created: Date.now(),
    plan: "free",
    planUntil: null,
  };
  users.push(user);
  await writeJson(USERS, users);
  return user;
}

export async function loginUser(email, password) {
  email = String(email || "").trim().toLowerCase();
  const user = await findUser(email);
  if (!user || !(await checkPass(password, user.pass))) {
    throw Object.assign(new Error("Identifiants incorrects."), { status: 401 });
  }
  return user;
}

export async function setUserPlan(email, plan, untilIso) {
  const users = await readJson(USERS, []);
  const u = users.find((x) => x.email === email);
  if (!u) return null;
  u.plan = plan;
  u.planUntil = untilIso;
  await writeJson(USERS, users);
  return u;
}

export function mountAccounts(app) {
  app.get("/api/me", async (req, res) => {
    const u = await userFromReq(req);
    res.json(u ? publicUser(u) : { email: null });
  });

  app.post("/api/signup", async (req, res) => {
    try {
      const user = await signupUser(req.body?.email, req.body?.password);
      await setSession(res, req, user.email);
      res.json(publicUser(user));
    } catch (e) {
      res.status(e.status || 400).json({ error: e.message });
    }
  });

  app.post("/api/login", async (req, res) => {
    try {
      const user = await loginUser(req.body?.email, req.body?.password);
      await setSession(res, req, user.email);
      res.json(publicUser(user));
    } catch (e) {
      res.status(e.status || 400).json({ error: e.message });
    }
  });

  app.post("/api/logout", async (req, res) => {
    await clearSession(req, res);
    res.json({ ok: true });
  });
}
