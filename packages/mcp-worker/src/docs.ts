type DocsRoute = "/" | "/docs" | "/docs/sdk" | "/docs/mcp" | "/docs/registry" | "/docs/deploy";

interface Page {
  title: string;
  eyebrow: string;
  description: string;
  body: string;
}

const pages: Record<DocsRoute, Page> = {
  "/": {
    title: "SIRAYA Agent Tools",
    eyebrow: "Developer documentation",
    description: "SDK and MCP integration layer for SIRAYA Model Router.",
    body: `
      <section class="hero-grid">
        <div>
          <p class="lede">Give agents one stable interface for discovering SIRAYA models, checking capabilities, choosing the right route, and calling the model router without hand-defining every model.</p>
          <div class="actions">
            <a class="button primary" href="/models">Browse Models</a>
            <a class="button" href="/docs/sdk">Read SDK Docs</a>
            <a class="button" href="/docs/mcp">Connect MCP</a>
          </div>
        </div>
        <div class="system-map" aria-label="SIRAYA Agent Tools architecture">
          <div class="node agent">Agent</div>
          <div class="rail"></div>
          <div class="node sdk">SDK</div>
          <div class="node mcp">MCP</div>
          <div class="rail"></div>
          <div class="node router">SIRAYA Model Router</div>
        </div>
      </section>
      <section class="tiles">
        ${tile("Live Model Catalog", "Browse the daily-refreshed model list by vendor, category, modality, and capability.", "/models")}
        ${tile("TypeScript SDK", "Use @siraya/agent for model discovery, request validation, model recommendation, and tool-calling loops.", "/docs/sdk")}
        ${tile("Remote MCP Server", "Expose SIRAYA model discovery and calls to MCP-capable agents through Cloudflare Workers.", "/docs/mcp")}
        ${tile("Capability Registry", "Daily model registry generated from /v1/models plus documented SIRAYA parameter support rules.", "/docs/registry")}
        ${tile("Cloudflare Deployment", "Custom domain, KV registry storage, cron refresh, and required secrets.", "/docs/deploy")}
      </section>
      <section>
        <h2>Production URLs</h2>
        <div class="endpoint-list">
          <code>https://siraya-mcp.bruceatsiraya.xyz</code>
          <code>https://siraya-mcp.bruceatsiraya.xyz/mcp</code>
          <code>https://siraya-mcp.bruceatsiraya.xyz/registry</code>
        </div>
      </section>
    `
  },
  "/docs": {
    title: "Documentation",
    eyebrow: "Overview",
    description: "Choose the integration surface you need.",
    body: `
      <section class="tiles">
        ${tile("SDK", "Build agentic applications directly in TypeScript.", "/docs/sdk")}
        ${tile("MCP", "Let external agents query and call SIRAYA through tools.", "/docs/mcp")}
        ${tile("Registry", "Understand how capabilities are inferred and refreshed.", "/docs/registry")}
        ${tile("Deploy", "Operate the Worker on Cloudflare.", "/docs/deploy")}
      </section>
    `
  },
  "/docs/sdk": {
    title: "SIRAYA Agent SDK",
    eyebrow: "@siraya/agent",
    description: "TypeScript SDK for model discovery, model recommendation, request validation, direct calls, and simple agent loops.",
    body: `
      ${section("Install", `
        <pre><code>pnpm add @siraya/agent</code></pre>
        <p>Until the package is published, use the workspace package directly.</p>
        <pre><code>pnpm install
pnpm --filter @siraya/agent build</code></pre>
      `)}
      ${section("Configure", `
        <pre><code>SIRAYA_API_KEY=sk-...
SIRAYA_BASE_URL=https://llm.siraya.ai/v1</code></pre>
        <pre><code>import { Siraya } from "@siraya/agent";

const siraya = new Siraya({
  apiKey: process.env.SIRAYA_API_KEY,
  baseUrl: "https://llm.siraya.ai/v1",
  registryUrl: "https://siraya-mcp.bruceatsiraya.xyz/registry"
});</code></pre>
        <p>Keep <code>SIRAYA_API_KEY</code> in the agent's server-side secret manager. The hosted registry is refreshed daily and keeps production deployments on the same current model catalog.</p>
      `)}
      ${section("Discover Models", `
        <pre><code>const models = await siraya.listModels();
console.log(models.map((model) => model.id));</code></pre>
      `)}
      ${section("Recommend a Model", `
        <pre><code>const model = await siraya.recommendModel({
  task: "agent",
  require: {
    toolCalling: true,
    reasoning: true
  },
  apiFormat: "openai_chat"
});

console.log(model.id);</code></pre>
      `)}
      ${section("Validate a Request", `
        <pre><code>const issues = await siraya.validateRequest("gpt-5.4-pro", {
  model: "gpt-5.4-pro",
  messages: [{ role: "user", content: "Return JSON." }],
  response_format: { type: "json_object" },
  temperature: 0.2
});</code></pre>
        <p>The validator warns when parameters may be silently dropped by a model family.</p>
      `)}
      ${section("Agent Loop with Tools", `
        <pre><code>import { Siraya, tool, stepCountIs } from "@siraya/agent";

const siraya = new Siraya({ apiKey: process.env.SIRAYA_API_KEY });

const getWeather = tool({
  name: "get_weather",
  description: "Get current weather for a city.",
  inputSchema: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
    additionalProperties: false
  },
  execute: async ({ city }) => ({ city, condition: "sunny" })
});

const result = await siraya.callModel({
  model: "auto",
  task: "agent",
  messages: [{ role: "user", content: "Weather in Singapore?" }],
  tools: [getWeather],
  provider: { require_parameters: true },
  stopWhen: [stepCountIs(5)]
});

console.log(result.getText());</code></pre>
      `)}
    `
  },
  "/docs/mcp": {
    title: "SIRAYA MCP Server",
    eyebrow: "Remote MCP",
    description: "Cloudflare-hosted MCP endpoint for agents that need SIRAYA model discovery and invocation tools.",
    body: `
      ${section("Endpoint", `
        <pre><code>https://siraya-mcp.bruceatsiraya.xyz/mcp</code></pre>
      `)}
      ${section("Tools", `
        <table>
          <thead><tr><th>Tool</th><th>Purpose</th></tr></thead>
          <tbody>
            ${toolRow("siraya_list_models", "List models and inferred capabilities from the cached registry.")}
            ${toolRow("siraya_get_model_capabilities", "Return capability details for one model.")}
            ${toolRow("siraya_recommend_model", "Recommend a model for a task and required features.")}
            ${toolRow("siraya_validate_request", "Warn when request parameters may be dropped or ignored.")}
            ${toolRow("siraya_chat_completion", "Call /v1/chat/completions.")}
            ${toolRow("siraya_responses", "Call /v1/responses.")}
            ${toolRow("siraya_generate_image", "Call /v1/images/generations.")}
            ${toolRow("siraya_generate_video", "Call /v1/videos/generations.")}
          </tbody>
        </table>
      `)}
      ${section("Client Configuration", `
        <pre><code>{
  "mcpServers": {
    "siraya": {
      "url": "https://siraya-mcp.bruceatsiraya.xyz/mcp",
      "headers": {
        "Authorization": "Bearer \${SIRAYA_API_KEY}"
      }
    }
  }
}</code></pre>
        <p>Give every agent its own SIRAYA API key. The Worker forwards that key for model calls and never stores it. Discovery remains available from the shared daily registry.</p>
      `)}
      ${section("Raw MCP Checks", `
        <pre><code>curl https://siraya-mcp.bruceatsiraya.xyz/mcp \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'</code></pre>
      `)}
      ${section("REST Debug Endpoints", `
        <div class="endpoint-list">
          <code>GET /health</code>
          <code>GET /registry</code>
          <code>GET /models</code>
          <code>GET /api/models</code>
          <code>POST /refresh</code>
          <code>POST /mcp</code>
        </div>
      `)}
    `
  },
  "/docs/registry": {
    title: "Model Capability Registry",
    eyebrow: "Daily model metadata",
    description: "Shared capability layer used by both the SDK and MCP server.",
    body: `
      ${section("Purpose", `
        <p>SIRAYA already exposes live model IDs through <code>GET https://llm.siraya.ai/v1/models</code>. Agents need more context: modalities, tool support, reasoning support, request formats, and parameter behavior.</p>
      `)}
      ${section("Registry Shape", `
        <pre><code>{
  "object": "siraya.model_registry",
  "generatedAt": "2026-07-15T00:00:00.000Z",
  "source": "https://llm.siraya.ai/v1/models",
  "models": [
    {
      "id": "claude-sonnet-4.6",
      "provider": "anthropic",
      "family": "claude",
      "apiFormats": ["openai_chat", "openai_responses", "anthropic_messages"],
      "modalities": ["text", "image_input", "pdf_input"],
      "features": {
        "streaming": true,
        "toolCalling": true,
        "structuredOutputs": true,
        "reasoning": true,
        "promptCaching": "explicit"
      }
    }
  ]
}</code></pre>
      `)}
      ${section("Current Inference Rules", `
        <ul>
          <li>Live <code>/v1/models</code> output.</li>
          <li><code>owned_by</code> provider values.</li>
          <li>Model ID family patterns such as GPT, Claude, Gemini, DeepSeek, Imagen, Veo, Seedance, embedding, and rerank.</li>
          <li>SIRAYA parameter support documentation.</li>
        </ul>
      `)}
      ${section("Recommended Product Endpoint", `
        <pre><code>GET /v1/model-capabilities
GET /v1/models?include_capabilities=true</code></pre>
        <p>Once this exists, the SDK and MCP server can cache authoritative metadata instead of inferring it.</p>
      `)}
    `
  },
  "/docs/deploy": {
    title: "Cloudflare Deployment",
    eyebrow: "Operations",
    description: "How the MCP server is deployed and refreshed on Cloudflare.",
    body: `
      ${section("Current Deployment", `
        <table>
          <tbody>
            <tr><th>Worker</th><td><code>siraya-mcp-worker</code></td></tr>
            <tr><th>Custom domain</th><td><code>https://siraya-mcp.bruceatsiraya.xyz</code></td></tr>
            <tr><th>Cron</th><td><code>0 18 * * *</code> UTC, daily 02:00 Asia/Singapore</td></tr>
            <tr><th>KV namespace</th><td><code>7f90e1d5c1fd4ba0857271f12b5caa46</code></td></tr>
          </tbody>
        </table>
      `)}
      ${section("Required Secrets", `
        <pre><code>npx.cmd wrangler@latest secret put SIRAYA_API_KEY --config packages/mcp-worker/wrangler.toml
npx.cmd wrangler@latest secret put ADMIN_TOKEN --config packages/mcp-worker/wrangler.toml</code></pre>
        <p>The Worker <code>SIRAYA_API_KEY</code> is a dedicated registry-sync key. <code>ADMIN_TOKEN</code> protects manual refresh. Each agent supplies its own SIRAYA API key for model calls.</p>
      `)}
      ${section("Deploy", `
        <pre><code>npx.cmd wrangler@latest deploy --config packages/mcp-worker/wrangler.toml</code></pre>
      `)}
      ${section("Verify", `
        <pre><code>Invoke-RestMethod -Uri https://siraya-mcp.bruceatsiraya.xyz/health
Invoke-RestMethod -Uri https://siraya-mcp.bruceatsiraya.xyz/mcp -Method Post -ContentType "application/json" -Body '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'</code></pre>
      `)}
    `
  }
};

