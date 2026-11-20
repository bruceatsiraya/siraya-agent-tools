# Automatic model identity checks

The deployed MCP Worker checks every model while processing the upstream `/v1/models` response. This is part of the platform's existing synchronization flow, not a Codex chat automation or a local audit command.

The check runs during scheduled registry synchronization, an authorized `/refresh`, an MCP refresh, and the live model-list fetch used by the sales workbench. The checked registry and its summary are persisted to KV during registry synchronization. Cached entries are also checked when read.

## Resolution and pending state

- Recognized upstream family and operation rules provide the initial vendor and category. Routing prefixes such as `SIRAYA`, `Dola`, `FW`, `NSFW` and `uncensored` do not replace the upstream identity.
- Familiar vendor prefixes with unfamiliar text-model variants do not automatically imply an LLM. A new, ambiguous variant remains `category: "unknown"` until evidence or a manual review resolves it.
- Structured upstream category, output-modality, and recognized vendor metadata can resolve an unfamiliar model. A generic `owned_by: "openai"` value alone does not establish its vendor.
- Missing, unfamiliar, or conflicting information leaves the relevant field pending. Vendor and category have independent statuses, so a known Google vendor can coexist with an unknown category.
- Manual identity corrections saved through model administration survive later scans. Resolving identity does not verify unrelated capabilities or change the model-call interface.

Each model exposes `identityCheck` with the overall status, vendor/category statuses, evidence source, scan timestamp, and an explanation when pending. The registry exposes `identitySummary` with counts and its scan timestamp. The catalog includes a `Pending review only` filter, and administration links to `/models?manage=1&pending=1`.

Unknown categories appear as `Pending review` / `待確認` in the catalog, model list and newly generated quotes. They do not appear in the LLM category. Existing API formats, parameter lists and recommendation behavior are preserved.

## Verification

`packages/mcp-worker/model-scan.test.cjs` exercises the Worker's actual scheduled handler with a mocked upstream response. It verifies that newly discovered unfamiliar IDs are checked, saved to KV, and served by `/registry` as pending. It also covers conflicting metadata and manual-review persistence.

The deployment workflow runs this integration test together with the full identity and sales regression tests before production deployment.
