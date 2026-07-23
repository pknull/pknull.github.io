import {
    DEFAULT_MAZE_LAW,
    DELTA_EDGE_LEN,
    DELTA_TIER_RANGES,
    DOOR_MIN_DIST_CELL_FRACTION,
    DOOR_MIN_DIST_FACTOR,
    HUNTER_BASE_CHANCE,
    HUNTER_TESSERACT_CHANCE,
    HUB_APO,
    MAZE_FEATURE_CHANCES,
    MAZE_FEATURE_REQUIRED_CHANCE,
    MAZE_FEATURE_ROSTER,
    MAZE_TESSELLATION,
    OVERLAP_ATTEMPTS,
    OVERLAP_REGION_SIZE,
    ROTATION_MIN_GAIN,
    SIGMA_EDGE_LEN,
    SIGMA_TIER_RANGES,
    getTess,
    getTesseractLaw,
    roomNavigation,
    scatterPool
} from './maze-data.js';

const EXTERIOR_HUB_MARGIN = 1;
const EXTERIOR_HUB_CLEARANCE = 2 *
    (HUB_APO / Math.cos(Math.PI / 8) + EXTERIOR_HUB_MARGIN);

// ===== PRNG =====
function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

function canonicalRoomPairKey(roomA, roomB) {
    return [roomA, roomB].sort().join('|');
}

const ORB_EXCLUDED_TESSERACTS = Object.freeze([3, 8]);
const ORB_PAIR_KEYS_BY_TESS = new Map();
for (const [room, navigation] of Object.entries(roomNavigation)) {
    const tess = getTess(room);
    if (ORB_EXCLUDED_TESSERACTS.includes(tess)) continue;
    for (const destination of Object.values(navigation)) {
        if (getTess(destination) !== tess) continue;
        if (!ORB_PAIR_KEYS_BY_TESS.has(tess)) ORB_PAIR_KEYS_BY_TESS.set(tess, new Set());
        ORB_PAIR_KEYS_BY_TESS.get(tess).add(canonicalRoomPairKey(room, destination));
    }
}
for (const [tess, pairs] of ORB_PAIR_KEYS_BY_TESS)
    ORB_PAIR_KEYS_BY_TESS.set(tess, Object.freeze([...pairs].sort()));

function orbPairKey(masterSeed, tess) {
    const pairs = ORB_PAIR_KEYS_BY_TESS.get(Number(tess));
    if (!pairs?.length) return null;
    return pairs[fnv1a(masterSeed + '|orb' + tess) % pairs.length];
}

function isOrbMaze(masterSeed, roomA, roomB) {
    const tess = getTess(roomA);
    return tess === getTess(roomB) &&
        canonicalRoomPairKey(roomA, roomB) === orbPairKey(masterSeed, tess);
}

function orbTesseracts() {
    return [...ORB_PAIR_KEYS_BY_TESS.keys()].sort((a, b) => a - b);
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

// ===== TESSELLATION TABLES =====
function pointKey(point) {
    return `${point.x.toFixed(8)},${point.z.toFixed(8)}`;
}

function segmentKey(a, b) {
    const ka = pointKey(a), kb = pointKey(b);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function makeCell(id, vertices, latticeX, latticeY) {
    const center = vertices.reduce((sum, point) => ({x:sum.x + point.x, z:sum.z + point.z}), {x:0, z:0});
    center.x /= vertices.length;
    center.z /= vertices.length;
    return {
        id,
        x:latticeX,
        y:latticeY,
        vertices,
        center,
        edges:[],
        visited:false,
        chamber:null,
        chamberId:null,
        chamberCenter:false,
        trap:false,
        trapDest:null,
        rotating:false,
        doorRoom:null,
        layer:null,
        layerRegion:null,
        twin:null
    };
}

function finishLattice(cells, tessellation, w, h, edgeLen) {
    const pending = new Map();
    const boundaryEdges = [];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;

    for (const cell of cells) {
        for (const point of cell.vertices) {
            minX = Math.min(minX, point.x);
            maxX = Math.max(maxX, point.x);
            minZ = Math.min(minZ, point.z);
            maxZ = Math.max(maxZ, point.z);
        }
        for (let index = 0; index < cell.vertices.length; index++) {
            const a = cell.vertices[index];
            const b = cell.vertices[(index + 1) % cell.vertices.length];
            const angle = ((Math.atan2(b.z - a.z, b.x - a.x) % Math.PI) + Math.PI) % Math.PI;
            const edge = {
                index,
                cell,
                neighbor:null,
                open:false,
                segment:[a, b],
                reverse:null,
                orientation:angle,
                oneWayBlocked:false,
                hardClosed:false,
                forcedOpen:false
            };
            cell.edges.push(edge);
            const key = segmentKey(a, b);
            const other = pending.get(key);
            if (other) {
                edge.neighbor = other.cell;
                other.neighbor = cell;
                edge.reverse = other;
                other.reverse = edge;
                pending.delete(key);
            } else {
                pending.set(key, edge);
            }
        }
    }

    for (const edge of pending.values()) boundaryEdges.push(edge);
    return {
        cells,
        boundaryEdges,
        bounds:{minX, maxX, minZ, maxZ, width:maxX - minX, height:maxZ - minZ},
        tessellation,
        w,
        h,
        edgeLen
    };
}

function buildDeltaLattice(w, h, edgeLen = DELTA_EDGE_LEN) {
    const cells = [];
    const rise = edgeLen * Math.sqrt(3) / 2;
    const point = (x, y) => ({x:(x + y / 2) * edgeLen, z:y * rise});
    let id = 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const p00 = point(x, y);
            const p10 = point(x + 1, y);
            const p01 = point(x, y + 1);
            const p11 = point(x + 1, y + 1);
            cells.push(makeCell(id++, [p00, p10, p01], x, y));
            cells.push(makeCell(id++, [p10, p11, p01], x, y));
        }
    }
    return finishLattice(cells, 'delta', w, h, edgeLen);
}

// Sigma uses flat-top regular hexagons in odd-column offset coordinates.
function buildSigmaLattice(w, h, edgeLen = SIGMA_EDGE_LEN) {
    const cells = [];
    const rise = Math.sqrt(3) * edgeLen;
    let id = 0;
    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
            const cx = x * edgeLen * 1.5;
            const cz = (y + (x % 2) / 2) * rise;
            const vertices = [];
            for (let i = 0; i < 6; i++) {
                const angle = i * Math.PI / 3;
                vertices.push({x:cx + Math.cos(angle) * edgeLen, z:cz + Math.sin(angle) * edgeLen});
            }
            cells.push(makeCell(id++, vertices, x, y));
        }
    }
    return finishLattice(cells, 'sigma', w, h, edgeLen);
}

