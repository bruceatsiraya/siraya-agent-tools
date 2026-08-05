# Model Metadata Administration

SIRAYA Agent Tools combines automatic model inference with persistent,
human-reviewed metadata corrections.

## Precedence

```text
manual override > approved web research > automatic inference
```

Manual overrides are stored in Cloudflare D1 and reapplied every time the daily
registry refresh rebuilds the compiled KV document. MCP, SDK, and the Models
page all read that same compiled registry.

## Edit Fields

1. Open `https://siraya-mcp.bruceatsiraya.xyz/models`.
2. Expand a model and select **Edit metadata**.
3. Enter `ADMIN_TOKEN` and select **Load**.
4. Enable **Manual** only for fields that should override inference.
5. Save the changes.

Provider, family, category, documentation, pricing, modalities, API formats,
capability tags, task tags, traits, lifecycle, quality, speed, feature flags,
supported parameters, and notes can be overridden. The upstream model ID and
raw SIRAYA payload remain read-only.

## Research

The **Research model** action:

1. Tries SIRAYA Tavily search.
2. Uses direct Tavily when `TAVILY_API_KEY` is configured.
3. Falls back to public Bing RSS and DuckDuckGo search results.
4. Fetches public page text.
5. Calls the configured SIRAYA enrichment model for strict JSON classification.
6. Validates every candidate against the Registry schema.
7. Stores the result as pending until an administrator approves or rejects it.

The default analysis model is configured through `SIRAYA_ENRICHMENT_MODEL`.
Search and analysis use `SIRAYA_ENRICHMENT_API_KEY` when present and otherwise
fall back to the dedicated registry-sync `SIRAYA_API_KEY`.

## Admin API

All routes require `Authorization: Bearer <ADMIN_TOKEN>`.

```text
GET    /admin/models/:modelId
PATCH  /admin/models/:modelId
DELETE /admin/models/:modelId
POST   /admin/models/:modelId/research
POST   /admin/research/:researchId/approve
POST   /admin/research/:researchId/reject
```

Override writes use an integer `baseVersion`. A stale edit returns HTTP 409
instead of silently overwriting a newer administrator change.
