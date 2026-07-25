// Unit tests for issue #13 — Shade transition re-entry. The four pure helpers
// were extracted from game.js specifically so the logic is testable without the
// browser/THREE runtime. We pull each function's source out of game.js by name
// and eval it in isolation, so the test verifies the SHIPPED code, not a copy.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const GAME = resolve(import.meta.dirname, '..', 'maze', 'game.js');
const DATA = resolve(import.meta.dirname, '..', 'maze', 'maze-data.js');
const gsrc = readFileSync(GAME, 'utf8');
const dsrc = readFileSync(DATA, 'utf8');

// Extract a top-level `function name(...) { ... }` by brace-matching from game.js.
function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`FATAL: function ${name} not found in game.js — did the patch land?`);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) { i++; break; }
  }
  return src.slice(start, i);
}
// Pull a numeric `const NAME = <number>;` out of maze-data.js so tests bind to
// the real constant, not a guessed literal.
function constOf(src, name) {
  const m = src.match(new RegExp(`const ${name}\\s*=\\s*([0-9.]+)`));
  if (!m) throw new Error(`FATAL: const ${name} not found in maze-data.js`);
  return Number(m[1]);
}

const {
  hubReentryPoint, shadeStepFactor, catchupResolved, catchAllowed,
} = new Function(
  `${extractFn(gsrc, 'hubReentryPoint')}
   ${extractFn(gsrc, 'shadeStepFactor')}
   ${extractFn(gsrc, 'catchupResolved')}
   ${extractFn(gsrc, 'catchAllowed')}
   return { hubReentryPoint, shadeStepFactor, catchupResolved, catchAllowed };`
)();

const HUB_APO = constOf(dsrc, 'HUB_APO');
const MIN_GAP = constOf(dsrc, 'SHADE_MIN_REENTRY_GAP');
const RESOLVE = constOf(dsrc, 'SHADE_CATCHUP_RESOLVE_DIST');
const CATCHUP = constOf(dsrc, 'SHADE_CATCHUP_FACTOR');
const GRACE_MS = constOf(dsrc, 'SHADE_REENTRY_GRACE_MS');
const HUNTER_BASE = constOf(dsrc, 'HUNTER_SPEED_FACTOR');
const CATCH_RAD = 0.75;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

let pass = 0; const fails = [];
const check = (name, cond, detail) => cond ? pass++ : fails.push(`${name}${detail ? ` — ${detail}` : ''}`);

// ---- Part A: hubReentryPoint keeps the Shade off the player (the warp kill) ----

// 1 — player at hub center (the orb-warp case): must NOT land on the player.
{
  const p = { x: 0, z: 0 };
  const s = hubReentryPoint(p.x, p.z, HUB_APO);
  check('1 warp: gap >= MIN_GAP', dist(s, p) >= MIN_GAP, `gap=${dist(s, p).toFixed(2)}`);
  check('1 warp: gap > catch radius', dist(s, p) > CATCH_RAD, `gap=${dist(s, p).toFixed(2)}`);
  check('1 warp: inside hub', Math.hypot(s.x, s.z) <= HUB_APO, `r=${Math.hypot(s.x, s.z).toFixed(2)}`);
}

// 2 — player near a door edge (door-return case): still clear, and inside hub.
{
  const spawnDist = HUB_APO - 1.5;
  for (let deg = 0; deg < 360; deg += 15) {
    const a = deg * Math.PI / 180;
    const p = { x: Math.sin(a) * spawnDist, z: -Math.cos(a) * spawnDist };
    const s = hubReentryPoint(p.x, p.z, HUB_APO);
    check(`2 door@${deg}: gap>=MIN_GAP`, dist(s, p) >= MIN_GAP, `gap=${dist(s, p).toFixed(2)}`);
    check(`2 door@${deg}: inside hub`, Math.hypot(s.x, s.z) <= HUB_APO + 1e-9, `r=${Math.hypot(s.x, s.z).toFixed(2)}`);
    check(`2 door@${deg}: opposite side`, s.x * p.x + s.z * p.z <= 1e-9, 'not opposite');
  }
}

