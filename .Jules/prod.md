# AI Providers And Deployment Posture

This document records the current provider shape and the next safe expansion path.

## Current State

- Production deployment is push-driven from the current branch. The GitHub Actions deploy job uses `github.ref_name`, and the VPS fetches and resets to that same branch.
- CI owns validation: TypeScript lint, tests, production dependency audit, Compose config, and Docker image build smoke. The app image build runs the Vite production build once.
- The production Dockerfile owns image assembly. It intentionally does not rerun lint/tests during image build; that keeps VPS deploys faster while CI remains the gate.
- The app currently has one external signal integration: a custom TSFM-compatible HTTPS endpoint configured from Application settings.
- There is no active Opencode Go or Gemini provider adapter in this repo yet.

For a single private VPS, building on the VPS remains the right default: it avoids registry credentials, registry cache invalidation, and image promotion complexity. Move to GHCR only when VPS build time becomes a measured deployment bottleneck.

## External Signal Reliability Contract

External signal requests are best-effort candidate generation, not trading authority. The app should always close a model run as either `succeeded` or `failed`.

Failure policy:

- `401` and `403` are configuration/access failures. Do not retry them inside the request.
- `429`, `408`, `425`, and `5xx` are retryable transient classes.
- Long `Retry-After` values should not block the UI request. Record a retryable failed run and let the operator retry later.
- Invalid JSON or schema-invalid signal output is not retryable without changing the provider.
- A failed provider request must update `model_runs.status = 'failed'`, set `completed_at`, and store structured error metrics.

## Opencode Go Fit

Opencode Go is useful here only as a provider adapter for structured reasoning around market context, not as a direct substitute for deterministic backtests or paper-trading evaluation.

If we add it, use a dedicated provider layer rather than overloading `TSFM_ENDPOINT_URL`:

- Store `opencode_go_api_key`, provider enablement, and selected model in Application settings.
- Keep model output schema-normalized into the existing `SignalResponse` contract.
- Use strict JSON output validation and mark every result as a candidate signal.
- Treat 403 as access/model entitlement failure, not transient capacity.
- Treat 429 and provider capacity errors as cooldown/retryable failures.

Current Opencode Go endpoint split:

- OpenAI-compatible chat models use `https://opencode.ai/zen/go/v1/chat/completions`.
- MiniMax M2.5/M2.7 use `https://opencode.ai/zen/go/v1/messages`.
- The documented model ids use the `opencode-go/<model-id>` format in OpenCode config.

That endpoint split matters. A provider adapter should select transport by model family instead of assuming one universal OpenAI-compatible request shape.

## Gemini Embedding 2 Fit

`gemini-embedding-2` is now a stable Gemini API embedding model. It is useful as a retrieval layer, not a forecasting model.

Good first uses in this project:

- Find historical signal explanations similar to the current market setup.
- Cluster duplicate external-provider rationales.
- Search operator notes, backtest summaries, and model-run explanations.
- Retrieve comparable past windows as context before asking a generative model for a candidate explanation.

Implementation path:

1. Add Application settings for Gemini embeddings:
   - enable/disable embeddings
   - AI Studio API key
   - embedding model, default `gemini-embedding-2`
   - output dimensionality, default `768`
2. Use the current `@google/genai` SDK from the Node app.
3. Add a small embedding table with `source_type`, `source_id`, `content_hash`, `model`, `dimensions`, `embedding`, and timestamps.
4. Store vectors in Postgres first and compute cosine similarity in Node for the expected small private dataset.
5. Move to `pgvector` only if retrieval volume grows enough to justify a custom Postgres image and extension management.

Important constraints:

- Do not compare `gemini-embedding-001` vectors with `gemini-embedding-2` vectors. Re-embed existing data when changing model families.
- `gemini-embedding-2` does not use the old `task_type` parameter. Put retrieval instructions in the text prompt for text-only use cases.
- Use Batch API for offline backfills where latency is not important.
- Keep the AI Studio API key in the authenticated settings UI, not in normal `.env.production` edits after bootstrap.

## References

- Gemini embeddings guide: https://ai.google.dev/gemini-api/docs/embeddings
- Gemini embeddings API reference: https://ai.google.dev/api/embeddings
- Opencode Go docs: https://opencode.ai/docs/go/
