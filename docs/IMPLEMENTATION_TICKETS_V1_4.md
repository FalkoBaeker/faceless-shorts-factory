# Faceless Shorts Factory – Implementation Tickets v1.4 (UX + Creative Control + Reliability)

Stand: 2026-02-28 01:52 CET  
Status: **Planned / not implemented yet** (explicitly waiting for execution go-ahead)

## Context
This planning pass captures:
1) Falko’s 18 UX/product feedback points (verbatim intent),
2) additional reliability findings from recent overnight debugging,
3) a strict ordering proposal (P0→P3) to avoid regressions.

Critical requirement agreed with Falko:
- Even when user-edited storyboard input is weak/flat, system-side prompt safeguards must still produce high-energy output (hook, pace, visual movement),
- except when script/intent clearly demands a calm style.

---

## Mapping from Falko feedback (1–18)

1. Mood/Grundstimmung erweitern + Mehrfachauswahl + Script-Einfluss  
2. Zusätzlich zum Sprachskript: sichtbares „Was passiert“, Dialoge möglich, ggf. Sora-Audio  
3. Hintergrundmusik  
4. Wie finaler Videoprompt erstellt wird + verständliche Vorschau  
5. Prompt/Shot-Styles „aufpimpen“ (cinematic, OTS, etc.)  
6. Frage Prompt-Modell/Kostenoptimierung  
7. Startframe-UX säubern, Modell/Prompt-Transparenz, bessere Bildqualität, Upload-vs-generated Priorität klar  
8. Human-first-frame Policy-Risiken abfangen  
9. User-Steuerparameter raus  
10. Onboarding (Firmenlogo/Branding)  
11. Klarheit welches Bild tatsächlich verwendet wird  
12. Login-UX (Enter key) + Google Sign-In  
13. Wer trägt Kosten bei Video-Fail  
14. Bessere Pending-Animation/Status-UX  
15. Echter Download klar sichtbar  
16. Looping/zu repetitive Video-Ausgabe  
17. Caption-Qualität/Format/Rechtschreibung/Dialogs  
18. Hook muss in erster Sekunde knallen

---

## P0 – Reliability + baseline UX (first)

### T15 – Queue runtime hardening on boot
**Why:** Recent failures showed stale active jobs after process restarts.  
**Scope:**
- Guarantee queue runtime init at API boot.
- Keep stale-active recovery deterministic + visible in timeline.
- Add runbook incident note for stale lock recovery.
**DoD:** No silent stuck jobs after restart; stale jobs resolve to clear terminal state.
**Feedback refs:** reliability incidents (post-feedback)

### T16 – Pending UX simplification
**Scope:**
- Replace noisy technical runtime statuses with one primary progress state.
- Add visible loading animation + ETA range fallback.
- Keep technical details behind expandable diagnostics section.
**DoD:** User never feels frozen during `VIDEO_PENDING`.
**Feedback refs:** #14

### T17 – Download CTA clarity
**Scope:**
- One obvious `Download MP4` action in READY state.
- Confirm success/error with visible feedback.
**DoD:** Download discoverable in one glance.
**Feedback refs:** #15

### T18 – Login UX baseline fix
**Scope:**
- Enter key submits login form.
- Better loading/disabled/error states.
**DoD:** Login works naturally from keyboard.
**Feedback refs:** #12

### T19 – Billing transparency on failure
**Scope:**
- Explain reservation/commit/release lifecycle in UI and/or job details.
- Show that failed jobs release reserved credit.
**DoD:** User can verify “who pays on fail” without guessing.
**Feedback refs:** #13

---

## P1 – Creative control + prompt quality engine

### T20 – Replace mood picker with Creative Intent matrix (multi-select)
**Scope:**
- Replace current mood-only single-select with two dimensions:
  - Effect goal (sell, funny, cringe, testimonial, etc.)
  - Narrative format (before/after, dialog, offer, commercial, etc.)
- Support multi-select with priority weighting.
- Make selections influence script drafting + video prompt compilation.
**DoD:** Intent selections materially alter script and generated plan.
**Feedback refs:** #1

### T21 – Script↔Intent consistency validator v2
**Scope:**
- Expand hard checks so script cannot contradict selected intent profile.
- Add hook quality gates for opening beat.
**DoD:** “Intent says high-energy” cannot pass with flat opener unless explicitly calm profile.
**Feedback refs:** #1, #18

### T22 – Storyboard Light (editable, user-facing)
**Scope:**
- Show compact user-readable scene plan (not raw API prompt).
- Allow editing beats/actions/dialog hints.
- Feed edits into final prompt compiler.
**DoD:** User edits “what happens” and sees corresponding output impact.
**Feedback refs:** #2, #4

### T23 – Prompt Compiler v2 with background safeguard
**Scope:**
- Keep template builder, but add system-level enhancer pass:
  - Hook enhancer
  - Motion/variation enhancer
  - Shot diversity enhancer
