import assert from 'node:assert/strict';

import {
    buildDeltaLattice,
    buildSigmaLattice,
    generateMaze
} from '../maze/generation.js';
import {
    DELTA_EDGE_LEN,
    DOOR_MIN_DIST_FACTOR,
    SIGMA_EDGE_LEN
} from '../maze/maze-data.js';

function assertLattice(lattice, expectedCells, edgeLen) {
    assert.equal(lattice.cells.length, expectedCells);
    assert.equal(lattice.edgeLen, edgeLen);
    assert.ok(lattice.boundaryEdges.length > 0);
    assert.ok(lattice.bounds.width > 0 && lattice.bounds.height > 0);

    for (const cell of lattice.cells) {
        assert.equal(cell.vertices.length, cell.edges.length);
        assert.ok(Number.isFinite(cell.center.x) && Number.isFinite(cell.center.z));
        for (const edge of cell.edges) {
            const [a, b] = edge.segment;
            assert.ok(Math.hypot(b.x - a.x, b.z - a.z) > 1e-8,
                `cell ${cell.id} has a degenerate edge`);
            if (edge.neighbor) {
                assert.equal(edge.reverse.neighbor, cell);
                assert.equal(edge.reverse.reverse, edge);
            } else {
                assert.ok(lattice.boundaryEdges.includes(edge));
            }
        }
    }
}

function featureCells(grid) {
    const cells = new Set();
    for (const cell of grid.cells) {
        if (cell.chamber || cell.trap) cells.add(cell);
    }
    if (grid.hunter?.lair) cells.add(grid.hunter.lair);
    for (const gate of grid.oneWayGates) {
        cells.add(gate.from);
        cells.add(gate.to);
    }
    for (const cell of [
        grid.rotatingChamber?.entry,
        grid.rotatingChamber?.cell,
        grid.rotatingChamber?.exit,
        grid.spatialLoop?.a,
        grid.spatialLoop?.b,
        grid.spaceFold?.a?.cell,
        grid.spaceFold?.b?.cell
    ]) if (cell) cells.add(cell);
    return cells;
}

function assertDoorRoom(grid, room, kind, features) {
    assert.equal(room.kind, kind);
    assert.equal(room.cells.length, grid.tessellation === 'delta' ? 6 : 1,
        `${kind} room has the wrong ${grid.tessellation} footprint`);
    assert.ok(room.cells.includes(room.panelCell));
    assert.ok(room.cells.includes(room.corridorEdge.cell));
    assert.equal(room.panelEdge.open, false);
    assert.equal(room.corridorEdge.open, true);
    assert.ok(room.corridorEdge.neighbor);
    assert.ok(!room.cells.includes(room.corridorEdge.neighbor));
    assert.ok(Number.isFinite(room.panelNormal.x) && Number.isFinite(room.panelNormal.z));

    const roomCells = new Set(room.cells);
    let corridorCount = 0;
    for (const cell of room.cells) {
        assert.equal(cell.doorRoom, room);
        assert.ok(!features.has(cell), `${kind} room overlaps a maze feature`);
        for (const edge of cell.edges) {
            if (edge.neighbor && !roomCells.has(edge.neighbor)) {
                if (edge.open) corridorCount++;
                assert.ok(!features.has(edge.neighbor), `${kind} room touches a maze feature`);
            }
        }
    }
    assert.equal(corridorCount, 1, `${kind} room must have one corridor`);
}

function stableLayout(grid, params) {
    const edgeState = grid.cells.map(cell => cell.edges.map(edge =>
        `${edge.open ? 1 : 0}${edge.oneWayBlocked ? 1 : 0}`).join('')).join('|');
    const ids = cells => cells?.map(cell => cell.id).sort((a, b) => a - b) || [];
    return JSON.stringify({
        tessellation:grid.tessellation,
        params,
        edgeState,
        entrance:ids(grid.entranceDoorRoom.cells),
        exit:ids(grid.exitDoorRoom.cells),
        entrancePanel:[grid.entranceDoorRoom.panelCell.id, grid.entranceDoorRoom.panelEdge.index],
        entranceCorridor:[grid.entranceDoorRoom.corridorEdge.cell.id, grid.entranceDoorRoom.corridorEdge.index],
        exitPanel:[grid.exitDoorRoom.panelCell.id, grid.exitDoorRoom.panelEdge.index],
        exitCorridor:[grid.exitDoorRoom.corridorEdge.cell.id, grid.exitDoorRoom.corridorEdge.index],
        chambers:grid.cells.filter(cell => cell.chamber).map(cell => [cell.id, cell.chamber, cell.chamberId]),
        traps:grid.cells.filter(cell => cell.trap).map(cell => [cell.id, cell.trapDest]),
        gates:grid.oneWayGates.map(gate => [gate.from.id, gate.to.id, gate.required]),
        rotating:grid.rotatingChamber && [grid.rotatingChamber.entry.id, grid.rotatingChamber.cell.id, grid.rotatingChamber.exit.id],
        loop:grid.spatialLoop && [grid.spatialLoop.a.id, grid.spatialLoop.b.id],
        fold:grid.spaceFold && [grid.spaceFold.a.cell.id, grid.spaceFold.a.edge.index,
            grid.spaceFold.b.cell.id, grid.spaceFold.b.edge.index],
        hunter:grid.hunter?.lair.id ?? null
    });
}

assertLattice(buildDeltaLattice(4, 3, DELTA_EDGE_LEN), 24, DELTA_EDGE_LEN);
assertLattice(buildSigmaLattice(4, 3, SIGMA_EDGE_LEN), 12, SIGMA_EDGE_LEN);