function midpoint(edge) {
    return {
        x:(edge.segment[0].x + edge.segment[1].x) / 2,
        z:(edge.segment[0].z + edge.segment[1].z) / 2
    };
}

function normalize(vector) {
    const length = Math.hypot(vector.x, vector.z) || 1;
    return {x:vector.x / length, z:vector.z / length};
}

function pointInPolygon(point, vertices) {
    let inside = false;
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
        const a = vertices[i], b = vertices[j];
        const crosses = (a.z > point.z) !== (b.z > point.z) &&
            point.x < (b.x - a.x) * (point.z - a.z) / (b.z - a.z) + a.x;
        if (crosses) inside = !inside;
    }
    return inside;
}

// ===== LATTICE-AGNOSTIC MAZE GRAPH =====
class MazeGrid {
    constructor(lattice, rng) {
        Object.assign(this, lattice);
        this.rng = rng;
        this.entranceCell = null;
        this.exitCell = null;
        this.entranceDoorRoom = null;
        this.exitDoorRoom = null;
        this.spaceFold = null;
        this.oneWayGates = [];
        this.rotatingChamber = null;
        this.spatialLoop = null;
        this.overlapRegion = null;
        this.orbChamber = null;
        this.guidePath = null;
        this.hunter = null;
        this.doorFloor = null;
        this.doorDistanceRelaxed = false;
    }

    cell(x, y) {
        if (y === undefined) return this.cells[x] || null;
        return this.cells.find(cell => cell.x === x && cell.y === y) || null;
    }

    edgeBetween(a, b) {
        return a?.edges.find(edge => edge.neighbor === b) || null;
    }

    areAdjacent(a, b) {
        return Boolean(this.edgeBetween(a, b));
    }

    setEdgeOpen(edgeOrA, bOrOpen, maybeOpen) {
        const edge = maybeOpen === undefined ? edgeOrA : this.edgeBetween(edgeOrA, bOrOpen);
        const open = maybeOpen === undefined ? bOrOpen : maybeOpen;
        if (!edge || (open && edge.hardClosed)) return false;
        edge.open = Boolean(open);
        if (edge.reverse) edge.reverse.open = Boolean(open);
        return true;
    }

    setWallBetween(a, b, closed) {
        return this.setEdgeOpen(a, b, !closed);
    }

    cellContainingPoint(x, z) {
        const point = typeof x === 'object' ? x : {x, z};
        return this.cells.find(cell => {
            if (cell.layerRegion && cell.layer !== cell.layerRegion.activeLayer) return false;
            return pointInPolygon(point, cell.vertices);
        }) || null;
    }

    eligibleEdges(cell, unvisitedOnly = false) {
        return cell.edges.filter(edge => edge.neighbor && !edge.hardClosed &&
            (!unvisitedOnly || !edge.neighbor.visited));
    }

    generate(bias) {
        for (const cell of this.cells) cell.visited = false;
        const stack = [this.entranceCell || this.cells[0]];
        stack[0].visited = true;
        while (stack.length > 0) {
            const current = stack[stack.length - 1];
            const candidates = this.eligibleEdges(current, true);
            if (candidates.length === 0) {
                stack.pop();
                continue;
            }
            let chosen = null;
            if (bias > 0 && stack.length > 1) {
                const previous = stack[stack.length - 2];
                const incoming = this.edgeBetween(previous, current);
                // A triangle has no edge opposite its entrance. Looking back
                // one extra cell preserves the alternating edge orientation
                // that reads as a straight run across the delta lattice.
                const prior = this.tessellation === 'delta' && stack.length > 2
                    ? this.edgeBetween(stack[stack.length - 3], previous) : null;
                const preferredOrientation = prior?.orientation ?? incoming.orientation;
                const parallel = candidates.filter(edge =>
                    Math.abs(Math.sin(edge.orientation - preferredOrientation)) < 1e-6);
                if (parallel.length && this.rng.next() < bias) chosen = this.rng.pick(parallel);
            }
            chosen ||= this.rng.pick(candidates);
            this.setEdgeOpen(chosen, true);
            chosen.neighbor.visited = true;
            stack.push(chosen.neighbor);
        }
        for (const cell of this.cells) {
            for (const edge of cell.edges) {
                if (edge.forcedOpen) this.setEdgeOpen(edge, true);
            }
        }
    }

    graphLinks(cell, {
        respectOneWay = true,
        includeSpatialLoop = true,
        includeSpaceFold = true,
        excludeEdge = null
    } = {}) {
        const links = [];
        for (const edge of cell.edges) {
            if (!edge.open || !edge.neighbor || (respectOneWay && edge.oneWayBlocked)) continue;
            if (excludeEdge && (edge === excludeEdge || edge.reverse === excludeEdge)) continue;
            links.push(edge.neighbor);
        }
        if (includeSpatialLoop && this.spatialLoop) {
            if (cell === this.spatialLoop.a) links.push(this.spatialLoop.b);
            else if (cell === this.spatialLoop.b) links.push(this.spatialLoop.a);
        }
        if (includeSpaceFold && this.spaceFold) {
            if (cell === this.spaceFold.a.cell) links.push(this.spaceFold.b.cell);
            else if (cell === this.spaceFold.b.cell) links.push(this.spaceFold.a.cell);
        }
        return links;
    }

    findPath(start = this.entranceCell, target = this.exitCell, options = {}) {
        if (!start || !target) return [];
        const previous = new Map([[start, null]]);
        const queue = [start];
        for (let cursor = 0; cursor < queue.length; cursor++) {
            const current = queue[cursor];
            if (current === target) {
                const path = [];
                for (let cell = target; cell; cell = previous.get(cell)) path.unshift(cell);
                return path;
            }
            for (const next of this.graphLinks(current, options)) {
                if (previous.has(next)) continue;
                previous.set(next, current);
                queue.push(next);
            }
        }
        return [];
    }

    reachableFrom(start, options = {}) {
        const reached = new Set();
        if (!start) return reached;
        const queue = [start];
        reached.add(start);
        for (let cursor = 0; cursor < queue.length; cursor++) {
            for (const next of this.graphLinks(queue[cursor], options)) {
                if (reached.has(next)) continue;
                reached.add(next);
                queue.push(next);
            }
        }
        return reached;
    }

