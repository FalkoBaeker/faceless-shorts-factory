# BullMQ Queue Design (MVP)

## Queues
- `video.ideation`
- `video.storyboard`
- `video.segment.render`
- `video.audio.tts`
- `video.assembly`
- `video.publish`

## Retry & Backoff
- Default: `attempts=3`, `backoff=exponential`, `delayMs=2000`
- Segment rendering gets provider-aware retry (e.g. timeout vs hard validation error)

## Dead-letter Strategy
- On final failure: move job payload + provider error snapshot to dead-letter collection
- Emit timeline event `FAILED_FINAL`
- Trigger credit `RELEASED` if prior state has `RESERVED`

## Idempotency
- Per segment use deterministic `segment_key` derived from project, variant, idx, model, seconds, size, prompt, input hash.
- Before enqueue/create provider request: check existing segment by key and resume instead of duplicating.
