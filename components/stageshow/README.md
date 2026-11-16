# Stageshow kit (vendored)

The parts of the [Stageshow](https://github.com/benjitaylor/skills/tree/main/stageshow) kit
(v1.1.1, MIT, see `LICENSE`) that `components/market/bid-lifecycle.tsx` uses: the `Stage`
(canvas, script, playback, poster, reduced motion) and the `Count`, `Roll`, `Swap`, `Check`
and `Icon` parts. Only these files are copied, so the phone, chat and chart styles never ship.

Changes from upstream, kept small so an update is a re-copy plus these:
- non-null assertions / fallbacks where `noUncheckedIndexedAccess` (our tsconfig) flags
  array or record reads, with no behaviour change.

Import from the files directly (`./kit/stage`, `./kit/motion/Count`, …), not an index.