    openBridgeEdges() {
        const links = new Map(this.cells.map(cell => [cell, []]));
        const addLink = (a, b, edge = null) => {
            if (!a || !b || a === b || !links.has(a) || !links.has(b)) return;
            const link = {a, b, edge};
            links.get(a).push({cell:b, link});
            links.get(b).push({cell:a, link});
        };
        for (const cell of this.cells) {
            for (const edge of cell.edges) {
                if (edge.open && !edge.hardClosed && edge.neighbor && cell.id < edge.neighbor.id)
                    addLink(cell, edge.neighbor, edge);
            }
        }
        addLink(this.spatialLoop?.a, this.spatialLoop?.b);
        addLink(this.spaceFold?.a?.cell, this.spaceFold?.b?.cell);

        const discovered = new Map();
        const low = new Map();
        const bridges = new Set();
        let time = 0;
        const visit = (cell, parentLink = null) => {
            discovered.set(cell, ++time);
            low.set(cell, time);
            for (const {cell:next, link} of links.get(cell)) {
                if (link === parentLink) continue;
                if (!discovered.has(next)) {
                    visit(next, link);
                    low.set(cell, Math.min(low.get(cell), low.get(next)));
                    if (link.edge && low.get(next) > discovered.get(cell)) bridges.add(link.edge);
                } else {
                    low.set(cell, Math.min(low.get(cell), discovered.get(next)));
                }
            }
        };
        for (const cell of this.cells) if (!discovered.has(cell)) visit(cell);
        return bridges;
    }

    doorDistanceFloor() {
        const physicalCellCount = this.cells.length - (this.overlapRegion?.cellsB.length ?? 0);
        return Math.max(
            Math.ceil((this.doorDistFactorOverride ?? DOOR_MIN_DIST_FACTOR) * (this.w + this.h)),
            Math.ceil(DOOR_MIN_DIST_CELL_FRACTION * physicalCellCount)
        );
    }

    meetsDoorDistance() {
        return this.findPath().length - 1 >= this.doorFloor;
    }

    tryOpen(edge) {
        if (!edge || edge.open || edge.hardClosed) return false;
        this.setEdgeOpen(edge, true);
        if (this.meetsDoorDistance()) return true;
        this.setEdgeOpen(edge, false);
        return false;
    }

    addLoops(factor) {
        const count = Math.floor(this.cells.length * factor);
        const candidates = [];
        for (const cell of this.cells) {
            for (const edge of cell.edges) {
                if (edge.neighbor && cell.id < edge.neighbor.id && !edge.open && !edge.hardClosed)
                    candidates.push(edge);
            }
        }
        let opened = 0;
        for (const edge of this.rng.shuffle(candidates)) {
            if (opened >= count) break;
            if (this.tryOpen(edge)) opened++;
        }
    }

    removeDeadEnds(removalRate) {
        for (const cell of this.rng.shuffle(this.cells)) {
            if (cell.doorRoom || cell.chamber || this.rng.next() > removalRate) continue;
            const openCount = cell.edges.filter(edge => edge.open && edge.neighbor).length;
            if (openCount !== 1) continue;
            const candidates = cell.edges.filter(edge => edge.neighbor && !edge.open && !edge.hardClosed &&
                !edge.neighbor.doorRoom);
            if (candidates.length) this.tryOpen(this.rng.pick(candidates));
        }
    }

    doorProtectedCells() {
        const protectedCells = new Set();
        for (const room of [this.entranceDoorRoom, this.exitDoorRoom]) {
            for (const cell of room?.cells || []) {
                protectedCells.add(cell);
                for (const edge of cell.edges) if (edge.neighbor) protectedCells.add(edge.neighbor);
            }
        }
        return protectedCells;
    }

    featureCells() {
        const cells = this.doorProtectedCells();
        for (const cell of this.cells) if (cell.chamber || cell.trap) cells.add(cell);
        if (this.hunter?.lair) cells.add(this.hunter.lair);
        for (const gate of this.oneWayGates) { cells.add(gate.from); cells.add(gate.to); }
        for (const cell of [
            this.rotatingChamber?.entry,
            this.rotatingChamber?.cell,
            this.rotatingChamber?.exit,
            this.spatialLoop?.a,
            this.spatialLoop?.b,
            this.spaceFold?.a?.cell,
            this.spaceFold?.b?.cell
        ]) if (cell) cells.add(cell);
        for (const cell of this.overlapRegion?.cellsA || []) cells.add(cell);
        for (const cell of this.overlapRegion?.cellsB || []) cells.add(cell);
        return cells;
    }

    placeChambers(count, types, rng = this.rng, protectedCells = this.doorProtectedCells()) {
        const candidates = rng.shuffle(this.cells.filter(cell =>
            !protectedCells.has(cell) && cell.edges.every(edge => edge.neighbor)));
        let placed = 0;
        const chambers = [];
        for (const center of candidates) {
            if (placed >= count) break;
            const size = this.cells.length >= 240 && rng.next() > 0.5 ? 6 : 4;
            const footprint = [center];
            for (let cursor = 0; cursor < footprint.length && footprint.length < size; cursor++) {
                for (const edge of rng.shuffle(footprint[cursor].edges)) {
                    const next = edge.neighbor;
                    if (!next || footprint.includes(next) || protectedCells.has(next) || next.chamber ||
                        !next.edges.every(candidate => candidate.neighbor)) continue;
                    footprint.push(next);
                    if (footprint.length === size) break;
                }
            }
            if (footprint.length !== size || footprint.some(cell => cell.chamber)) continue;
            const internal = [];
            for (const cell of footprint) {
                for (const edge of cell.edges) {
                    if (edge.neighbor && footprint.includes(edge.neighbor) && cell.id < edge.neighbor.id && !edge.open)
                        internal.push(edge);
                }
            }
            for (const edge of internal) this.setEdgeOpen(edge, true);
            if (!this.meetsDoorDistance()) {
                for (const edge of internal) this.setEdgeOpen(edge, false);
                continue;
            }
            const chamberId = `chamber-${center.id}`;
            const type = rng.pick(types);
            for (const cell of footprint) {
                cell.chamber = type;
                cell.chamberId = chamberId;
            }
            center.chamberCenter = true;
            chambers.push({cells:footprint, center, type});
            placed++;
        }
        return chambers;
    }

    placeOrbChamber(tess, orbRng) {
        if (!orbRng || this.orbChamber) return false;
        const [chamber] = this.placeChambers(1, ['orb'], orbRng, this.featureCells());
        if (!chamber) return false;
        this.orbChamber = {cells:chamber.cells, center:chamber.center, tess};
        return true;
    }

    addSpaceFold() {
        const reserved = this.featureCells();
        const candidates = this.rng.shuffle(this.boundaryEdges.filter(edge => !reserved.has(edge.cell)));
        for (let i = 0; i < candidates.length; i++) {
            for (let j = i + 1; j < candidates.length; j++) {
                if (candidates[i].cell === candidates[j].cell) continue;
                this.spaceFold = {
                    a:{cell:candidates[i].cell, edge:candidates[i]},
                    b:{cell:candidates[j].cell, edge:candidates[j]}
                };
                if (this.meetsDoorDistance()) return true;
            }
        }
        this.spaceFold = null;
        return false;
    }

