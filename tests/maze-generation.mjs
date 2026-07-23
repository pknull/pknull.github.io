import assert from 'node:assert/strict';

import {
    EXTERIOR_HUB_CLEARANCE,
    buildDeltaLattice,
    buildSigmaLattice,
    generateMaze,
    getMazeParams,
    isOrbMaze,
    orbPairKey,
    orbTesseracts
} from '../maze/generation.js';
import {
    DELTA_EDGE_LEN,
    DOOR_MIN_DIST_CELL_FRACTION,
    DOOR_MIN_DIST_FACTOR,
    MAZE_FEATURE_ROSTER,
    ROTATION_MIN_GAIN,
    SIGMA_EDGE_LEN,
    TESSERACTS,
    getTess,
    roomNavigation
} from '../maze/maze-data.js';

function assertLattice(lattice, expectedCells, edgeLen) {
    assert.equal(lattice.cells.length, expectedCells);
    assert.equal(lattice.edgeLen, edgeLen);
    assert.ok(lattice.boundaryEdges.length > 0);
    assert.ok(lattice.bounds.width > 0 && lattice.bounds.height > 0);

    for (const cell of lattice.cells) {
        assert.equal(cell.vertices.length, cell.edges.length);
        assert.ok(Number.isFinite(cell.center.x) && Number.isFinite(cell.center.z));
        assert.equal(cell.layer, null);
        assert.equal(cell.layerRegion, null);
        assert.equal(cell.twin, null);
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
    for (const cell of grid.overlapRegion?.cellsA || []) cells.add(cell);
    for (const cell of grid.overlapRegion?.cellsB || []) cells.add(cell);
    return cells;
}

function assertGateBridges(grid, label) {
    for (const gate of grid.oneWayGates) {
        const reached = grid.reachableFrom(gate.from, {
            respectOneWay:false,
            excludeEdge:gate.edge
        });
        assert.ok(!reached.has(gate.to), `${label} gate ${gate.from.id}->${gate.to.id} is bypassable`);
    }
}

function assertRotatingChamberMeaningful(grid, label) {
    const chamber = grid.rotatingChamber;
    if (!chamber) return;
    const sealedPath = grid.findPath(grid.entranceCell, grid.exitCell, {respectOneWay:true});
    const sealedDistance = sealedPath.length ? sealedPath.length - 1 : Infinity;
    const previous = chamber.cell.edges.map(edge => edge.open);
    assert.equal(grid.activateRotatingChamber(), true, `${label} has a nonfunctional rotating chamber`);
    const activePath = grid.findPath(grid.entranceCell, grid.exitCell, {respectOneWay:true});
    const activeDistance = activePath.length ? activePath.length - 1 : Infinity;
    for (let index = 0; index < chamber.cell.edges.length; index++)
        grid.setEdgeOpen(chamber.cell.edges[index], previous[index]);
    chamber.activated = false;
    assert.ok(Number.isFinite(activeDistance) &&
        (!Number.isFinite(sealedDistance) || sealedDistance - activeDistance >= ROTATION_MIN_GAIN),
    `${label} rotation gain ${sealedDistance} -> ${activeDistance} is below ${ROTATION_MIN_GAIN}`);
}

function assertOverlapRegion(grid) {
    const region = grid.overlapRegion;
    if (!region) return;
    assert.equal(region.cellsA.length, region.cellsB.length);
    assert.ok(region.cellsA.length > 0);
    const cellsA = new Set(region.cellsA);
    const cellsB = new Set(region.cellsB);
    const regionCells = new Set([...cellsA, ...cellsB]);
    const cloneStart = grid.cells.length - region.cellsB.length;
    assert.equal(regionCells.size, region.cellsA.length + region.cellsB.length,
        'overlap layers must have disjoint cell identities');

    for (let index = 0; index < region.cellsA.length; index++) {
        const cellA = region.cellsA[index];
        const cellB = region.cellsB[index];
        assert.equal(cellB.id, cloneStart + index);
        assert.equal(grid.cells[cloneStart + index], cellB);
        assert.notEqual(cellA.id, cellB.id);
        assert.equal(cellA.layer, 'a');
        assert.equal(cellB.layer, 'b');
        assert.equal(cellA.layerRegion, region);
        assert.equal(cellB.layerRegion, region);
        assert.equal(cellA.twin, cellB);
        assert.equal(cellB.twin, cellA);
        assert.deepEqual(cellA.center, cellB.center);
        assert.equal(cellA.vertices.length, cellB.vertices.length);
        for (let vertex = 0; vertex < cellA.vertices.length; vertex++)
            assert.equal(cellA.vertices[vertex], cellB.vertices[vertex]);
        for (let edge = 0; edge < cellA.edges.length; edge++) {
            assert.equal(cellA.edges[edge].segment[0], cellB.edges[edge].segment[0]);
            assert.equal(cellA.edges[edge].segment[1], cellB.edges[edge].segment[1]);
            if (cellB.edges[edge].neighbor) {
                assert.ok(cellsB.has(cellB.edges[edge].neighbor) ||
                    region.portals.some(portal => portal.outsideEdge.reverse === cellB.edges[edge]));
            } else {
                assert.equal(cellB.edges[edge].hardClosed, true);
            }
        }
    }

    assert.ok(region.portals.length >= 2);
    assert.deepEqual(new Set(region.portals.map(portal => portal.layer)), new Set(['a', 'b']));
    const severed = new Set();
    for (const portal of region.portals) {
        assert.equal(portal.outsideEdge.cell, portal.outsideCell);
        assert.equal(portal.outsideEdge.open, true);
        assert.equal(portal.outsideEdge.neighbor, portal.vestibule);
        assert.equal(portal.outsideEdge.reverse?.cell, portal.vestibule);
        assert.equal(portal.outsideEdge.reverse?.reverse, portal.outsideEdge);
        assert.equal(portal.vestibule.layer, portal.layer);
        assert.equal(portal.severedEdge.cell, portal.vestibule.twin);
        assert.equal(portal.severedEdge.open, false);
        assert.equal(portal.severedEdge.hardClosed, true);
        assert.equal(portal.severedEdge.neighbor, null);
        assert.equal(portal.severedEdge.reverse, null);
        assert.ok(!severed.has(portal.severedEdge), 'a severed edge may belong to only one portal');
        severed.add(portal.severedEdge);
    }

    const reachedB = new Set([region.cellsB[0]]);
    const queue = [region.cellsB[0]];
    for (let cursor = 0; cursor < queue.length; cursor++) {
        for (const edge of queue[cursor].edges) {
            if (!edge.open || !cellsB.has(edge.neighbor) || reachedB.has(edge.neighbor)) continue;
            reachedB.add(edge.neighbor);
            queue.push(edge.neighbor);
        }
    }
    assert.equal(reachedB.size, region.cellsB.length, 'layer B must be internally connected');

    const occupied = [
        ...grid.cells.filter(cell => cell.chamber || cell.trap),
        ...grid.oneWayGates.flatMap(gate => [gate.from, gate.to]),
        grid.rotatingChamber?.entry,
        grid.rotatingChamber?.cell,
        grid.rotatingChamber?.exit,
        grid.spatialLoop?.a,
        grid.spatialLoop?.b,
        grid.spaceFold?.a?.cell,
        grid.spaceFold?.b?.cell,
        ...(grid.entranceDoorRoom?.cells || []),
        ...(grid.exitDoorRoom?.cells || []),
        grid.hunter?.lair
    ].filter(Boolean);
    for (const cell of occupied)
        assert.ok(!regionCells.has(cell), `overlap region cell ${cell.id} is occupied by another feature`);

    const cellA = region.cellsA[0];
    assert.equal(grid.cellContainingPoint(cellA.center), cellA);
    region.activeLayer = 'b';
    assert.equal(grid.cellContainingPoint(cellA.center), cellA.twin);
    region.activeLayer = 'a';
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
    assert.equal(room.panelEdge.neighbor, null,
        `${kind} panel edge must be on the lattice boundary`);
    assert.ok(grid.boundaryEdges.includes(room.panelEdge));
    assert.equal(grid[`${kind}Cell`], room.panelCell,
        `${kind}Cell must be the cell immediately inside the doorway`);
    const [a, b] = room.panelEdge.segment;
    const midpoint = {x:(a.x + b.x) / 2, z:(a.z + b.z) / 2};
    for (const cell of grid.cells) {
        const side = (cell.center.x - midpoint.x) * room.panelNormal.x +
            (cell.center.z - midpoint.z) * room.panelNormal.z;
        assert.ok(side < -1e-8,
            `${grid.tessellation} cell ${cell.id} is not strictly behind the ${kind} plane`);
    }

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

function navPairKeys(tess) {
    const pairs = new Set();
    for (const [room, navigation] of Object.entries(roomNavigation)) {
        if (getTess(room) !== tess) continue;
        for (const destination of Object.values(navigation)) {
            if (getTess(destination) !== tess) continue;
            pairs.add([room, destination].sort().join('|'));
        }
    }
    return [...pairs].sort();
}

function assertOrbChamber(grid, tess, label) {
    const orb = grid.orbChamber;
    assert.ok(orb, `${label} omitted its orb chamber`);
    assert.equal(orb.tess, tess);
    assert.ok(orb.cells.includes(orb.center));
    assert.equal(orb.center.chamberCenter, true);
    assert.ok(orb.cells.length >= 4);
    const reached = grid.reachableFrom(grid.entranceCell, {respectOneWay:false});
    const occupied = new Set([
        ...grid.cells.filter(cell => (cell.chamber && cell.chamber !== 'orb') || cell.trap),
        ...grid.oneWayGates.flatMap(gate => [gate.from, gate.to]),
        grid.rotatingChamber?.entry,
        grid.rotatingChamber?.cell,
        grid.rotatingChamber?.exit,
        grid.spatialLoop?.a,
        grid.spatialLoop?.b,
        grid.spaceFold?.a?.cell,
        grid.spaceFold?.b?.cell,
        ...(grid.overlapRegion?.cellsA || []),
        ...(grid.overlapRegion?.cellsB || []),
        ...(grid.entranceDoorRoom?.cells || []),
        ...(grid.exitDoorRoom?.cells || []),
        grid.hunter?.lair
    ].filter(Boolean));
    for (const cell of orb.cells) {
        assert.equal(cell.chamber, 'orb');
        assert.equal(cell.chamberId, orb.center.chamberId);
        assert.ok(reached.has(cell), `${label} orb cell ${cell.id} is unreachable`);
        assert.ok(!occupied.has(cell), `${label} orb cell ${cell.id} overlaps another feature`);
        assert.ok(!grid.doorProtectedCells().has(cell),
            `${label} orb cell ${cell.id} touches a door room`);
    }
}

function assertExteriorHubClearance(grid) {
    const midpoint = room => {
        const [a, b] = room.panelEdge.segment;
        return {x:(a.x + b.x) / 2, z:(a.z + b.z) / 2};
    };
    const entrance = midpoint(grid.entranceDoorRoom);
    const exit = midpoint(grid.exitDoorRoom);
    assert.ok(Math.hypot(exit.x - entrance.x, exit.z - entrance.z) >=
        EXTERIOR_HUB_CLEARANCE - 1e-9,
        `doorway midpoints violate exterior hub clearance ${EXTERIOR_HUB_CLEARANCE}`);
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
        region:grid.overlapRegion && {
            cellsA:ids(grid.overlapRegion.cellsA),
            cellsB:ids(grid.overlapRegion.cellsB),
            portals:grid.overlapRegion.portals.map(portal =>
                [portal.outsideCell.id, portal.outsideEdge.index, portal.layer]),
            vestibuleBreaks:grid.overlapRegion.vestibuleBreaks
        },
        orb:grid.orbChamber && {
            cells:ids(grid.orbChamber.cells),
            center:grid.orbChamber.center.id,
            tess:grid.orbChamber.tess
        },
        hunter:grid.hunter?.lair.id ?? null
    });
}

