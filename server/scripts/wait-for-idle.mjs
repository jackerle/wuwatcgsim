// Waits for the running server to have no match in progress, so a deploy can
// restart it without taking a game away from anyone.
//
// Rooms and matches live in the server's memory and do not survive a restart
// (see README) — so the only way a deploy costs nobody a game is to pick a
// moment when there is no game to cost. This polls /health, which reports
// what the process is carrying, and exits 0 once `matches` reaches zero.
//
// Deliberately plain .mjs with no imports: a deploy step that cannot fail to
// compile, and that still runs if the build it is gating is broken.
//
// Run with: node server/scripts/wait-for-idle.mjs
//
//   HEALTH_URL       where to look          (default http://127.0.0.1:$PORT/health)
//   PORT             the server's port      (default 3001)
//   DRAIN_TIMEOUT_S  how long to wait       (default 900 — fifteen minutes)
//   DRAIN_EVERY_S    how often to look      (default 10)
//
// Exits 1 if a match is still running when the time is up, which stops the
// deploy rather than deciding on the operator's behalf. `npm run deploy:now`
// is the way to say "restart anyway".

const PORT = process.env.PORT ?? "3001";
const URL_ = process.env.HEALTH_URL ?? `http://127.0.0.1:${PORT}/health`;
const TIMEOUT_MS = Number(process.env.DRAIN_TIMEOUT_S ?? 900) * 1000;
const EVERY_MS = Number(process.env.DRAIN_EVERY_S ?? 10) * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The server's load, or null if it could not be asked. */
async function load() {
  try {
    const response = await fetch(URL_, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return null;
    const body = await response.json();
    return body?.load ?? null;
  } catch {
    return null;
  }
}

const deadline = Date.now() + TIMEOUT_MS;
let announced = false;

while (true) {
  const now = await load();

  // Nothing answering: a first deploy, or a server that is already down.
  // Either way there is no match to wait for and no reason to hold the
  // deploy up.
  if (now === null) {
    console.log(`wait-for-idle: no server answering at ${URL_} — nothing to drain`);
    process.exit(0);
  }

  if (now.matches === 0) {
    console.log(`wait-for-idle: idle (${now.rooms} room(s), ${now.players} player(s)) — safe to restart`);
    process.exit(0);
  }

  if (Date.now() >= deadline) {
    console.error(
      `wait-for-idle: ${now.matches} match(es) still running after ${TIMEOUT_MS / 1000}s — not restarting.\n` +
        `             Wait and run the deploy again, or use \`npm run deploy:now\` to restart anyway.`
    );
    process.exit(1);
  }

  if (!announced) {
    console.log(`wait-for-idle: ${now.matches} match(es) in progress — waiting for them to finish`);
    announced = true;
  }
  await sleep(EVERY_MS);
}