    edgeSeparatesEntranceExit(edge) {
        return this.findPath(this.entranceCell, this.exitCell, {
            respectOneWay:false,
            includeSpatialLoop:false,
            includeSpaceFold:false,
            excludeEdge:edge
        }).length === 0;
    }

    installOneWayGate(from, to, required = false) {
        const edge = this.edgeBetween(from, to);
        if (!edge?.open) return false;
        const reverse = edge.reverse;
        reverse.oneWayBlocked = true;
        const gate = {from, to, edge, reverse, required};
        this.oneWayGates.push(gate);
        if (!this.findPath().length || this.reachableFrom(this.entranceCell).size !== this.cells.length) {
            reverse.oneWayBlocked = false;
            this.oneWayGates.pop();
            return false;
        }
        return true;
    }

    placeOneWayGates(count, required = false) {
        const reserved = this.featureCells();
        const path = this.findPath();
        const pathEdges = new Set(path.slice(0, -1)
            .map((cell, index) => this.edgeBetween(cell, path[index + 1]))
            .map(edge => edge && edge.cell.id < edge.neighbor.id ? edge : edge?.reverse)
            .filter(Boolean));
        const bridges = this.openBridgeEdges();
        const candidates = [...bridges].filter(edge => !required || pathEdges.has(edge));
        let placed = 0;
        for (const edge of this.rng.shuffle(candidates)) {
            if (placed >= count) break;
            if (reserved.has(edge.cell) || reserved.has(edge.neighbor)) continue;
            const [from, to] = this.rng.next() < 0.5 ? [edge.cell, edge.neighbor] : [edge.neighbor, edge.cell];
            if (this.installOneWayGate(from, to, required)) {
                reserved.add(from);
                reserved.add(to);
                placed++;
            }
        }
        return placed > 0;
    }

    placeOneWayOnPath(path = this.findPath()) {
        const original = this.oneWayGates.length;
        const reserved = this.featureCells();
        for (let i = 1; i < path.length - 2; i++) {
            if (reserved.has(path[i]) || reserved.has(path[i + 1])) continue;
            if (this.installOneWayGate(path[i], path[i + 1], this.edgeSeparatesEntranceExit(
                this.edgeBetween(path[i], path[i + 1])))) return true;
        }
        return this.oneWayGates.length > original;
    }

    placeRotatingChamber() {
        const path = this.findPath();
        const reserved = this.featureCells();
        const candidates = [];
        for (let i = 2; i < path.length - 2; i++) {
            const entry = path[i - 1], cell = path[i], exit = path[i + 1];
            if (reserved.has(entry) || reserved.has(cell) || reserved.has(exit) || cell.chamber) continue;
            candidates.push({entry, cell, exit});
        }
        const candidateCells = new Set(candidates.map(candidate => candidate.cell));
        for (const cell of this.cells) {
            if (candidateCells.has(cell) || reserved.has(cell) || cell.chamber) continue;
            const openNeighbors = cell.edges.filter(edge => edge.open && edge.neighbor && !reserved.has(edge.neighbor))
                .map(edge => edge.neighbor);
            if (openNeighbors.length < 2) continue;
            candidates.push({entry:openNeighbors[0], cell, exit:openNeighbors[1]});
        }
        if (!candidates.length) return false;
        for (const chamber of this.rng.shuffle(candidates)) {
            const previous = chamber.cell.edges.map(edge => edge.open);
            chamber.activated = false;
            chamber.shift = 1;
            chamber.angle = this.tessellation === 'delta' ? Math.PI * 2 / 3 : Math.PI / 3;
            chamber.wallPattern = [...previous];
            chamber.cell.rotating = true;
            this.rotatingChamber = chamber;
            if (!this.rotatingChamberValid()) {
                chamber.cell.rotating = false;
                this.rotatingChamber = null;
                continue;
            }
            return true;
        }
        return false;
    }

    rotatingChamberValid() {
        const chamber = this.rotatingChamber;
        if (!chamber || chamber.activated) return false;
        const sealedPath = this.findPath(this.entranceCell, this.exitCell, {respectOneWay:true});
        const sealedDistance = sealedPath.length ? sealedPath.length - 1 : Infinity;
        const previous = chamber.cell.edges.map(edge => edge.open);
        if (!this.activateRotatingChamber()) return false;
        const activePath = this.findPath(this.entranceCell, this.exitCell, {respectOneWay:true});
        const activeDistance = activePath.length ? activePath.length - 1 : Infinity;
        for (let index = 0; index < chamber.cell.edges.length; index++)
            this.setEdgeOpen(chamber.cell.edges[index], previous[index]);
        chamber.activated = false;
        return Number.isFinite(activeDistance) &&
            (!Number.isFinite(sealedDistance) || sealedDistance - activeDistance >= ROTATION_MIN_GAIN);
    }

    activateRotatingChamber() {
        const chamber = this.rotatingChamber;
        if (!chamber || chamber.activated) return false;
        const edges = chamber.cell.edges;
        const previous = edges.map(edge => edge.open);
        for (let i = 0; i < edges.length; i++) {
            const source = (i - chamber.shift + edges.length) % edges.length;
            this.setEdgeOpen(edges[i], chamber.wallPattern[source] && !edges[i].hardClosed);
        }
        if (!this.meetsDoorDistance() ||
            this.reachableFrom(this.entranceCell, {respectOneWay:false}).size !== this.cells.length) {
            for (let i = 0; i < edges.length; i++) this.setEdgeOpen(edges[i], previous[i]);
            return false;
        }
        chamber.activated = true;
        return true;
    }

    placeSpatialLoop(required = false) {
        const reserved = this.featureCells();
        const candidates = this.rng.shuffle(this.cells.filter(cell => !reserved.has(cell) && !cell.chamber));
        for (let i = 0; i < candidates.length; i++) {
            for (let j = i + 1; j < candidates.length; j++) {
                const a = candidates[i], b = candidates[j];
                if (this.areAdjacent(a, b)) continue;
                const distance = Math.hypot(a.center.x - b.center.x, a.center.z - b.center.z);
                if (distance < this.edgeLen * 4) continue;
                this.spatialLoop = {a, b, required, cut:null, cooldown:null};
                if (this.meetsDoorDistance()) {
                    this.guidePath = this.findPath();
                    return true;
                }
            }
        }
        this.spatialLoop = null;
        return false;
    }

    overlapReachable(cells, start) {
        const allowed = new Set(cells);
        const reached = new Set();
        if (!start || !allowed.has(start)) return reached;
        const queue = [start];
        reached.add(start);
        for (let cursor = 0; cursor < queue.length; cursor++) {
            for (const edge of queue[cursor].edges) {
                if (!edge.open || !allowed.has(edge.neighbor) || reached.has(edge.neighbor)) continue;
                reached.add(edge.neighbor);
                queue.push(edge.neighbor);
            }
        }
        return reached;
    }

