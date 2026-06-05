# TACP Beta — In Scope vs. Out of Scope

Use this to fight scope creep. If something isn't on the IN list, it doesn't ship for June 27.

---

## ✅ IN scope for beta (June 27, 2026)

### User-facing features
- Web app at a real URL (Vercel)
- Email signup + invite code (Clerk)
- Story creation form: idea, length (3 tiers), style (Photorealistic OR Ghibli), aspect ratio (9:16 OR 16:9), voice (curated 6-8)
- Job status page with progress states
- Download finished MP4 from R2
- Dashboard listing user's past videos
- Per-user video quota

### Behind the scenes
- Wan 2.1 1.3B as the single video model
- Curated style prompts for Photorealistic + Ghibli
- BullMQ job queue with Redis
- Single warm Vast.ai GPU instance, sequential job processing
- Cloudflare R2 storage with signed URLs
- Sentry error tracking
- Keyword blocklist moderation
- Privacy policy + ToS

---

## ❌ OUT of scope for beta (post-launch v1.1+)

### User-facing
- Style options beyond Photorealistic + Ghibli (anime, sketches, stickman)
- Tone option (dramatic, casual, mysterious, etc.)
- Custom voice cloning
- Video editing tools / re-render specific segments
- Sharing / public video links
- Comments, likes, social features
- Templates / saved styles
- Multi-aspect-ratio output per video

### Behind the scenes
- GPU instance pool / parallel processing
- Word-level subtitle sync (Whisper)
- Self-hosted TTS (Coqui XTTS-v2)
- Stripe subscriptions / paid tiers
- Public CDN
- LLM-based moderation
- A/B testing framework
- Analytics dashboards
- Advanced admin tools

---

## ⚠️ Cuts justified

These are things I considered for beta and explicitly cut:

- **GPU instance pool** — single warm instance handles 20-50 invite-only users fine. Pool adds 20+ hours of work for no immediate user benefit.
- **CDN in front of R2** — direct R2 download URLs are fine at beta volume. CDN adds ~$5/mo and config time, no UX gain at this scale.
- **LLM-based moderation** — keyword blocklist catches the obvious cases. LLM moderation adds latency and cost for marginal gain. Revisit if users find blocklist gaps.
- **Open beta** — would explode GPU costs and support load. Invite-only is the right shape for solo founder iteration.