# Homepage Warp Tunnel · Production Closeout

> Date: 2026-07-20
>
> Branch: `codex/warp-tunnel-effect`
>
> Baseline: `7e7a472`
>
> Delivery state: `PRODUCTION_OBSERVED / LIMITED_LAUNCH`

## Outcome

The homepage now uses a Three.js warp-tunnel background while the other public portfolio routes retain the existing Morse signal Canvas. The enhancement is dynamically loaded on `/`, consumes the existing color tokens, does not intercept pointer input, and preserves the existing content and chat flows.

Desktop uses 760 rays at up to 60 fps. Coarse-pointer and narrow screens use 300 rays at up to 36 fps. Device pixel ratio is capped at 1.5. Rendering pauses while the document is hidden; `prefers-reduced-motion` renders one static frame. WebGL initialization failure or context loss falls back to `MorseSignalCanvas`.

The implementation releases the animation frame, renderer, geometry, materials, media-query listener, visibility listener, resize listener, and context-loss listener when it unmounts.

## Verification

- Final `npm test`: 601 tests, 601 pass, 0 fail, 0 skip.
- Final `npm run build`: exit 0; Next.js and TypeScript passed, and 21 routes were generated.
- Production preview: `next start --hostname 127.0.0.1 --port 3020`.
- Full S9 browser gate: final rerun exit 0 with `failures: []`, console errors 0, page errors 0, external runtime requests 0, and horizontal overflow 0 on every checked route and viewport.
- Canvas checks: desktop variance `49.956134`, frame difference `3.591296`; mobile variance `395.600059`, frame difference `0.743079`; reduced-motion variance `405.057968`, frame difference `0`.
- Context-loss handling: the browser gate dispatched a cancelable `webglcontextlost` event, verified it was prevented, and observed the Morse Canvas fallback.
- Manual screenshot review: desktop 1440x900, mobile 390x844, and mobile reduced-motion retained readable identity, CTA, invitation form, and controls without incoherent overlap.

After mainline absorption, S9 exposed Next.js-generated favicon URLs whose navigation-time cancellation surfaced as `ERR_ABORTED`. The monitor now accepts only the exact generated fingerprint query form; arbitrary queries such as `?version=private` still fail. The final full production S9 gate passed twice consecutively with no failures, console/page errors, external requests, or horizontal overflow.

## Evidence

- `s9-home-desktop-1440x900.png`
- `s9-home-mobile-390x844.png`
- `s9-home-mobile-390-reduced.png`
- `s9-works-desktop-1440x900.png`
- `s9-works-mobile-390x844.png`

The historical images under `docs/verify/s9/` remain unchanged. This round writes its screenshots to `docs/verify/warp-tunnel/` through `S9_EVIDENCE_DIR`.

## Production Observation

- Feature commit `e364f03` was absorbed into `master` by merge commit `1ced025`; S9 stabilization landed as `44ed094`.
- Local `master` and `origin/master` both reached `44ed094` before deployment.
- `/opt/revolution/current` and the Web, Worker, and Edge Compose working directories point to `/opt/revolution/releases/44ed094/revolution`.
- Production migration 001/002, grants, idempotent ingest, live/ready, and `release:smoke` passed; ingest updated 0 documents and skipped all 40.
- Lighthouse 13.4.0 Performance is 99 on mobile and 99 on desktop. Desktop FCP is 0.2s, LCP 0.6s, TBT 70ms, CLS 0, and Speed Index 1.0s.
- No real Chat, Bocha, or Feishu Provider was called.

The application remains `LIMITED_LAUNCH` until monitoring, managed backup and recovery, edge traffic limits, real Bocha/Feishu smoke, moderate dependency advisories, and broader domestic reachability are addressed.