    repairOverlapConnectivity(cellsB, root, layersRng) {
        let reached = this.overlapReachable(cellsB, root);
        while (reached.size < cellsB.length) {
            const bridges = [];
            for (const cell of reached) {
                for (const edge of cell.edges) {
                    if (!edge.neighbor || edge.neighbor.layer !== 'b' || reached.has(edge.neighbor) ||
                        edge.open || edge.hardClosed) continue;
                    bridges.push(edge);
                }
            }
            if (!bridges.length) return false;
            this.setEdgeOpen(layersRng.pick(bridges), true);
            reached = this.overlapReachable(cellsB, root);
        }
        return true;
    }

    beginOverlapCandidate(cellsA, portalSpecs, layersRng) {
        const originalLength = this.cells.length;
        const previousRegion = this.overlapRegion;
        const previousDoorFloor = this.doorFloor;
        const cellStates = cellsA.map(cell => ({
            cell,
            layer:cell.layer,
            layerRegion:cell.layerRegion,
            twin:cell.twin
        }));
        const touchedEdges = new Set();
        for (const portal of portalSpecs) {
            touchedEdges.add(portal.edgeA);
            touchedEdges.add(portal.outsideEdge);
        }
        const edgeStates = [...touchedEdges].map(edge => ({
            edge,
            neighbor:edge.neighbor,
            reverse:edge.reverse,
            open:edge.open,
            hardClosed:edge.hardClosed
        }));
        const rollback = () => {
            this.cells.length = originalLength;
            for (const state of edgeStates) {
                state.edge.neighbor = state.neighbor;
                state.edge.reverse = state.reverse;
                state.edge.open = state.open;
                state.edge.hardClosed = state.hardClosed;
            }
            for (const state of cellStates) {
                state.cell.layer = state.layer;
                state.cell.layerRegion = state.layerRegion;
                state.cell.twin = state.twin;
            }
            this.overlapRegion = previousRegion;
            this.doorFloor = previousDoorFloor;
        };

        try {
            const cellsB = cellsA.map((cellA, index) => {
                const cellB = makeCell(originalLength + index, [...cellA.vertices], cellA.x, cellA.y);
                cellB.layer = 'b';
                return cellB;
            });
            const twinByA = new Map(cellsA.map((cell, index) => [cell, cellsB[index]]));
            const footprint = new Set(cellsA);
            const bbox = cellsA.reduce((box, cell) => {
                for (const point of cell.vertices) {
                    box.minX = Math.min(box.minX, point.x);
                    box.maxX = Math.max(box.maxX, point.x);
                    box.minZ = Math.min(box.minZ, point.z);
                    box.maxZ = Math.max(box.maxZ, point.z);
                }
                return box;
            }, {minX:Infinity, maxX:-Infinity, minZ:Infinity, maxZ:-Infinity});
            bbox.width = bbox.maxX - bbox.minX;
            bbox.height = bbox.maxZ - bbox.minZ;
            const region = {
                cellsA,
                cellsB,
                portals:[],
                bbox,
                activeLayer:'a',
                vestibuleBreaks:[]
            };

            for (let cellIndex = 0; cellIndex < cellsA.length; cellIndex++) {
                const cellA = cellsA[cellIndex];
                const cellB = cellsB[cellIndex];
                cellA.layer = 'a';
                cellA.layerRegion = region;
                cellA.twin = cellB;
                cellB.layerRegion = region;
                cellB.twin = cellA;
                cellB.edges = cellA.edges.map(edgeA => ({
                    index:edgeA.index,
                    cell:cellB,
                    neighbor:null,
                    open:false,
                    segment:[edgeA.segment[0], edgeA.segment[1]],
                    reverse:null,
                    orientation:edgeA.orientation,
                    oneWayBlocked:false,
                    hardClosed:!footprint.has(edgeA.neighbor),
                    forcedOpen:false
                }));
            }
            for (let cellIndex = 0; cellIndex < cellsA.length; cellIndex++) {
                const cellA = cellsA[cellIndex];
                const cellB = cellsB[cellIndex];
                for (const edgeA of cellA.edges) {
                    const neighborB = twinByA.get(edgeA.neighbor);
                    if (!neighborB) continue;
                    const edgeB = cellB.edges[edgeA.index];
                    edgeB.neighbor = neighborB;
                    edgeB.reverse = neighborB.edges[edgeA.reverse.index];
                }
            }

            this.cells.push(...cellsB);
            for (const spec of portalSpecs) {
                const cellB = twinByA.get(spec.cellA);
                const edgeB = cellB.edges[spec.edgeA.index];
                let vestibule;
                let severedEdge;
                if (spec.layer === 'a') {
                    vestibule = spec.cellA;
                    severedEdge = edgeB;
                } else {
                    vestibule = cellB;
                    severedEdge = spec.edgeA;
                    spec.outsideEdge.neighbor = cellB;
                    spec.outsideEdge.reverse = edgeB;
                    spec.outsideEdge.open = true;
                    edgeB.neighbor = spec.outsideCell;
                    edgeB.reverse = spec.outsideEdge;
                    edgeB.open = true;
                    edgeB.hardClosed = false;
                    spec.edgeA.neighbor = null;
                    spec.edgeA.reverse = null;
                    spec.edgeA.open = false;
                    spec.edgeA.hardClosed = true;
                }
                region.portals.push({
                    segment:spec.edgeA.segment,
                    outsideCell:spec.outsideCell,
                    outsideEdge:spec.outsideEdge,
                    layer:spec.layer,
                    vestibule,
                    severedEdge
                });
            }
            this.overlapRegion = region;

            const root = region.portals.find(portal => portal.layer === 'b')?.vestibule;
            if (!root) {
                rollback();
                return null;
            }
            const visited = new Set([root]);
            const stack = [root];
            while (stack.length) {
                const current = stack[stack.length - 1];
                const candidates = current.edges.filter(edge =>
                    edge.neighbor?.layerRegion === region && edge.neighbor.layer === 'b' &&
                    !visited.has(edge.neighbor));
                if (!candidates.length) {
                    stack.pop();
                    continue;
                }
                const chosen = layersRng.pick(candidates);
                this.setEdgeOpen(chosen, true);
                visited.add(chosen.neighbor);
                stack.push(chosen.neighbor);
            }
            if (visited.size !== cellsB.length) {
                rollback();
                return null;
            }

            for (let portalIndex = 0; portalIndex < portalSpecs.length; portalIndex++) {
                const cellA = portalSpecs[portalIndex].cellA;
                const cellB = twinByA.get(cellA);
                for (const edgeA of cellA.edges) {
                    if (!footprint.has(edgeA.neighbor)) continue;
                    this.setEdgeOpen(cellB.edges[edgeA.index], edgeA.open);
                }
                if (this.overlapReachable(cellsB, root).size !== cellsB.length) {
                    if (!this.repairOverlapConnectivity(cellsB, root, layersRng)) {
                        rollback();
                        return null;
                    }
                    region.vestibuleBreaks.push(portalIndex);
                }
            }
            if (this.doorDistanceRelaxed) {
                const achievedPath = this.findPath(this.entranceCell, this.exitCell, {respectOneWay:false});
                if (!achievedPath.length) {
                    rollback();
                    return null;
                }
                this.doorFloor = achievedPath.length - 1;
            }
            return {region, rollback};
        } catch {
            rollback();
            return null;
        }
    }

