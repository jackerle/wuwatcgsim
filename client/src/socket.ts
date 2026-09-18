import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@wuwatcg/shared";

/** Where the server listens when nothing says otherwise. */
const DEFAULT_SERVER_PORT = "3001";

/**
 * Where the Socket.IO server actually is.
 *
 * `VITE_SERVER_URL` is baked into the build at compile time — it is not
 * something a cloud host's runtime environment variables can fix after the
 * fact, because by the time the app is running in someone's browser, Vite
 * has already substituted whatever value it saw during `npm run build`. A
 * literal "http://localhost:3001" only ever worked on the machine that built
 * it, and kept saying so forever after, wherever the build was deployed.
 *
 * Left unset, this instead asks the browser what page it is actually on and
 * assumes the server sits on the same host, just on its own port — true for
 * local dev (localhost:5173 client, localhost:3001 server) and for the
 * simplest cloud deployment (one host, two exposed ports) without needing a
 * single build-time secret. It resolves at connection time, in the browser,
 * so the very same static build works unmodified wherever it lands.
 *
 * This guess is wrong when the server lives on a genuinely different host or
 * domain (a split deployment, or a sandboxed dev environment that maps each
 * port to its own subdomain) — set VITE_SERVER_URL explicitly to the
 * server's real address in that case, and set CLIENT_ORIGIN on the server to
 * match so its CORS check lets the connection through.
 */
function resolveServerUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL;
  if (configured) return configured;

  // Behind a reverse proxy (standard 80/443) the server is reached on the same
  // origin via /socket.io, not on a separate port.
  if (!window.location.port) return window.location.origin;

  const port = import.meta.env.VITE_SERVER_PORT || DEFAULT_SERVER_PORT;
  return `${window.location.protocol}//${window.location.hostname}:${port}`;
}

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(resolveServerUrl(), {
  autoConnect: true,
});
