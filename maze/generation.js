import {
    CELL,
    DEFAULT_MAZE_LAW,
    HUNTER_BASE_CHANCE,
    HUNTER_TESSERACT_CHANCE,
    getTess,
    getTesseractLaw,
    scatterPool
} from './maze-data.js';

// ===== PRNG =====
function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

class Rng {
    constructor(seed) { this.state = seed || 1; }
    next() {
        this.state ^= this.state << 13;
        this.state ^= this.state >> 17;
        this.state ^= this.state << 5;
        this.state = this.state >>> 0;
        return this.state / 0x100000000;
    }
    nextInt(min, max) { return min + Math.floor(this.next() * (max - min + 1)); }
    pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
    shuffle(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(this.next() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }
}

// ===== MAZE GENERATION =====
class MazeGrid {
    constructor(w, h, rng) {
        this.w = w; this.h = h; this.rng = rng;
        this.cells = [];
        for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++)
                this.cells.push({
                    x, y, N:true, S:true, E:true, W:true, visited:false,
                    chamber:null, chamberId:null, chamberCenter:false,
                    trap:false, trapDest:null,
                    rotating:false,
                    oneWayBlocked:{N:false,S:false,E:false,W:false}
                });
        this.entranceCell = null;
        this.exitCell = null;
        this.spaceFold = null;
        this.oneWayGates = [];
        this.rotatingChamber = null;
        this.spatialLoop = null;
        this.guidePath = null;
        this.hunter = null;
    }
    cell(x, y) {
        if (x < 0 || x >= this.w || y < 0 || y >= this.h) return null;
        return this.cells[y * this.w + x];
    }
    removeWall(a, b) {
        if (a.x < b.x) { a.E = false; b.W = false; }
        else if (a.x > b.x) { a.W = false; b.E = false; }
        else if (a.y < b.y) { a.S = false; b.N = false; }
        else if (a.y > b.y) { a.N = false; b.S = false; }
    }
    unvisitedNeighbors(c) {
        const n = [];
        const dirs = [{dx:0,dy:-1},{dx:1,dy:0},{dx:0,dy:1},{dx:-1,dy:0}];
        for (const d of dirs) {
            const nb = this.cell(c.x + d.dx, c.y + d.dy);
            if (nb && !nb.visited) n.push(nb);
        }
        return n;
    }
    generate(bias) {
        const stack = [];
        const start = this.cell(0, 0);
        start.visited = true;
        stack.push(start);
        while (stack.length > 0) {
            const cur = stack[stack.length - 1];
            const nb = this.unvisitedNeighbors(cur);
            if (nb.length === 0) { stack.pop(); continue; }
            let chosen;
            if (bias > 0 && stack.length > 1) {
                const prev = stack[stack.length - 2];
                const dx = cur.x - prev.x, dy = cur.y - prev.y;
                const straight = nb.find(n => n.x - cur.x === dx && n.y - cur.y === dy);
                chosen = (straight && this.rng.next() < bias) ? straight : this.rng.pick(nb);
            } else {
                chosen = this.rng.pick(nb);
            }
            this.removeWall(cur, chosen);
            chosen.visited = true;
            stack.push(chosen);
        }
    }
    addLoops(factor) {
        const count = Math.floor(this.w * this.h * factor);
        const offsets = [{dx:0,dy:-1,w:'N'},{dx:1,dy:0,w:'E'},{dx:0,dy:1,w:'S'},{dx:-1,dy:0,w:'W'}];
        for (let i = 0; i < count; i++) {
            const x = this.rng.nextInt(0, this.w - 1);
            const y = this.rng.nextInt(0, this.h - 1);
            const c = this.cell(x, y);
            const o = this.rng.pick(offsets);
            const nb = this.cell(x + o.dx, y + o.dy);
            if (nb) this.removeWall(c, nb);
        }
    }
    removeDeadEnds(removalRate) {
        let changed = true;
        while (changed) {
            changed = false;
            for (const c of this.cells) {
                if (c === this.entranceCell || c === this.exitCell) continue;
                if (c.chamber) continue;
                // Count open walls (passages)
                let openCount = 0;
                if (!c.N) openCount++;
                if (!c.S) openCount++;
                if (!c.E) openCount++;
                if (!c.W) openCount++;
                if (openCount !== 1) continue; // not a dead end
                if (this.rng.next() > removalRate) continue;
                // Fill in the single opening to remove dead end
                if (!c.N) { c.N = true; const nb = this.cell(c.x, c.y - 1); if (nb) nb.S = true; }
                else if (!c.S) { c.S = true; const nb = this.cell(c.x, c.y + 1); if (nb) nb.N = true; }
                else if (!c.E) { c.E = true; const nb = this.cell(c.x + 1, c.y); if (nb) nb.W = true; }
                else if (!c.W) { c.W = true; const nb = this.cell(c.x - 1, c.y); if (nb) nb.E = true; }
                changed = true;
            }
        }
    }
    setEntranceExit() {
        const ey = Math.floor(this.h / 2);
        this.entranceCell = this.cell(0, ey);
        this.entranceCell.W = false;
        const ex = this.w - 1;
        this.exitCell = this.cell(ex, ey);
        this.exitCell.E = false;
    }
    addSpaceFold() {
        const reserved = new Set([
            ...this.oneWayGates.flatMap(gate => [gate.from, gate.to]),
            this.rotatingChamber?.entry,
            this.rotatingChamber?.cell,
            this.rotatingChamber?.exit,
            this.spatialLoop?.a,
            this.spatialLoop?.b
        ].filter(Boolean));
        const northCandidates = [], southCandidates = [];
        for (let x = 1; x < this.w - 1; x++) {
            const north = this.cell(x, 0), south = this.cell(x, this.h - 1);
            if (!reserved.has(north)) northCandidates.push(north);
            if (!reserved.has(south)) southCandidates.push(south);
        }
        const north = this.rng.pick(northCandidates);
        let south = this.rng.pick(southCandidates);
        if (!north || !south) return false;
        if (south.x === north.x && southCandidates.length > 1) {
            south = southCandidates.find(cell => cell.x !== north.x) || south;
        }
        north.N = false;
        south.S = false;
        this.spaceFold = {north, south};
        return true;
    }
    passageDirection(a, b) {
        if (b.x > a.x) return 'E';
        if (b.x < a.x) return 'W';
        if (b.y > a.y) return 'S';
        if (b.y < a.y) return 'N';
        return null;
    }
    setWallBetween(a, b, closed) {
        const direction = this.passageDirection(a, b);
        const opposite = {N:'S',S:'N',E:'W',W:'E'}[direction];
        if (!direction || !opposite) return;
        a[direction] = closed;
        b[opposite] = closed;
    }
    findPath(start = this.entranceCell, target = this.exitCell, {
        respectOneWay = true,
        includeSpatialLoop = true,
        includeSpaceFold = true,
        excludeEdge = null
    } = {}) {
        if (!start || !target) return [];
        const previous = new Map([[start, null]]);
        const queue = [start];
        const dirs = [
            {dx:0,dy:-1,w:'N'}, {dx:1,dy:0,w:'E'},
            {dx:0,dy:1,w:'S'}, {dx:-1,dy:0,w:'W'}
        ];
        const isExcluded = (a, b) => excludeEdge && (
            (a === excludeEdge[0] && b === excludeEdge[1]) ||
            (a === excludeEdge[1] && b === excludeEdge[0])
        );
        while (queue.length > 0) {
            const cur = queue.shift();
            if (cur === target) {
                const path = [];
                for (let cell = target; cell; cell = previous.get(cell)) path.unshift(cell);
                return path;
            }
            for (const d of dirs) {
                if (cur[d.w] || (respectOneWay && cur.oneWayBlocked[d.w])) continue;
                const next = this.cell(cur.x + d.dx, cur.y + d.dy);
                if (!next || isExcluded(cur, next) || previous.has(next)) continue;
                previous.set(next, cur);
                queue.push(next);
            }
            if (includeSpatialLoop && this.spatialLoop) {
                const next = cur === this.spatialLoop.a ? this.spatialLoop.b
                    : cur === this.spatialLoop.b ? this.spatialLoop.a : null;
                if (next && !previous.has(next)) {
                    previous.set(next, cur);
                    queue.push(next);
                }
            }
            if (includeSpaceFold && this.spaceFold) {
                const next = cur === this.spaceFold.north ? this.spaceFold.south
                    : cur === this.spaceFold.south ? this.spaceFold.north : null;
                if (next && !previous.has(next)) {
                    previous.set(next, cur);
                    queue.push(next);
                }
            }
        }
        return [];
    }
    reachableFrom(start, options = {}) {
        const reached = new Set();
        if (!start) return reached;
        const queue = [start];
        reached.add(start);
        const dirs = [
            {dx:0,dy:-1,w:'N'}, {dx:1,dy:0,w:'E'},
            {dx:0,dy:1,w:'S'}, {dx:-1,dy:0,w:'W'}
        ];
        while (queue.length > 0) {
            const cur = queue.shift();
            for (const d of dirs) {
                if (cur[d.w] || (options.respectOneWay !== false && cur.oneWayBlocked[d.w])) continue;
                const next = this.cell(cur.x + d.dx, cur.y + d.dy);
                if (!next || reached.has(next)) continue;
                reached.add(next);
                queue.push(next);
            }
            if (options.includeSpatialLoop !== false && this.spatialLoop) {
                const next = cur === this.spatialLoop.a ? this.spatialLoop.b
                    : cur === this.spatialLoop.b ? this.spatialLoop.a : null;
                if (next && !reached.has(next)) { reached.add(next); queue.push(next); }
            }
            if (options.includeSpaceFold !== false && this.spaceFold) {
                const next = cur === this.spaceFold.north ? this.spaceFold.south
                    : cur === this.spaceFold.south ? this.spaceFold.north : null;
                if (next && !reached.has(next)) { reached.add(next); queue.push(next); }
            }
        }
        return reached;
    }
    edgeSeparatesEntranceExit(a, b) {
        return this.findPath(this.entranceCell, this.exitCell, {
            respectOneWay:false,
            includeSpatialLoop:false,
            excludeEdge:[a, b]
        }).length === 0;
    }
    installOneWayGate(from, to, required) {
        const blockedDirection = this.passageDirection(to, from);
        const allowedDirection = this.passageDirection(from, to);
        to.oneWayBlocked[blockedDirection] = true;
        this.oneWayGates.push({from, to, allowedDirection, blockedDirection, required});
    }
    placeOneWayGates(count, required = false) {
        if (count <= 0 || !this.entranceCell) return;

        if (required) {
            const path = this.findPath();
            const requiredCandidates = [];
            for (let i = 1; i < path.length - 2; i++) {
                const from = path[i], to = path[i + 1];
                if (from.chamber || to.chamber || this.edgeSeparatesEntranceExit(from, to) === false) continue;
                requiredCandidates.push([from, to]);
            }
            if (requiredCandidates.length > 0) {
                const [from, to] = this.rng.pick(requiredCandidates);
                this.installOneWayGate(from, to, true);
                return;
            }
        }

        // Catalogue only passages reachable from the entrance. A gate is
        // eligible only when removing its edge leaves another route between
        // its cells, so changing it to one-way cannot strand the player.
        const reachable = this.reachableFrom(this.entranceCell, {respectOneWay:false, includeSpatialLoop:false});

        const candidates = [];
        for (const cell of reachable) {
            if (cell === this.entranceCell || cell === this.exitCell || cell.chamber) continue;
            for (const {dx,dy,w} of [{dx:1,dy:0,w:'E'},{dx:0,dy:1,w:'S'}]) {
                if (cell[w]) continue;
                const next = this.cell(cell.x + dx, cell.y + dy);
                if (!next || !reachable.has(next) || next === this.entranceCell || next === this.exitCell || next.chamber) continue;
                candidates.push([cell, next]);
            }
        }

        for (const [first, second] of this.rng.shuffle(candidates)) {
            if (this.oneWayGates.length >= count) break;
            if (!this.findPath(first, second, {respectOneWay:false, includeSpatialLoop:false, excludeEdge:[first, second]}).length) continue;
            const [from, to] = this.rng.next() < 0.5 ? [first, second] : [second, first];
            this.installOneWayGate(from, to, false);
        }
    }
    placeOneWayOnPath(path = this.findPath()) {
        const reserved = new Set([
            this.spatialLoop?.a,
            this.spatialLoop?.b,
            this.rotatingChamber?.entry,
            this.rotatingChamber?.cell,
            this.rotatingChamber?.exit
        ].filter(Boolean));
        const candidates = [];
        for (let i = 1; i < path.length - 2; i++) {
            const from = path[i], to = path[i + 1];
            if (Math.abs(from.x - to.x) + Math.abs(from.y - to.y) !== 1) continue;
            if (from.chamber || to.chamber || reserved.has(from) || reserved.has(to)) continue;
            candidates.push([from, to]);
        }
        if (!candidates.length) return false;
        const [from, to] = this.rng.pick(candidates);
        this.installOneWayGate(from, to, this.edgeSeparatesEntranceExit(from, to));
        return true;
    }
    placeRotatingChamber() {
        const path = this.findPath();
        const gateCells = new Set(this.oneWayGates.flatMap(gate => [gate.from, gate.to]));
        const candidates = [];
        for (let i = 2; i < path.length - 2; i++) {
            const entry = path[i - 1], cell = path[i], exit = path[i + 1];
            if (cell.chamber || gateCells.has(cell) || gateCells.has(entry) || gateCells.has(exit)) continue;
            const openNeighbors = [
                this.cell(cell.x, cell.y - 1), this.cell(cell.x + 1, cell.y),
                this.cell(cell.x, cell.y + 1), this.cell(cell.x - 1, cell.y)
            ].filter(next => next && !cell[this.passageDirection(cell, next)]);
            if (openNeighbors.length !== 2 || !openNeighbors.includes(entry) || !openNeighbors.includes(exit)) continue;
            if (!this.edgeSeparatesEntranceExit(cell, exit)) continue;
            candidates.push({entry, cell, exit, guidePath:path});
        }
        if (candidates.length === 0) return false;
        const chamber = this.rng.pick(candidates);
        chamber.activated = false;
        chamber.entryPanel = null;
        chamber.exitPanel = null;
        chamber.visual = null;
        chamber.cell.rotating = true;
        this.rotatingChamber = chamber;
        this.guidePath = chamber.guidePath;
        this.setWallBetween(chamber.cell, chamber.exit, true);
        return true;
    }
    activateRotatingChamber() {
        const chamber = this.rotatingChamber;
        if (!chamber || chamber.activated) return false;
        this.setWallBetween(chamber.entry, chamber.cell, true);
        this.setWallBetween(chamber.cell, chamber.exit, false);
        chamber.activated = true;
        return true;
    }
    placeSpatialLoop(required) {
        const basePath = this.findPath();
        if (basePath.length < 8) return false;
        const usable = cell => cell && cell !== this.entranceCell && cell !== this.exitCell && !cell.chamber;

        if (required) {
            const cuts = [];
            for (let i = 2; i < basePath.length - 3; i++) {
                const a = basePath[i], b = basePath[i + 1];
                if (usable(a) && usable(b) && Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1 &&
                    this.edgeSeparatesEntranceExit(a, b)) cuts.push([a, b]);
            }
            if (cuts.length > 0) {
                const cut = this.rng.pick(cuts);
                this.setWallBetween(cut[0], cut[1], true);
                const entranceSide = [...this.reachableFrom(this.entranceCell, {respectOneWay:false, includeSpatialLoop:false})]
                    .filter(usable);
                const exitSide = [...this.reachableFrom(this.exitCell, {respectOneWay:false, includeSpatialLoop:false})]
                    .filter(usable);
                if (entranceSide.length && exitSide.length) {
                    const a = this.rng.pick(entranceSide);
                    const shuffledExit = this.rng.shuffle(exitSide);
                    const b = shuffledExit.reduce((best, cell) =>
                        Math.abs(cell.x - a.x) + Math.abs(cell.y - a.y) > Math.abs(best.x - a.x) + Math.abs(best.y - a.y) ? cell : best
                    );
                    this.spatialLoop = {a, b, required:true, cut, cooldown:null};
                    this.guidePath = this.findPath();
                    return this.guidePath.length > 0;
                }
                this.setWallBetween(cut[0], cut[1], false);
            }
        }

        const candidates = [];
        for (let i = 2; i < basePath.length - 5; i++) {
            for (let j = i + 4; j < basePath.length - 2; j++) {
                const a = basePath[i], b = basePath[j];
                if (usable(a) && usable(b) && Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > 3) candidates.push([a, b]);
            }
        }
        if (!candidates.length) return false;
        const [a, b] = this.rng.pick(candidates);
        this.spatialLoop = {a, b, required:false, cut:null, cooldown:null};
        this.guidePath = this.findPath();
        return true;
    }
    placeChambers(count, types) {
        const candidates = this.cells.filter(c => {
            if (c === this.entranceCell || c === this.exitCell) return false;
            if (c.x <= 1 || c.x >= this.w - 2 || c.y <= 1 || c.y >= this.h - 2) return false;
            return true;
        });
        const shuffled = this.rng.shuffle(candidates);
        let placed = 0;
        for (const center of shuffled) {
            if (placed >= count) break;
            const type = this.rng.pick(types);
            const sz = (this.w >= 13 && this.rng.next() > 0.5) ? 3 : 2;
            const footprint = [];
            for (let dy = 0; dy < sz; dy++) {
                for (let dx = 0; dx < sz; dx++) {
                    const nc = this.cell(center.x + dx, center.y + dy);
                    if (nc) footprint.push(nc);
                }
            }
            if (footprint.length !== sz * sz || footprint.some(c => c.chamber)) continue;

            const chamberId = `${center.x},${center.y}`;
            for (let dy = 0; dy < sz; dy++) {
                for (let dx = 0; dx < sz; dx++) {
                    const nc = this.cell(center.x + dx, center.y + dy);
                    if (!nc) continue;
                    nc.chamber = type;
                    nc.chamberId = chamberId;
                    nc.chamberCenter = dx === Math.floor(sz / 2) && dy === Math.floor(sz / 2);
                    if (dx < sz - 1) {
                        const right = this.cell(center.x + dx + 1, center.y + dy);
                        if (right) this.removeWall(nc, right);
                    }
                    if (dy < sz - 1) {
                        const below = this.cell(center.x + dx, center.y + dy + 1);
                        if (below) this.removeWall(nc, below);
                    }
                }
            }
            placed++;
        }
    }
    placeTraps(count, srcRoom, dstRoom) {
        const destPool = scatterPool(srcRoom, dstRoom);
        if (destPool.length === 0) return;
        // Mines are never a deliberate part of the solution: the guide path
        // stays mine-free, so every segment is completable without one.
        const pathCells = new Set(this.guidePath || this.findPath());
        const featureCells = new Set([
            ...this.oneWayGates.flatMap(gate => [gate.from, gate.to]),
            this.rotatingChamber?.entry,
            this.rotatingChamber?.cell,
            this.rotatingChamber?.exit,
            this.spatialLoop?.a,
            this.spatialLoop?.b,
            this.spaceFold?.north,
            this.spaceFold?.south
        ].filter(Boolean));
        const candidates = this.cells.filter(c =>
            !c.chamber && c !== this.entranceCell && c !== this.exitCell &&
            !featureCells.has(c) && !pathCells.has(c) &&
            c.x > 0 && c.x < this.w - 1 && c.y > 0 && c.y < this.h - 1
        );
        const shuffled = this.rng.shuffle(candidates);
        for (let i = 0; i < count && i < shuffled.length; i++) {
            shuffled[i].trap = true;
            shuffled[i].trapDest = this.rng.pick(destPool);
        }
    }
    spawnHunter() {
        // BFS flood from the entrance over plain walls, then a SEEDED pick
        // among the far band (>= 70% of max distance) — the lair is a fixed
        // property of the maze's seed, and the player keeps a head start.
        const dist = new Map([[this.entranceCell, 0]]);
        const queue = [this.entranceCell];
        const dirs = [{dx:0,dy:-1,w:'N'},{dx:1,dy:0,w:'E'},{dx:0,dy:1,w:'S'},{dx:-1,dy:0,w:'W'}];
        while (queue.length) {
            const cur = queue.shift();
            for (const d of dirs) {
                if (cur[d.w]) continue;
                const next = this.cell(cur.x + d.dx, cur.y + d.dy);
                if (!next || next.chamber || dist.has(next)) continue;
                dist.set(next, dist.get(cur) + 1);
                queue.push(next);
            }
        }
        let maxD = 0;
        for (const [c, d] of dist) {
            if (c === this.entranceCell || c === this.exitCell || c.chamber) continue;
            if (d > maxD) maxD = d;
        }
        if (maxD < 2) return false;
        const band = [];
        for (const [c, d] of dist) {
            if (c === this.entranceCell || c === this.exitCell || c.chamber) continue;
            if (d >= Math.max(2, Math.floor(maxD * 0.7))) band.push(c);
        }
        if (band.length === 0) return false;
        const lair = this.rng.pick(band);
        this.hunter = {
            cell: lair,
            lair,
            x: lair.x * CELL + CELL / 2,
            z: lair.y * CELL + CELL / 2,
            targetCell: null,
            wakeAt: 0,
            visual: null
        };
        return true;
    }
}

