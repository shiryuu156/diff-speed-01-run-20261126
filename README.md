# Diff two texts faster — entry for diff-speed-01-run-20261126

A faster drop-in for makefun-diff 1.0.0. `solve.js` returns exactly
makefun-diff's patch for every input, computed by the reference's own rule:

- lines cut after every `\n` (a `\r` is part of its line; a last line with no
  `\n` is a line too), equal only when the same code units;
- common prefix, then common suffix of what is left;
- between them Myers's greedy search, furthest into the old text, deletion
  on a tie, no edge diagonal pruned, every equal run followed as far as it
  goes; the first path to reach both ends is the script;
- the patch header, hunks with 3 kept lines of context, runs at most 6 kept
  lines apart sharing a hunk, deletions before insertions, `%` after a line
  that ends its text with no newline.

The speed comes from the implementation, not a different algorithm: lines
are interned to integers once, the search runs on flat `Int32Array`
frontiers (one snapshot per depth, written straight into place, so
backtracking needs no second pass), and the patch is emitted straight from
the split parts. No path object is allocated per step.

## Files

- `main.ts` — the house driver: reads `/input/cases.json`, answers each case
  with `run()` from `solve.js`, writes `/output/answers.json`.
- `solve.js` — the entry. `run(input)` returns makefun-diff 1.0.0's patch of
  `{ old, new }` as one string.
- `package.json` — `{"type": "module"}` so `solve.js` loads as an ES module.

## Measured on the kit practice set (4 cases, 21k–32k lines each)

| case | house baseline CPU | this entry CPU |
| ---- | ------------------ | -------------- |
| g-0001 | ~455 ms | ~154 ms |
| g-0002 | ~460 ms | ~138 ms |
| g-0003 | ~349 ms | ~118 ms |
| g-0004 | ~457 ms | ~118 ms |

Whole driver (`node main.ts`, fresh process, 4 cases): baseline ~2.0 s CPU,
this entry ~0.95 s CPU. All 4 practice answers byte-identical to the
reference (`passed: 1, cases_passed: 4/4` via the kit scorer), and 4,055
differential tests against the reference (edge cases plus 20 full-size
cases drawn with the kit's own generator from 5 seeds) all match exactly.