    overlapCandidateValid() {
        const bridges = this.openBridgeEdges();
        if (this.oneWayGates.some(gate => !bridges.has(
            gate.edge.cell.id < gate.edge.neighbor.id ? gate.edge : gate.reverse))) return false;
        if (this.reachableFrom(this.entranceCell).size !== this.cells.length ||
            !this.meetsDoorDistance()) return false;
        const chamber = this.rotatingChamber;
        if (!chamber || chamber.activated) return true;
        return this.rotatingChamberValid();
    }

    placeOverlapRegion(layersRng) {
        if (!layersRng || this.overlapRegion) return false;
        const [minimumSize, targetSize] = OVERLAP_REGION_SIZE[this.tessellation][this.tier ?? 0];
        const reserved = this.featureCells();
        const candidates = layersRng.shuffle(this.cells.filter(cell =>
            !reserved.has(cell) && !cell.chamber && !cell.doorRoom &&
            cell.edges.every(edge => edge.neighbor)));
        const eligible = new Set(candidates);
        let attempts = 0;
        let passing = 0;
        let best = null;

        for (const seed of candidates) {
            if (attempts++ >= OVERLAP_ATTEMPTS || passing >= 3) break;
            const cellsA = [seed];
            const footprint = new Set(cellsA);
            for (let cursor = 0; cursor < cellsA.length && cellsA.length < targetSize; cursor++) {
                for (const edge of layersRng.shuffle(cellsA[cursor].edges)) {
                    const next = edge.neighbor;
                    if (!next || footprint.has(next) || !eligible.has(next)) continue;
                    footprint.add(next);
                    cellsA.push(next);
                    if (cellsA.length >= targetSize) break;
                }
            }
            if (cellsA.length < minimumSize) continue;

            const portalCandidates = [];
            for (const cellA of cellsA) {
                for (const edgeA of cellA.edges) {
                    if (footprint.has(edgeA.neighbor) || !edgeA.open || !edgeA.reverse) continue;
                    portalCandidates.push({
                        cellA,
                        edgeA,
                        outsideCell:edgeA.neighbor,
                        outsideEdge:edgeA.reverse
                    });
                }
            }
            if (portalCandidates.length < 2) continue;
            const portalSpecs = layersRng.shuffle(portalCandidates).map((portal, index) => ({
                ...portal,
                layer:index === 0 ? 'a' : index === 1 ? 'b' : layersRng.next() < 0.5 ? 'a' : 'b'
            }));
            const applicationRngState = layersRng.state;
            const transaction = this.beginOverlapCandidate(cellsA, portalSpecs, layersRng);
            if (!transaction) continue;
            const valid = this.overlapCandidateValid();
            if (valid) {
                passing++;
                const score = transaction.region.vestibuleBreaks.length;
                if (!best || score < best.score || (score === best.score && seed.id < best.seedId)) {
                    best = {cellsA, portalSpecs, applicationRngState, score, seedId:seed.id};
                }
            }
            transaction.rollback();
        }

        if (!best) {
            this.overlapRegion = null;
            return false;
        }
        layersRng.state = best.applicationRngState;
        const transaction = this.beginOverlapCandidate(best.cellsA, best.portalSpecs, layersRng);
        if (!transaction || !this.overlapCandidateValid()) {
            transaction?.rollback();
            this.overlapRegion = null;
            return false;
        }
        return true;
    }

    placeTraps(count, srcRoom, dstRoom) {
        const destPool = scatterPool(srcRoom, dstRoom);
        if (!destPool.length) return;
        const pathCells = new Set(this.guidePath || this.findPath());
        const reserved = this.featureCells();
        const candidates = this.rng.shuffle(this.cells.filter(cell =>
            !reserved.has(cell) && !pathCells.has(cell) && !cell.chamber &&
            cell.edges.every(edge => edge.neighbor)));
        for (let i = 0; i < count && i < candidates.length; i++) {
            candidates[i].trap = true;
            candidates[i].trapDest = this.rng.pick(destPool);
        }
    }

    spawnHunter() {
        const reserved = this.featureCells();
        const distances = new Map([[this.entranceCell, 0]]);
        const queue = [this.entranceCell];
        for (let cursor = 0; cursor < queue.length; cursor++) {
            const current = queue[cursor];
            for (const next of this.graphLinks(current, {respectOneWay:false})) {
                if (distances.has(next)) continue;
                distances.set(next, distances.get(current) + 1);
                queue.push(next);
            }
        }
        let maxDistance = 0;
        for (const [cell, distance] of distances) {
            if (!reserved.has(cell) && !cell.chamber) maxDistance = Math.max(maxDistance, distance);
        }
        const band = [];
        for (const [cell, distance] of distances) {
            if (!reserved.has(cell) && !cell.chamber && distance >= Math.max(2, Math.floor(maxDistance * 0.7)))
                band.push(cell);
        }
        if (!band.length) return false;
        const lair = this.rng.pick(band);
        this.hunter = {
            cell:lair,
            lair,
            x:lair.center.x,
            z:lair.center.z,
            targetCell:null,
            wakeAt:0,
            visual:null
        };
        return true;
    }
}

// ===== HEX DOOR ROOMS =====
function deltaDoorFootprints(grid) {
    const vertices = new Map();
    for (const cell of grid.cells) {
        for (const vertex of cell.vertices) {
            const key = pointKey(vertex);
            if (!vertices.has(key)) vertices.set(key, {center:{...vertex}, cells:[]});
            vertices.get(key).cells.push(cell);
        }
    }
    return [...vertices.values()].filter(candidate => {
        if (candidate.cells.length !== 6) return false;
        const footprint = new Set(candidate.cells);
        const outer = candidate.cells.flatMap(cell => cell.edges.filter(edge =>
            !edge.neighbor || !footprint.has(edge.neighbor)));
        return outer.length === 6;
    });
}

function outerEdges(candidate) {
    const footprint = new Set(candidate.cells);
    return candidate.cells.flatMap(cell => cell.edges.filter(edge =>
        !edge.neighbor || !footprint.has(edge.neighbor)));
}