// ===== KEY PROCESSING =====
function getMazeParams(masterSeed, roomA, roomB) {
    const canonical = [roomA, roomB].sort().join('|');
    const seed = fnv1a(masterSeed + canonical);
    const rng = new Rng(seed);
    const tier = rng.nextInt(0, 3); // 0=simple, 1=moderate, 2=complex, 3=labyrinthine
    const gridRanges = [[8,10],[10,14],[14,18],[18,20]];
    const [gMin, gMax] = gridRanges[tier];
    const w = rng.nextInt(gMin, gMax);
    const h = rng.nextInt(gMin, gMax);
    const bias = 0.1 + rng.next() * 0.8;
    const loops = rng.next() * 0.15;
    const rooms = [rng.nextInt(0,1), rng.nextInt(1,2), rng.nextInt(2,3), rng.nextInt(3,4)][tier];
    const traps = [0, rng.nextInt(0,1), rng.nextInt(1,2), rng.nextInt(2,3)][tier];
    const fogFar = 18 + rng.next() * 30;
    const availableLaw = getTesseractLaw(roomA);
    let law = rng.next() < availableLaw.chance ? availableLaw : null;
    let structuralFeature = null;
    if (rng.next() < [0.22, 0.36, 0.52, 0.68][tier]) {
        const featureRoll = rng.next();
        structuralFeature = featureRoll < 0.44 ? 'one-way'
            : featureRoll < 0.7 ? 'rotating-chamber' : 'spatial-loop';
    }
    const structuralRequired = structuralFeature === 'rotating-chamber' ||
        (structuralFeature !== null && rng.next() < 0.4);
    if (structuralRequired) law = null;
    return {w, h, bias, loops, rooms, traps, fogFar, seed, tier, law, structuralFeature, structuralRequired};
}

