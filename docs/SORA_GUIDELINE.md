# Sora Guideline (Prompt Architect Input)

Use this guideline when generating production prompts for `sora-2`.

## Core
- Output format target: vertical 9:16 (`720x1280`) for TikTok.
- Prioritize one clear subject identity from first frame to end.
- Keep visual progression forward; avoid reset shots and loop-like repetition.
- Enforce a strong hook in the first 0–2 seconds.

## Startframe handling
- The provided start image is the canonical visual anchor for shot 1.
- Preserve subject identity, key objects, framing logic, and environment cues from the startframe.
- Subsequent shots may evolve, but continuity must remain believable.

## Shot writing
- Each shot must contain:
  1) explicit subject/object,
  2) visible action,
  3) concrete context/location,
  4) camera behavior.
- Avoid abstract placeholders like “central motif”, “show action”, “camera follows a step”.
- Keep one dominant action per shot.

## Brand consistency
- If brand text appears in-frame, use the exact configured brand name.
- Do not invent alternate brand/shop names.

## TikTok pacing
- Immediate hook, frequent but readable shot changes.
- No long static drift.
- Keep transitions coherent and momentum-driven.

## Safety / quality negatives
- No deformed anatomy, no distorted text, no logo hallucinations.
- No inconsistent species/identity morphing.
- No cluttered captions or unreadable overlays.
