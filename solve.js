// A faster drop-in for makefun-diff 1.0.0, written from the rule in the competition
// description (the same rule the reference index.js states in its header). It returns
// exactly makefun-diff's patch for every input, but computes the edit script without
// allocating a path object per step.
//
// The speed comes from three choices:
//  1. Lines are interned to small integers once (a line is its text plus whether it
//     ends in "\n"), so every comparison inside the search is an integer compare.
//  2. Myers's greedy search runs on flat Int32Array frontiers, one per depth, instead
//     of a linked list of path objects; a depth's frontier is written straight into
//     its snapshot, so backtracking needs no recomputation and no second pass.
//  3. The patch is emitted straight from the split parts, so no line string is ever
//     built for a line the patch does not show.
//
// The search itself is the reference's rule, step for step: common prefix, then
// common suffix of what is left; between them, for d = 0, 1, 2, ... and each diagonal
// k = x - y from -d to d in steps of 2, the furthest point of d edits on k is one
// old line past the furthest (d-1)-point on k - 1 (a deletion) or one new line past
// the furthest (d-1)-point on k + 1 (an insertion), whichever lies further into the
// old text, the deletion when both reach the same point; a move past the end of
// either text is no candidate, no edge diagonal is pruned, and from that point the
// path follows every run of lines equal in both as far as it goes. The first path
// to reach both ends is the script.

/** The patch's first word. */
export const FORMAT = 'makefun-diff/1';

/** The kept lines a hunk shows before and after each change run. */
export const CONTEXT = 3;

/** Run kinds: a kept, a deleted and an inserted line. */
const KEEP = 0;
const DELETE = 1;
const INSERT = 2;

/** A frontier entry with no path on its diagonal. Old positions are -1 or more. */
const NONE = -2;

/**
 * The runs of the edit script of a into b: [{ kind, count }], in order.
 * a and b are Int32Arrays of interned line ids, the middle after the common
 * prefix and suffix have been cut. The runs are the reference's runs.
 */
function editRuns(a, b) {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];

  // One frontier snapshot per depth. snaps[d] is an Int32Array of length 2d+1;
  // snaps[d][k + d] is the old position the best d-edit path on diagonal k
  // reaches after its snake, or NONE when no d-edit path reaches k.
  const snaps = [];

  // Depth 0: the path from (-1, -1) along its snake.
  let x = -1;
  let y = -1;
  while (x + 1 < n && y + 1 < m && a[x + 1] === b[y + 1]) {
    x++;
    y++;
  }
  const s0 = new Int32Array(1);
  s0[0] = x;
  snaps.push(s0);
  if (x + 1 >= n && y + 1 >= m) return x >= 0 ? [{ kind: KEEP, count: n }] : [];

  let D = -1;
  let kFinal = 0;
  let prev = s0;
  for (let d = 1; d <= n + m; d++) {
    const cur = new Int32Array(2 * d + 1);
    // The frontier is walked by j = k + d, from 0 to 2d in steps of 2, so the
    // two diagonals the choice reads are prev[j - 2] and prev[j]. The two
    // edge diagonals have only one candidate each and sit outside the loop.
    let add = prev[0];
    if (add !== NONE && add + d < m) {
      // k = -d: only the insertion from diagonal k + 1; its new line is add + d.
      let px = add;
      let py = px + d;
      while (px + 1 < n && py + 1 < m && a[px + 1] === b[py + 1]) {
        px++;
        py++;
      }
      cur[0] = px;
      if (px + 1 >= n && py + 1 >= m) {
        D = d;
        kFinal = -d;
        snaps.push(cur);
        break;
      }
    } else {
      cur[0] = NONE;
    }
    let done = false;
    for (let j = 2; j <= 2 * d - 2; j += 2) {
      const k = j - d;
      const rem = prev[j - 2];
      add = prev[j];
      const canRemove = rem !== NONE && rem + 1 < n;
      const canAdd = add !== NONE && add - k < m;
      if (!canRemove && !canAdd) {
        cur[j] = NONE;
        continue;
      }
      // The candidate further into the old text, the deletion on a tie.
      const byDeletion = canRemove ? rem + 1 : NONE;
      const byInsertion = canAdd ? add : NONE;
      let px = byDeletion >= byInsertion ? byDeletion : byInsertion;
      let py = px - k;
      while (px + 1 < n && py + 1 < m && a[px + 1] === b[py + 1]) {
        px++;
        py++;
      }
      cur[j] = px;
      if (px + 1 >= n && py + 1 >= m) {
        D = d;
        kFinal = k;
        done = true;
        break;
      }
    }
    if (!done) {
      // k = d: only the deletion from diagonal k - 1.
      const rem = prev[2 * d - 2];
      if (rem !== NONE && rem + 1 < n) {
        let px = rem + 1;
        let py = px - d;
        while (px + 1 < n && py + 1 < m && a[px + 1] === b[py + 1]) {
          px++;
          py++;
        }
        cur[2 * d] = px;
        if (px + 1 >= n && py + 1 >= m) {
          D = d;
          kFinal = d;
          done = true;
        }
      } else {
        cur[2 * d] = NONE;
      }
    }
    snaps.push(cur);
    prev = cur;
    if (done) break;
  }
  if (D < 0) throw new Error('makefun-diff: the search ended without reaching both ends');

  // Backtrack from the first path to reach both ends. At each depth the choice
  // is recomputed from the previous depth's snapshot by the same rule, so the
  // pre-snake point and the snake's length are exact, and the predecessor is
  // the previous depth's post-snake point on the diagonal the choice came from.
  const rev = [];
  let d = D;
  let k = kFinal;
  x = snaps[D][k + D];
  while (d > 0) {
    const prevSnap = snaps[d - 1];
    let preX;
    let choice;
    if (k === -d) {
      preX = prevSnap[k + d];
      choice = INSERT;
    } else if (k === d) {
      preX = prevSnap[k + d - 2] + 1;
      choice = DELETE;
    } else {
      const rem = prevSnap[k + d - 2];
      const add = prevSnap[k + d];
      const canRemove = rem !== NONE && rem + 1 < n;
      const canAdd = add !== NONE && add - k < m;
      const byDeletion = canRemove ? rem + 1 : NONE;
      const byInsertion = canAdd ? add : NONE;
      if (byDeletion >= byInsertion) {
        preX = byDeletion;
        choice = DELETE;
      } else {
        preX = byInsertion;
        choice = INSERT;
      }
    }
    const keep = x - preX;
    if (keep > 0) rev.push({ kind: KEEP, count: keep });
    rev.push({ kind: choice, count: 1 });
    if (choice === DELETE) {
      k = k - 1;
      x = prevSnap[k + (d - 1)];
    } else {
      k = k + 1;
      x = prevSnap[k + (d - 1)];
    }
    d--;
  }
  // The depth-0 snake, from (-1, -1) to the first snapshot's point.
  const keep0 = snaps[0][0] + 1;
  if (keep0 > 0) rev.push({ kind: KEEP, count: keep0 });
  rev.reverse();

  // Adjacent runs of one kind (two deletions in a row with no snake between
  // them, and the like) are one run, as the reference's path components are.
  const runs = [];
  for (const r of rev) {
    const last = runs.length > 0 ? runs[runs.length - 1] : undefined;
    if (last !== undefined && last.kind === r.kind) last.count += r.count;
    else runs.push({ kind: r.kind, count: r.count });
  }
  return runs;
}