function buildStandardMaze(p, roomA, roomB) {
    const rng = new Rng(p.seed);
    const grid = new MazeGrid(p.w, p.h, rng);
    grid.generate(p.bias);
    grid.addLoops(p.loops);
    grid.setEntranceExit();
    const types = ['empty','empty','lore','nav'];
    grid.placeChambers(p.rooms, types);
    // Dead-end removal: higher tiers keep more dead ends for complexity
    // Runs after setEntranceExit so entrance/exit cells are protected
    const deadEndRate = [0.7, 0.5, 0.3, 0.1][p.tier];
    grid.removeDeadEnds(deadEndRate);
    if (p.law?.id === 'space-fold') grid.addSpaceFold();
    if (p.structuralFeature === 'one-way') grid.placeOneWayGates(1, p.structuralRequired);
    else if (p.structuralFeature === 'rotating-chamber') grid.placeRotatingChamber();
    else if (p.structuralFeature === 'spatial-loop') grid.placeSpatialLoop(p.structuralRequired);
    if (!grid.guidePath) grid.guidePath = grid.findPath();
    grid.placeTraps(p.traps, roomA, roomB);
    // Rolled last so earlier draws (and thus existing layouts) are unchanged.
    const hunterChance = HUNTER_TESSERACT_CHANCE[getTess(roomB)] ?? HUNTER_BASE_CHANCE;
    if (rng.next() < hunterChance) grid.spawnHunter();
    return {grid, params: p};
}

