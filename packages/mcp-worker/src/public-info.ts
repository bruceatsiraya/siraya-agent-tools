import type { SirayaModelCapability, SirayaPricingQuote, SirayaPublicSource, SirayaRegistry } from "@siraya/agent";

type PricingPage = { url: string; text: string; checkedAt: string };

/**
 * Public pricing pages are deliberately treated as references, never as SIRAYA billing data.
 * Only sources with a stable, exact model match receive a numeric quote.
 */
export async function enrichPublicInfo(registry: SirayaRegistry): Promise<SirayaRegistry> {
  const pages = await fetchPricingPages(registry.models);
  const prices = new Map<string, SirayaPricingQuote>();

  const xai = pages.get("xai");
  if (xai) {
    addTokenQuote(prices, xai, "grok-4.3", ["grok-4.3"], "USD");
    addTokenQuote(prices, xai, "grok-4-20-reasoning", ["grok-4.20-0309-reasoning", "grok-4.20-reasoning"], "USD");
    addTokenQuote(prices, xai, "grok-4-20-non-reasoning", ["grok-4.20-0309-non-reasoning", "grok-4.20-non-reasoning"], "USD");
  }

  const publicSources = sourceStatus(registry.models, pages, prices);
  return {
    ...registry,
    publicSources,
    models: registry.models.map(model => {
      const price = prices.get(model.id.toLowerCase());
      return price ? { ...model, pricing: price } : model;
    })
  };
}

async function fetchPricingPages(models: SirayaModelCapability[]): Promise<Map<string, PricingPage>> {
  const providers = new Map<string, { url: string }>();
  for (const model of models) {
    if (model.provider && model.pricingUrl) providers.set(model.provider, { url: model.pricingUrl });
  }

  const responses = await Promise.all([...providers.entries()].map(async ([provider, source]) => {
    const checkedAt = new Date().toISOString();
    try {
      const response = await fetch(source.url, {
        headers: { accept: "text/html,application/xhtml+xml" },
        signal: AbortSignal.timeout(8_000)
      });
      if (!response.ok) return [provider, undefined] as const;
      const text = await response.text();
      return [provider, { url: source.url, text: normalizePageText(text), checkedAt }] as const;
    } catch {
      return [provider, undefined] as const;
    }
  }));

  return new Map(responses.filter((entry): entry is readonly [string, PricingPage] => Boolean(entry[1])));
}

function sourceStatus(
  models: SirayaModelCapability[],
  pages: Map<string, PricingPage>,
  quotes: Map<string, SirayaPricingQuote>
): SirayaPublicSource[] {
  const providers = new Map<string, SirayaModelCapability>();
  models.forEach(model => {
    if (model.provider && model.pricingUrl && !providers.has(model.provider)) providers.set(model.provider, model);
  });
  return [...providers.values()].map(model => {
    const page = pages.get(model.provider!);
    return {
      provider: model.provider!,
      providerName: model.providerName,
      url: model.pricingUrl!,
      status: page ? "verified" : "unavailable",
      checkedAt: page?.checkedAt ?? new Date().toISOString(),
      parsedQuotes: [...quotes.keys()].filter(id => registryProviderForModel(models, id) === model.provider).length,
      note: page
        ? "Official public pricing page checked during this registry refresh."
        : "Official pricing page could not be checked from this Worker run."
    };
  });
}

function registryProviderForModel(models: SirayaModelCapability[], modelId: string): string | undefined {
  return models.find(model => model.id.toLowerCase() === modelId)?.provider;
}

function addTokenQuote(
  quotes: Map<string, SirayaPricingQuote>,
  page: PricingPage,
  modelId: string,
  aliases: string[],
  currency: SirayaPricingQuote["currency"]
): void {
  const snippet = aliases.map(alias => extractSnippet(page.text, alias)).find(Boolean);
  if (!snippet) return;
  const values = [...snippet.matchAll(/\$\s*(\d+(?:\.\d+)?)/g)].map(match => Number(match[1]));
  if (values.length < 2) return;
  quotes.set(modelId, {
    source: "official_public",
    sourceUrl: page.url,
    observedAt: page.checkedAt,
    currency,
    unit: "per 1M tokens",
    input: values[0],
    cachedInput: values.length >= 3 ? values[1] : undefined,
    output: values.length >= 3 ? values[2] : values[1],
    note: "Official upstream list price. This is a reference only and is not SIRAYA billing."
  });
}

function extractSnippet(text: string, name: string): string | undefined {
  const index = text.toLowerCase().indexOf(name.toLowerCase());
  return index === -1 ? undefined : text.slice(index, index + 1_600);
}

function normalizePageText(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ");
}