assertLattice(buildDeltaLattice(4, 3, DELTA_EDGE_LEN), 24, DELTA_EDGE_LEN);
assertLattice(buildSigmaLattice(4, 3, SIGMA_EDGE_LEN), 12, SIGMA_EDGE_LEN);

const orbMasterSeed = 'orb-generation-invariant';
const eligibleOrbTesseracts = orbTesseracts();
assert.deepEqual(eligibleOrbTesseracts, Object.keys(TESSERACTS).map(Number)
    .filter(tess => navPairKeys(tess).length > 0));
for (const tess of eligibleOrbTesseracts) {
    const pairs = navPairKeys(tess);
    const chosen = orbPairKey(orbMasterSeed, tess);
    assert.ok(pairs.includes(chosen), `tesseract ${tess} chose a non-navigation orb pair`);
    assert.equal(orbPairKey(orbMasterSeed, tess), chosen,
        `tesseract ${tess} orb pair is unstable across calls`);
    assert.equal(pairs.filter(pair => {
        const [roomA, roomB] = pair.split('|');
        return isOrbMaze(orbMasterSeed, roomA, roomB);
    }).length, 1, `tesseract ${tess} did not choose exactly one orb pair`);
    const [roomA, roomB] = chosen.split('|');
    assert.equal(isOrbMaze(orbMasterSeed, roomB, roomA), true,
        `tesseract ${tess} orb pair is not undirected`);
    const first = generateMaze(orbMasterSeed, roomA, roomB, {allFeatures:true});
    const second = generateMaze(orbMasterSeed, roomA, roomB, {allFeatures:true});
    assertOrbChamber(first.grid, tess, `tesseract ${tess}`);
    assert.equal(stableLayout(first.grid, first.params), stableLayout(second.grid, second.params),
        `tesseract ${tess} orb maze is not deterministic`);

    const nonChosen = pairs.find(pair => pair !== chosen);
    assert.ok(nonChosen, `tesseract ${tess} has no non-chosen pair to test`);
    const [otherA, otherB] = nonChosen.split('|');
    assert.equal(generateMaze(orbMasterSeed, otherA, otherB, {allFeatures:true}).grid.orbChamber, null,
        `tesseract ${tess} placed an orb in a non-chosen maze`);
}
for (const tess of Object.keys(TESSERACTS).map(Number)
    .filter(tess => !eligibleOrbTesseracts.includes(tess)))
    assert.equal(orbPairKey(orbMasterSeed, tess), null,
        `ineligible tesseract ${tess} unexpectedly chose an orb pair`);

