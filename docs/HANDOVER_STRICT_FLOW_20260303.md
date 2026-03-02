# Handover – Strict Flow State (2026-03-03 00:36 CET)

## Repo state
- Branch: `main`
- Commit: `d0a7156`

## What was implemented
- Strict prompt flow with `gpt-5-mini` for prompt generation/update.
- Strict startframe image generation path using `gpt-image-1.5`.
- Multipart Sora call uses exact LLM prompt in `prompt` field (`model=sora-2`, `seconds`, `size`, `input_reference`).
- Prompt artifacts persisted in storage.
- 30s segment-chain infrastructure (12+12+8) with reference continuity.
- Startframe thumbnail reuse fix via context signature (from Codex patch).

## Key commits (newest first)
- `d0a7156` fix(strict-flow): stabilize website context and normalize video input references
- `4786dd7` fix(startframe): context-sign cache key and strict asset timeline events
- `087cbfc` fix(strict): force gpt-image-1.5 and derive draft script from strict sora prompt
- `d941a2f` feat(strict-flow): use gpt-5-mini prompts for image+sora and persist prompt source
- `b0f47f8` feat(sora): send exact step1 gpt-5-mini prompt as multipart prompt field
- `bc53332` feat(prompt): add strict gpt-5-mini step1 flow with website context and image input

## What to do next
1. Run one real localhost flow.
2. Validate artifacts for the run:
   - `startframe-prompt-step1.txt`
   - `sora-prompt-step1.txt`
   - `sora-request-step1.txt`
3. If mismatch persists, patch directly from that job’s artifacts/timeline.

## External memory pointers
- `~/.openclaw/workspace/memory/progress.md`
- `~/.openclaw/workspace/memory/handover-2026-03-03-0036.md`
