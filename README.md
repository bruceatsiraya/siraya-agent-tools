# SIRAYA Agent Tools

This workspace contains two product surfaces for SIRAYA Model Router:

- `@siraya/agent`: a TypeScript Agent SDK for model discovery, request validation, model recommendation, direct model calls, and simple tool-calling loops.
- `siraya-mcp-worker`: a Cloudflare Worker MCP server that exposes SIRAYA model discovery and invocation tools to MCP-capable agents.

The MCP worker is configured for `siraya-mcp.bruceatsiraya.xyz` and refreshes its model registry every day with a Cloudflare Cron Trigger.

Published documentation:

- https://siraya-mcp.bruceatsiraya.xyz/
- https://siraya-mcp.bruceatsiraya.xyz/docs/sdk
- https://siraya-mcp.bruceatsiraya.xyz/docs/mcp
- https://siraya-mcp.bruceatsiraya.xyz/docs/registry
- https://siraya-mcp.bruceatsiraya.xyz/docs/deploy

## Quick Start

```bash
pnpm install
pnpm build
```

Read:

- [SDK guide](./docs/sdk.md)
- [MCP guide](./docs/mcp.md)
- [Cloudflare deployment](./docs/cloudflare-deploy.md)
- [Registry design](./docs/registry.md)