const overlapStats = {
    delta:{attempted:0, placed:0, totalBreaks:0, maxBreaks:0, zeroBreaks:0},
    sigma:{attempted:0, placed:0, totalBreaks:0, maxBreaks:0, zeroBreaks:0}
};
const featureSurvivalStats = {
    delta:{attempted:0, gate:0, chamber:0},
    sigma:{attempted:0, gate:0, chamber:0}
};
for (const tessellation of ['delta', 'sigma']) {
    for (let seed = 0; seed < 200; seed++) {
        const args = [`generation-invariant-${seed}`, '1.07', '5.03', {tessellation, allFeatures:true}];
        const first = generateMaze(...args);
        const second = generateMaze(...args);
        const {grid, params} = first;

        assert.equal(grid.tessellation, tessellation);
        if (!isOrbMaze(args[0], args[1], args[2])) assert.equal(grid.orbChamber, null);
        else if (grid.orbChamber) assertOrbChamber(grid, getTess(args[1]),
            `${tessellation} seed ${seed}`);
        assert.ok(grid.spaceFold && grid.spatialLoop && grid.hunter,
            `${tessellation} seed ${seed} did not honor allFeatures`);
        featureSurvivalStats[tessellation].attempted++;
        if (grid.oneWayGates.length) featureSurvivalStats[tessellation].gate++;
        if (grid.rotatingChamber) featureSurvivalStats[tessellation].chamber++;
        if (params.traps > 0) assert.ok(grid.cells.some(cell => cell.trap),
            `${tessellation} seed ${seed} omitted requested traps`);
        const baseCells = tessellation === 'delta' ? 2 * grid.w * grid.h : grid.w * grid.h;
        assert.equal(grid.cells.length, baseCells + (grid.overlapRegion?.cellsB.length ?? 0));
        assert.equal(grid.reachableFrom(grid.entranceCell, {respectOneWay:false}).size, grid.cells.length,
            `${tessellation} seed ${seed} leaves unreachable cells`);
        assertGateBridges(grid, `${tessellation} seed ${seed}`);
        assertRotatingChamberMeaningful(grid, `${tessellation} seed ${seed}`);
        assertOverlapRegion(grid);
        const region = grid.overlapRegion;
        overlapStats[tessellation].attempted++;
        if (region) {
            const breaks = region.vestibuleBreaks.length;
            overlapStats[tessellation].placed++;
            overlapStats[tessellation].totalBreaks += breaks;
            overlapStats[tessellation].maxBreaks = Math.max(overlapStats[tessellation].maxBreaks, breaks);
            if (breaks === 0) overlapStats[tessellation].zeroBreaks++;
        }

        const path = grid.findPath(grid.entranceCell, grid.exitCell, {respectOneWay:true});
        assert.ok(path.length > 0, `${tessellation} seed ${seed} has no directed entrance-exit path`);
        assert.ok(path.length - 1 >= grid.doorFloor,
            `${tessellation} seed ${seed} violates the door distance floor`);
        const nominalFloor = Math.max(
            Math.ceil(DOOR_MIN_DIST_FACTOR * (grid.w + grid.h)),
            Math.ceil(DOOR_MIN_DIST_CELL_FRACTION * baseCells)
        );
        const epsilon = 1e-12;
        assert.ok(grid.doorFloor >= DOOR_MIN_DIST_CELL_FRACTION * baseCells * (1 - epsilon),
            `${tessellation} seed ${seed} does not apply the area-based door distance floor`);
        if (!grid.doorDistanceRelaxed) assert.equal(grid.doorFloor, nominalFloor);
        assert.equal(grid.doorDistanceRelaxed, false,
            `${tessellation} seed ${seed} unexpectedly relaxed the door distance floor`);

        const features = featureCells(grid);
        assertDoorRoom(grid, grid.entranceDoorRoom, 'entrance', features);
        assertDoorRoom(grid, grid.exitDoorRoom, 'exit', features);
        assertExteriorHubClearance(grid);
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

const mixedStats = {};
for (const tessellation of ['delta', 'sigma']) {
    const stats = {multipleStructural:0, foldWithStructural:0, none:0};
    for (let seed = 0; seed < 100; seed++) {
        const masterSeed = `generation-mixed-${seed}`;
        const paramsOnly = getMazeParams(masterSeed, '1.07', '5.03', tessellation);
        assert.deepEqual(Object.keys(paramsOnly.features), MAZE_FEATURE_ROSTER,
            `${tessellation} mixed seed ${seed} has the wrong feature roster`);

        const args = [masterSeed, '1.07', '5.03', {tessellation, allFeatures:false}];
        const first = generateMaze(...args);
        const second = generateMaze(...args);
        const {grid, params} = first;
        assert.deepEqual(params, paramsOnly);
        assert.equal(stableLayout(grid, params), stableLayout(second.grid, second.params),
            `${tessellation} mixed seed ${seed} is not deterministic`);

        const present = {
            'one-way':grid.oneWayGates.length > 0,
            'spatial-loop':Boolean(grid.spatialLoop),
            'layered-overlap':Boolean(grid.overlapRegion),
            'rotating-chamber':Boolean(grid.rotatingChamber)
        };
        for (const id of Object.keys(present)) {
            if (!params.features[id].active) assert.equal(present[id], false,
                `${tessellation} mixed seed ${seed} spuriously placed ${id}`);
        }
        if (params.law === null) assert.equal(Boolean(grid.spaceFold), false,
            `${tessellation} mixed seed ${seed} spuriously placed a space fold`);
        for (const gate of grid.oneWayGates)
            assert.equal(gate.required, params.features['one-way'].required);
        if (grid.spatialLoop)
            assert.equal(grid.spatialLoop.required, params.features['spatial-loop'].required);
        assertGateBridges(grid, `${tessellation} mixed seed ${seed}`);
        assertRotatingChamberMeaningful(grid, `${tessellation} mixed seed ${seed}`);
        assertOverlapRegion(grid);

        const structuralCount = Object.values(present).filter(Boolean).length;
        if (structuralCount >= 2) stats.multipleStructural++;
        if (grid.spaceFold && structuralCount > 0) stats.foldWithStructural++;
        if (!grid.spaceFold && structuralCount === 0) stats.none++;
    }
    assert.ok(stats.multipleStructural > 0,
        `${tessellation} mixed corpus never placed multiple structural features`);
    assert.ok(stats.foldWithStructural > 0,
        `${tessellation} mixed corpus never combined a fold with a structural feature`);
    assert.ok(stats.none > 0, `${tessellation} mixed corpus never produced a featureless maze`);
    mixedStats[tessellation] = stats;
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
        assertGateBridges(grid, `${tessellation} fallback seed ${seed}`);
        assertRotatingChamberMeaningful(grid, `${tessellation} fallback seed ${seed}`);
        assertOverlapRegion(grid);

        const features = featureCells(grid);
        assertDoorRoom(grid, grid.entranceDoorRoom, 'entrance', features);
        assertDoorRoom(grid, grid.exitDoorRoom, 'exit', features);
        assertExteriorHubClearance(grid);
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

const overlapAttempted = Object.values(overlapStats).reduce((sum, stats) => sum + stats.attempted, 0);
const overlapPlaced = Object.values(overlapStats).reduce((sum, stats) => sum + stats.placed, 0);
assert.ok(overlapPlaced / overlapAttempted >= 0.60,
    `layered overlap placement rate ${overlapPlaced}/${overlapAttempted} is below 60%`);

console.log('maze generation invariants passed (200 seeds per tessellation; standard floor never relaxed)');
console.log('layered-overlap allFeatures stats:', overlapStats,
    `aggregate=${overlapPlaced}/${overlapAttempted} (${(100 * overlapPlaced / overlapAttempted).toFixed(1)}%)`);
console.log('gate/chamber allFeatures survival rates:', Object.fromEntries(
    Object.entries(featureSurvivalStats).map(([tessellation, stats]) => [tessellation, {
        gate:`${stats.gate}/${stats.attempted} (${(100 * stats.gate / stats.attempted).toFixed(1)}%)`,
        chamber:`${stats.chamber}/${stats.attempted} (${(100 * stats.chamber / stats.attempted).toFixed(1)}%)`
    }])));
console.log('mixed-mode feature stats (100 seeds per tessellation; 200 total):', mixedStats);
console.log('forced rung-2 achieved distances:', fallbackStats);