- Respect calm-mode exception when script/intent says calm.
**DoD:** Default output remains punchy even with mediocre user text.
**Feedback refs:** explicit safeguard request, #5, #18

### T24 – Prompt Explainability Panel (structured, not raw)
**Scope:**
- Display high-level rationale:
  - Active intent rules
  - Hook rule selected
  - Shot style set
  - Safety constraints
- No raw production prompt string shown by default.
**DoD:** User understands why generation behaves as it does.
**Feedback refs:** #4 clarification

### T25 – Shot style library (curated)
**Scope:**
- Add controlled style tags: cinematic close-up, over-shoulder, handheld, product macro, etc.
- Integrate into compiler weighting.
**DoD:** Better visual variety without chaotic free-text prompts.
**Feedback refs:** #5

### T26 – Remove technical “User Controls” chips
**Scope:**
- Remove CTA/motion/pace/style chip cluster from UI.
- Fold control into intent + storyboard edits.
**DoD:** Less technical UI, more natural creative control.
**Feedback refs:** #9

---

## P2 – Audio/music/captions/policy quality

### T27 – Audio strategy modes (VO / Scene Audio / Hybrid)
**Scope:**
- Introduce selectable audio mode:
  1) Voiceover-only (stable default)
  2) Scene/dialog audio (experimental)
  3) Hybrid (VO + scene + ducking)
- Define compatibility matrix per provider.
**DoD:** Audio path explicit and testable per mode.
**Feedback refs:** #2, #3

### T28 – Dialog-capable script schema
**Scope:**
- Extend script structure for speakers/lines/scene actions.
- Ensure compatibility with caption pipeline.
**DoD:** Dialog generation is first-class, not a hack.
**Feedback refs:** #2

### T29 – Caption engine v2
**Scope:**
- Standardize caption styling and timing.
- Add grammar/spell cleanup pass.
- Improve dialog caption support.
**DoD:** Consistent TikTok-like caption quality.
**Feedback refs:** #17

### T30 – Hook engine (first-second impact)
**Scope:**
- Build reusable hook templates tied to intent profiles.
- Force opening-beat quality threshold unless calm profile.
**DoD:** “First second must hit” rule enforced.
**Feedback refs:** #18

### T31 – Startframe precedence + clarity
**Scope:**
- UI must show exactly which startframe is active.
- Explicit precedence logic displayed:
  - Upload active => upload wins
  - else selected generated candidate.
**DoD:** No ambiguity before Generate click.
**Feedback refs:** #7, #11

### T32 – Human-first-frame policy preflight
**Scope:**
- Add preflight checks and fallback behavior for policy-risk references.
- Surface user-friendly reason + remediation path.
**DoD:** Fewer avoidable generation failures from risky first-frame inputs.
**Feedback refs:** #8

### T33 – Image model transparency + upgrade path
**Scope:**
- Show model used for startframe generation in diagnostics.
- Compare quality/cost before hard default switch.
- Keep model configurable with fallback.
**DoD:** Model choice is transparent and measurable.
**Feedback refs:** #7

---

## P3 – Product onboarding and auth expansion

### T34 – Brand onboarding
**Scope:**
- Add onboarding for logo/brand tone/colors/company info.
- Persist profile and inject into script + prompt builder.
**DoD:** First-run onboarding materially changes generated output.
**Feedback refs:** #10

### T35 – Google Sign-In (Supabase OAuth)
**Scope:**
- Add Google auth flow next to email login.
- Maintain existing email auth fallback.
**DoD:** Google login works end-to-end.
**Feedback refs:** #12

---

## Recommended execution order
1) **P0 complete first:** T15 → T16 → T17 → T18 → T19  
2) **P1 compiler/control core:** T20 → T22 → T23 → T21 → T24 → T25 → T26  
3) **P2 media quality:** T31 → T32 → T30 → T27 → T28 → T29 → T33  
4) **P3 onboarding/auth:** T34 → T35

Reasoning:
- Reliability and clear UX first prevent noisy false negatives during creative upgrades.
- Prompt compiler + intent foundation must exist before deep audio/caption enhancements.
- Onboarding/auth can follow once generation quality and flow trust are stable.

---

## Relevant code/document touchpoints for later implementation
- `apps/api/src/providers/live-provider-runtime.ts`
- `apps/api/src/services/creative-consistency.ts`
- `apps/api/src/handlers.ts`
- `apps/api/src/server.ts`
- `apps/api/src/orchestration/queue-runtime.ts`
- `apps/web/app/components/review-live-actions.tsx`
- `apps/web/app/components/job-runtime-panel.tsx`
- `apps/web/app/lib/api-client.ts`
- `docs/PRODUCT_FLOW_V1_1.md`
- `docs/RUNBOOK.md`

(Planning only in this pass; no scope execution from these tickets yet.)