/** A line as the patch writes it: its op, the line, a newline, and "%" on a line of its own when it had none. */
function written(op, parts, i, last) {
  return i < last ? `${op}${parts[i]}\n` : `${op}${parts[i]}\n%\n`;
}

/** makefun-diff 1.0.0's answer for one case's input: its patch of { old, new }. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }

  // A text's lines, each its "\n" (the last one without, when the text does not
  // end in one). The empty text has no lines; "\n" has one, an empty line.
  // parts[i] is line i's text without its newline; line i has one iff i < last.
  const pa = input.old.split('\n');
  const pb = input.new.split('\n');
  const lastA = pa.length - 1;
  const lastB = pb.length - 1;
  const n = pa[lastA] === '' ? lastA : lastA + 1;
  const m = pb[lastB] === '' ? lastB : lastB + 1;

  // Intern every line to one integer: its text's id, doubled, plus one when
  // the line ends in "\n". Two lines are equal exactly when their ids match.
  const ids = new Map();
  let nextId = 1;
  const ia = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    let id = ids.get(pa[i]);
    if (id === undefined) {
      id = nextId++;
      ids.set(pa[i], id);
    }
    ia[i] = (id << 1) | (i < lastA ? 1 : 0);
  }
  const ib = new Int32Array(m);
  for (let j = 0; j < m; j++) {
    let id = ids.get(pb[j]);
    if (id === undefined) {
      id = nextId++;
      ids.set(pb[j], id);
    }
    ib[j] = (id << 1) | (j < lastB ? 1 : 0);
  }

  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && ia[prefix] === ib[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && ia[n - 1 - suffix] === ib[m - 1 - suffix]) suffix++;

  const runs = [];
  if (prefix > 0) runs.push({ kind: KEEP, count: prefix });
  runs.push(...editRuns(ia.subarray(prefix, n - suffix), ib.subarray(prefix, m - suffix)));
  if (suffix > 0) runs.push({ kind: KEEP, count: suffix });

  // The change runs: each a stretch of deletions and insertions between two kept lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    if (r.kind === KEEP) {
      o += r.count;
      p += r.count;
      continue;
    }
    let c = changes.length > 0 ? changes[changes.length - 1] : undefined;
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DELETE) {
      c.dels += r.count;
      o += r.count;
      deleted += r.count;
    } else {
      c.ins += r.count;
      p += r.count;
      inserted += r.count;
    }
  }

  // The hunks: change runs at most 2 * CONTEXT kept lines apart share one.
  const hunks = [];
  for (const c of changes) {
    const h = hunks.length > 0 ? hunks[hunks.length - 1] : undefined;
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }

  const out = [`${FORMAT} old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) out.push(written('=', pa, at, lastA));
      for (let i = 0; i < c.dels; i++) out.push(written('-', pa, c.o + i, lastA));
      for (let i = 0; i < c.ins; i++) out.push(written('+', pb, c.p + i, lastB));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written('=', pa, at, lastA));
  }
  return out.join('');
}
