# Phase 07 — Deferred Items (out-of-scope discoveries)

## 07-06 execution

Pre-existing failures in `parser/__tests__/post-positioning.test.mjs`, present on the
pristine `main` baseline (c5c0755) BEFORE any 07-06 change — NOT in scope for the LC
layer-B fix (these are Valmor greedy/Viterbi p4 symbol-distance assertions, unrelated to
the LC shared-symbol collapse). Logged per the executor scope-boundary rule; left untouched.

- `FAIL: post 4 kept when raw symbol matches circle`
- `FAIL: [D-N2-01 baseline] greedy assignment Valmor p4 max symbol-distance < 30 pt`
- `FAIL: [D-N2-01 fix] Viterbi assignment Valmor p4 max symbol-distance < 5 pt`

Note: `post-positioning.test.mjs` is NOT a gate in `npm run test:gate` (the Valmor gates
that ARE wired — `run-valmor-post-position-gate.mjs` / `run-valmor-accuracy-gate.mjs` —
pass green). These three are internal unit assertions that predate Phase 07; route to a
future Valmor-positioning quick task if they need addressing.
