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
| `siraya_list_models` | List models and inferred capabilities from the cached registry. |
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
GET  /models
POST /refresh
POST /mcp
```

`/refresh` requires `Authorization: Bearer <ADMIN_TOKEN>` when `ADMIN_TOKEN` is configured.

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

Recommend a model:

```bash
curl https://siraya-mcp.bruceatsiraya.xyz/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "siraya_recommend_model",
      "arguments": {
        "task": "agent",
        "require": {
          "toolCalling": true,
          "reasoning": true
        }
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
3. Stores the latest registry in Cloudflare KV under `registry:latest`.

Manual refresh:

```bash
curl -X POST https://siraya-mcp.bruceatsiraya.xyz/refresh \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```
