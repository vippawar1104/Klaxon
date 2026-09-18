# Deploying Klaxon

What it takes to run Klaxon for real, so a deployed site's crashes reach it
from any visitor's browser rather than only from your own machine.

## Why a tunnel is not enough

A local tunnel (ngrok, cloudflared) only works while your laptop is awake, and
both have failure modes that are invisible until a real browser hits them:

- ngrok's free tier answers browser requests with an HTML interstitial unless
  they carry `ngrok-skip-browser-warning`. A `<script src>` tag cannot send
  headers, so the SDK silently loads an HTML page as JavaScript and never
  initialises. `curl` does not reproduce this — it is skipped for non-browser
  user agents, which makes the tunnel look healthy when it is not.
- Cloudflare quick tunnels serve JS correctly, but some resolvers return
  NXDOMAIN for `*.trycloudflare.com`, which makes the tunnel unreachable from
  the very network hosting it.

Deploy the API and neither applies.

## Render (blueprint included)

`render.yaml` declares all three services: the API, a Postgres database, and
the dashboard as a static site.

1. Push this repo to GitHub.
2. render.com → **New** → **Blueprint** → select the repo. Render reads
   `render.yaml` and provisions everything.
3. After the first deploy, set two values in the dashboard:
   - `KLAXON_INGEST_ORIGIN` on **klaxon-api** → the API's full URL *including
     the scheme*, e.g. `https://klaxon-api.onrender.com`. Every DSN is built
     from this; a value without `https://` produces a malformed DSN.
   - `GROQ_API_KEY` on **klaxon-api** → only needed for the "Explain" button.
     Everything else works without it.
4. If your API's hostname is not `klaxon-api.onrender.com`, update
   `VITE_API_BASE` on **klaxon-dashboard** to match and redeploy it. That value
   is baked in at build time, not read at runtime.

### Free plan caveat

Render's free web services sleep after ~15 minutes idle and take a few seconds
to wake. Ingest returns `202` before doing any work, so a cold start delays the
first event rather than losing it — but for anything you actually depend on,
use a paid instance.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | in production | Postgres connection string. Unset falls back to a local SQLite file, which is correct for development and wrong for deployment. |
| `KLAXON_INGEST_ORIGIN` | in production | Public API origin used to build DSNs and loader URLs. Must include the scheme. |
| `GROQ_API_KEY` | no | Enables AI explanation of a stack trace. Strictly off the ingest path. |
| `KLAXON_WORKER` | no | `1` (default) drains the queue in-process. Set `0` when running a separate worker. |
| `VITE_API_BASE` | dashboard build | Where the dashboard's API calls go, e.g. `https://klaxon-api.onrender.com/api`. Build-time only. |

## Database

SQLite is the local default and is not viable in production: a container's
filesystem is ephemeral, so the file is destroyed on every deploy, and its
single-writer lock is the measured throughput ceiling on ingest.

Setting `DATABASE_URL` switches to Postgres. Legacy `postgres://` URLs are
rewritten to the driver SQLAlchemy 2 expects. Tables are created on startup;
there is no separate migration step.

## Connecting a site

Once deployed, the dashboard's **Setup** tab shows a single line to paste into
your site's `<head>`:

```html
<script src="https://klaxon-api.onrender.com/js/1/pk_xxx.js"></script>
```

The SDK arrives pre-configured for that project, so there is nothing to
initialise and no gap between the script loading and error capture starting.

### React and Next.js

React routes render errors to an error boundary rather than `window.onerror`,
so the script tag alone will not see them — the largest class of crashes in a
React app. Report them explicitly; in the Next.js App Router, from
`app/global-error.tsx`:

```tsx
'use client'

export default function GlobalError({ error }: { error: Error }) {
  window.Klaxon?.captureException(error)
  return <html><body><h2>Something went wrong</h2></body></html>
}
```

## Verifying a deployment

```bash
curl https://klaxon-api.onrender.com/api/health
```

Then, with a browser user agent, confirm the loader really returns JavaScript
rather than an interstitial or error page — this is the check that would have
caught the ngrok failure above:

```bash
curl -s -A "Mozilla/5.0" -o /dev/null -w '%{content_type}\n' \
  https://klaxon-api.onrender.com/js/1/pk_xxx.js
# expect: application/javascript; charset=utf-8
```

Finally, open the deployed site, throw an error from the console, and watch the
Setup tab. The SDK batches for 5 seconds before sending, so allow ~6 seconds:

```js
setTimeout(() => { null.crash() })
```

It must be thrown asynchronously — an error typed directly into the console is
captured by devtools and never reaches `window.onerror`.
