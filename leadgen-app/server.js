require("dotenv").config();
const express = require("express");
const session = require("express-session");
const FileStore = require("session-file-store")(session);
const path = require("path");
const fs = require("fs");

const { login, logout, whoami, requireAuth, requirePageAuth, requireAdmin } = require("./src/auth");
const searchRoute = require("./src/routes/search");
const leadsRoute = require("./src/routes/leads");
const nichesRoute = require("./src/routes/niches");
const catchLogsRoute = require("./src/routes/catchLogs");
const settingsRoute = require("./src/routes/settings");
const usersRoute = require("./src/routes/users");
const themeRoute = require("./src/routes/theme");
const reportsRoute = require("./src/routes/reports");
const backupRoute = require("./src/routes/backup");

const app = express();

// Behind Coolify/Traefik's reverse proxy - needed for correct protocol/IP detection
app.set("trust proxy", 1);

app.use(express.json({ limit: "25mb" })); // backup imports can be large for accounts with lots of leads

const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
console.log(`[startup] Using data directory: ${dataDir}`);
console.log(`[startup] SQLite file present: ${fs.existsSync(path.join(dataDir, "leadgen.db"))}`);

app.use(
  session({
    store: new FileStore({
      path: path.join(dataDir, "sessions"), // co-located with the DB, so it
      // survives redeploys as long as your Coolify volume covers /data
      ttl: 60 * 60 * 24 * 7,
      logFn: () => {}, // quiet - avoid noisy logs for routine session file ops
    }),
    secret: process.env.SESSION_SECRET || "prospect-dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
      httpOnly: true,
    },
  })
);

// Publicly reachable: login page + shared static assets (css/js/fonts).
// index.html is served explicitly below, gated behind auth.
// Cache-Control: no-cache forces the browser to revalidate on every load
// instead of silently reusing a stale copy of app.js/style.css after a deploy.
app.use(
  express.static(path.join(__dirname, "public"), {
    index: false,
    setHeaders: (res) => res.setHeader("Cache-Control", "no-cache"),
  })
);

app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
app.post("/api/login", login);
app.post("/api/logout", logout);
app.get("/api/whoami", requireAuth, whoami);

app.get("/", requirePageAuth, (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// Everything else under /api requires an authenticated session
app.use("/api/search", requireAuth, searchRoute);
app.use("/api/leads", requireAuth, leadsRoute);
app.use("/api/niches", requireAuth, nichesRoute);
app.use("/api/catch-logs", requireAuth, catchLogsRoute);
app.use("/api/settings", requireAuth, settingsRoute);
app.use("/api/users", requireAuth, requireAdmin, usersRoute);
app.use("/api/theme", requireAuth, themeRoute);
app.use("/api/reports", requireAuth, reportsRoute);
app.use("/api/backup", requireAuth, backupRoute);

app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Lead-gen app running on port ${PORT}`);
});
