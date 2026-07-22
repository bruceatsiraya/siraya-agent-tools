import type { SirayaRegistry } from "@siraya/agent";

export function renderModelCatalog(registry: SirayaRegistry): Response {
  const registryJson = JSON.stringify(registry)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Model Catalog | SIRAYA</title>
  <meta name="description" content="Daily-refreshed catalog of models available through SIRAYA Model Router, grouped by vendor, category, and capability.">
  <style>${catalogStyles()}</style>
</head>
<body>
  <div class="shell">
    <aside class="sidebar">
      <a class="brand" href="/">
        <span class="mark">S</span>
        <span><strong>SIRAYA</strong><small>Agent Tools</small></span>
      </a>
      <nav aria-label="Documentation">
        <a href="/">Overview</a>
        <a class="active" href="/models">Models</a>
        <a href="/docs/sdk">SDK</a>
        <a href="/docs/mcp">MCP</a>
        <a href="/docs/registry">Registry</a>
        <a href="/docs/deploy">Deploy</a>
      </nav>
      <div class="status"><span class="dot"></span><span>Daily registry live</span></div>
    </aside>

    <main>
      <header class="page-header">
        <div>
          <p class="eyebrow">Model Router</p>
          <h1>Models</h1>
          <p class="lede">Explore every model available through SIRAYA, with normalized capabilities, tasks, modalities, and public upstream pricing.</p>
        </div>
        <div class="sync-panel">
          <span>Last synchronized</span>
          <strong id="sync-time">${escapeHtml(registry.generatedAt)}</strong>
          <div class="sync-actions">
            <a href="/models?format=json">View JSON</a>
            <button id="refresh-registry" type="button">Refresh registry</button>
          </div>
        </div>
      </header>

      <section class="stats" id="stats" aria-label="Catalog summary"></section>
      <section class="source-status" id="source-status" aria-label="Public pricing sources"></section>

      <div class="model-browser">
        <button class="filter-backdrop" id="filter-backdrop" type="button" aria-label="Close filters"></button>
        <aside class="filter-rail" id="filter-rail" aria-label="Model filters">
          <div class="filter-rail-heading">
            <strong>Filters</strong>
            <button class="filter-close" id="filter-close" type="button" aria-label="Close filters">x</button>
          </div>
          <div class="filter-section">
            <span class="control-label">Category</span>
            <div class="category-list" id="category-filter"></div>
          </div>
          <div class="filter-section">
            <span class="control-label">Provider</span>
            <div class="check-list" id="provider-filter"></div>
          </div>
          <div class="filter-section">
            <span class="control-label">Capabilities</span>
            <div class="check-list" id="capability-filter"></div>
          </div>
          <details class="filter-section filter-more" open>
            <summary>Best-fit tasks</summary>
            <div class="check-list" id="task-filter"></div>
          </details>
          <details class="filter-section filter-more">
            <summary>Model traits</summary>
            <div class="check-list" id="trait-filter"></div>
          </details>
          <button class="clear-all" id="clear-filters" type="button">Clear all filters</button>
        </aside>

        <section class="catalog-results">
          <div class="result-toolbar">
            <div class="search-wrap">
              <label class="sr-only" for="model-search">Search models</label>
              <input id="model-search" type="search" placeholder="Search models, providers, tasks..." autocomplete="off">
            </div>
            <button class="filter-toggle" id="filter-toggle" type="button" aria-controls="filter-rail" aria-expanded="false">Filters <span id="filter-count">0</span></button>
            <label class="sort-control" for="sort-models"><span>Sort</span><select id="sort-models"><option value="name">Name</option><option value="provider">Provider</option><option value="category">Category</option></select></label>
          </div>
          <div class="result-meta">
            <strong id="result-count"></strong>
            <div class="active-filters" id="active-filters"></div>
          </div>
          <div id="model-groups" aria-live="polite"></div>
        </section>
      </div>

      <section class="data-note">
        <strong>How to read this catalog</strong>
        <p>Availability comes from SIRAYA's live <code>/v1/models</code> endpoint. Vendor, category, and capabilities are conservatively inferred from model IDs and public vendor documentation until SIRAYA exposes authoritative per-model capability metadata. Custom SIRAYA aliases may differ from the upstream vendor model. Upstream pricing is only a public reference; SIRAYA billing is authoritative for charges through this router.</p>
      </section>
    </main>
  </div>

  <dialog id="refresh-dialog" aria-labelledby="refresh-title">
    <form id="refresh-form" method="dialog">
      <div class="dialog-heading">
        <div>
          <p class="eyebrow">Administration</p>
          <h2 id="refresh-title">Refresh model registry</h2>
        </div>
        <button id="close-refresh" class="icon-button" type="button" aria-label="Close refresh dialog">x</button>
      </div>
      <p>Fetch the current SIRAYA model list and re-check public pricing sources.</p>
      <label for="admin-token">Admin token</label>
      <input id="admin-token" type="password" autocomplete="off" required>
      <p class="refresh-feedback" id="refresh-feedback" role="status"></p>
      <div class="dialog-actions">
        <button id="cancel-refresh" type="button">Cancel</button>
        <button id="confirm-refresh" class="primary-action" type="submit">Refresh now</button>
      </div>
    </form>
  </dialog>

  <script id="registry-data" type="application/json">${registryJson}</script>
  <script>${catalogScript()}</script>
</body>
</html>`, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300"
    }
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function catalogScript(): string {
  return `
    const registry = JSON.parse(document.getElementById("registry-data").textContent);
    const models = registry.models;
    const categoryOrder = ["text", "image", "video", "audio", "embedding", "rerank"];
    const categoryLabels = { text: "Text", image: "Image", video: "Video", audio: "Audio", embedding: "Embedding", rerank: "Rerank" };
    const featureLabels = {
      streaming: "Streaming",
      tool_calling: "Tool use",
      structured_output: "Structured output",
      reasoning: "Reasoning",
      prompt_caching: "Prompt caching",
      image_input: "Vision",
      pdf_input: "PDF",
      image_generation: "Image generation",
      video_generation: "Video generation",
      speech_recognition: "Speech recognition",
      text_output: "Text output",
      embeddings: "Embeddings",
      reranking: "Reranking"
    };
    const taskLabels = {
      chat: "Chat", agent: "Agent", coding: "Coding", reasoning: "Reasoning",
      structured_output: "Data extraction", vision: "Vision", document_analysis: "Document analysis",
      image_generation: "Image generation", video_generation: "Video generation", speech_to_text: "Speech to text",
      semantic_search: "Semantic search", retrieval_ranking: "Retrieval ranking"
    };
    const traitLabels = {
      fast: "Fast", economy: "Economy", premium: "Premium", small: "Small", multimodal: "Multimodal",
      specialized: "Specialized", preview: "Preview", dated_snapshot: "Dated snapshot",
      content_policy_relaxed: "Relaxed content policy"
    };
    const state = {
      query: "", category: "all", providers: new Set(), capabilities: new Set(),
      tasks: new Set(), traits: new Set(), sort: "name"
    };

    const search = document.getElementById("model-search");
    const categories = document.getElementById("category-filter");
    const providerFilter = document.getElementById("provider-filter");
    const capabilityFilter = document.getElementById("capability-filter");
    const taskFilter = document.getElementById("task-filter");
    const traitFilter = document.getElementById("trait-filter");
    const groups = document.getElementById("model-groups");
    const resultCount = document.getElementById("result-count");
    const activeFilters = document.getElementById("active-filters");
    const filterRail = document.getElementById("filter-rail");
    const filterToggle = document.getElementById("filter-toggle");
    const refreshDialog = document.getElementById("refresh-dialog");
    const refreshForm = document.getElementById("refresh-form");
    const adminToken = document.getElementById("admin-token");
    const refreshFeedback = document.getElementById("refresh-feedback");

    document.getElementById("sync-time").textContent = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium", timeStyle: "short"
    }).format(new Date(registry.generatedAt));

    const providers = [...new Map(models.map(model => [model.provider, model.providerName || model.provider])).entries()]
      .sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    [{ value: "all", label: "All models" }, ...categoryOrder.map(value => ({ value, label: categoryLabels[value] }))]
      .forEach(({ value, label }) => {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.category = value;
        button.append(el("span", "", label), el("span", "filter-option-count", String(value === "all" ? models.length : models.filter(model => model.category === value).length)));
        button.className = value === "all" ? "active" : "";
        button.setAttribute("aria-pressed", String(value === "all"));
        categories.append(button);
      });

    providers.forEach(([value, label]) => appendFilterOption(providerFilter, "providers", value, String(label), models.filter(model => model.provider === value).length));
    appendTaxonomyOptions(capabilityFilter, "capabilities", "capabilityTags", featureLabels);
    appendTaxonomyOptions(taskFilter, "tasks", "taskTags", taskLabels);
    appendTaxonomyOptions(traitFilter, "traits", "traits", traitLabels);

    search.addEventListener("input", () => { state.query = search.value.trim().toLowerCase(); render(); });
    categories.addEventListener("click", event => {
      const button = event.target.closest("button[data-category]");
      if (!button) return;
      state.category = button.dataset.category;
      categories.querySelectorAll("button").forEach(candidate => {
        const active = candidate === button;
        candidate.classList.toggle("active", active);
        candidate.setAttribute("aria-pressed", String(active));
      });
      render();
    });
    [providerFilter, capabilityFilter, taskFilter, traitFilter].forEach(container => container.addEventListener("change", event => {
      const input = event.target.closest("input[data-state-key]");
      if (!input) return;
      const values = state[input.dataset.stateKey];
      if (input.checked) values.add(input.value);
      else values.delete(input.value);
      render();
    }));
    document.getElementById("sort-models").addEventListener("change", event => { state.sort = event.target.value; render(); });
    document.getElementById("clear-filters").addEventListener("click", () => {
      state.query = "";
      state.category = "all";
      state.providers.clear();
      state.capabilities.clear();
      state.tasks.clear();
      state.traits.clear();
      search.value = "";
      document.querySelectorAll(".filter-rail input[type=checkbox]").forEach(input => { input.checked = false; });
      categories.querySelectorAll("button").forEach(button => {
        const active = button.dataset.category === "all";
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      render();
    });
    activeFilters.addEventListener("click", event => {
      const button = event.target.closest("button[data-filter-kind]");
      if (!button) return;
      if (button.dataset.filterKind === "category") state.category = "all";
      else state[button.dataset.filterKind].delete(button.dataset.filterValue);
      syncFilterControls();
      render();
    });
    filterToggle.addEventListener("click", () => setFilterRail(true));
    document.getElementById("filter-close").addEventListener("click", () => setFilterRail(false));
    document.getElementById("filter-backdrop").addEventListener("click", () => setFilterRail(false));
    document.getElementById("refresh-registry").addEventListener("click", () => {
      refreshFeedback.textContent = "";
      refreshDialog.showModal();
      adminToken.focus();
    });
    document.getElementById("close-refresh").addEventListener("click", () => refreshDialog.close());
    document.getElementById("cancel-refresh").addEventListener("click", () => refreshDialog.close());
    refreshForm.addEventListener("submit", async event => {
      event.preventDefault();
      const token = adminToken.value;
      if (!token) return;
      const confirm = document.getElementById("confirm-refresh");
      confirm.disabled = true;
      refreshFeedback.textContent = "Refreshing model and public pricing data...";
      try {
        const response = await fetch("/refresh", {
          method: "POST",
          headers: { authorization: "Bearer " + token }
        });
        if (!response.ok) throw new Error(response.status === 401 ? "The admin token was not accepted." : "Refresh failed. Please try again.");
        adminToken.value = "";
        window.location.reload();
      } catch (error) {
        refreshFeedback.textContent = error instanceof Error ? error.message : "Refresh failed. Please try again.";
      } finally {
        confirm.disabled = false;
      }
    });

    function appendTaxonomyOptions(container, stateKey, modelKey, labels) {
      const counts = new Map();
      models.forEach(model => (model[modelKey] || []).forEach(value => counts.set(value, (counts.get(value) || 0) + 1)));
      [...counts.entries()]
        .filter(([value]) => labels[value])
        .sort((a, b) => b[1] - a[1] || labels[a[0]].localeCompare(labels[b[0]]))
        .forEach(([value, count]) => appendFilterOption(container, stateKey, value, labels[value], count));
    }

    function appendFilterOption(container, stateKey, value, label, count) {
      const row = el("label", "check-option");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = value;
      input.dataset.stateKey = stateKey;
      row.append(input, el("span", "filter-option-name", label), el("span", "filter-option-count", String(count)));
      container.append(row);
    }

    function setFilterRail(open) {
      filterRail.classList.toggle("open", open);
      document.body.classList.toggle("filters-open", open);
      filterToggle.setAttribute("aria-expanded", String(open));
    }

    function syncFilterControls() {
      categories.querySelectorAll("button").forEach(button => {
        const active = button.dataset.category === state.category;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      document.querySelectorAll("input[data-state-key]").forEach(input => {
        input.checked = state[input.dataset.stateKey].has(input.value);
      });
    }

    function renderStats() {
      const counts = Object.fromEntries(categoryOrder.map(category => [category, models.filter(model => model.category === category).length]));
      const entries = [
        [models.length, "Models"],
        [providers.length, "Vendors"],
        [counts.text || 0, "Text"],
        [(counts.image || 0) + (counts.video || 0), "Image & video"],
        [counts.audio || 0, "Audio"]
      ];
      const stats = document.getElementById("stats");
      stats.replaceChildren(...entries.map(([value, label]) => {
        const item = el("div", "stat");
        item.append(el("strong", "", String(value)), el("span", "", label));
        return item;
      }));
    }

    function renderSourceStatus() {
      const sources = registry.publicSources || [];
      if (!sources.length) return;
      const verified = sources.filter(source => source.status === "verified");
      const quotes = sources.reduce((total, source) => total + source.parsedQuotes, 0);
      const section = document.getElementById("source-status");
      section.replaceChildren(
        el("strong", "", verified.length + " of " + sources.length + " official pricing sources checked"),
        el("span", "", quotes ? quotes + " exact upstream model prices matched" : "Pricing links are available where exact model prices cannot be matched automatically.")
      );
    }

    function matches(model) {
      const capabilityText = (model.capabilityTags || []).map(key => featureLabels[key] || key).join(" ");
      const taskText = (model.taskTags || []).map(key => taskLabels[key] || key).join(" ");
      const traitText = (model.traits || []).map(key => traitLabels[key] || key).join(" ");
      const haystack = [model.id, model.providerName, model.provider, model.family, model.category, ...model.modalities, capabilityText, taskText, traitText].join(" ").toLowerCase();
      return (!state.query || haystack.includes(state.query))
        && (!state.providers.size || state.providers.has(model.provider))
        && (state.category === "all" || model.category === state.category)
        && [...state.capabilities].every(value => (model.capabilityTags || []).includes(value))
        && [...state.tasks].every(value => (model.taskTags || []).includes(value))
        && [...state.traits].every(value => (model.traits || []).includes(value));
    }

    function render() {
      const filtered = models.filter(matches).sort((a, b) => {
        if (state.sort === "provider") return (a.providerName || a.provider).localeCompare(b.providerName || b.provider) || a.id.localeCompare(b.id);
        if (state.sort === "category") return categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category) || a.id.localeCompare(b.id);
        return a.id.localeCompare(b.id);
      });
      resultCount.textContent = filtered.length + (filtered.length === 1 ? " model" : " models");
      renderActiveFilters();
      groups.replaceChildren();

      if (!filtered.length) {
        const empty = el("div", "empty");
        empty.append(el("strong", "", "No matching models"), el("p", "", "Try removing a capability filter or searching a broader model family."));
        groups.append(empty);
        return;
      }

      categoryOrder.forEach(category => {
        const categoryModels = filtered.filter(model => model.category === category);
        if (!categoryModels.length) return;
        const section = el("section", "model-section");
        const heading = el("div", "section-heading");
        heading.append(el("h2", "", categoryLabels[category]), el("span", "count", String(categoryModels.length)));
        section.append(heading);
        const list = el("div", "model-list");
        categoryModels.forEach(model => list.append(renderModel(model)));
        section.append(list);
        groups.append(section);
      });
    }

    function renderActiveFilters() {
      activeFilters.replaceChildren();
      const entries = [];
      if (state.category !== "all") entries.push(["category", state.category, categoryLabels[state.category]]);
      state.providers.forEach(value => entries.push(["providers", value, providers.find(entry => entry[0] === value)?.[1] || value]));
      state.capabilities.forEach(value => entries.push(["capabilities", value, featureLabels[value] || value]));
      state.tasks.forEach(value => entries.push(["tasks", value, taskLabels[value] || value]));
      state.traits.forEach(value => entries.push(["traits", value, traitLabels[value] || value]));
      entries.forEach(([kind, value, label]) => {
        const button = el("button", "active-filter", label + " x");
        button.type = "button";
        button.dataset.filterKind = kind;
        button.dataset.filterValue = value;
        button.setAttribute("aria-label", "Remove " + label + " filter");
        activeFilters.append(button);
      });
      const count = entries.length;
      document.getElementById("filter-count").textContent = String(count);
      filterToggle.classList.toggle("has-filters", count > 0);
    }

    function renderModel(model) {
      const details = el("details", "model-row");
      const summary = document.createElement("summary");
      const identity = el("div", "model-identity");
      identity.append(providerMark(model), el("code", "model-id", model.id));
      summary.append(identity, el("span", "vendor", model.providerName || model.provider), categoryBadge(model.category), featureChips(model, 4));
      details.append(summary);

      const body = el("div", "model-detail");
      const facts = el("dl", "facts");
      addFact(facts, "Family", model.family);
      addFact(facts, "Input", (model.inputModalities || []).join(", ") || "Not declared");
      addFact(facts, "Output", (model.outputModalities || []).join(", ") || "Not declared");
      addFact(facts, "API formats", model.apiFormats.join(", "));
      addFact(facts, "Lifecycle", model.lifecycle || "unknown");
      addFact(facts, "Quality tier", model.qualityTier || "unknown");
      addFact(facts, "Speed tier", model.speedTier || "unknown");
      addFact(facts, "Metadata", model.capabilitySource || "inferred");
      body.append(facts);

      const capabilityBlock = el("div", "detail-block");
      capabilityBlock.append(el("strong", "detail-label", "Capabilities"), featureChips(model));
      body.append(capabilityBlock);

      const taskBlock = el("div", "detail-block");
      taskBlock.append(el("strong", "detail-label", "Best-fit tasks"), taxonomyChips(model.taskTags || [], taskLabels));
      body.append(taskBlock);

      const traitBlock = el("div", "detail-block");
      traitBlock.append(el("strong", "detail-label", "Model traits"), taxonomyChips(model.traits || [], traitLabels));
      body.append(traitBlock);

      const parameterBlock = el("div", "detail-block");
      parameterBlock.append(el("strong", "detail-label", "Known parameters"), el("p", "parameter-list", model.supportedParameters.join(", ")));
      body.append(parameterBlock);

      const pricingBlock = renderPricing(model);
      if (pricingBlock) body.append(pricingBlock);

      if (model.notes && model.notes.length) {
        const note = el("p", "model-note", model.notes.join(" "));
        body.append(note);
      }
      if (model.documentationUrl) {
        const link = el("a", "docs-link", "Official vendor documentation");
        link.href = model.documentationUrl;
        link.target = "_blank";
        link.rel = "noreferrer";
        body.append(link);
      }
      details.append(body);
      return details;
    }

    function renderPricing(model) {
      if (!model.pricing && !model.pricingUrl) return null;
      const block = el("div", "detail-block pricing-block");
      block.append(el("strong", "detail-label", "Official upstream pricing"));
      if (model.pricing) {
        const lines = [];
        if (model.pricing.input !== undefined) lines.push("Input " + formatPrice(model.pricing.input, model.pricing));
        if (model.pricing.cachedInput !== undefined) lines.push("Cached input " + formatPrice(model.pricing.cachedInput, model.pricing));
        if (model.pricing.output !== undefined) lines.push("Output " + formatPrice(model.pricing.output, model.pricing));
        block.append(el("p", "price-list", lines.join(" | ")));
        block.append(el("p", "pricing-note", "Reference only. SIRAYA router billing may differ."));
        const source = el("a", "docs-link", "Official pricing source");
        source.href = model.pricing.sourceUrl;
        source.target = "_blank";
        source.rel = "noreferrer";
        block.append(source);
      } else {
        block.append(el("p", "pricing-note", "An official pricing page is available, but an exact price was not automatically matched for this model."));
        const source = el("a", "docs-link", "Open official pricing page");
        source.href = model.pricingUrl;
        source.target = "_blank";
        source.rel = "noreferrer";
        block.append(source);
      }
      return block;
    }

    function formatPrice(value, pricing) {
      return pricing.currency + " $" + value + " " + pricing.unit;
    }

    function providerMark(model) {
      const mark = el("span", "provider-mark provider-" + model.provider, (model.providerName || model.provider || "?").slice(0, 1).toUpperCase());
      mark.setAttribute("aria-hidden", "true");
      return mark;
    }

    function categoryBadge(category) {
      return el("span", "category category-" + category, categoryLabels[category] || category);
    }

    function featureChips(model, limit = Infinity) {
      const wrap = el("span", "chips");
      const enabled = (model.capabilityTags || [])
        .filter(key => featureLabels[key])
        .map(key => featureLabels[key]);
      enabled.slice(0, limit).forEach(label => wrap.append(el("span", "chip", label)));
      if (enabled.length > limit) wrap.append(el("span", "chip more", "+" + (enabled.length - limit)));
      if (!enabled.length) wrap.append(el("span", "chip muted", "Specialized endpoint"));
      return wrap;
    }

    function taxonomyChips(values, labels) {
      const wrap = el("span", "chips");
      values.forEach(value => wrap.append(el("span", "chip", labels[value] || value)));
      if (!values.length) wrap.append(el("span", "chip muted", "No inferred labels"));
      return wrap;
    }

    function addFact(list, term, value) {
      list.append(el("dt", "", term), el("dd", "", value));
    }

    function el(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    renderStats();
    renderSourceStatus();
    render();
  `;
}

function catalogStyles(): string {
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
      --blue: #315f9c;
      --green: #347853;
    }
    * { box-sizing: border-box; }
    body { margin: 0; color: var(--ink); background: #f8faf9; font: 15px/1.55 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: 0; }
    a { color: inherit; }
    button, input, select { font: inherit; letter-spacing: 0; }
    .shell { display: grid; grid-template-columns: 260px minmax(0, 1fr); min-height: 100vh; }
    .sidebar { position: sticky; top: 0; height: 100vh; padding: 28px 20px; border-right: 1px solid var(--line); background: rgba(255,255,255,.94); }
    .brand { display: grid; grid-template-columns: 42px 1fr; gap: 12px; align-items: center; text-decoration: none; margin-bottom: 30px; }
    .mark { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 8px; color: #fff; background: linear-gradient(135deg, var(--teal), var(--coral)); font-weight: 800; }
    .brand strong, .brand small { display: block; }
    .brand small { color: var(--muted); }
    nav { display: grid; gap: 6px; }
    nav a { padding: 9px 10px; border-radius: 7px; color: var(--muted); text-decoration: none; }
    nav a.active, nav a:hover { color: var(--ink); background: #edf4f1; }
    .status { position: absolute; left: 20px; right: 20px; bottom: 24px; display: flex; gap: 8px; align-items: center; color: var(--muted); font-size: 13px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #25a56a; }
    main { width: min(1320px, 100%); padding: 46px 44px 80px; }
    .page-header { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 28px; align-items: end; padding-bottom: 26px; border-bottom: 1px solid var(--line); }
    .eyebrow { margin: 0 0 8px; color: var(--coral); font-size: 13px; font-weight: 750; text-transform: uppercase; }
    h1 { margin: 0 0 10px; font-size: 42px; line-height: 1.1; letter-spacing: 0; }
    .lede { max-width: 760px; margin: 0; color: var(--muted); font-size: 17px; }
    .sync-panel { display: grid; justify-items: end; gap: 3px; color: var(--muted); font-size: 13px; }
    .sync-panel strong { color: var(--ink); }
    .sync-actions { display: flex; gap: 12px; align-items: center; }
    .sync-panel a, .sync-panel button { color: var(--teal); font-weight: 700; }
    .sync-panel button { padding: 0; border: 0; background: transparent; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
    .stats { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); margin: 26px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
    .stat { padding: 17px 18px; border-right: 1px solid var(--line); }
    .stat:last-child { border-right: 0; }
    .stat strong, .stat span { display: block; }
    .stat strong { font-size: 25px; line-height: 1.2; }
    .stat span { color: var(--muted); font-size: 13px; }
    .source-status { display: flex; gap: 9px; align-items: baseline; margin: -10px 0 24px; color: var(--muted); font-size: 13px; }
    .source-status strong { color: var(--ink); }
    .catalog-controls { display: grid; grid-template-columns: minmax(250px, 1.3fr) minmax(180px, .7fr); gap: 18px 22px; padding: 20px 0 24px; border-bottom: 1px solid var(--line); }
    label, .control-label, legend { color: var(--muted); font-size: 12px; font-weight: 750; text-transform: uppercase; }
    .search-wrap, .select-wrap { display: grid; gap: 6px; }
    input[type="search"], select { width: 100%; height: 42px; padding: 0 12px; border: 1px solid #bdc9c3; border-radius: 7px; background: #fff; color: var(--ink); }
    input:focus, select:focus, button:focus-visible, summary:focus-visible { outline: 3px solid rgba(15,118,110,.22); outline-offset: 2px; }
    .category-wrap { display: grid; gap: 7px; align-content: start; }
    .segments { display: flex; flex-wrap: wrap; gap: 5px; }
    .segments button { min-height: 36px; padding: 6px 11px; border: 1px solid var(--line); border-radius: 6px; background: #fff; color: var(--muted); cursor: pointer; }
    .segments button.active { border-color: var(--teal); background: var(--teal); color: #fff; }
    .feature-filter { display: flex; flex-wrap: wrap; gap: 12px 18px; align-items: center; min-width: 0; margin: 0; padding: 0; border: 0; }
    .feature-filter legend { margin-bottom: 7px; }
    .feature-filter label { display: inline-flex; gap: 6px; align-items: center; color: var(--ink); font-size: 13px; text-transform: none; }
    .feature-filter input { width: 16px; height: 16px; accent-color: var(--teal); }
    .result-bar { display: flex; justify-content: space-between; align-items: center; min-height: 54px; }
    .result-bar button { border: 0; background: transparent; color: var(--teal); cursor: pointer; font-weight: 700; }
    .model-section { margin: 0 0 30px; }
    .section-heading { display: flex; gap: 9px; align-items: center; margin-bottom: 9px; }
    h2 { margin: 0; font-size: 20px; letter-spacing: 0; }
    .count { display: inline-grid; place-items: center; min-width: 26px; height: 22px; padding: 0 7px; border-radius: 11px; background: #e8efec; color: var(--muted); font-size: 12px; }
    .model-list { border-top: 1px solid var(--line); }
    .model-row { border-bottom: 1px solid var(--line); background: #fff; }
    .model-row summary { display: grid; grid-template-columns: minmax(260px, 1.4fr) minmax(130px, .55fr) 100px minmax(260px, 1fr); gap: 14px; align-items: center; min-height: 64px; padding: 10px 14px; cursor: pointer; list-style: none; }
    .model-row summary::-webkit-details-marker { display: none; }
    .model-row summary:hover { background: #f4f8f6; }
    .model-row[open] summary { background: #eef5f2; }
    .model-identity { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .model-id { overflow-wrap: anywhere; color: var(--ink); font-size: 13px; font-weight: 750; }
    .provider-mark { flex: 0 0 auto; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 6px; background: #dce9e5; color: var(--teal); font-size: 12px; font-weight: 850; }
    .provider-openai, .provider-anthropic { background: #e7e7e4; color: #313633; }
    .provider-google { background: #e4ecfa; color: var(--blue); }
    .provider-deepseek, .provider-xai { background: #e5e8f2; color: #38496f; }
    .provider-alibaba, .provider-bytedance { background: #f7e9e5; color: var(--coral); }
    .provider-siraya { background: #e2efe9; color: var(--green); }
    .vendor { color: var(--muted); font-size: 13px; }
    .category { justify-self: start; padding: 3px 8px; border-radius: 5px; font-size: 12px; font-weight: 750; }
    .category-text { background: #e6f0ed; color: var(--teal); }
    .category-image { background: #f8e7e2; color: var(--coral); }
    .category-video { background: #eee8f5; color: #74518d; }
    .category-audio { background: #e4edf7; color: var(--blue); }
    .category-embedding, .category-rerank { background: #f4eddc; color: var(--gold); }
    .chips { display: flex; flex-wrap: wrap; gap: 5px; min-width: 0; }
    .chip { padding: 3px 7px; border: 1px solid #d4ded9; border-radius: 5px; background: #fafcfb; color: #4d5a55; font-size: 11px; white-space: nowrap; }
    .chip.more { color: var(--teal); }
    .chip.muted { color: var(--muted); }
    .model-detail { display: grid; grid-template-columns: minmax(260px, .8fr) minmax(260px, 1.2fr); gap: 18px 28px; padding: 20px 54px 24px; background: #fbfcfb; border-top: 1px solid var(--line); }
    .facts { display: grid; grid-template-columns: 100px 1fr; gap: 7px 12px; margin: 0; }
    dt { color: var(--muted); }
    dd { margin: 0; overflow-wrap: anywhere; }
    .detail-block { display: grid; align-content: start; gap: 8px; }
    .detail-label { font-size: 13px; }
    .parameter-list, .model-note, .price-list, .pricing-note { grid-column: 1 / -1; margin: 0; color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
    .model-note { padding-left: 10px; border-left: 3px solid #d8bd83; }
    .docs-link { justify-self: start; color: var(--teal); font-weight: 750; }
    .empty { padding: 42px 20px; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); text-align: center; }
    .empty p { margin: 5px 0 0; color: var(--muted); }
    .data-note { margin-top: 46px; padding-top: 20px; border-top: 1px solid var(--line); }
    .data-note p { max-width: 900px; margin: 6px 0 0; color: var(--muted); }
    dialog { width: min(460px, calc(100% - 32px)); padding: 0; border: 1px solid var(--line); border-radius: 8px; color: var(--ink); box-shadow: 0 20px 60px rgba(21, 38, 31, .2); }
    dialog::backdrop { background: rgba(23, 33, 29, .38); }
    dialog form { display: grid; gap: 14px; padding: 24px; }
    .dialog-heading { display: flex; align-items: start; justify-content: space-between; gap: 16px; }
    .dialog-heading h2 { margin-top: -2px; }
    dialog p { margin: 0; color: var(--muted); }
    dialog label { display: grid; gap: 6px; }
    dialog input { height: 42px; padding: 0 12px; border: 1px solid #bdc9c3; border-radius: 7px; }
    .icon-button { display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--muted); cursor: pointer; }
    .icon-button:hover { background: var(--wash); color: var(--ink); }
    .refresh-feedback { min-height: 22px; font-size: 13px; }
    .dialog-actions { display: flex; justify-content: end; gap: 10px; margin-top: 4px; }
    .dialog-actions button { min-height: 38px; padding: 0 13px; border: 1px solid var(--line); border-radius: 6px; background: #fff; color: var(--ink); cursor: pointer; font-weight: 700; }
    .dialog-actions .primary-action { border-color: var(--teal); background: var(--teal); color: #fff; }
    .dialog-actions button:disabled { cursor: wait; opacity: .7; }
    code { font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; }
    @media (max-width: 980px) {
      .shell { display: block; }
      .sidebar { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--line); }
      .sidebar nav { display: flex; flex-wrap: wrap; }
      .status { position: static; margin-top: 18px; }
      .model-row summary { grid-template-columns: minmax(220px, 1fr) 130px 90px; }
      .model-row summary > .chips { grid-column: 1 / -1; }
    }
    @media (max-width: 680px) {
      main { padding: 30px 16px 56px; }
      .page-header { grid-template-columns: 1fr; align-items: start; }
      .sync-panel { justify-items: start; }
      .source-status { display: grid; gap: 2px; }
      h1 { font-size: 34px; }
      .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .stat { border-bottom: 1px solid var(--line); }
      .catalog-controls { grid-template-columns: 1fr; }
      .model-row summary { grid-template-columns: minmax(0, 1fr) auto; gap: 8px 10px; padding: 12px 8px; }
      .model-row summary .vendor { grid-column: 1; padding-left: 40px; }
      .model-row summary .category { grid-column: 2; grid-row: 1; }
      .model-row summary > .chips { grid-column: 1 / -1; padding-left: 40px; }
      .model-detail { grid-template-columns: 1fr; padding: 18px 12px 22px; }
      .provider-mark { width: 30px; }
    }

    /* Model browser */
    .shell { grid-template-columns: 220px minmax(0, 1fr); }
    .sidebar { padding: 24px 18px; }
    main { width: 100%; max-width: 1540px; padding: 30px 36px 72px; }
    .page-header { align-items: center; padding-bottom: 20px; }
    h1 { margin-bottom: 5px; font-size: 32px; }
    .lede { max-width: 820px; font-size: 15px; }
    .stats { display: flex; gap: 0; margin: 16px 0 0; border: 0; }
    .stat { display: flex; gap: 6px; align-items: baseline; padding: 0 18px; border-right: 1px solid var(--line); }
    .stat:first-child { padding-left: 0; }
    .stat strong { font-size: 17px; }
    .stat span { font-size: 12px; }
    .source-status { margin: 8px 0 20px; }
    .model-browser { position: relative; display: grid; grid-template-columns: 248px minmax(0, 1fr); min-height: 620px; border-top: 1px solid var(--line); }
    .filter-rail { position: sticky; top: 0; align-self: start; max-height: 100vh; overflow-y: auto; padding: 18px 20px 28px 0; border-right: 1px solid var(--line); background: #f8faf9; }
    .filter-rail-heading { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; font-size: 15px; }
    .filter-close, .filter-backdrop { display: none; }
    .filter-section { display: grid; gap: 7px; margin: 0; padding: 15px 0; border: 0; border-top: 1px solid var(--line); }
    .filter-section:first-of-type { border-top: 0; }
    .category-list, .check-list { display: grid; gap: 2px; }
    .category-list button, .check-option { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; min-height: 32px; padding: 5px 8px; border: 0; border-radius: 5px; background: transparent; color: #46524d; text-align: left; cursor: pointer; }
    .category-list button:hover, .check-option:hover { background: #edf2ef; color: var(--ink); }
    .category-list button.active { background: #e1eeea; color: #096b64; font-weight: 750; }
    .check-option { grid-template-columns: 16px minmax(0, 1fr) auto; gap: 8px; font-size: 13px; font-weight: 500; text-transform: none; }
    .check-option input { width: 15px; height: 15px; margin: 0; accent-color: var(--teal); }
    .filter-option-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .filter-option-count { color: #85908b; font-size: 11px; font-weight: 500; }
    .filter-more summary { color: var(--muted); font-size: 12px; font-weight: 750; text-transform: uppercase; cursor: pointer; }
    .filter-more[open] summary { margin-bottom: 5px; }
    .clear-all { width: 100%; min-height: 34px; border: 1px solid var(--line); border-radius: 6px; background: #fff; color: var(--teal); cursor: pointer; font-weight: 700; }
    .catalog-results { min-width: 0; padding-left: 24px; }
    .result-toolbar { position: sticky; top: 0; z-index: 3; display: grid; grid-template-columns: minmax(240px, 1fr) auto; gap: 12px; align-items: center; padding: 14px 0; border-bottom: 1px solid var(--line); background: rgba(248,250,249,.96); backdrop-filter: blur(8px); }
    .search-wrap { position: relative; }
    .search-wrap::before { content: ""; position: absolute; left: 13px; top: 13px; width: 12px; height: 12px; border: 1.5px solid #71807a; border-radius: 50%; }
    .search-wrap::after { content: ""; position: absolute; left: 24px; top: 25px; width: 6px; height: 1.5px; background: #71807a; transform: rotate(45deg); }
    input[type="search"] { height: 40px; padding: 0 12px 0 38px; background: #fff; }
    .sort-control { display: flex; gap: 8px; align-items: center; text-transform: none; }
    .sort-control select { width: 118px; height: 38px; }
    .filter-toggle { display: none; }
    .result-meta { display: flex; gap: 12px; align-items: center; min-height: 48px; }
    .active-filters { display: flex; flex-wrap: wrap; gap: 5px; }
    .active-filter { padding: 3px 8px; border: 1px solid #bcd2ca; border-radius: 5px; background: #edf5f2; color: #27665a; cursor: pointer; font-size: 11px; }
    .model-section { margin-bottom: 22px; }
    .section-heading { position: sticky; top: 69px; z-index: 2; min-height: 38px; margin: 0; padding: 7px 10px; border-bottom: 1px solid var(--line); background: #f8faf9; }
    .section-heading h2 { font-size: 14px; }
    .model-list { border-top: 0; }
    .model-row summary { position: relative; grid-template-columns: minmax(220px, 1.25fr) minmax(110px, .55fr) 90px minmax(240px, 1fr); min-height: 56px; padding: 8px 32px 8px 10px; }
    .model-row summary::after { content: "+"; position: absolute; right: 10px; top: 50%; color: #78847f; font-size: 18px; transform: translateY(-50%); }
    .model-row[open] summary::after { content: "-"; }
    .model-row summary > .chips { margin-right: -22px; }
    .model-detail { grid-template-columns: minmax(240px, .8fr) minmax(260px, 1.2fr); padding: 18px 46px 22px; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }

    @media (max-width: 1100px) {
      .model-row summary { grid-template-columns: minmax(220px, 1fr) 120px 90px; }
      .model-row summary > .chips { grid-column: 1 / -1; margin: 0; padding-left: 40px; }
    }
    @media (max-width: 820px) {
      .shell { display: block; }
      .sidebar { position: static; height: auto; padding: 14px 18px; border-right: 0; border-bottom: 1px solid var(--line); }
      .brand { margin-bottom: 12px; }
      .sidebar nav { display: flex; flex-wrap: nowrap; gap: 3px; overflow-x: auto; }
      .sidebar nav a { flex: 0 0 auto; padding: 7px 9px; }
      .status { display: none; }
      main { padding: 24px 18px 56px; }
      .model-browser { display: block; }
      .filter-rail { position: fixed; z-index: 20; top: 0; bottom: 0; left: 0; width: min(330px, calc(100% - 44px)); max-height: none; padding: 20px; border-right: 1px solid var(--line); background: #fff; box-shadow: 12px 0 36px rgba(23,33,29,.2); transform: translateX(-105%); transition: transform .18s ease; }
      .filter-rail.open { transform: translateX(0); }
      .filter-close { display: grid; place-items: center; width: 30px; height: 30px; border: 0; background: transparent; cursor: pointer; }
      .filter-backdrop { position: fixed; z-index: 19; inset: 0; width: 100%; height: 100%; border: 0; background: rgba(23,33,29,.32); }
      .filters-open { overflow: hidden; }
      .filters-open .filter-backdrop { display: block; }
      .catalog-results { padding-left: 0; }
      .result-toolbar { grid-template-columns: minmax(0, 1fr) auto auto; }
      .filter-toggle { display: inline-flex; gap: 7px; align-items: center; height: 38px; padding: 0 11px; border: 1px solid var(--line); border-radius: 6px; background: #fff; color: var(--ink); cursor: pointer; font-weight: 700; }
      .filter-toggle span { display: grid; place-items: center; min-width: 18px; height: 18px; border-radius: 9px; background: #e7eeeb; font-size: 10px; }
      .filter-toggle.has-filters span { background: var(--teal); color: #fff; }
    }
    @media (max-width: 620px) {
      main { padding: 20px 14px 48px; }
      .page-header { grid-template-columns: 1fr; gap: 12px; align-items: start; }
      .sync-panel { justify-items: start; }
      .stats { flex-wrap: wrap; gap: 4px 0; }
      .stat { padding: 0 10px; }
      .stat:nth-child(n+4) { display: none; }
      .source-status { display: grid; gap: 1px; }
      .result-toolbar { grid-template-columns: minmax(0, 1fr) auto; }
      .sort-control { display: none; }
      .section-heading { top: 69px; }
      .model-row summary { grid-template-columns: minmax(0, 1fr) auto; gap: 5px 8px; padding: 10px 6px; }
      .model-row summary .vendor { grid-column: 1; padding-left: 40px; }
      .model-row summary .category { grid-column: 2; grid-row: 1; margin-right: 22px; }
      .model-row summary > .chips { grid-column: 1 / -1; padding-left: 40px; }
      .model-detail { grid-template-columns: 1fr; padding: 16px 10px 20px; }
    }
  `;
}