// 3 — a full sweep of player positions across the hub: invariant never violated.
{
  let worst = Infinity;
  for (let r = 0; r <= HUB_APO; r += 0.5) {
    for (let deg = 0; deg < 360; deg += 30) {
      const a = deg * Math.PI / 180;
      const p = { x: Math.sin(a) * r, z: -Math.cos(a) * r };
      const s = hubReentryPoint(p.x, p.z, HUB_APO);
      worst = Math.min(worst, dist(s, p));
    }
  }
  check('3 sweep: min gap over all positions >= MIN_GAP', worst >= MIN_GAP, `worst=${worst.toFixed(2)}`);
}

// ---- Part B: catch-up speed closes big gaps, then reverts (the door never-catch) ----

// 4 — trailing Shade moves faster than the player while catching up.
{
  check('4 catchup factor > base', shadeStepFactor(true, HUNTER_BASE, CATCHUP) > HUNTER_BASE);
  check('4 catchup factor == CATCHUP', shadeStepFactor(true, HUNTER_BASE, CATCHUP) === CATCHUP);
  check('4 resolved factor == base', shadeStepFactor(false, HUNTER_BASE, CATCHUP) === HUNTER_BASE);
}

// 5 — catch-up resolves exactly at proximity range, not before.
{
  check('5 far: not resolved', catchupResolved(RESOLVE + 0.01, RESOLVE) === false);
  check('5 at range: resolved', catchupResolved(RESOLVE, RESOLVE) === true);
  check('5 near: resolved', catchupResolved(0.5, RESOLVE) === true);
}

// 6 — simulation: a 39-unit maze gap actually closes under catch-up, and a
//     player fleeing in a straight line at base speed cannot outrun it.
{
  const MOVE = 5, dt = 1 / 60;
  let shadeX = 0, playerX = 39, catchup = true, frames = 0, resolved = false;
  for (; frames < 60 * 60; frames++) { // cap 60s
    const step = MOVE * shadeStepFactor(catchup, HUNTER_BASE, CATCHUP) * dt;
    shadeX += step;                 // shade chases +x
    playerX += MOVE * dt;           // player flees +x at full base speed
    const d = playerX - shadeX;
    if (catchup && catchupResolved(d, RESOLVE)) { catchup = false; resolved = true; break; }
  }
  check('6 catch-up closes a 39u gap to proximity range', resolved, `after ${frames} frames`);
  // and once resolved, base speed keeps a straight-line fleer at a constant gap
  // (fair chase, not an unwinnable teleport) — sanity, not a catch guarantee.
  check('6 base factor does not exceed player speed', HUNTER_BASE <= 1.0);
}

// ---- Part C: grace window blocks the same-frame catch ----

// 7 — on the materialization frame (now < graceUntil) the catch is suppressed
//     even when the Shade is on top of the player.
{
  const now = 1000, graceUntil = now + GRACE_MS;
  check('7 grace: no catch on materialization frame', catchAllowed(now, graceUntil, 0.0, CATCH_RAD, false) === false);
  check('7 grace: no catch mid-window', catchAllowed(now + GRACE_MS / 2, graceUntil, 0.0, CATCH_RAD, false) === false);
  check('7 catch resumes after window', catchAllowed(graceUntil, graceUntil, 0.0, CATCH_RAD, false) === true);
}

// 8 — grace does not break the normal catch: close + past grace + active => caught;
//     inactive-overlap or out-of-range => not.
{
  const now = 5000, expired = 0;
  check('8 caught when close, active, past grace', catchAllowed(now, expired, 0.5, CATCH_RAD, false) === true);
  check('8 not caught out of range', catchAllowed(now, expired, 1.0, CATCH_RAD, false) === false);
  check('8 not caught while inactive-overlap', catchAllowed(now, expired, 0.5, CATCH_RAD, true) === false);
}

console.log(`\nshade re-entry (#13) tests: ${pass} passed, ${fails.length} failed`);
if (fails.length) { console.log('\nFAILURES:'); for (const f of fails) console.log(`  ✗ ${f}`); process.exit(1); }
console.log('all green');
