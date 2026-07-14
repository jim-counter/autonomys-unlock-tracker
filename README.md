# Autonomys AI3 unlock tracker

Real-time dashboard for the AI3 12-month TGE milestone unlock (Jul 16, 2026 12:00 UTC),
tracking Hedgey claims on Auto EVM for Investors, Team, Advisors, Vendors and
Ambassadors, plus the Foundation and Autonomys Labs treasury allocations.

## How it works

- `scripts/build-registry.mjs` scans every `PlanCreated` event on the two Hedgey
  contracts (WAI3 plans of at least 100 AI3 - smaller ones are test grants) and
  attributes each plan by its creating wallet, per the
  [transparency forum post](https://forum.autonomys.xyz/t/subspace-foundation-autonomys-labs-wallets-official-addresses-for-transparency/4917/3):
  the four group admins map to their groups, the Foundation Long-Term Treasury and
  Autonomys Labs Treasury self-lockups go to the treasury section, and everything else
  is the Ambassadors program (created by the ambassador Safe and predecessors; creator
  address recorded per plan). Writes `data/registry.json` + `data/registry.js`.
- `index.html` is a self-contained static dashboard. It loads the registry, then polls
  Blockscout for `PlanRedeemed` / `PlanRevoked` events filtered to the tracked plan NFT
  IDs (so unrelated activity on the shared Hedgey contracts is excluded). Revocations
  count the vested payout as claimed and remove the returned remainder from the group
  total. Auto-refreshes every 45s.

Ambassadors are hidden by default to keep the milestone view clean; the "Show
ambassadors" toggle in the header (persisted per browser) folds them into every
section: KPIs, group cards, chart, feed, flow and claimants.

Shown: per-group totals/milestone step/claimable/claimed, the Foundation & Labs section
(both treasury Hedgey lockups plus live balances of the eight official operational
wallets), the unlock projection chart, a live claim feed, a "where claimed tokens went"
flow chart (held wrapped / unwrapped & held / moved onward, from WAI3 burn detection),
and per-claimant movement tracing.

## Usage

```sh
node scripts/build-registry.mjs   # refresh the plan registry (new plans are still being created)
python3 -m http.server 8642       # then open http://localhost:8642
```

Any static host works (GitHub Pages etc.); the explorer API allows cross-origin requests.
Opening `index.html` directly from disk also works since the registry loads via `data/registry.js`.

## Key addresses (Auto EVM mainnet)

| What | Address |
|---|---|
| Hedgey TokenLockupPlans (unlock claims) | `0x06B6D0AbD9dfC7F04F478B089FD89d4107723264` |
| Hedgey TokenVestingPlans (active-team vesting) | `0x2CDE9919e81b20B4B33DD562a48a84b54C48F00C` |
| Hedgey BatchPlanner | `0x5D3513EB3f889C8451BB8a1a02C23aFfD0CA64bE` |
| Wrapped AI3 (WAI3) | `0x7ba06C7374566c68495f7e4690093521F6B991bb` |
| Investors admin | `0x42AbFED9D4d9AF06dB50A80038A334bC5E88E9EB` |
| Team admin | `0xDB2278a91C8b5DA8585321136d2DDA49D0Cd8f9F` |
| Advisors admin | `0x99c2Cb8d62Fc041D21367084Ce0DeC646DE6Da73` |
| Vendors admin | `0xE6A6DcFFB470031D4eEe2cC9f83FC8d5135496DE` |
| Ambassador program Safe (plan creator) | `0xba0C1DD5072125337d0c827B3162523bA7B20415` |
| Foundation Long-Term Treasury beneficiary (100M plan recipient) | `0x7172f980f81aDDaCBd77645A07835d8218E8E47b` |
| Autonomys Labs Treasury beneficiary (70M plan recipient) | `0x1cCeB7b286b54F70E3d33783009Cb511cF9cC05d` |

Explorer: https://explorer.auto-evm.mainnet.autonomys.xyz

## Schedule structure (as found on-chain)

- Investors / Advisors / Vendors: lockup plans starting at TGE (2025-07-16), cliff at
  2026-07-16 12:00 UTC, streaming per-second over 48 months. At the cliff, 12 months of
  accrual (25%) becomes claimable at once.
- Team: single-unlock lockup plans for the 25% cliff amount plus revocable vesting plans
  streaming the remaining 75% over 36 months from the cliff; departed staff hold
  TGE-start lockup plans like investors.
- Ambassadors: monthly revocable vesting grants (Dec 2025 onward) plus some lockups,
  created by the ambassador Safe; already redeeming before the milestone.
- Treasuries: Foundation Long-Term Treasury (100M) and Autonomys Labs Treasury (70M)
  hold TGE-start 48-month lockup plans with the same milestone cliff (+25M / +17.5M at
  the milestone).
