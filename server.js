const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const db = require("./db");
const { seed } = require("./seed");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.DIRECTORY_ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.DIRECTORY_ADMIN_PASSWORD || process.env.DIRECTORY_PIN || "zomi";
const SESSION_MS = 8 * 60 * 60 * 1000;
const sessions = new Map();
const loginAttempts = new Map();

const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase() || ".jpg";
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
});

app.use(express.json({ limit: "2mb" }));
app.use("/img", express.static(path.join(__dirname, "img")));
app.use("/uploads", express.static(uploadDir));
app.use(express.static(path.join(__dirname, "public")));

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function readSession(req) {
  const token = parseCookies(req).admin_session;
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_MS) {
    sessions.delete(token);
    return null;
  }
  return { token, ...session };
}

function setSessionCookie(res, token) {
  res.setHeader(
    "Set-Cookie",
    `admin_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_MS / 1000)}`
  );
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "admin_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) {
    crypto.timingSafeEqual(left, left);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function tooManyLogins(ip) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const entry = loginAttempts.get(ip) || { count: 0, start: now };
  if (now - entry.start > windowMs) {
    loginAttempts.set(ip, { count: 1, start: now });
    return false;
  }
  entry.count += 1;
  loginAttempts.set(ip, entry);
  return entry.count > 8;
}

function requireAdmin(req, res, next) {
  const session = readSession(req);
  if (!session) {
    return res.status(401).json({ error: "Admin login required" });
  }
  req.admin = session;
  next();
}

const PUBLIC_API = new Set(["GET /api/directory", "GET /api/me", "POST /api/login", "POST /api/logout"]);
app.use((req, res, next) => {
  if (!req.path.startsWith("/api")) return next();
  const key = `${req.method} ${req.path}`;
  if (PUBLIC_API.has(key)) return next();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return requireAdmin(req, res, next);
  }
  next();
});

app.get("/api/directory", (_req, res) => {
  res.json(db.getDirectory());
});

app.get("/api/me", (req, res) => {
  res.json({ admin: Boolean(readSession(req)) });
});

app.post("/api/login", (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  if (tooManyLogins(ip)) {
    return res.status(429).json({ error: "Too many login attempts. Try again later." });
  }
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || req.body?.pin || "");
  if (!safeEqual(username, ADMIN_USER) || !safeEqual(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: "Wrong admin username or password" });
  }
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, { createdAt: Date.now(), username });
  setSessionCookie(res, token);
  res.json({ ok: true, admin: true });
});

app.post("/api/logout", (req, res) => {
  const session = readSession(req);
  if (session) sessions.delete(session.token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.post("/api/upload", requireAdmin, upload.single("photo"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No photo uploaded" });
  res.json({ url: `/uploads/${req.file.filename}` });
});

app.post("/api/groups", requireAdmin, (req, res) => {
  if (!req.body?.name?.trim()) return res.status(400).json({ error: "Group name is required" });
  res.status(201).json(db.createGroup(req.body));
});

app.put("/api/groups/:id", requireAdmin, (req, res) => {
  const group = db.updateGroup(Number(req.params.id), req.body || {});
  if (!group) return res.status(404).json({ error: "Group not found" });
  res.json(group);
});

app.delete("/api/groups/:id", requireAdmin, (req, res) => {
  db.deleteGroup(Number(req.params.id));
  res.json({ ok: true });
});

app.post("/api/people", requireAdmin, (req, res) => {
  if (!req.body?.name?.trim() || !req.body?.group_id || !req.body?.kind) {
    return res.status(400).json({ error: "Name, group, and type are required" });
  }
  res.status(201).json(db.createPerson(req.body));
});

app.put("/api/people/:id", requireAdmin, (req, res) => {
  const person = db.updatePerson(Number(req.params.id), req.body || {});
  if (!person) return res.status(404).json({ error: "Person not found" });
  res.json(person);
});

app.delete("/api/people/:id", requireAdmin, (req, res) => {
  db.deletePerson(Number(req.params.id));
  res.json({ ok: true });
});

seed();

app.listen(PORT, () => {
  console.log(`Directory running at http://localhost:${PORT}`);
  console.log(`Admin login: ${ADMIN_USER} / ${ADMIN_PASSWORD}`);
});