function hullEdges(grid, candidate) {
    return outerEdges(candidate).filter(edge => {
        if (edge.neighbor) return false;
        const edgeMid = midpoint(edge);
        const normal = normalize({
            x:edgeMid.x - candidate.center.x,
            z:edgeMid.z - candidate.center.z
        });
        return grid.cells.every(cell =>
            (cell.center.x - edgeMid.x) * normal.x +
            (cell.center.z - edgeMid.z) * normal.z < -1e-8 &&
            cell.vertices.every(vertex =>
                (vertex.x - edgeMid.x) * normal.x +
                (vertex.z - edgeMid.z) * normal.z <= 1e-8));
    });
}

function deltaHullDoorCandidates(grid) {
    return deltaDoorFootprints(grid).map(candidate => ({
        ...candidate,
        panelEdges:hullEdges(grid, candidate)
    })).filter(candidate => candidate.panelEdges.length > 0);
}

function sigmaHullDoorCandidates(grid) {
    return grid.cells.filter(cell => cell.edges.some(edge => !edge.neighbor))
        .map(cell => ({center:{...cell.center}, cells:[cell]}))
        .map(candidate => ({...candidate, panelEdges:hullEdges(grid, candidate)}))
        .filter(candidate => candidate.panelEdges.length > 0);
}

function candidatesTouch(a, b) {
    const bCells = new Set(b.cells);
    return a.cells.some(cell => bCells.has(cell) || cell.edges.some(edge => bCells.has(edge.neighbor)));
}

function exteriorDoorwayPairs(first, second) {
    const pairs = [];
    for (const entranceEdge of first.panelEdges) {
        const entranceMid = midpoint(entranceEdge);
        for (const exitEdge of second.panelEdges) {
            const exitMid = midpoint(exitEdge);
            const separation = Math.hypot(exitMid.x - entranceMid.x, exitMid.z - entranceMid.z);
            if (separation >= EXTERIOR_HUB_CLEARANCE)
                pairs.push({entranceEdge, exitEdge, separation});
        }
    }
    return pairs;
}

function makeDoorRoom(grid, candidate, kind, panelEdge) {
    const roomCells = new Set(candidate.cells);
    const connectedOuterEdges = [];
    for (const cell of candidate.cells) {
        for (const edge of cell.edges) {
            edge.open = false;
            edge.oneWayBlocked = false;
            if (edge.neighbor && roomCells.has(edge.neighbor)) {
                edge.forcedOpen = true;
                edge.reverse.forcedOpen = true;
                edge.hardClosed = false;
                edge.reverse.hardClosed = false;
            } else {
                edge.hardClosed = true;
                if (edge.reverse) edge.reverse.hardClosed = true;
                if (edge.neighbor) connectedOuterEdges.push(edge);
            }
        }
    }
    const panelMid = midpoint(panelEdge);
    const panelDirection = normalize({
        x:panelMid.x - candidate.center.x,
        z:panelMid.z - candidate.center.z
    });
    const corridorEdge = connectedOuterEdges.reduce((best, edge) => {
        const point = midpoint(edge);
        const direction = normalize({x:point.x - candidate.center.x, z:point.z - candidate.center.z});
        const score = direction.x * panelDirection.x + direction.z * panelDirection.z;
        return !best || score < best.score ? {edge, score} : best;
    }, null).edge;
    corridorEdge.hardClosed = false;
    corridorEdge.reverse.hardClosed = false;
    const room = {
        kind,
        cells:[...candidate.cells],
        center:{...candidate.center},
        corridorCell:corridorEdge.neighbor,
        corridorEdge,
        panelCell:panelEdge.cell,
        panelEdge,
        panelNormal:normalize({x:panelMid.x - candidate.center.x, z:panelMid.z - candidate.center.z})
    };
    for (const cell of candidate.cells) cell.doorRoom = room;
    return room;
}

function installDoorPair(grid, first, second, rng) {
    const doorwayPairs = exteriorDoorwayPairs(first, second);
    if (!doorwayPairs.length) return false;
    const {entranceEdge, exitEdge} = rng.pick(doorwayPairs);
    grid.entranceDoorRoom = makeDoorRoom(grid, first, 'entrance', entranceEdge);
    grid.exitDoorRoom = makeDoorRoom(grid, second, 'exit', exitEdge);
    grid.entranceCell = grid.entranceDoorRoom.panelCell;
    grid.exitCell = grid.exitDoorRoom.panelCell;
    grid.doorFloor = grid.doorDistanceFloor();
    grid.doorDistanceRelaxed = false;
    return true;
}