for (const tessellation of ['delta', 'sigma']) {
    for (let seed = 0; seed < 200; seed++) {
        const args = [`generation-invariant-${seed}`, '1.07', '5.03', {tessellation, allFeatures:true}];
        const first = generateMaze(...args);
        const second = generateMaze(...args);
        const {grid, params} = first;

        assert.equal(grid.tessellation, tessellation);
        assert.ok(grid.spaceFold && grid.oneWayGates.length && grid.rotatingChamber &&
            grid.spatialLoop && grid.hunter,
            `${tessellation} seed ${seed} did not honor allFeatures`);
        if (params.traps > 0) assert.ok(grid.cells.some(cell => cell.trap),
            `${tessellation} seed ${seed} omitted requested traps`);
        assert.equal(grid.cells.length, tessellation === 'delta' ? 2 * grid.w * grid.h : grid.w * grid.h);
        assert.equal(grid.reachableFrom(grid.entranceCell, {respectOneWay:false}).size, grid.cells.length,
            `${tessellation} seed ${seed} leaves unreachable cells`);

        const path = grid.findPath(grid.entranceCell, grid.exitCell, {respectOneWay:true});
        assert.ok(path.length > 0, `${tessellation} seed ${seed} has no directed entrance-exit path`);
        assert.ok(path.length - 1 >= grid.doorFloor,
            `${tessellation} seed ${seed} violates the door distance floor`);
        const nominalFloor = Math.ceil(DOOR_MIN_DIST_FACTOR * (grid.w + grid.h));
        if (!grid.doorDistanceRelaxed) assert.equal(grid.doorFloor, nominalFloor);
        assert.equal(grid.doorDistanceRelaxed, false,
            `${tessellation} seed ${seed} unexpectedly relaxed the door distance floor`);

        const features = featureCells(grid);
        assertDoorRoom(grid, grid.entranceDoorRoom, 'entrance', features);
        assertDoorRoom(grid, grid.exitDoorRoom, 'exit', features);
        assert.equal(new Set([...grid.entranceDoorRoom.cells, ...grid.exitDoorRoom.cells]).size,
            grid.entranceDoorRoom.cells.length + grid.exitDoorRoom.cells.length);

        for (const cell of grid.cells) {
            for (const edge of cell.edges) {
                const [a, b] = edge.segment;
                assert.ok(Math.hypot(b.x - a.x, b.z - a.z) > 1e-8);
            }
        }

        assert.equal(stableLayout(grid, params), stableLayout(second.grid, second.params),
            `${tessellation} seed ${seed} is not deterministic`);
        if (grid.rotatingChamber) {
            assert.ok(Math.abs(grid.rotatingChamber.angle -
                (tessellation === 'delta' ? Math.PI * 2 / 3 : Math.PI / 3)) < 1e-12);
            assert.equal(grid.activateRotatingChamber(), true,
                `${tessellation} seed ${seed} has a nonfunctional rotating chamber`);
            assert.ok(grid.findPath().length - 1 >= grid.doorFloor,
                `${tessellation} seed ${seed} rotation violates the door distance floor`);
        }
    }
}

const fallbackStats = {};
for (const tessellation of ['delta', 'sigma']) {
    const achieved = [];
    for (let seed = 0; seed < 3; seed++) {
        const args = [`generation-fallback-${seed}`, '1.07', '5.03', {
            tessellation,
            allFeatures:true,
            doorDistFactorOverride:99
        }];
        const first = generateMaze(...args);
        const second = generateMaze(...args);
        const {grid, params} = first;
        const path = grid.findPath(grid.entranceCell, grid.exitCell, {respectOneWay:false});

        assert.ok(path.length > 0, `${tessellation} fallback seed ${seed} has no entrance-exit path`);
        assert.equal(grid.reachableFrom(grid.entranceCell, {respectOneWay:false}).size, grid.cells.length,
            `${tessellation} fallback seed ${seed} leaves unreachable cells`);
        assert.equal(grid.doorDistanceRelaxed, true,
            `${tessellation} fallback seed ${seed} did not exercise rung 2`);
        assert.equal(grid.doorFloor, path.length - 1,
            `${tessellation} fallback seed ${seed} did not retain its achieved distance`);
        assert.ok(grid.doorFloor < grid.doorDistanceFloor(),
            `${tessellation} fallback seed ${seed} did not relax an unreachable nominal floor`);
        assert.equal(stableLayout(grid, params), stableLayout(second.grid, second.params),
            `${tessellation} fallback seed ${seed} is not deterministic`);

        const features = featureCells(grid);
        assertDoorRoom(grid, grid.entranceDoorRoom, 'entrance', features);
        assertDoorRoom(grid, grid.exitDoorRoom, 'exit', features);
        if (grid.rotatingChamber) {
            assert.equal(grid.activateRotatingChamber(), true,
                `${tessellation} fallback seed ${seed} has a nonfunctional rotating chamber`);
            assert.ok(grid.findPath().length - 1 >= grid.doorFloor,
                `${tessellation} fallback seed ${seed} rotation violates the effective floor`);
        }
        achieved.push(grid.doorFloor);
    }
    fallbackStats[tessellation] = {
        min:Math.min(...achieved),
        max:Math.max(...achieved),
        values:achieved
    };
}

console.log('maze generation invariants passed (200 seeds per tessellation; standard floor never relaxed)');
console.log('forced rung-2 achieved distances:', fallbackStats);