function pathUsesConnection(path, a, b) {
    return path.some((cell, index) =>
        (cell === a && path[index + 1] === b) ||
        (cell === b && path[index + 1] === a)
    );
}

function buildFeatureTestMaze(baseParams, roomA, roomB) {
    const template = {
        ...baseParams,
        w:14,
        h:14,
        tier:2,
        bias:0.45,
        loops:0.055,
        rooms:2,
        traps:2,
        law:DEFAULT_MAZE_LAW,
        structuralFeature:'feature-test',
        structuralRequired:false,
        testMode:true
    };

    for (let attempt = 0; attempt < 128; attempt++) {
        const p = {...template, seed:fnv1a(`${baseParams.seed}|feature-test|${attempt}`)};
        const grid = new MazeGrid(p.w, p.h, new Rng(p.seed));
        grid.generate(p.bias);
        grid.addLoops(p.loops);
        grid.setEntranceExit();
        grid.placeChambers(p.rooms, ['empty','empty','lore','nav']);
        grid.removeDeadEnds(0.3);

        if (!grid.placeSpatialLoop(false)) continue;
        if (!grid.placeOneWayOnPath(grid.guidePath)) continue;
        grid.guidePath = grid.findPath();
        if (!grid.placeRotatingChamber()) continue;
        const guide = grid.guidePath;
        const gate = grid.oneWayGates[0];
        const loop = grid.spatialLoop;
        if (!gate || !loop || !pathUsesConnection(guide, gate.from, gate.to) ||
            !pathUsesConnection(guide, loop.a, loop.b) || !guide.includes(grid.rotatingChamber.cell)) continue;
        if (!grid.addSpaceFold()) continue;
        grid.placeTraps(p.traps, roomA, roomB);
        if (!grid.cells.some(cell => cell.trap)) continue;
        if (!grid.spawnHunter()) continue;
        return {grid, params:p};
    }

    return buildStandardMaze({...baseParams, law:DEFAULT_MAZE_LAW}, roomA, roomB);
}

function generateMaze(masterSeed, roomA, roomB, {allFeatures = false} = {}) {
    const p = getMazeParams(masterSeed, roomA, roomB);
    return allFeatures ? buildFeatureTestMaze(p, roomA, roomB) : buildStandardMaze(p, roomA, roomB);
}

export { fnv1a, Rng, generateMaze };
