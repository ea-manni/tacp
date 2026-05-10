# TACP Architecture Decisions

Format: one entry per decision. Date, decision, reasoning. Newest at top.

---

## 2026-05-10 — Video model: LTX-Video 0.9.7-dev (single-stage, no upscaler)

**Decision:** Switch the video model from LTX 0.9.5 (2B) to **LTX-Video 0.9.7-dev (13B)**, run **single-stage (skip the spatial upscaler)** at low resolution (480×832).

**Reasoning:**
- 13B vs 2B is the largest single-step quality jump available in the LTX family without changing model families. Direct response to "decent not great" output from 0.9.5.
- The "dev" variant (not distilled) avoids the scheduler-mismatch noise issue that broke our LTX 0.9.8 distilled fp8 attempt. bfloat16, no fp8 quirks.
- Skipping the upscaler keeps inference time inside the 5-minute target (~8–12 min for 8 clips on a 4090). Quality will be visibly softer than the full 2-stage pipeline — accepted trade-off.
- Build-in-public principle: ship visible imperfection now, document it, iterate publicly. Adding the upscaler later is a 1-day enhancement once funding allows higher GPU spend.
- Earlier consideration of Wan 2.1 1.3B was dropped after learning real runtime on a 4090 is ~40 minutes per video — far past target.

**Configuration:**
- Resolution: 480×832 (matches existing Remotion output, no downstream changes)
- Frames: `duration * 24 + 1` (LTX requires `8N + 1`; 6s × 24fps + 1 = 145, valid)
- FPS: 24
- Inference steps: 30 (single pass, no upscaler refinement)
- `decode_timestep=0.05`, `image_cond_noise_scale=0.025` (per official Lightricks docs)
- `pipe.vae.enable_tiling()` — required for 13B model VRAM headroom on 24GB cards
- bfloat16 throughout
- Negative prompt: "worst quality, inconsistent motion, blurry, jittery, distorted" (Lightricks-recommended)

**Estimated cost & timing on RTX 4090 ($0.30/hr):**
- ~60–90 sec per 6-second clip
- 8 clips ≈ 8–12 min total
- ~$0.04–0.06 per video

**Revisit when:** Beta user feedback identifies sharpness as the top complaint, or when budget allows running the 2-stage upscaler pipeline (~12–17 min/video, ~$0.06–0.09).

---

## 2026-05-10 — Single video style model (Wan 2.1 1.3B) — REVERSED

**Decision (reversed):** Originally planned to use Wan 2.1 1.3B for both Photorealistic and Ghibli. Reversed after learning real-world runtime on a 4090 is ~40 min per 8-clip video — far past the 5-minute target. Replaced with LTX 0.9.7-dev (see entry above).

**Lesson:** When picking a model, verify real-world runtime numbers from official docs before committing to a Docker rebuild.

---

## 2026-05-10 — Auth: Clerk
**Decision:** Use Clerk for authentication.

**Reasoning:** Free tier covers 10K MAUs (we need <100 at beta). 1–2 hour integration vs. 8–12 for self-hosted. At ~$50/hr engineer time, "saving money" by self-hosting a free service is a 6+ hour loss.

**Revisit when:** Hit Clerk's paid tier (10K MAUs).

---

## 2026-05-10 — Hosting: Vercel + Railway
**Decision:** Frontend on Vercel, backend + worker + Redis + Postgres on Railway.

**Reasoning:** ~$20/mo total at beta scale. Free tiers cover frontend. Railway's bundled Postgres + Redis + worker is the cheapest setup that doesn't require VPS sysadmin work. Self-hosting on a $5 VPS would save $15/mo but cost ~20 hours of setup time.

**Revisit when:** Crossing 1,000 users or $200/mo bill.

---

## 2026-05-10 — Storage: Cloudflare R2
**Decision:** Cloudflare R2 for video storage.

**Reasoning:** Zero egress fees. Storage costs ~$0.15/mo for beta volume. S3 would be similar storage but $0.09/GB egress kills the math when users download.

---

## 2026-05-10 — GPU strategy: single warm instance
**Decision:** One Vast.ai instance handles all queued jobs sequentially during beta.

**Reasoning:** Invite-only beta with 20–50 users. Parallel processing complexity not worth it at this scale. Instance auto-spins-up when queue has jobs, auto-destroys after N minutes idle.

**Revisit when:** Job queue depth regularly exceeds capacity (users waiting >30 min).

---

## 2026-05-10 — Beta scope: invite-only, 20–50 users
**Decision:** Beta is closed and invite-only. Waitlist for outsiders. Manual approval.

**Reasoning:** Solo part-time founder cannot moderate or support open beta. GPU costs uncapped for open beta would burn budget. Invite-only allows iteration with motivated testers.

---

## 2026-05-09 — Audio sync: 1.15x speedup + proportional segment stretching
**Decision:** Audio plays at 1.15x. Per-segment video duration is proportional to character count of the segment's narration. Each video clip's playback rate adjusts to fit its segment's allocated duration.

**Reasoning:** Mirrors a manual editing technique (sped audio + stretched clips). No extra API calls. Closes 80% of the sync problem. Word-level timestamps via Whisper deferred to post-beta.

---

## 2026-05-09 — Render-time audio measurement
**Decision:** WAV duration is read from the file header at render time, not from the synthesize step's return value.

**Reasoning:** Allows render-only mode (skip TTS step) for iteration on existing audio.

---

## 2026-05-08 — Restrict GPU shortlist to FP8-capable cards
**Decision:** `vast-manager.ts` `ACCEPTED_GPUS` restricted to RTX 4090 / 4080 / L40 / L40S / H100. Min VRAM bumped to 24GB.

**Reasoning:** FP8 inference requires Ada or Hopper architecture (compute capability 8.9+). Earlier attempts to run fp8 on Quadro RTX 6000 (Turing) produced CUDA illegal memory access errors. Cheaper cards aren't actually cheaper if they can't run the model.

**Revisit when:** Switching to a model that doesn't require fp8. **Note (2026-05-10):** LTX 0.9.7-dev uses bf16, not fp8 — could relax this filter back to broader GPU shortlist if cost pressure increases.

---

## 2026-05-08 — Auto-start uvicorn in Docker image
**Decision:** Dockerfile `CMD` launches uvicorn automatically.

**Reasoning:** Removes the manual SSH-and-start-server step from every session. Vast.ai's `onstart.sh` mechanism overrides this for SSH-runtype instances, but the `CMD` is still useful for non-SSH runs and as documented behavior.

---

## 2026-05-08 — TTS provider: stick with Gemini Flash TTS
**Decision:** Keep Gemini Flash TTS for beta. Defer self-hosted TTS to post-beta.

**Reasoning:** Cost is negligible at beta scale (~$0.001/video, ~$0.20/month for 200 videos). Quality is solid. Self-hosting (Coqui XTTS-v2) adds infra complexity, GPU time, and prompt-tuning work that doesn't pay back at beta scale.