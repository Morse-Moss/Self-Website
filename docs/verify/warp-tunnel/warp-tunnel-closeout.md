# Homepage Warp Tunnel · Local Closeout

> Date: 2026-07-19
>
> Branch: `codex/warp-tunnel-effect`
>
> Baseline: `7e7a472`
>
> Delivery state: `LOCAL_READY · NOT MERGED · NOT PUSHED · NOT DEPLOYED`

## Outcome

The homepage now uses a Three.js warp-tunnel background while the other public portfolio routes retain the existing Morse signal Canvas. The enhancement is dynamically loaded on `/`, consumes the existing color tokens, does not intercept pointer input, and preserves the existing content and chat flows.

Desktop uses 760 rays at up to 60 fps. Coarse-pointer and narrow screens use 300 rays at up to 36 fps. Device pixel ratio is capped at 1.5. Rendering pauses while the document is hidden; `prefers-reduced-motion` renders one static frame. WebGL initialization failure or context loss falls back to `MorseSignalCanvas`.

The implementation releases the animation frame, renderer, geometry, materials, media-query listener, visibility listener, resize listener, and context-loss listener when it unmounts.

## Verification

- `npm test`: 593 tests, 593 pass, 0 fail, 0 skip.
- `npm run build`: exit 0; Next.js and TypeScript passed, and 20 routes were generated.
- Production preview: `next start --hostname 127.0.0.1 --port 3020`.
- Full S9 browser gate: final rerun exit 0 with `failures: []`, console errors 0, page errors 0, external runtime requests 0, and horizontal overflow 0 on every checked route and viewport.
- Canvas checks: desktop variance `49.956134`, frame difference `3.591296`; mobile variance `395.600059`, frame difference `0.743079`; reduced-motion variance `405.057968`, frame difference `0`.
- Context-loss handling: the browser gate dispatched a cancelable `webglcontextlost` event, verified it was prevented, and observed the Morse Canvas fallback.
- Manual screenshot review: desktop 1440x900, mobile 390x844, and mobile reduced-motion retained readable identity, CTA, invitation form, and controls without incoherent overlap.

The first full browser run reported one non-reproducible `mobile-reduced:/works:network-Other-failed` after all homepage Canvas checks passed. The unchanged gate was rerun against the same production preview and passed completely, so no network-monitor exception was added.

## Evidence

- `s9-home-desktop-1440x900.png`
- `s9-home-mobile-390x844.png`
- `s9-home-mobile-390-reduced.png`
- `s9-works-desktop-1440x900.png`
- `s9-works-mobile-390x844.png`

The historical images under `docs/verify/s9/` remain unchanged. This round writes its screenshots to `docs/verify/warp-tunnel/` through `S9_EVIDENCE_DIR`.

## Open Gate

Fresh Lighthouse was not produced. The documented offline command failed with `ENOTCACHED` because `lighthouse@13.4.0` is no longer present in the local npm cache, and no package was installed solely for this report. A fresh score of at least 0.90 remains required before deployment.

The branch started before the AI lead-generation portfolio commits and is behind the current local `master`. Mainline absorption must resolve the overlapping `package.json` and S9 harness changes against the latest mainline, then rerun the full build, tests, browser gate, and Lighthouse before any push or deployment.
