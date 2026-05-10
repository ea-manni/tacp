# TACP — Toledot Automated Content Pipeline

> One command in. Finished short-form video out.

TACP is an automated video production pipeline. You give it a story idea. It generates a full short-form video — script, narration, AI-generated visuals, synced subtitles, professionally rendered MP4 — without manual editing.

It's built for **Toledot Stories**, my faceless YouTube history channel. It's becoming a SaaS for other faceless content creators.

---

## What it does

```bash
npx tsx src/orchestrator.ts "the 10 seconds that ended World War One"
```

Produces:

- A full production package — title options, thumbnail prompt, description, tags, hashtags, chapters, social captions
- An AI-narrated audio track (Gemini Flash TTS, voice auto-cast by Claude)
- 8 AI-generated video clips (LTX-Video on rented GPUs)
- A synced final MP4 with subtitles, overlay cards, and a subscribe sticker (Remotion)

End-to-end runtime: **~10–15 minutes**, mostly GPU time. Cost per video: **~$0.05–0.10**.

---

## Architecture

```
Story idea
    │
    ▼
┌─────────────────┐
│   Claude API    │  Generates VideoPackage JSON
│   (Sonnet 4)    │  (script, segments, prompts, metadata)
└────────┬────────┘
         │
         ├──────────────────┐
         ▼                  ▼
┌─────────────────┐  ┌─────────────────┐
│   Gemini TTS    │  │   Vast.ai GPU   │
│   (Flash TTS)   │  │  (LTX-Video on  │
│                 │  │   RTX 4090)     │
│  Narration WAV  │  │  8 video clips  │
└────────┬────────┘  └────────┬────────┘
         │                    │
         └──────────┬─────────┘
                    ▼
           ┌─────────────────┐
           │    Remotion     │
           │  (final render) │
           │                 │
           │   MP4 output    │
           └─────────────────┘
```

**Stack:** TypeScript orchestration · Python inference server · Claude API · Gemini API · Vast.ai GPU rentals · Docker · GitHub Actions · Remotion · React

---

## Project layout

```
tacp/
├── src/
│   ├── claude/         # Story package generation (Sonnet 4)
│   ├── tts/            # Gemini TTS narration
│   ├── clips/          # Video clip generation (Vast.ai client)
│   ├── vastai/         # GPU instance lifecycle (spin up, tunnel, destroy)
│   ├── remotion/       # Final video composition (React + Remotion)
│   ├── orchestrator.ts # End-to-end pipeline
│   └── types.ts        # Shared TypeScript types
│
├── public/             # Remotion static assets (clips + audio at render time)
├── output/             # Generated artifacts
│   ├── packages/       # Story package JSONs
│   ├── audio/          # Narration WAVs
│   ├── clips/          # Generated video clips
│   └── videos/         # Final rendered MP4s
│
├── Dockerfile          # Image baked with LTX-Video model + inference server
├── .github/workflows/  # GitHub Actions: auto-build Docker image on changes
└── BACKLOG.md          # What's being built next
```

---

## Quickstart (for developers)

**Requires:** Node 20+, Python 3.10+, Docker, accounts on Anthropic, Google AI Studio, Vast.ai.

```bash
git clone https://github.com/ea-manni/tacp.git
cd tacp
npm install
cp .env.example .env   # fill in API keys
```

**One-shot pipeline:**
```bash
npx tsx src/orchestrator.ts "your story idea here"
```

**Or step by step:**
```bash
# 1. Generate package
npx tsx src/claude/generate-package.ts "your story idea"

# 2. Generate narration
npx tsx src/tts/synthesize.ts "output/packages/<story_id>.json"

# 3. Spin up GPU + generate clips
npx tsx src/vastai/start-session.ts
npx tsx src/clips/generate-clips.ts "output/packages/<story_id>.json"
npx tsx src/vastai/cleanup.ts

# 4. Render final video
npx tsx src/render-only.ts <story_id>
```

---

## Building in public

This repo is built in public. Every architectural decision, every failed model run, every GPU bill mistake is documented in [`DECISIONS.md`](./DECISIONS.md). The current scope and what's been deliberately cut from the upcoming beta is in [`BETA_SCOPE.md`](./BETA_SCOPE.md). The active task list is in [`BACKLOG.md`](./BACKLOG.md).

Build-in-public posts: [LinkedIn — Ebunoluwa Olowo](https://www.linkedin.com/in/ebunoluwa-olowo/)

---

## Roadmap

**Closed beta (target: June 27, 2026)** — invite-only web app
- Story configuration: length, video style (Photorealistic + Ghibli), aspect ratio, voice
- Wan 2.1 video model upgrade
- Job queue, user accounts, R2 storage
- Waitlist sign-up open below

**Post-beta**
- More styles (anime, sketches, stickman)
- Tone control (dramatic, casual, mysterious, scholarly)
- Word-level subtitle sync via Whisper
- Self-hosted TTS
- Stripe subscriptions and public launch

---

## Want early access?

Beta is invite-only. To join the waitlist: [link coming soon]

---

## License

This project is private and not currently open source. The repository is public for transparency and portfolio purposes. Reuse not permitted without written permission.

---

## Contact

**Ebunoluwa Olowo**
Building TACP solo, part-time, in Lagos.
LinkedIn: [linkedin.com/in/ebunoluwa-olowo](https://www.linkedin.com/in/ebunoluwa-olowo/)
GitHub: [github.com/ea-manni](https://github.com/ea-manni)
