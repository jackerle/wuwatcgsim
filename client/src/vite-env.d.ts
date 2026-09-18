/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Full override — set this when the server is not "this host, another port". */
  readonly VITE_SERVER_URL?: string;
  /** Port-only override, when the host guess is right but 3001 isn't. */
  readonly VITE_SERVER_PORT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