export function renderDocs(pathname: string): Response | undefined {
  const route = normalizeRoute(pathname);
  if (!route) return undefined;
  const page = pages[route];
  return html(layout(page, route));
}

function normalizeRoute(pathname: string): DocsRoute | undefined {
  const clean = pathname.endsWith("/") && pathname !== "/" ? pathname.slice(0, -1) : pathname;
  if (clean in pages) return clean as DocsRoute;
  return undefined;
}

function layout(page: Page, route: DocsRoute): string {
  const navItems: Array<[string, string]> = [
    ["/", "Overview"],
    ["/models", "Models"],
    ["/docs/sdk", "SDK"],
    ["/docs/mcp", "MCP"],
    ["/docs/registry", "Registry"],
    ["/docs/deploy", "Deploy"]
  ];
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${page.title} | SIRAYA</title>
  <meta name="description" content="${page.description}">
  <style>${styles()}</style>
</head>
<body>
  <div class="shell">
    <aside class="sidebar">
      <a class="brand" href="/">
        <span class="mark">S</span>
        <span><strong>SIRAYA</strong><small>Agent Tools</small></span>
      </a>
      <nav>
        ${navItems.map(([href, label]) => `<a class="${href === route ? "active" : ""}" href="${href}">${label}</a>`).join("")}
      </nav>
      <div class="status">
        <span class="dot"></span>
        <span>Cloudflare Worker live</span>
      </div>
    </aside>
    <main>
      <header class="page-header">
        <p class="eyebrow">${page.eyebrow}</p>
        <h1>${page.title}</h1>
        <p>${page.description}</p>
      </header>
      ${page.body}
    </main>
  </div>
</body>
</html>`;
}

function section(title: string, body: string): string {
  return `<section><h2>${title}</h2>${body}</section>`;
}

function tile(title: string, description: string, href: string): string {
  return `<a class="tile" href="${href}"><strong>${title}</strong><span>${description}</span></a>`;
}

function toolRow(name: string, purpose: string): string {
  return `<tr><td><code>${name}</code></td><td>${purpose}</td></tr>`;
}

function html(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300"
    }
  });
}

function styles(): string {
  return `
    :root {
      color-scheme: light;
      --ink: #17211d;
      --muted: #63706b;
      --line: #d8e0dc;
      --panel: #ffffff;
      --wash: #f5f8f6;
      --teal: #0f766e;
      --coral: #c7503c;
      --gold: #9a6b1f;
      --code: #101816;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      background: linear-gradient(180deg, #fbfcfb 0%, var(--wash) 100%);
      font: 15px/1.6 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }
    a { color: inherit; }
    .shell {
      display: grid;
      grid-template-columns: 280px minmax(0, 1fr);
      min-height: 100vh;
    }
    .sidebar {
      position: sticky;
      top: 0;
      height: 100vh;
      padding: 28px 20px;
      border-right: 1px solid var(--line);
      background: rgba(255, 255, 255, .88);
    }
    .brand {
      display: grid;
      grid-template-columns: 42px 1fr;
      gap: 12px;
      align-items: center;
      text-decoration: none;
      margin-bottom: 30px;
    }
    .mark {
      display: grid;
      place-items: center;
      width: 42px;
      height: 42px;
      border-radius: 8px;
      color: #fff;
      background: linear-gradient(135deg, var(--teal), var(--coral));
      font-weight: 800;
    }
    .brand strong, .brand small { display: block; }
    .brand small { color: var(--muted); }
    nav { display: grid; gap: 6px; }
    nav a {
      padding: 9px 10px;
      border-radius: 7px;
      color: var(--muted);
      text-decoration: none;
    }
    nav a.active, nav a:hover {
      color: var(--ink);
      background: #edf4f1;
    }
    .status {
      position: absolute;
      left: 20px;
      right: 20px;
      bottom: 24px;
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--muted);
      font-size: 13px;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #25a56a;
    }
    main {
      width: min(1040px, 100%);
      padding: 54px 48px 80px;
    }
    .page-header {
      padding-bottom: 28px;
      border-bottom: 1px solid var(--line);
      margin-bottom: 34px;
    }
    .eyebrow {
      color: var(--coral);
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      margin: 0 0 8px;
    }
    h1 {
      font-size: 44px;
      line-height: 1.1;
      margin: 0 0 12px;
      letter-spacing: 0;
    }
    h2 {
      font-size: 22px;
      margin: 0 0 14px;
      letter-spacing: 0;
    }
    p { color: var(--muted); margin: 0 0 14px; }
    section { margin: 0 0 34px; }
    .lede {
      font-size: 18px;
      max-width: 680px;
    }
    .hero-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.2fr) minmax(280px, .8fr);
      gap: 30px;
      align-items: center;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 22px;
    }
    .button {
      display: inline-flex;
      align-items: center;
      min-height: 38px;
      padding: 8px 13px;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: var(--panel);
      text-decoration: none;
      font-weight: 700;
    }
    .button.primary {
      border-color: var(--teal);
      background: var(--teal);
      color: #fff;
    }
    .system-map {
      display: grid;
      grid-template-columns: 1fr 20px 1fr;
      grid-template-rows: auto auto auto;
      gap: 12px;
      align-items: center;
      padding: 18px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
    }
    .node {
      padding: 13px;
      border-radius: 8px;
      border: 1px solid var(--line);
      background: #fbfdfc;
      text-align: center;
      font-weight: 800;
    }
    .agent { grid-column: 1 / 4; border-color: #94c7bf; }
    .sdk { grid-column: 1; }
    .mcp { grid-column: 3; }
    .router { grid-column: 1 / 4; border-color: #e0a99d; }
    .rail {
      grid-column: 2;
      width: 2px;
      height: 22px;
      background: var(--gold);
      justify-self: center;
    }
    .tiles {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }
    .tile {
      min-height: 132px;
      padding: 18px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      text-decoration: none;
    }
    .tile strong { display: block; margin-bottom: 8px; font-size: 17px; }
    .tile span { color: var(--muted); }
    .tile:hover { border-color: #94c7bf; }
    .endpoint-list {
      display: grid;
      gap: 8px;
    }
    code, pre {
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    }
    code {
      color: var(--code);
      background: #eef3f1;
      border-radius: 5px;
      padding: 2px 5px;
      word-break: break-word;
    }
    pre {
      overflow-x: auto;
      padding: 15px;
      border-radius: 8px;
      background: #101816;
      color: #e8f3ef;
    }
    pre code {
      padding: 0;
      color: inherit;
      background: transparent;
      word-break: normal;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
      background: var(--panel);
    }
    th, td {
      padding: 11px 12px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
    }
    th { width: 210px; background: #f1f6f3; }
    tr:last-child th, tr:last-child td { border-bottom: 0; }
    li { margin: 7px 0; }
    @media (max-width: 820px) {
      .shell { display: block; }
      .sidebar {
        position: static;
        height: auto;
        border-right: 0;
        border-bottom: 1px solid var(--line);
      }
      .status { position: static; margin-top: 22px; }
      main { padding: 34px 20px 60px; }
      h1 { font-size: 34px; }
      .hero-grid, .tiles { grid-template-columns: 1fr; }
    }
  `;
}
