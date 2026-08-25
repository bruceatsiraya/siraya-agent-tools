# Deploy the SIRAYA MCP Worker to Cloudflare

The Worker is configured for:

```text
siraya-mcp.bruceatsiraya.xyz
```

Current deployed Worker:

```text
Worker: siraya-mcp-worker
Cloudflare account: Sry_int (ab9ae397d12c06738bd3c9b984633a33)
Public URL: https://siraya-mcp.bruceatsiraya.xyz
Worker URL: https://siraya-mcp-worker.sry-int-ab9.workers.dev
Cron: 0 18 * * *
KV namespace: 660bb2ea88d54a4e8fc2896033cf3d0c
Preview KV namespace: 358ad061f635493bbef51b0141a8f741
D1 database: 4fb97140-daf5-42d2-837a-cc3378811abc
```

## Prerequisites

- Cloudflare account access for the `bruceatsiraya.xyz` zone.
- Wrangler authenticated locally.
- SIRAYA API key.

The deployment is pinned to its Cloudflare account with `account_id` in
`packages/mcp-worker/wrangler.toml`. This prevents Wrangler from accidentally
using resource IDs from another authenticated account.

## 1. Install Dependencies

```bash
pnpm install
```

On Windows PowerShell, if `npm.ps1` is blocked by execution policy, use the bundled `pnpm.cmd` or call `npm.cmd` instead of `npm`.

## 2. Create KV Namespace

```bash
npx wrangler@latest kv namespace create SIRAYA_REGISTRY
npx wrangler@latest kv namespace create SIRAYA_REGISTRY --preview
```

Copy the returned IDs into:

```text
packages/mcp-worker/wrangler.toml
```

Replace:

```toml
id = "REPLACE_WITH_KV_NAMESPACE_ID"
preview_id = "REPLACE_WITH_PREVIEW_KV_NAMESPACE_ID"
```

## 3. Add Secrets

```bash
npx wrangler@latest secret put SIRAYA_API_KEY --config packages/mcp-worker/wrangler.toml
npx wrangler@latest secret put ADMIN_TOKEN --config packages/mcp-worker/wrangler.toml
```

The Worker `SIRAYA_API_KEY` is a dedicated registry-sync key used only by scheduled and manual refresh. Browser administrators sign in at `/admin`; `ADMIN_TOKEN` is an optional emergency CLI credential. Each agent supplies its own SIRAYA API key for model invocation.

On Windows PowerShell, use `npx.cmd` if `npx.ps1` is blocked:

```powershell
npx.cmd wrangler@latest secret put SIRAYA_API_KEY --config packages/mcp-worker/wrangler.toml
npx.cmd wrangler@latest secret put ADMIN_TOKEN --config packages/mcp-worker/wrangler.toml
```

## 4. Deploy

```bash
npx wrangler@latest deploy --config packages/mcp-worker/wrangler.toml
```

## 5. Verify

```bash
curl https://siraya-mcp.bruceatsiraya.xyz/health
curl https://siraya-mcp.bruceatsiraya.xyz/registry
```

Expected health response:

```json
{
  "ok": true,
  "service": "siraya-mcp-worker"
}
```

The deployment in this workspace has already verified:

```text
GET  https://siraya-mcp.bruceatsiraya.xyz/health
POST https://siraya-mcp.bruceatsiraya.xyz/mcp  initialize
```

The daily refresh requires the Worker's dedicated registry-sync `SIRAYA_API_KEY`. Model invocation tools use the calling agent's own SIRAYA API key instead.

## 6. Trigger Manual Registry Refresh

```bash
curl -X POST https://siraya-mcp.bruceatsiraya.xyz/refresh \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

## Domain Routing Notes

`wrangler.toml` uses:

```toml
workers_dev = true
preview_urls = false
routes = [
  { pattern = "siraya-mcp.bruceatsiraya.xyz/*", zone_name = "bruceatsiraya.xyz" }
]
```

The `bruceatsiraya.xyz` DNS zone contains this proxied record:

```text
CNAME  siraya-mcp  siraya-mcp-worker.sry-int-ab9.workers.dev  Proxied
```

This standard Worker Route configuration is intentional. During the 2026-08-25
account migration, Cloudflare displayed the Custom Domain as configured but did
not publish its managed DNS record. A proxied CNAME plus zone route avoids that
provisioning dependency while preserving the same public FQDN.
