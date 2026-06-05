Here's the realistic 6-week plan against your June 27 target:
Week 1 (May 11-17) — Foundation

Set up the new monorepo
Get Next.js + Tailwind + shadcn running locally
Integrate Clerk
Build landing page + waitlist signup
Deploy a "Hello World" version to Vercel under your eventual domain

Week 2 (May 18-24) — Database + dashboard shell

Set up Railway (Postgres + Redis)
Drizzle schema
Build dashboard page (empty state + grid layout)
Build create form (no submission yet, just the UI)

Week 3 (May 25-31) — Pipeline integration

Move existing TACP code into apps/worker
Wire up BullMQ
Form submission creates DB record + queues job
Worker consumes job, runs pipeline, writes status updates back to DB
Job status page polls DB for updates

Week 4 (June 1-7) — Storage + delivery

R2 setup, upload final videos
Video viewer page
Resend integration for completion emails
Feedback form

Week 5 (June 8-14) — Polish + close the loop

Dark/light toggle
Loading states, error states, empty states
GPU lifecycle (auto-spin-up, auto-destroy)
Per-user quota enforcement
Cost tracking

Week 6 (June 15-21) — Beta prep

5-user closed test
Bug fixes from feedback
Sentry + monitoring
Privacy policy + ToS
Final polish

June 22-27 — Launch buffer

Recruit beta users from LinkedIn
Send invite codes
Public launch post