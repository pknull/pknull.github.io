import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const TIMEOUT_MS = 30_000;
const MIME = new Map([
    ['.css', 'text/css; charset=utf-8'],
    ['.html', 'text/html; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.svg', 'image/svg+xml'],
    ['.woff2', 'font/woff2']
]);

function deferred() {
    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolveValue, rejectValue) => {
        resolvePromise = resolveValue;
        rejectPromise = rejectValue;
    });
    return {promise, resolve: resolvePromise, reject: rejectPromise};
}

function startStaticServer() {
    const server = createServer((request, response) => {
        try {
            const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
            const relative = normalize(pathname).replace(/^[/\\]+/, '');
            let target = resolve(ROOT, relative);
            if (target !== ROOT && !target.startsWith(ROOT + sep)) throw new Error('path traversal');
            if (statSync(target).isDirectory()) target = join(target, 'index.html');
            const type = MIME.get(extname(target)) || 'application/octet-stream';
            response.writeHead(200, {'Content-Type': type, 'Cache-Control': 'no-store'});
            createReadStream(target).pipe(response);
        } catch {
            response.writeHead(404).end('Not found');
        }
    });
    return new Promise((resolveServer, rejectServer) => {
        server.once('error', rejectServer);
        server.listen(0, '127.0.0.1', () => resolveServer(server));
    });
}

async function connectWebSocket(url) {
    const socket = new WebSocket(url);
    await new Promise((resolveSocket, rejectSocket) => {
        socket.addEventListener('open', resolveSocket, {once: true});
        socket.addEventListener('error', () => rejectSocket(new Error(`WebSocket connection failed: ${url}`)), {once: true});
    });
    return socket;
}

class CdpSession {
    constructor(socket) {
        this.socket = socket;
        this.nextId = 1;
        this.pending = new Map();
        this.listeners = new Map();
        socket.addEventListener('message', event => {
            const message = JSON.parse(event.data);
            if (message.id) {
                const pending = this.pending.get(message.id);
                if (!pending) return;
                this.pending.delete(message.id);
                if (message.error) pending.reject(new Error(message.error.message));
                else pending.resolve(message.result);
                return;
            }
            for (const listener of this.listeners.get(message.method) || []) listener(message.params);
        });
    }

    call(method, params = {}) {
        const id = this.nextId++;
        const pending = deferred();
        this.pending.set(id, pending);
        this.socket.send(JSON.stringify({id, method, params}));
        return pending.promise;
    }

    on(method, listener) {
        if (!this.listeners.has(method)) this.listeners.set(method, []);
        this.listeners.get(method).push(listener);
    }

    close() {
        this.socket.close();
    }
}

async function waitFor(session, expression, description, timeout = TIMEOUT_MS) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const result = await session.call('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise: true
        });
        if (result.result.value) return result.result.value;
        await new Promise(resolveWait => setTimeout(resolveWait, 100));
    }
    throw new Error(`Timed out waiting for ${description}`);
}

async function readCameraPosition(session) {
    const group = 'maze-smoke-camera';
    try {
        const prototype = await session.call('Runtime.evaluate', {
            expression: `(async () => (await import('three')).PerspectiveCamera.prototype)()`,
            awaitPromise: true,
            objectGroup: group
        });
        const instances = await session.call('Runtime.queryObjects', {
            prototypeObjectId: prototype.result.objectId,
            objectGroup: group
        });
        const position = await session.call('Runtime.callFunctionOn', {
            objectId: instances.objects.objectId,
            functionDeclaration: `function() {
                const camera = this.find(value => value?.isPerspectiveCamera);
                return camera ? {x: camera.position.x, y: camera.position.y, z: camera.position.z} : null;
            }`,
            returnByValue: true
        });
        assert.ok(position.result.value, 'Perspective camera was not found');
        return position.result.value;
    } finally {
        await session.call('Runtime.releaseObjectGroup', {objectGroup: group});
    }
}

