# Deploy the SIRAYA MCP Worker to Cloudflare

The Worker is configured for:

```text
siraya-mcp.bruceatsiraya.xyz
```

Current deployed Worker:

```text
Worker: siraya-mcp-worker
Custom domain: https://siraya-mcp.bruceatsiraya.xyz
Cron: 0 18 * * *
KV namespace: 7f90e1d5c1fd4ba0857271f12b5caa46
Preview KV namespace: f49c57aad20c48fa988e213e04259f6c
```

## Prerequisites

- Cloudflare account access for the `bruceatsiraya.xyz` zone.
- Wrangler authenticated locally.
- SIRAYA API key.

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

The Worker `SIRAYA_API_KEY` is a dedicated registry-sync key used only by scheduled and manual refresh. `ADMIN_TOKEN` protects manual refresh. Each agent supplies its own SIRAYA API key for model invocation.

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

## Custom Domain Notes

`wrangler.toml` uses:

```toml
routes = [
  { pattern = "siraya-mcp.bruceatsiraya.xyz", custom_domain = true }
]
```

If Cloudflare rejects the custom domain because the zone is not selected or DNS is not ready, add the Worker custom domain in the Cloudflare dashboard:

Workers & Pages -> siraya-mcp-worker -> Settings -> Triggers -> Custom Domains.
