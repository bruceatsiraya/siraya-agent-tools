# SIRAYA MCP Server

`siraya-mcp-worker` exposes SIRAYA Model Router to MCP-capable agents through Cloudflare Workers.

Production FQDN:

```text
https://siraya-mcp.bruceatsiraya.xyz
```

MCP endpoint:

```text
https://siraya-mcp.bruceatsiraya.xyz/mcp
```

## What It Provides

The server exposes these MCP tools:

| Tool | Purpose |
| --- | --- |
| `siraya_list_models` | List or filter models by normalized capability, task, trait, provider, category, and lifecycle labels. |
| `siraya_list_capability_taxonomy` | Return all supported labels, descriptions, and current model counts. |
| `siraya_get_model_capabilities` | Return capability details for one model. |
| `siraya_recommend_model` | Recommend a model for a task and required features. |
| `siraya_validate_request` | Warn when request parameters may be dropped or ignored. |
| `siraya_chat_completion` | Call `/v1/chat/completions`. |
| `siraya_responses` | Call `/v1/responses`. |
| `siraya_generate_image` | Call `/v1/images/generations`. |
| `siraya_generate_video` | Call `/v1/videos/generations`. |

## REST Endpoints

These endpoints are useful for debugging and for non-MCP clients:

```text
GET  /health
GET  /registry
GET  /models        # HTML catalog for browsers; full registry when requested as JSON
GET  /api/models    # JSON model list
POST /refresh       # protected manual refresh; also checks public pricing pages
POST /mcp
```

`/refresh` requires `Authorization: Bearer <ADMIN_TOKEN>` when `ADMIN_TOKEN` is configured. The catalog's **Refresh registry** button prompts for this token in the browser and sends it only for that request; it is never stored in the page or registry.

## MCP Client Configuration

For clients that support remote Streamable HTTP MCP servers:

```json
{
  "mcpServers": {
    "siraya": {
      "url": "https://siraya-mcp.bruceatsiraya.xyz/mcp",
      "headers": {
        "Authorization": "Bearer ${SIRAYA_API_KEY}"
      }
    }
  }
}
```

Some MCP clients require a local bridge for remote HTTP servers. In that case, run an HTTP-to-stdio MCP bridge locally and point it at the same `/mcp` URL.

Give every agent its own SIRAYA API key. Model invocation, image/video generation, and forced registry refresh use that agent key from `Authorization: Bearer <SIRAYA_API_KEY>`. The Worker forwards the key to SIRAYA for that request and does not store it.

## Raw MCP Example

Initialize:

```bash
curl https://siraya-mcp.bruceatsiraya.xyz/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <AGENT_SIRAYA_API_KEY>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

List tools:

```bash
curl https://siraya-mcp.bruceatsiraya.xyz/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

Discover the taxonomy before selecting a model:

```bash
curl https://siraya-mcp.bruceatsiraya.xyz/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"siraya_list_capability_taxonomy","arguments":{}}}'
```

Filter for fast coding agents:

```json
{
  "name": "siraya_list_models",
  "arguments": {
    "capabilityTags": ["tool_calling", "reasoning"],
    "taskTags": ["coding", "agent"],
    "traits": ["fast"]
  }
}
```

Recommend a model:

```bash
curl https://siraya-mcp.bruceatsiraya.xyz/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 4,
    "method": "tools/call",
    "params": {
      "name": "siraya_recommend_model",
      "arguments": {
        "task": "agent",
        "require": {
          "toolCalling": true,
          "reasoning": true
        },
        "requireTags": ["tool_calling", "reasoning"],
        "requireTasks": ["agent"]
      }
    }
  }'
```

Call SIRAYA:

```bash
curl https://siraya-mcp.bruceatsiraya.xyz/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 4,
    "method": "tools/call",
    "params": {
      "name": "siraya_chat_completion",
      "arguments": {
        "request": {
          "model": "deepseek-v4-flash",
          "messages": [
            { "role": "user", "content": "Hello from SIRAYA MCP." }
          ]
        }
      }
    }
  }'
```

## Security Notes

- The Worker stores only a dedicated registry-sync `SIRAYA_API_KEY` as a Cloudflare secret.
- Each agent sends its own SIRAYA API key with its MCP connection; the Worker forwards it and does not store it.
- API keys are never returned by any endpoint.
- Public discovery endpoints expose model metadata only.
- Every agent should use a separate SIRAYA API key so usage, revocation, and limits remain isolated.

## Daily Update

Cloudflare Cron Trigger runs daily at `18:00 UTC`, which is `02:00 Asia/Singapore`.

The scheduled job:

1. Calls `GET https://llm.siraya.ai/v1/models`.
2. Builds the capability registry.
3. Checks fixed official public pricing pages where available and records source availability.
4. Stores the latest registry in Cloudflare KV under the current versioned registry key.

Public upstream pricing is shown only when the model ID can be matched conservatively to an official page. It is a reference, not the amount billed by SIRAYA Model Router; use SIRAYA billing for the actual charge.

Manual refresh:

```bash
curl -X POST https://siraya-mcp.bruceatsiraya.xyz/refresh \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```