async function run() {
    const server = await startStaticServer();
    const address = server.address();
    const pageUrl = `http://127.0.0.1:${address.port}/maze/`;
    const profile = await mkdtemp(join(tmpdir(), 'maze-smoke-'));
    const browserReady = deferred();
    const browser = spawn(process.env.CHROME_BIN || 'google-chrome', [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu-sandbox',
        '--disable-extensions',
        '--disable-background-networking',
        '--enable-unsafe-swiftshader',
        '--no-first-run',
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        'about:blank'
    ], {stdio: ['ignore', 'ignore', 'pipe']});

    let stderr = '';
    browser.stderr.setEncoding('utf8');
    browser.stderr.on('data', chunk => {
        stderr += chunk;
        const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) browserReady.resolve(match[1]);
    });
    browser.once('error', browserReady.reject);
    browser.once('exit', code => {
        if (code !== null && code !== 0) browserReady.reject(new Error(`Chrome exited with ${code}: ${stderr}`));
    });

    let session;
    try {
        const browserWs = await Promise.race([
            browserReady.promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Chrome did not expose DevTools')), 10_000))
        ]);
        const endpoint = new URL(browserWs);
        const targets = await fetch(`http://${endpoint.host}/json/list`).then(response => response.json());
        const page = targets.find(target => target.type === 'page');
        if (!page) throw new Error('Chrome exposed no page target');

        session = new CdpSession(await connectWebSocket(page.webSocketDebuggerUrl));
        const errors = [];
        session.on('Runtime.exceptionThrown', ({exceptionDetails}) => {
            errors.push(exceptionDetails.exception?.description || exceptionDetails.text);
        });
        session.on('Runtime.consoleAPICalled', event => {
            if (event.type === 'error' || event.type === 'assert') {
                errors.push(event.args.map(argument => argument.value || argument.description).join(' '));
            }
        });
        await session.call('Runtime.enable');
        await session.call('Page.enable');
        await session.call('Page.navigate', {url: pageUrl});

        const state = await waitFor(session, `(() => {
            const date = document.getElementById('optDate')?.value;
            const seed = document.getElementById('seedLine')?.textContent;
            if (document.documentElement.dataset.mazeReady !== 'true' || !date || seed !== 'DAILY ' + date || document.querySelectorAll('canvas').length < 2) return null;
            const target = document.querySelector('#blocker > p');
            const rect = target.getBoundingClientRect();
            return {date, seed, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
        })()`, 'maze initialization');

        if (errors.length) throw new Error(`JavaScript errors during initialization:\n${errors.join('\n')}`);

        const frozenPrototypes = await session.call('Runtime.evaluate', {
            expression: `(async () => {
                const T = await import('three');
                return Object.isFrozen(T.Object3D.prototype)
                    && Object.isFrozen(T.Vector3.prototype)
                    && Object.isFrozen(T.Euler.prototype)
                    && Object.isFrozen(T.PerspectiveCamera.prototype);
            })()`,
            returnByValue: true,
            awaitPromise: true
        });
        assert.equal(frozenPrototypes.result.value, true, 'Three.js gameplay prototypes must be frozen');

        await session.call('Input.dispatchMouseEvent', {
            type: 'mousePressed', x: state.x, y: state.y, button: 'left', clickCount: 1
        });
        await session.call('Input.dispatchMouseEvent', {
            type: 'mouseReleased', x: state.x, y: state.y, button: 'left', clickCount: 1
        });
        await waitFor(session,
            `document.getElementById('blocker').classList.contains('hidden') && document.pointerLockElement === document.body`,
            'entry interaction', 10_000);

        const positionBeforeSyntheticInput = await readCameraPosition(session);
        await session.call('Runtime.evaluate', {
            expression: `(async () => {
                document.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyW'}));
                await new Promise(resolveFrames => {
                    let frames = 0;
                    const nextFrame = () => {
                        frames++;
                        if (frames === 6) resolveFrames();
                        else requestAnimationFrame(nextFrame);
                    };
                    requestAnimationFrame(nextFrame);
                });
                document.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyW'}));
            })()`,
            awaitPromise: true
        });
        const positionAfterSyntheticInput = await readCameraPosition(session);
        assert.deepEqual(positionAfterSyntheticInput, positionBeforeSyntheticInput,
            'Synthetic keyboard input must not move the player');

        if (errors.length) throw new Error(`JavaScript errors after entry:\n${errors.join('\n')}`);
        console.log(`Maze smoke passed: ${state.seed}; prototypes frozen, synthetic input rejected, entry acquired pointer lock.`);
    } finally {
        session?.close();
        server.close();
        if (browser.exitCode === null) {
            const exited = once(browser, 'exit');
            browser.kill('SIGTERM');
            await Promise.race([exited, new Promise(resolveWait => setTimeout(resolveWait, 5_000))]);
        }
        if (browser.exitCode === null) {
            const exited = once(browser, 'exit');
            browser.kill('SIGKILL');
            await exited;
        }
        await rm(profile, {recursive: true, force: true, maxRetries: 10, retryDelay: 200});
    }
}

run().catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