function makePreparedGrid(params, tessellation) {
    const doorsRng = new Rng(fnv1a(`${params.seed}|doors`));
    const makeGrid = (w = params.w, h = params.h) => {
        const lattice = tessellation === 'sigma'
            ? buildSigmaLattice(w, h, SIGMA_EDGE_LEN)
            : buildDeltaLattice(w, h, DELTA_EDGE_LEN);
        const grid = new MazeGrid(lattice, new Rng(params.seed));
        grid.tier = params.tier;
        grid.doorDistFactorOverride = params.doorDistFactorOverride;
        return grid;
    };
    const doorCandidates = grid => tessellation === 'sigma'
        ? sigmaHullDoorCandidates(grid) : deltaHullDoorCandidates(grid);
    for (let attempt = 0; attempt < 64; attempt++) {
        const grid = makeGrid();
        const candidates = doorCandidates(grid);
        if (candidates.length < 2) continue;
        const first = doorsRng.pick(candidates);
        const possible = candidates.filter(candidate => !candidatesTouch(first, candidate) &&
            exteriorDoorwayPairs(first, candidate).length > 0);
        if (!possible.length) continue;
        possible.sort((a, b) => {
            const ad = Math.max(...exteriorDoorwayPairs(first, a).map(pair => pair.separation));
            const bd = Math.max(...exteriorDoorwayPairs(first, b).map(pair => pair.separation));
            return bd - ad;
        });
        // Prefer the farthest quartile first. The final sixteen bounded
        // attempts relax that preference, never the BFS distance floor.
        const secondPool = attempt < 48
            ? possible.slice(0, Math.max(1, Math.ceil(possible.length / 4)))
            : possible;
        const second = doorsRng.pick(secondPool);
        if (!installDoorPair(grid, first, second, doorsRng)) continue;
        grid.generate(params.bias);
        if (grid.reachableFrom(grid.entranceCell, {respectOneWay:false}).size !== grid.cells.length) continue;
        if (!grid.meetsDoorDistance()) continue;
        return grid;
    }

    const candidateIds = candidate => candidate.cells.map(cell => cell.id).sort((a, b) => a - b);
    const compareIds = (a, b) => {
        for (let i = 0; i < Math.min(a.length, b.length); i++) {
            if (a[i] !== b[i]) return a[i] - b[i];
        }
        return a.length - b.length;
    };
    const comparePairsByIds = (a, b) => compareIds(a.ids[0], b.ids[0]) || compareIds(a.ids[1], b.ids[1]);
    let w = params.w, h = params.h;
    for (;;) {
        const probeGrid = makeGrid(w, h);
        const probeCandidates = doorCandidates(probeGrid);
        if (probeCandidates.length < 2) {
            w++;
            h++;
            continue;
        }
        const pairs = [];
        for (let i = 0; i < probeCandidates.length; i++) {
            for (let j = 0; j < probeCandidates.length; j++) {
                if (candidatesTouch(probeCandidates[i], probeCandidates[j])) continue;
                const doorwayPairs = exteriorDoorwayPairs(probeCandidates[i], probeCandidates[j]);
                if (!doorwayPairs.length) continue;
                const ids = [candidateIds(probeCandidates[i]), candidateIds(probeCandidates[j])];
                pairs.push({i, j, ids, separation:Math.max(...doorwayPairs.map(pair => pair.separation))});
            }
        }
        if (!pairs.length) {
            w++;
            h++;
            continue;
        }
        pairs.sort((a, b) => b.separation - a.separation || comparePairsByIds(a, b));

        let best = null;
        for (const pair of pairs.slice(0, 32)) {
            const grid = makeGrid(w, h);
            const candidates = doorCandidates(grid);
            const doorsState = doorsRng.state;
            if (!installDoorPair(grid, candidates[pair.i], candidates[pair.j], doorsRng)) continue;
            grid.generate(params.bias);
            if (grid.reachableFrom(grid.entranceCell, {respectOneWay:false}).size !== grid.cells.length) continue;
            const achievedDistance = grid.findPath().length - 1;
            if (!best || achievedDistance > best.achievedDistance ||
                (achievedDistance === best.achievedDistance && comparePairsByIds(pair, best.pair) < 0))
                best = {pair, doorsState, achievedDistance};
        }
        if (!best) {
            w++;
            h++;
            continue;
        }

        doorsRng.state = best.doorsState;
        const grid = makeGrid(w, h);
        const candidates = doorCandidates(grid);
        installDoorPair(grid, candidates[best.pair.i], candidates[best.pair.j], doorsRng);
        grid.generate(params.bias);
        const achievedDistance = grid.findPath().length - 1;
        grid.doorFloor = Math.min(grid.doorFloor, achievedDistance);
        grid.doorDistanceRelaxed = true;
        return grid;
    }
}

// ===== KEY PROCESSING =====
function getMazeParams(masterSeed, roomA, roomB, tessellation = MAZE_TESSELLATION,
    doorDistFactorOverride = undefined) {
    const canonical = [roomA, roomB].sort().join('|');
    const seed = fnv1a(masterSeed + canonical);
    const rng = new Rng(seed);
    const tier = rng.nextInt(0, 3);
    const ranges = tessellation === 'sigma' ? SIGMA_TIER_RANGES : DELTA_TIER_RANGES;
    const [gMin, gMax] = ranges[tier];
    const w = rng.nextInt(gMin, gMax);
    const h = rng.nextInt(gMin, gMax);
    const bias = 0.1 + rng.next() * 0.5;
    const loops = rng.next() * 0.15;
    const rooms = [rng.nextInt(0,1), rng.nextInt(1,2), rng.nextInt(2,3), rng.nextInt(3,4)][tier];
    const traps = [0, rng.nextInt(0,1), rng.nextInt(1,2), rng.nextInt(2,3)][tier];
    const fogFar = 18 + rng.next() * 30;
    const availableLaw = getTesseractLaw(roomA);
    const law = rng.next() < availableLaw.chance ? availableLaw : null;
    const features = {};
    // Draw exactly twice per roster entry, unconditionally. Never branch on whether to draw.
    for (const id of MAZE_FEATURE_ROSTER) {
        features[id] = {
            active:rng.next() < MAZE_FEATURE_CHANCES[id][tier],
            required:rng.next() < MAZE_FEATURE_REQUIRED_CHANCE[id]
        };
    }
    const edgeLen = tessellation === 'sigma' ? SIGMA_EDGE_LEN : DELTA_EDGE_LEN;
    return {
        w, h, bias, loops, rooms, traps, fogFar, seed, tier, law,
        features, tessellation, edgeLen, doorDistFactorOverride
    };
}

function buildMaze(params, masterSeed, roomA, roomB, allFeatures) {
    const grid = makePreparedGrid(params, params.tessellation);
    const types = ['empty','empty','lore','nav'];
    grid.placeChambers(params.rooms, types);
    grid.addLoops(params.loops);
    grid.removeDeadEnds([0.35, 0.25, 0.15, 0.05][params.tier]);
    if (isOrbMaze(masterSeed, roomA, roomB))
        grid.placeOrbChamber(getTess(roomA), new Rng(fnv1a(params.seed + '|orb')));

    if (allFeatures || params.law?.id === 'space-fold') grid.addSpaceFold();
    if (allFeatures || params.features['spatial-loop'].active)
        grid.placeSpatialLoop(params.features['spatial-loop'].required);
    if (allFeatures || params.features['one-way'].active)
        grid.placeOneWayGates(1, params.features['one-way'].required);
    // Keep rotation last among the pre-overlap route-shorteners. Overlap
    // candidates revalidate both the resting and activated wall patterns.
    if (allFeatures || params.features['rotating-chamber'].active) grid.placeRotatingChamber();
    if (allFeatures || params.features['layered-overlap'].active)
        grid.placeOverlapRegion(new Rng(fnv1a(params.seed + '|layers')));

    grid.guidePath = grid.findPath();
    grid.placeTraps(params.traps, roomA, roomB);
    const hunterChance = HUNTER_TESSERACT_CHANCE[getTess(roomB)] ?? HUNTER_BASE_CHANCE;
    if (allFeatures || grid.rng.next() < hunterChance) grid.spawnHunter();
    return {grid, params};
}

function generateMaze(masterSeed, roomA, roomB, {
    allFeatures = false,
    tessellation = MAZE_TESSELLATION,
    doorDistFactorOverride = undefined
} = {}) {
    if (tessellation !== 'delta' && tessellation !== 'sigma')
        throw new RangeError(`Unknown maze tessellation: ${tessellation}`);
    const params = getMazeParams(masterSeed, roomA, roomB, tessellation, doorDistFactorOverride);
    return buildMaze(params, masterSeed, roomA, roomB, allFeatures);
}

export {
    MazeGrid,
    Rng,
    EXTERIOR_HUB_CLEARANCE,
    ORB_EXCLUDED_TESSERACTS,
    buildDeltaLattice,
    buildSigmaLattice,
    fnv1a,
    generateMaze,
    getMazeParams,
    isOrbMaze,
    orbPairKey,
    orbTesseracts
};
