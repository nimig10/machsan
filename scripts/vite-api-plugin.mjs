// vite-api-plugin.mjs
// Dev-only Vite plugin: runs Vercel-style handlers from ./api/*.js in-process,
// so local `npm run dev` supports /api/* routes without `vercel dev`.
//
// Behaviour:
//   * Loads .env.local into process.env on startup (handlers read SUPABASE_URL,
//     SUPABASE_SERVICE_ROLE_KEY, etc. directly off process.env).
//   * Intercepts requests whose path starts with /api/ — resolves to
//     ./api/<route>.js, dynamically imports it, invokes the default export
//     with (req, res) where res has Vercel-compatible .status()/.json()/.send().
//   * Parses JSON + urlencoded bodies before invoking the handler, matching
//     Vercel's runtime behaviour.
//   * Skips files starting with `_` (they're helpers, not routes).

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { parse as parseUrl } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_DIR = resolve(__dirname, "..", "api");

function loadEnvLocal() {
  const envPath = resolve(__dirname, "..", ".env.local");
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Z_][A-Z0-9_]*)="(.*)"$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => resolveBody(Buffer.concat(chunks)));
    req.on("error", rejectBody);
  });
}

function parseBody(raw, contentType) {
  if (!raw || raw.length === 0) return undefined;
  const ct = (contentType || "").toLowerCase();
  const text = raw.toString("utf8");
  if (ct.includes("application/json")) {
    try { return JSON.parse(text); } catch { return {}; }
  }
  if (ct.includes("application/x-www-form-urlencoded")) {
    const out = {};
    for (const [k, v] of new URLSearchParams(text).entries()) out[k] = v;
    return out;
  }
  return text;
}

function wrapResponse(res) {
  // Vercel-style helpers on top of Node's ServerResponse.
  res.status = function (code) { this.statusCode = code; return this; };
  res.json = function (obj) {
    if (!this.getHeader("Content-Type")) this.setHeader("Content-Type", "application/json; charset=utf-8");
    this.end(JSON.stringify(obj));
    return this;
  };
  res.send = function (body) {
    if (body == null) { this.end(); return this; }
    if (typeof body === "object" && !(body instanceof Buffer)) return this.json(body);
    this.end(body);
    return this;
  };
  return res;
}

export default function devApiPlugin() {
  loadEnvLocal();

  return {
    name: "dev-api-plugin",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || "";
        if (!url.startsWith("/api/")) return next();

        const { pathname, query } = parseUrl(url, true);
        // /api/foo  or  /api/foo/bar -> foo or foo/bar
        const route = pathname.replace(/^\/api\//, "").replace(/\/$/, "");
        if (!route || route.startsWith("_")) {
          res.statusCode = 404;
          return res.end(JSON.stringify({ error: "Not found" }));
        }

        const handlerPath = join(API_DIR, `${route}.js`);
        if (!existsSync(handlerPath)) {
          res.statusCode = 404;
          res.setHeader("Content-Type", "application/json");
          return res.end(JSON.stringify({ error: `No handler at api/${route}.js` }));
        }

        try {
          // Cache-bust on every request so edits to api/*.js are picked up.
          const mod = await import(`file://${handlerPath}?t=${Date.now()}`);
          const handler = mod.default || mod.handler;
          if (typeof handler !== "function") {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            return res.end(JSON.stringify({ error: `api/${route}.js has no default export` }));
          }

          const raw = await readBody(req);
          req.body = parseBody(raw, req.headers["content-type"]);
          req.query = query || {};
          wrapResponse(res);

          await handler(req, res);
        } catch (err) {
          console.error(`[dev-api] ${route} threw:`, err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Handler threw", detail: String(err?.message || err) }));
          }
        }
      });
    },
  };
}
