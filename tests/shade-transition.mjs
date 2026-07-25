// Behavioral end-to-end test for issue #13 — drives the REAL game in headless
// Chrome and reproduces the two repro paths from the issue, asserting the
// symptom is gone. Complements tests/shade-reentry.mjs (pure-helper unit tests):
// that proves the math, this proves the lived outcome in the running engine.
//
// The game keeps all state in module-closure scope and exposes nothing on
// window, so a driver can't observe the Shade. Rather than add a permanent hook
// to the shipped game.js, this test's static server appends a small
// introspection hook to game.js IN FLIGHT — it lands inside the module scope, so
// it can read/drive activeShade, playerPos, etc., and the committed file stays
// clean. The hook is only ever present in this test's served copy.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const GAME_REL = `${sep}maze${sep}game.js`;
const TIMEOUT_MS = 60_000;
const MIME = new Map([
    ['.css', 'text/css; charset=utf-8'], ['.html', 'text/html; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
    ['.svg', 'image/svg+xml'], ['.woff2', 'font/woff2'],
]);

// Appended to game.js in module scope. Reads and drives the closure state the
// fix touches; nothing here runs unless the test calls it.
const HOOK = `
;window.__shadeTest = (() => {
  const st = () => {
    const s = activeShade;
    const hasPos = s && typeof s.x === 'number' && typeof s.z === 'number';
    return {
      gameState, playerInMaze, room: currentRoomId,
      locked: !!(typeof controls !== 'undefined' && controls && controls.isLocked),
      player: { x: playerPos.x, z: playerPos.z },
      shade: s ? { mode: s.mode, x: s.x ?? null, z: s.z ?? null, catchup: !!s.catchup } : null,
      dist: hasPos ? Math.hypot(playerPos.x - s.x, playerPos.z - s.z) : null,
      msg: (document.getElementById('eventMessage') || {}).textContent || '',
    };
  };
  return {
    consts: { LAG: SHADE_LAG_MS, RESOLVE: SHADE_CATCHUP_RESOLVE_DIST, HUB_APO },
    state: st,
    // An awake hub Shade, so a transition has a pursuer to carry into lag mode.
    plantHubShade(x = 2.5, z = 2.5) {
      if (activeShade && activeShade.visual) { scene.remove(activeShade.visual); disposeObjectTree(activeShade.visual); }
      activeShade = { mode: 'hub', grid: null, cell: null, targetCell: null, x, z, visual: makeShadeVisual() };
      activeShade.visual.position.set(x, 0, z);
      scene.add(activeShade.visual);
      return st();
    },
    // Reproduce an orb warp: enterHub with no fromRoom drops the player at (0,0)
    // and converts the pursuing Shade to lag — exactly the warp path.
    warp() { enterHub(currentRoomId); return st(); },
    clearShade() {
      if (activeShade && activeShade.visual) { scene.remove(activeShade.visual); disposeObjectTree(activeShade.visual); }
      activeShade = null;
      const m = document.getElementById('eventMessage'); if (m) m.textContent = '';
      return st();
    },
    // Reproduce a door-exit: attach a real maze, drop the player at its farthest
    // cell, and spawn a lag Shade due to materialize at the entrance far behind.
    enterMazeDeep() {
      const nav = roomNavigation[currentRoomId] || {};
      const dir = Object.keys(nav)[0];
      if (!dir) return { ok: false, reason: 'no navigable direction from ' + currentRoomId };
      attachMaze(dir);
      const grid = attachedMazeGrid;
      if (!grid || !grid.cells || !grid.entranceCell) return { ok: false, reason: 'no maze attached' };
      const ew = mazeLocalToWorld(grid.entranceCell.center.x, grid.entranceCell.center.z);
      let far = grid.entranceCell, farD = 0;
      for (const c of grid.cells) {
        if (!c.center) continue;
        const w = mazeLocalToWorld(c.center.x, c.center.z);
        const d = Math.hypot(w.x - ew.x, w.z - ew.z);
        if (d > farD) { farD = d; far = c; }
      }
      const fw = mazeLocalToWorld(far.center.x, far.center.z);
      playerPos.x = fw.x; playerPos.z = fw.z;
      trackedPos.x = fw.x; trackedPos.z = fw.z;
      playerInMaze = true;
      if (activeShade && activeShade.visual) { scene.remove(activeShade.visual); disposeObjectTree(activeShade.visual); }
      activeShade = { mode: 'lag', lagUntil: performance.now(), grid: null, cell: null, targetCell: null, visual: null };
      const m = document.getElementById('eventMessage'); if (m) m.textContent = '';  // so a fresh SEIZE is detectable
      return { ok: true, entranceGap: farD };
    },
  };
})();
`;

function deferred() {
    let resolvePromise, rejectPromise;
    const promise = new Promise((res, rej) => { resolvePromise = res; rejectPromise = rej; });
    return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function startStaticServer() {
    const server = createServer(async (request, response) => {
        try {
            const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
            const relative = normalize(pathname).replace(/^[/\\]+/, '');
            let target = resolve(ROOT, relative);
            if (target !== ROOT && !target.startsWith(ROOT + sep)) throw new Error('path traversal');
            if (statSync(target).isDirectory()) target = join(target, 'index.html');
            // Serve game.js with the introspection hook appended (module scope).
            if (target.endsWith(GAME_REL)) {
                const src = await readFile(target, 'utf8');
                response.writeHead(200, { 'Content-Type': MIME.get('.js'), 'Cache-Control': 'no-store' });
                response.end(src + HOOK);
                return;
            }
            const type = MIME.get(extname(target)) || 'application/octet-stream';
            response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
            createReadStream(target).pipe(response);
        } catch {
            response.writeHead(404).end('Not found');
        }
    });
    return new Promise((res, rej) => { server.once('error', rej); server.listen(0, '127.0.0.1', () => res(server)); });
}

async function connectWebSocket(url) {
    const socket = new WebSocket(url);
    await new Promise((res, rej) => {
        socket.addEventListener('open', res, { once: true });
        socket.addEventListener('error', () => rej(new Error(`WebSocket failed: ${url}`)), { once: true });
    });
    return socket;
}

class CdpSession {
    constructor(socket) {
        this.socket = socket; this.nextId = 1; this.pending = new Map(); this.listeners = new Map();
        socket.addEventListener('message', event => {
            const message = JSON.parse(event.data);
            if (message.id) {
                const pending = this.pending.get(message.id);
                if (pending) {
                    this.pending.delete(message.id);
                    message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
                }
            } else if (message.method) {
                for (const listener of this.listeners.get(message.method) || []) listener(message.params);
            }
        });
    }
    call(method, params = {}) {
        const id = this.nextId++;
        this.socket.send(JSON.stringify({ id, method, params }));
        return new Promise((res, rej) => this.pending.set(id, { resolve: res, reject: rej }));
    }
    on(method, listener) {
        if (!this.listeners.has(method)) this.listeners.set(method, []);
        this.listeners.get(method).push(listener);
    }
    close() { this.socket.close(); }
}

async function ev26(session, expr) {
    const r = await session.call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`page eval threw: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
}

async function waitFor(session, expr, description, timeout = 15_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (await ev26(session, expr)) return true;
        await new Promise(r => setTimeout(r, 80));
    }
    throw new Error(`Timed out waiting for ${description}`);
}

// Poll __shadeTest.state() every ~40ms until predicate(state) is true; returns
// the full sample trail. Used to catch the materialization frame precisely.
async function sample(session, predicate, description, timeout = 9_000) {
    const deadline = Date.now() + timeout;
    const trail = [];
    while (Date.now() < deadline) {
        const s = await ev26(session, 'window.__shadeTest.state()');
        trail.push(s);
        if (predicate(s, trail)) return trail;
        await new Promise(r => setTimeout(r, 40));
    }
    throw new Error(`Timed out: ${description}. last=${JSON.stringify(trail[trail.length - 1])}`);
}

async function run() {
    const server = await startStaticServer();
    const pageUrl = `http://127.0.0.1:${server.address().port}/maze/?test=features`;
    const profile = await mkdtemp(join(tmpdir(), 'maze-shade-'));
    const browserReady = deferred();
    const browser = spawn(process.env.CHROME_BIN || 'google-chrome', [
        '--headless=new', '--no-sandbox', '--disable-gpu-sandbox', '--disable-extensions',
        '--disable-background-networking', '--enable-unsafe-swiftshader', '--no-first-run',
        '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    let stderr = '';
    browser.stderr.setEncoding('utf8');
    browser.stderr.on('data', chunk => {
        stderr += chunk;
        const m = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (m) browserReady.resolve(m[1]);
    });
    browser.once('error', browserReady.reject);
    browser.once('exit', code => { if (code) browserReady.reject(new Error(`Chrome exited ${code}: ${stderr}`)); });

    let session;
    const results = [];
    try {
        const browserWs = await Promise.race([
            browserReady.promise,
            new Promise((_, rej) => setTimeout(() => rej(new Error('Chrome did not expose DevTools')), 10_000)),
        ]);
        const endpoint = new URL(browserWs);
        const targets = await fetch(`http://${endpoint.host}/json/list`).then(r => r.json());
        const page = targets.find(t => t.type === 'page');
        if (!page) throw new Error('no page target');
        session = new CdpSession(await connectWebSocket(page.webSocketDebuggerUrl));

        const pageErrors = [];
        session.on('Runtime.exceptionThrown', ({ exceptionDetails }) =>
            pageErrors.push(exceptionDetails.exception?.description || exceptionDetails.text));
        await session.call('Runtime.enable');
        await session.call('Page.enable');
        await session.call('Page.navigate', { url: pageUrl });

        // Ready (feature-test seed) + hook present.
        await waitFor(session,
            `document.documentElement.dataset.mazeReady === 'true' && !!window.__shadeTest`,
            'maze ready + test hook', 20_000);

        // Acquire pointer lock — updateHunter only runs when locked & in HUB.
        const blocker = await ev26(session, `(() => {
            const p = document.querySelector('#blocker > p'); if (!p) return null;
            const r = p.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        })()`);
        assert.ok(blocker, 'blocker prompt not found');
        await session.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: blocker.x, y: blocker.y, button: 'left', clickCount: 1 });
        await session.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: blocker.x, y: blocker.y, button: 'left', clickCount: 1 });
        await waitFor(session,
            `document.getElementById('blocker').classList.contains('hidden') && document.pointerLockElement === document.body`,
            'pointer lock', 10_000);

        const consts = await ev26(session, 'window.__shadeTest.consts');

        // ================= SCENARIO 1 — orb warp no longer instant-kills =========
        // Old bug: Shade re-enters at hub centre (0,0) where the warp drops you,
        // and the catch fires on the materialization frame. Fixed: it re-enters
        // a fair distance away and the grace window blocks a same-frame catch.
        await ev26(session, 'window.__shadeTest.plantHubShade()');
        const warpState = await ev26(session, 'window.__shadeTest.warp()');
        assert.equal(warpState.shade.mode, 'lag', 'warp should carry the Shade into lag mode');

        // Catch the first materialized frame (mode flips lag -> hub).
        const warpTrail = await sample(session,
            s => s.shade && s.shade.mode !== 'lag' && s.dist != null,
            'warp Shade to materialize', consts.LAG + 6_000);
        const seizedBeforeMat = warpTrail.some(s => /SEIZED/.test(s.msg));
        const atMat = warpTrail[warpTrail.length - 1];

        assert.equal(seizedBeforeMat, false,
            `WARP REGRESSION: player was SEIZED on/at materialization — the instant-death bug. trail=${JSON.stringify(warpTrail.map(s => ({ m: s.shade?.mode, d: s.dist?.toFixed?.(2), msg: s.msg })).slice(-6))}`);
        assert.ok(atMat.dist > 0.75,
            `WARP REGRESSION: Shade materialized within catch radius (dist=${atMat.dist?.toFixed(3)}) — on top of the player`);
        assert.ok(atMat.dist >= 3.0,
            `WARP: materialization gap ${atMat.dist?.toFixed(2)} below the ~${(consts.HUB_APO - 0.8).toFixed(1)} the fix guarantees`);
        assert.ok(/CAME THROUGH/.test(atMat.msg) || atMat.msg === '',
            `WARP: expected "IT CAME THROUGH" (or no message), got "${atMat.msg}"`);
        results.push(`WARP: no instant-death — Shade materialized ${atMat.dist.toFixed(2)}u away (catch radius 0.75), no SEIZE on the frame.`);

        // Stop the (correct) post-materialization pursuit of the now-stationary
        // test player so it can't bleed a SEIZE into the next scenario.
        await ev26(session, 'window.__shadeTest.clearShade()');

        // ================= SCENARIO 2 — door exit no longer loses the Shade ======
        // Old bug: Shade re-enters at the entrance ~39u back and, at 1.0x speed,
        // never closes the gap; the veil stays at 0 and it never catches.
        // Fixed: post-transition catch-up (unseen, beyond veil range) closes the
        // gap. The symptom's exact negation, so we assert the OUTCOME — the gap
        // demonstrably closes and the Shade reaches the player — rather than a
        // particular sampled frame (the close can be faster than the poll).
        const deep = await ev26(session, 'window.__shadeTest.enterMazeDeep()');
        assert.ok(deep.ok, `door setup failed: ${deep.reason}`);
        assert.ok(deep.entranceGap > consts.RESOLVE,
            `door setup: entrance gap ${deep.entranceGap?.toFixed(1)} not larger than catch-up range ${consts.RESOLVE} — pick a deeper maze`);

        // Poll the outcome. Success = the gap closed (a sample below the initial
        // gap, or into proximity range) OR the Shade reached the player (fresh
        // SEIZE / it caught + was destroyed after having been far). Under the old
        // bug none of these happen: the Shade sits ~entranceGap away forever.
        let sawFar = false, minDist = Infinity, sawCatchup = false, outcome = null;
        try {
            const trail = await sample(session, s => {
                if (s.shade && s.shade.mode === 'maze') { sawFar = sawFar || s.dist > consts.RESOLVE; sawCatchup = sawCatchup || s.shade.catchup === true; }
                if (s.dist != null) minDist = Math.min(minDist, s.dist);
                if (/SEIZED/.test(s.msg)) { outcome = 'caught'; return true; }
                if (s.dist != null && s.dist <= consts.RESOLVE) { outcome = 'closed-to-range'; return true; }
                if (s.dist != null && s.dist < deep.entranceGap - 4) { outcome = 'closing'; return true; }
                return false;
            }, 'maze Shade to close a large gap', 12_000);
            void trail;
        } catch (e) {
            throw new Error(`DOOR REGRESSION: over 12s the ${deep.entranceGap.toFixed(1)}u gap never closed `
                + `(min observed ${Number.isFinite(minDist) ? minDist.toFixed(1) : 'n/a'}u) — the never-catches bug. ${e.message}`);
        }
        assert.ok(outcome, 'door outcome unresolved');
        const detail = outcome === 'caught'
            ? `Shade closed from ${deep.entranceGap.toFixed(1)}u and reached the player`
            : `Shade closed the gap from ${deep.entranceGap.toFixed(1)}u to ${minDist.toFixed(1)}u`;
        results.push(`DOOR: ${detail}${sawCatchup ? ' (catch-up observed engaged)' : ''} — it now follows through doors instead of stalling ${deep.entranceGap.toFixed(0)}u back.`);

        if (pageErrors.length) throw new Error(`page errors during run:\n${pageErrors.join('\n')}`);

        console.log('\nShade transition behaviour (#13):');
        for (const r of results) console.log(`  ✓ ${r}`);
        console.log('all green — both repro paths verified in the running engine.');
    } finally {
        session?.close();
        server.close();
        if (browser.exitCode === null) { const ex = once(browser, 'exit'); browser.kill('SIGTERM'); await Promise.race([ex, new Promise(r => setTimeout(r, 5_000))]); }
        if (browser.exitCode === null) { const ex = once(browser, 'exit'); browser.kill('SIGKILL'); await ex; }
        await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
}

const guard = setTimeout(() => { console.error(`hard timeout after ${TIMEOUT_MS}ms`); process.exit(1); }, TIMEOUT_MS).unref?.() ?? null;
run().then(() => { if (guard) clearTimeout(guard); }).catch(error => { console.error(error.stack || error); process.exitCode = 1; });
