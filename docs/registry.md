# SIRAYA Model Capability Registry

The registry is the shared layer used by both the SDK and MCP server.

SIRAYA already exposes a live model list:

```text
GET https://llm.siraya.ai/v1/models
```

That response tells us which model IDs are available, but most agent frameworks need more than model IDs. They need to know which model supports tools, reasoning, structured output, image input, PDF input, image generation, video generation, embeddings, reranking, and which request format to use.

## Registry Shape

```json
{
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
        "promptCaching": "explicit",
        "webSearch": false,
        "imageInput": true,
        "pdfInput": true,
        "imageGeneration": false,
        "videoGeneration": false,
        "embeddings": false,
        "reranking": false
      },
      "supportedParameters": ["model", "messages", "tools", "tool_choice"],
      "notes": [],
      "raw": {}
    }
  ]
}
```

## Current Inference Rules

The first version builds capability metadata from:

- `/v1/models` live output.
- `owned_by` provider.
- model ID family patterns such as `gpt`, `claude`, `gemini`, `deepseek`, `imagen`, `veo`, `seedance`, `embedding`, and `rerank`.
- SIRAYA parameter support documentation.

This is enough for agent onboarding, but not perfect. The long-term product version should expose first-class capability metadata directly from SIRAYA's model catalog or a dedicated endpoint.

## Recommended Future Endpoint

Add one of these to the SIRAYA public API:

```text
GET /v1/model-capabilities
GET /v1/models?include_capabilities=true
```

Recommended fields:

- `id`
- `owned_by`
- `provider_routes`
- `api_formats`
- `modalities`
- `features`
- `supported_parameters`
- `context_window`
- `max_output_tokens`
- `pricing`
- `zdr_supported`
- `routing_notes`
- `updated_at`

Once available, the SDK and MCP server can stop inferring and simply cache the authoritative capability response.
