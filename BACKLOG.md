# TACP Beta Backlog

**Target launch:** June 27, 2026 (private invite-only beta)
**Days remaining:** 48
**Budget:** ~150–180 dev hours (part-time around Equinix)

---

## Workstream 1 — Foundation cleanup
*Do this first. Clean foundation makes everything else faster.*

- [ ] Rename `src/grok/` → `src/clips/`
- [ ] Rename `src/elevenlabs/` → `src/tts/`
- [ ] Update all imports to match new paths
- [ ] Write `README.md` (project overview, quickstart, architecture diagram)
- [ ] Update `BACKLOG.md`, `DECISIONS.md`, `BETA_SCOPE.md` (this file and siblings)

**Estimate:** 6 hours

---

## Workstream 2 — Model swap to Wan 2.1 1.3B
*Quality is the #1 user complaint risk. Fix this before building UI.*

- [ ] Update `Dockerfile` to bake Wan 2.1 1.3B model + dependencies
- [ ] Rewrite `src/vastai/server.py` for Wan inference pipeline
- [ ] Test single clip generation end-to-end on a fresh instance
- [ ] Tune inference params (steps, guidance, scheduler) for quality
- [ ] Trigger GitHub Actions Docker rebuild
- [ ] Generate full test video, compare to current LTX output

**Estimate:** 25 hours

---

## Workstream 3 — Story configuration options
*Beta-critical user-facing config.*

- [ ] Add `length` option to package generation (Short 30-45s, Standard 45-75s, Long 75-120s)
- [ ] Add `style` option (Photorealistic, Ghibli) — affects video model prompts
- [ ] Add `aspect_ratio` option (9:16 vertical, 16:9 horizontal) — affects clip dimensions + Remotion composition
- [ ] Add `voice` option (curated list of 6-8 Gemini TTS voices)
- [ ] Update Claude prompt to honor length + tone
- [ ] Update video generation prompts to honor style
- [ ] Update Remotion `Root.tsx` and `Video.tsx` to honor aspect ratio

**Estimate:** 18 hours

---

## Workstream 4 — Web UI (frontend)
*Next.js on Vercel. App Router.*

- [ ] Set up Next.js project with App Router
- [ ] Integrate Clerk for auth
- [ ] Landing page (what is TACP, beta waitlist signup)
- [ ] Story creation form (idea + length + style + aspect ratio + voice)
- [ ] Job status page (queued → generating → rendering → complete)
- [ ] Video viewer page (download, share, regenerate)
- [ ] User dashboard (list of past videos)

**Estimate:** 35 hours

---

## Workstream 5 — Backend & job queue
*Railway hosts API + worker + Redis + Postgres.*

- [ ] Set up Railway project (Postgres, Redis, worker service)
- [ ] Define database schema (users, jobs, videos)
- [ ] Set up BullMQ queue and worker process
- [ ] Refactor `orchestrator.ts` into a queue-consumable job
- [ ] API routes (create job, get status, list user videos)
- [ ] Hook Clerk auth → API authorization

**Estimate:** 22 hours

---

## Workstream 6 — GPU lifecycle (single warm instance)
*One instance handles all queued jobs sequentially during beta.*

- [ ] Worker boot logic: start Vast instance if none exists
- [ ] Worker idle logic: destroy instance after N minutes of empty queue
- [ ] Job retry logic on instance failure
- [ ] Cost tracking per user (videos generated this month)
- [ ] Per-user quota enforcement

**Estimate:** 18 hours

---

## Workstream 7 — Storage on Cloudflare R2
- [ ] Set up R2 bucket
- [ ] Upload finished MP4s post-render
- [ ] Generate signed download URLs
- [ ] Lifecycle policy (auto-delete after 30 days for beta)

**Estimate:** 6 hours

---

## Workstream 8 — Operations (logging, errors, moderation)
- [ ] Sentry integration for frontend + backend
- [ ] Keyword blocklist for story idea moderation
- [ ] Failed-job alerting (email/Slack)
- [ ] Basic admin view of all jobs

**Estimate:** 10 hours

---

## Workstream 9 — Beta launch prep
- [ ] Privacy policy + Terms of service (template-based, lightweight)
- [ ] Waitlist + invite-code system
- [ ] Onboarding email sequence (3 emails)
- [ ] Recruit 5 initial beta users for closed test
- [ ] Bug fixes from initial test
- [ ] Launch LinkedIn post

**Estimate:** 18 hours

---

## Total estimate: 158 hours
*Within 150–180 hour window. Tight. Cuts may be needed.*

---

## Stretch (post-beta v1.1)
- Style options: anime, sketches, stickman
- Tone option (dramatic, casual, mysterious, scholarly)
- GPU instance pool (parallel job processing)
- Word-level subtitle sync via Whisper
- Self-hosted TTS (replace Gemini with Coqui XTTS-v2)
- Stripe subscriptions
- Public open beta