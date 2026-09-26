// A read-only status page: open rooms, who is online, matches in play and the
// last errors the server printed. One HTML page and one JSON endpoint, served
// by the Express app that is already running — no database, no framework, no
// extra process. The page asks for fresh numbers only while it is open, so it
// costs nothing when nobody is looking.
//
// Guarded by ADMIN_TOKEN in the server's .env. Unset, both routes answer 404,
// as if they did not exist. The token is checked on the JSON only: the page
// itself is an empty shell that asks for it.

import { timingSafeEqual } from "node:crypto";
import type { Express, Request } from "express";

const TOKEN = process.env.ADMIN_TOKEN ?? "";

/** How many errors to remember. Older ones fall off the end. */
const ERROR_LIMIT = 50;

const errors: { at: string; text: string }[] = [];
const startedAt = Date.now();

/**
 * Keeps a copy of everything the server reports through console.error —
 * a card effect that threw, Discord refusing a bug report — for the status
 * page, while still printing it as before.
 */
export function captureErrors(): void {
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    original(...args);
    const text = args
      .map((arg) => (arg instanceof Error ? (arg.stack ?? arg.message) : typeof arg === "string" ? arg : safeJson(arg)))
      .join(" ");
    errors.unshift({ at: new Date().toISOString(), text: text.slice(0, 2000) });
    if (errors.length > ERROR_LIMIT) errors.length = ERROR_LIMIT;
  };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function authorised(req: Request): boolean {
  const given = (req.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function registerAdmin(app: Express, snapshot: () => Record<string, unknown>): void {
  app.get("/admin", (_req, res) => {
    if (!TOKEN) return void res.sendStatus(404);
    res.type("html").send(PAGE);
  });

  app.get("/admin/status", (req, res) => {
    if (!TOKEN) return void res.sendStatus(404);
    if (!authorised(req)) return void res.sendStatus(401);
    const memory = process.memoryUsage();
    res.json({
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      memoryMb: Math.round(memory.rss / 1024 / 1024),
      ...snapshot(),
      errors,
    });
  });
}

// The whole page, inline. Plain DOM, a few lines of CSS; nothing to build.
const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>WUWATCGSIM status</title>
<style>
  body { margin: 0; padding: 16px; font: 14px/1.5 system-ui, sans-serif; background: #111522; color: #e6e9f2; }
  h1 { font-size: 18px; margin: 0 0 12px; }
  h2 { font-size: 15px; margin: 20px 0 8px; }
  .tiles { display: flex; flex-wrap: wrap; gap: 8px; }
  .tile { background: #1b2133; border-radius: 8px; padding: 8px 12px; min-width: 110px; }
  .tile b { display: block; font-size: 20px; }
  table { width: 100%; border-collapse: collapse; }
  td, th { text-align: left; padding: 4px 8px; border-bottom: 1px solid #262d42; vertical-align: top; }
  pre { white-space: pre-wrap; word-break: break-word; margin: 0; font-size: 12px; }
  .muted { color: #8a91a6; }
  .off { color: #e08a8a; }
  form { display: flex; gap: 8px; }
  input { flex: 1; padding: 6px 8px; background: #1b2133; color: inherit; border: 1px solid #333b55; border-radius: 6px; }
  button { padding: 6px 12px; }
</style>
</head>
<body>
<h1>WUWATCGSIM status <span class="muted" id="stamp"></span></h1>
<form id="login" hidden><input id="token" type="password" placeholder="Admin token" autocomplete="current-password" /><button>Open</button></form>
<div id="out"></div>
<script>
const KEY = "wuwatcg.adminToken";
const out = document.getElementById("out");
const login = document.getElementById("login");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const ago = (s) => s < 3600 ? Math.round(s / 60) + " min" : (s / 3600).toFixed(1) + " h";
let timer = null;

async function load() {
  const token = sessionStorage.getItem(KEY);
  if (!token) { login.hidden = false; return; }
  const res = await fetch("/admin/status", { headers: { authorization: "Bearer " + token } }).catch(() => null);
  if (!res) { out.textContent = "Server unreachable."; return; }
  if (res.status === 401) { sessionStorage.removeItem(KEY); login.hidden = false; out.textContent = "Wrong token."; return; }
  const d = await res.json();
  login.hidden = true;
  document.getElementById("stamp").textContent = "· " + new Date().toLocaleTimeString();
  const tile = (label, value) => '<div class="tile"><b>' + esc(value) + '</b>' + esc(label) + '</div>';
  const rooms = d.rooms.map((r) => '<tr><td>' + esc(r.code) + '</td><td>' + esc(r.visibility) + '</td><td>' +
    r.players.map((p) => '<span class="' + (p.connected ? '' : 'off') + '">' + esc(p.name) + (p.host ? ' (host)' : '') + '</span>').join(', ') +
    '</td><td>' + (r.match ? 'turn ' + r.match.turn + ' · ' + esc(r.match.phase) + (r.match.winner ? ' · won by ' + esc(r.match.winner) : '') : '<span class="muted">lobby</span>') + '</td></tr>').join('');
  const errs = d.errors.map((e) => '<tr><td class="muted">' + esc(new Date(e.at).toLocaleString()) + '</td><td><pre>' + esc(e.text) + '</pre></td></tr>').join('');
  out.innerHTML =
    '<div class="tiles">' + tile("online now", d.online) + tile("rooms", d.rooms.length) + tile("matches in play", d.matches) +
    tile("up", ago(d.uptimeSeconds)) + tile("memory", d.memoryMb + " MB") + '</div>' +
    '<h2>Rooms</h2>' + (rooms ? '<table><tr><th>Code</th><th></th><th>Players</th><th>Match</th></tr>' + rooms + '</table>' : '<p class="muted">None open.</p>') +
    '<h2>Recent errors</h2>' + (errs ? '<table>' + errs + '</table>' : '<p class="muted">None since the server started.</p>');
}

login.addEventListener("submit", (e) => {
  e.preventDefault();
  sessionStorage.setItem(KEY, document.getElementById("token").value);
  load();
});
// Every 15 seconds, and only while the tab is actually being looked at.
function schedule() {
  clearInterval(timer);
  if (document.visibilityState === "visible") timer = setInterval(load, 15000);
}
document.addEventListener("visibilitychange", () => { schedule(); if (document.visibilityState === "visible") load(); });
schedule();
load();
</script>
</body>
</html>`;
