import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import {
    CONTROL_ROOMS,
    DIRECTIONS,
    DIR_ANGLES,
    DOOR_H,
    DOOR_W,
    EYE_H,
    GRUVBOX,
    HUB_APO,
    HUB_H,
    HUB_RAD,
    HUNTER_SPEED_FACTOR,
    HUNTER_WAKE_DELAY_MS,
    MOVE_SPD,
    OVERLAP_FORCE_RADIUS_FACTOR,
    OVERLAP_HYSTERESIS_MARGIN,
    OVERLAP_MINIMAP_ALPHA,
    OVERLAP_PORTAL_W,
    OVERLAP_SWAP_RADIUS_FACTOR,
    OVERLAP_VIEW_AWAY_DOT,
    P_RAD,
    SHADE_LAG_MS,
    TESSERACTS,
    TOGGLE_RAD,
    WALL_H,
    WALL_T,
    getTess,
    roomNavigation,
    roomToggles,
    scatterPool
} from './maze-data.js';
import { Rng, fnv1a, generateMaze, isOrbMaze, orbPairKey, orbTesseracts } from './generation.js';

const DOORWAY_ESCAPE_DEPTH = 1.5;
const OVERLAP_LAYER_COLORS = {a:'#8ec07c', b:'#fe8019'};

// The import map shares the three.js module instance with the console, so
// prototype patches there would reach our objects (issue #4). Frozen, the
// patches silently no-op. Preserve Three.js's deliberate prototype writes:
// Vector3 resets its type marker, and Euler shadows its default callback.
Object.freeze(THREE.Object3D.prototype);
Object.defineProperty(THREE.Vector3.prototype, 'isVector3', {
    get: () => true,
    set: () => {},
    configurable: false
});
Object.freeze(THREE.Vector3.prototype);
const defaultEulerOnChange = THREE.Euler.prototype._onChangeCallback;
Object.defineProperty(THREE.Euler.prototype, '_onChangeCallback', {
    get: () => defaultEulerOnChange,
    set(callback) {
        if (this === THREE.Euler.prototype) return;
        Object.defineProperty(this, '_onChangeCallback', {
            value: callback,
            writable: true,
            configurable: true
        });
    },
    configurable: false
});
Object.freeze(THREE.Euler.prototype);
Object.freeze(THREE.PerspectiveCamera.prototype);

// ===== PROCEDURAL TEXTURES =====
function finishCanvasTexture(canvas) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return texture;
}

const persistentTextures = new Set();
const sharedDoorTextures = new Map();

function getDoorTexture(tessNumber, accent) {
    if (sharedDoorTextures.has(tessNumber)) return sharedDoorTextures.get(tessNumber);
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    const rng = new Rng(fnv1a(`door-${tessNumber}`));

    const gradient = ctx.createLinearGradient(0, 0, size, 0);
    gradient.addColorStop(0, '#282828');
    gradient.addColorStop(0.5, '#504945');
    gradient.addColorStop(1, '#282828');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.42;
    ctx.lineWidth = 3;
    for (let x = 0; x <= size; x += 64) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke();
    }
    for (let y = 0; y <= size; y += 64) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 90; i++) {
        const x = rng.next() * size;
        const y = rng.next() * size;
        const length = 4 + rng.next() * 22;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rng.next() - 0.5) * 3, y + length); ctx.stroke();
    }

    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.55;
    for (const [x, y] of [[16,16],[240,16],[16,240],[240,240]]) {
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    const texture = finishCanvasTexture(canvas);
    persistentTextures.add(texture);
    sharedDoorTextures.set(tessNumber, texture);
    return texture;
}

// ===== PATHFINDING =====
let distances = {};
let guideNext = {};
function computeDistances() {
    distances = {};
    guideNext = {};
    distances['3.02'] = 0;
    const deque = ['3.02'];
    while (deque.length > 0) {
        const room = deque.shift();
        const d = distances[room];
        // Toggle edges (cost 0). The discovering room is recorded as the
        // next step on a true shortest path — distances alone can't pick
        // the warp, because toggle-paired rooms always tie (issue #3).
        const tog = roomToggles[room];
        if (tog && (distances[tog] === undefined || d < distances[tog])) {
            distances[tog] = d;
            guideNext[tog] = room;
            deque.unshift(tog);
        }
        // Navigation edges (cost 1)
        const nav = roomNavigation[room] || {};
        for (const dest of Object.values(nav)) {
            if (distances[dest] === undefined || d + 1 < distances[dest]) {
                distances[dest] = d + 1;
                guideNext[dest] = room;
                deque.push(dest);
            }
        }
    }
}

// ===== CHEAT: MAZE SOLVER =====
let cheatMode = false;

function solveMaze(grid) {
    return grid.guidePath || grid.findPath();
}

function edgeMidpoint(edge) {
    const [a, b] = edge.segment;
    return {x:(a.x + b.x) / 2, z:(a.z + b.z) / 2};
}

function applyOverlapVisibility(grid) {
    const region = grid?.overlapRegion;
    if (!region) return;
    for (const panel of region.panels || [])
        panel.visual.visible = panel.layer === region.activeLayer;
    for (const occluder of region.occluders || [])
        occluder.visual.visible = occluder.layer === region.activeLayer;
}

function setActiveOverlapLayer(grid, layer) {
    const region = grid?.overlapRegion;
    if (!region || region.activeLayer === layer) return;
    region.activeLayer = layer;
    applyOverlapVisibility(grid);
    grid._closedWallCache = null;
}

function doorRoomThreshold(room) {
    const [a, b] = room.panelEdge.segment;
    const dx = b.x - a.x, dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    const tangent = {x:dx / length, z:dz / length};
    const normal = room.panelNormal;
    const frame = edgeMidpoint(room.panelEdge);
    return {frame, tangent, normal};
}

function pointInDoorwayOpening(point, room) {
    if (!room) return false;
    const [a, b] = room.panelEdge.segment;
    const dx = b.x - a.x, dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    const midpoint = edgeMidpoint(room.panelEdge);
    const tangentDistance = Math.abs(
        (point.x - midpoint.x) * dx / length +
        (point.z - midpoint.z) * dz / length
    );
    const normalDistance = Math.abs(
        (point.x - midpoint.x) * room.panelNormal.x +
        (point.z - midpoint.z) * room.panelNormal.z
    );
    return tangentDistance < DOOR_W / 2 - P_RAD * 0.5 &&
        normalDistance <= DOORWAY_ESCAPE_DEPTH;
}

function addCheatPath(group, grid, path, color) {
    if (path.length < 2) return;
    const mat = new THREE.LineBasicMaterial({color, transparent: true, opacity: 0.5, depthWrite: false});
    const centerPoint = cell => new THREE.Vector3(cell.center.x, 0.1, cell.center.z);
    let segment = [centerPoint(path[0])];
    const flush = () => {
        if (segment.length < 2) { segment = []; return; }
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(segment), mat.clone()));
        segment = [];
    };
    for (let i = 0; i < path.length - 1; i++) {
        const from = path[i], to = path[i + 1];
        if (grid.areAdjacent(from, to)) {
            segment.push(centerPoint(to));
            continue;
        }
        flush();
        segment = [centerPoint(to)];
    }
    flush();
    mat.dispose();
}

function addCheatLine(group, grid) {
    addCheatPath(group, grid, solveMaze(grid), GRUVBOX.red);
}

function addHubDoorArrow(group, dir, color) {
    const angle = DIR_ANGLES[dir];
    const points = [
        new THREE.Vector3(0, 0.1, 0),
        new THREE.Vector3(Math.sin(angle) * (HUB_APO - 0.5), 0.1, -Math.cos(angle) * (HUB_APO - 0.5))
    ];
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({color, transparent: true, opacity: 0.5, depthWrite: false});
    group.add(new THREE.Line(geom, mat));
    // Arrow at the end
    const arrowGeo = new THREE.ConeGeometry(0.12, 0.25, 4);
    const arrowMat = new THREE.MeshBasicMaterial({color, transparent: true, opacity: 0.5});
    const arrow = new THREE.Mesh(arrowGeo, arrowMat);
    arrow.rotation.x = -Math.PI / 2;
    arrow.rotation.z = -angle;
    arrow.position.set(Math.sin(angle) * (HUB_APO - 0.3), 0.1, -Math.cos(angle) * (HUB_APO - 0.3));
    group.add(arrow);
}

function addHubCheatLine(group, roomId) {
    // Follow the BFS tree from computeDistances: guideNext[roomId] is the
    // next room on a true shortest path to the Entryway. Greedy neighbor
    // comparison oscillated on distance ties (issue #3).
    const next = guideNext[roomId];
    if (!next) return;
    const nav = roomNavigation[roomId] || {};
    let bestDir = null;
    for (const [dir, dest] of Object.entries(nav)) {
        if (dest === next) { bestDir = dir; break; }
    }
    const tog = roomToggles[roomId];
    if (tog === next) {
        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(1.38, 0.08, 8, 48),
            new THREE.MeshBasicMaterial({color: GRUVBOX.red, transparent: true, opacity: 0.8, depthWrite: false})
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.12;
        group.add(ring);

        const label = makeFloorInscription(`WARP \u2192 ${tog}`, '#ff6453', {
            size: 30,
            worldWidth: 2.6,
            worldHeight: 0.36,
            plaque: true
        });
        label.position.set(0, 0.14, 1.65);
        group.add(label);
        return;
    }
    if (!bestDir) return;
    addHubDoorArrow(group, bestDir, GRUVBOX.red);
}

function addHubOrbCheatLine(group, roomId) {
    const tess = getTess(roomId);
    if (!orbTesseracts().includes(tess) || collectedObelisks.has(tess)) return;
    const pairKey = orbPairKey(masterSeed, tess);
    if (!pairKey) return;
    const pairRooms = pairKey.split('|');
    let next = pairRooms.includes(roomId)
        ? pairRooms.find(room => room !== roomId)
        : null;

    if (!next) {
        const adjacency = new Map();
        const addNeighbor = (from, to) => {
            if (!adjacency.has(from)) adjacency.set(from, []);
            adjacency.get(from).push(to);
        };
        for (const [room, nav] of Object.entries(roomNavigation)) {
            if (getTess(room) !== tess) continue;
            for (const dest of Object.values(nav)) {
                if (getTess(dest) !== tess) continue;
                addNeighbor(room, dest);
                addNeighbor(dest, room);
            }
        }
        const targets = new Set(pairRooms);
        const previous = new Map([[roomId, null]]);
        const queue = [roomId];
        for (let cursor = 0; cursor < queue.length && !next; cursor++) {
            const current = queue[cursor];
            if (targets.has(current)) {
                let step = current;
                while (previous.get(step) !== roomId) step = previous.get(step);
                next = step;
                break;
            }
            for (const neighbor of adjacency.get(current) || []) {
                if (previous.has(neighbor)) continue;
                previous.set(neighbor, current);
                queue.push(neighbor);
            }
        }
    }

    const bestDir = Object.entries(roomNavigation[roomId] || {})
        .find(([, dest]) => dest === next)?.[0];
    if (bestDir) addHubDoorArrow(group, bestDir, TESSERACTS[tess].color);
}

// ===== THREE.JS SETUP =====
let scene, camera, renderer, controls;
const playerPos = new THREE.Vector3();
const trackedPos = {x: 0, z: 0};
const moveState = {forward:false, backward:false, left:false, right:false};
const JUMP_VELOCITY = 3.2;
const GRAVITY = 9.8;
let verticalVelocity = 0;
const moveForward = new THREE.Vector3();
const moveRight = new THREE.Vector3();
const moveDirection = new THREE.Vector3();
const minimapForward = new THREE.Vector3();
let currentGroup = null;
let gameState = 'GATE';
let currentRoomId = null;
let elapsedPlayMs = 0;
let playStartedAt = 0;
let mazeCount = 0;
let masterSeed = '';
let activeKey = '';
let seedLabel = '';
let isDailyRun = true;
let roomTrail = [];
let lastShareText = '';
let hardMode = false;
let hardEntireRun = false;
let shadeDisabled = false;
let shadeDisabledEntireRun = false;
let runStarted = false;
let cheatUsed = false;
let activeShade = null;
let lastArrivalDir = null;
let shadeRng = null;
let testMazeMode = false;
let playerLight = null;
let collectedObelisks = new Set();

function setupThree() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(GRUVBOX.bg);
    scene.fog = new THREE.Fog(GRUVBOX.bg, 1, 48);
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200);
    camera.position.set(0, EYE_H, 0);
    renderer = new THREE.WebGLRenderer({antialias: true});
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.7;
    document.body.appendChild(renderer.domElement);
    controls = new PointerLockControls(camera, document.body);
    scene.add(new THREE.AmbientLight(GRUVBOX.fg, 1.05));
    const hemi = new THREE.HemisphereLight(GRUVBOX.blue, GRUVBOX.bg1, 0.9);
    scene.add(hemi);
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

// ===== ARCHITECTURAL TEXT =====
// World text is always attached to a plane. Nothing billboards toward the
// camera, so labels read as plaques or inscriptions rather than HUD fragments.
function makeTextPanel(text, color = '#ebdbb2', {
    size = 28,
    canvasWidth = 512,
    canvasHeight = 96,
    worldWidth = 2.4,
    worldHeight = 0.45,
    plaque = true
} = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    if (plaque) {
        ctx.fillStyle = 'rgba(40,40,40,0.92)';
        ctx.fillRect(2, 2, canvasWidth - 4, canvasHeight - 4);
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 3;
        ctx.strokeRect(5, 5, canvasWidth - 10, canvasHeight - 10);
        ctx.globalAlpha = 1;
    }
    ctx.font = `${size}px 'JetBrainsMono Nerd Font', 'JetBrains Mono', monospace`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvasWidth / 2, canvasHeight / 2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({
        map:tex,
        transparent:true,
        side:THREE.DoubleSide,
        depthWrite:false,
        polygonOffset:true,
        polygonOffsetFactor:-1
    });
    return new THREE.Mesh(new THREE.PlaneGeometry(worldWidth, worldHeight), mat);
}

function makeFloorInscription(text, color, options = {}) {
    const inscription = makeTextPanel(text, color, {...options, plaque:options.plaque ?? false});
    inscription.rotation.x = -Math.PI / 2;
    return inscription;
}

// ===== CLEAR SCENE =====
function disposeMaterial(material) {
    if (!material) return;
    for (const value of Object.values(material)) {
        if (value && value.isTexture && !persistentTextures.has(value)) value.dispose();
    }
    material.dispose();
}

function disposeObjectTree(group) {
    if (!group) return;
    group.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
            if (Array.isArray(obj.material)) obj.material.forEach(disposeMaterial);
            else disposeMaterial(obj.material);
        }
    });
}

function clearScene() {
    if (currentGroup) {
        scene.remove(currentGroup);
        disposeObjectTree(currentGroup);
        currentGroup = null;
    }
    // Remove any extra lights
    const toRemove = [];
    scene.traverse(obj => { if (obj.isPointLight && !obj._permanent) toRemove.push(obj); });
    toRemove.forEach(l => scene.remove(l));
}

// ===== HUB STATE =====
let hubDoorOpen = null;        // direction string or null
let hubDoorPanels = {};        // dir -> mesh (sealed door panel)
let hubClickables = [];        // raycasting targets
let mazeOrbClickables = [];
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2(0, 0); // center of screen

// ===== HUB BUILDER =====
function buildHub(roomId, {preview = false, openDirection = null} = {}) {
    const group = new THREE.Group();
    const tessNum = getTess(roomId);
    const tess = TESSERACTS[tessNum];
    const color = new THREE.Color(tess.color);
    const nav = roomNavigation[roomId] || {};
    const isControl = CONTROL_ROOMS.includes(roomId);

    if (!preview) {
        hubDoorOpen = null;
        hubDoorPanels = {};
        hubClickables = [];
    }

    // Materials
    const wallSolid = new THREE.MeshStandardMaterial({color: GRUVBOX.bg2, side: THREE.DoubleSide, roughness: 0.88});
    const floorMat = new THREE.MeshStandardMaterial({color: GRUVBOX.bg1, side: THREE.DoubleSide, roughness: 0.92});

    function addWallEdges(geometry, mesh) {
        const edgeGeometry = new THREE.EdgesGeometry(geometry);
        const edgeMaterial = new THREE.LineBasicMaterial({color, transparent: true, opacity: 0.38});
        const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
        edges.position.copy(mesh.position);
        edges.rotation.copy(mesh.rotation);
        group.add(edges);
    }

    // Floor
    const floorShape = new THREE.Shape();
    for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI / 4) + Math.PI / 8;
        const x = Math.sin(a) * HUB_RAD, z = -Math.cos(a) * HUB_RAD;
        i === 0 ? floorShape.moveTo(x, z) : floorShape.lineTo(x, z);
    }
    floorShape.closePath();
    const floorGeom = new THREE.ShapeGeometry(floorShape);
    const floor = new THREE.Mesh(floorGeom, floorMat);
    floor.rotation.x = -Math.PI / 2;
    group.add(floor);

    // Ceiling
    const ceil = new THREE.Mesh(floorGeom.clone(), floorMat.clone());
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = HUB_H;
    group.add(ceil);

    // Walls
    for (const dir of DIRECTIONS) {
        const angle = DIR_ANGLES[dir];
        const isPreviewOpening = preview && dir === openDirection;
        const hasDoor = !!nav[dir] || isPreviewOpening;
        const nx = Math.sin(angle), nz = -Math.cos(angle);
        const wx = nx * HUB_APO, wz = nz * HUB_APO;
        const wallLen = 2 * HUB_RAD * Math.sin(Math.PI / 8);
        const tx = Math.cos(angle), tz = Math.sin(angle);

        if (hasDoor) {
            const halfWall = wallLen / 2;
            const halfDoor = DOOR_W / 2;
            // Left wall segment
            const lgw = halfWall - halfDoor;
            if (lgw > 0.01) {
                const lg = new THREE.BoxGeometry(lgw, HUB_H, WALL_T);
                const lm = new THREE.Mesh(lg, wallSolid);
                lm.position.set(wx - tx * (halfDoor + lgw / 2), HUB_H / 2, wz - tz * (halfDoor + lgw / 2));
                lm.rotation.y = -angle;
                group.add(lm);
                addWallEdges(lg, lm);
            }
            // Right wall segment
            if (lgw > 0.01) {
                const rg = new THREE.BoxGeometry(lgw, HUB_H, WALL_T);
                const rm = new THREE.Mesh(rg, wallSolid);
                rm.position.set(wx + tx * (halfDoor + lgw / 2), HUB_H / 2, wz + tz * (halfDoor + lgw / 2));
                rm.rotation.y = -angle;
                group.add(rm);
                addWallEdges(rg, rm);
            }
            // Top segment above door
            const topH = HUB_H - DOOR_H;
            if (topH > 0.01) {
                const tg = new THREE.BoxGeometry(DOOR_W, topH, WALL_T);
                const tm = new THREE.Mesh(tg, wallSolid);
                tm.position.set(wx, DOOR_H + topH / 2, wz);
                tm.rotation.y = -angle;
                group.add(tm);
                addWallEdges(tg, tm);
            }

            if (!isPreviewOpening) {
                // Sealed door panel (blocks the opening until clicked)
                const dest = nav[dir];
                const dt = TESSERACTS[getTess(dest)];
                const doorColor = new THREE.Color(dt.color);
                const doorMat = new THREE.MeshStandardMaterial({
                    map: getDoorTexture(getTess(dest), dt.color),
                    color: GRUVBOX.fg,
                    emissive: doorColor,
                    emissiveIntensity: 0.07,
                    metalness: 0.35,
                    roughness: 0.72,
                    side: THREE.DoubleSide
                });
                const doorGeom = new THREE.BoxGeometry(DOOR_W, DOOR_H, 0.08);
                const doorPanel = new THREE.Mesh(doorGeom, doorMat);
                doorPanel.position.set(wx, DOOR_H / 2, wz);
                doorPanel.rotation.y = -angle;
                doorPanel.userData = {isDoor: true, direction: dir, destination: dest};
                group.add(doorPanel);
                if (!preview) {
                    hubDoorPanels[dir] = doorPanel;
                    hubClickables.push(doorPanel);
                }

                // Wireframe on door panel
                const doorWireGeom = new THREE.EdgesGeometry(doorGeom);
                const doorWireMat = new THREE.LineBasicMaterial({color: doorColor, transparent: true, opacity: 0.6});
                const doorWire = new THREE.LineSegments(doorWireGeom, doorWireMat);
                doorWire.position.copy(doorPanel.position);
                doorWire.rotation.copy(doorPanel.rotation);
                doorPanel._wire = doorWire;
                group.add(doorWire);

                if (cheatMode && !preview && !collectedObelisks.has(tessNum) &&
                    isOrbMaze(masterSeed, roomId, dest)) {
                    const marker = new THREE.Mesh(
                        new THREE.TorusGeometry(0.3, 0.03, 8, 24),
                        new THREE.MeshBasicMaterial({color: tess.color})
                    );
                    marker.rotation.x = -Math.PI / 2;
                    marker.position.set(wx, 0.08, wz);
                    group.add(marker);
                }

                // Destination and interaction text are plaques fixed to the door,
                // rather than camera-facing labels suspended in the room.
                const label = makeTextPanel(`${dest} · ${dt.name.toUpperCase()}`, dt.color, {
                    size: 30,
                    worldWidth: 1.72,
                    worldHeight: 0.34
                });
                label.position.set(wx - nx * 0.055, 2.35, wz - nz * 0.055);
                label.rotation.y = -angle;
                doorPanel._label = label;
                group.add(label);

                const sigil = makeTextPanel('OPEN · CLICK / E', dt.color, {
                    size: 25,
                    worldWidth: 1.62,
                    worldHeight: 0.3
                });
                sigil.position.set(wx - nx * 0.058, 1.25, wz - nz * 0.058);
                sigil.rotation.y = -angle;
                doorPanel._sigil = sigil;
                group.add(sigil);
            }

        } else {
            // Solid wall (no door)
            const wg = new THREE.BoxGeometry(wallLen, HUB_H, WALL_T);
            const wm = new THREE.Mesh(wg, wallSolid);
            wm.position.set(wx, HUB_H / 2, wz);
            wm.rotation.y = -angle;
            group.add(wm);
            addWallEdges(wg, wm);
        }
    }

    // Toggle portal
    const togDest = roomToggles[roomId];
    if (togDest) {
        const portalColor = isControl ? GRUVBOX.aqua : GRUVBOX.yellow;
        const torus = new THREE.TorusGeometry(1.2, 0.06, 8, 32);
        const torusMat = new THREE.MeshBasicMaterial({color: portalColor, transparent: true, opacity: 0.5});
        const portal = new THREE.Mesh(torus, torusMat);
        portal.rotation.x = -Math.PI / 2;
        portal.position.y = 0.05;
        group.add(portal);
        const pLight = new THREE.PointLight(portalColor, 0.6, 6);
        pLight.position.set(0, 0.5, 0);
        group.add(pLight);
        const inner = new THREE.TorusGeometry(0.6, 0.03, 8, 24);
        const innerMat = new THREE.MeshBasicMaterial({color: portalColor, transparent: true, opacity: 0.3});
        const innerMesh = new THREE.Mesh(inner, innerMat);
        innerMesh.rotation.x = -Math.PI / 2;
        innerMesh.position.y = 0.04;
        group.add(innerMesh);

        // Broad invisible target so the floor portal is practical to click.
        const warpTarget = new THREE.Mesh(
            new THREE.CircleGeometry(1.35, 32),
            new THREE.MeshBasicMaterial({transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false})
        );
        warpTarget.rotation.x = -Math.PI / 2;
        warpTarget.position.y = 0.08;
        warpTarget.userData = {isWarp: true, destination: togDest};
        group.add(warpTarget);
        if (!preview) hubClickables.push(warpTarget);
    }

    // Central orb (near ceiling, main light source — matches original FPS)
    const orbY = HUB_H - 0.8;
    const orbGeo = new THREE.SphereGeometry(0.5, 32, 32);
    const orbMat = new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 0.8, metalness: 0.3, roughness: 0.2
    });
    const orb = new THREE.Mesh(orbGeo, orbMat);
    orb.position.set(0, orbY, 0);
    if (togDest) orb.userData = {isWarp: true, destination: togDest};
    group.add(orb);
    if (togDest && !preview) hubClickables.push(orb);
    const orbLight = new THREE.PointLight(color, 3.5, 22);
    orbLight.position.set(0, orbY, 0);
    group.add(orbLight);

    // Floor ring beneath orb
    const ringGeo = new THREE.TorusGeometry(1.0, 0.04, 8, 48);
    const ringMat = new THREE.MeshBasicMaterial({color, transparent: true, opacity: 0.4, depthWrite: false});
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.06, 0);
    group.add(ring);

    // Compass arrow pointing North (-Z) — 3D box so visible from all angles
    const compassLen = 2.0;
    const compassGeo = new THREE.BoxGeometry(0.08, 0.06, compassLen);
    const compassMat = new THREE.MeshBasicMaterial({color, transparent: true, opacity: 0.5});
    const compassLine = new THREE.Mesh(compassGeo, compassMat);
    compassLine.position.set(0, 0.08, -compassLen / 2);
    group.add(compassLine);
    // Arrowhead
    const arrowGeo = new THREE.ConeGeometry(0.15, 0.3, 4);
    const arrowMat = new THREE.MeshBasicMaterial({color, transparent: true, opacity: 0.6});
    const arrow = new THREE.Mesh(arrowGeo, arrowMat);
    arrow.rotation.x = -Math.PI / 2;
    arrow.position.set(0, 0.08, -compassLen - 0.1);
    group.add(arrow);

    // Compass and room identity are inlaid into the floor.
    const nLabel = makeFloorInscription('N', tess.color, {
        size: 38,
        canvasWidth: 128,
        canvasHeight: 128,
        worldWidth: 0.42,
        worldHeight: 0.42
    });
    nLabel.position.set(0, 0.085, -compassLen - 0.5);
    group.add(nLabel);

    const roomLabel = makeFloorInscription(`${roomId} · ${tess.name.toUpperCase()}`, tess.color, {
        size: 30,
        worldWidth: 3.2,
        worldHeight: 0.42,
        plaque: true
    });
    roomLabel.position.set(0, 0.075, 2.0);
    group.add(roomLabel);

    if (cheatMode && !preview) {
        addHubCheatLine(group, roomId);
        addHubOrbCheatLine(group, roomId);
    }

    return group;
}

function openHubDoor(dir) {
    // Close any currently open door
    if (hubDoorOpen && hubDoorPanels[hubDoorOpen]) {
        const old = hubDoorPanels[hubDoorOpen];
        old.visible = true;
        if (old._wire) old._wire.visible = true;
        if (old._label) old._label.visible = true;
        if (old._sigil) old._sigil.visible = true;
    }
    // Detach previous maze
    detachMaze();
    // Open the clicked door
    hubDoorOpen = dir;
    const panel = hubDoorPanels[dir];
    if (panel) {
        panel.visible = false;
        if (panel._wire) panel._wire.visible = false;
        if (panel._label) panel._label.visible = false;
        if (panel._sigil) panel._sigil.visible = false;
    }
    // Generate and attach the maze beyond this door
    attachMaze(dir);
}

function interactWithHub(allowNearbyWarp = false) {
    if (gameState !== 'HUB' || !controls.isLocked) return;
    raycaster.setFromCamera(pointer, camera);
    if (playerInMaze) {
        const visibleHit = raycaster.intersectObjects(mazeOrbClickables)
            .find(hit => hit.distance <= 3 && hit.object.visible);
        if (!visibleHit) return;
        const orb = visibleHit.object;
        const {tess} = orb.userData;
        if (!orb.userData.isObelisk || collectedObelisks.has(tess)) return;
        collectedObelisks.add(tess);
        orb.visible = false;
        if (orb._obeliskLight) orb._obeliskLight.visible = false;
        mazeOrbClickables = mazeOrbClickables.filter(clickable => clickable !== orb);
        showEventMessage(`${TESSERACTS[tess].emoji} ${TESSERACTS[tess].name.toUpperCase()} OBELISK CLAIMED`);
        return;
    }
    const hits = raycaster.intersectObjects(hubClickables);
    const visibleHit = hits.find(hit => hit.object.visible);
    if (visibleHit) {
        const hit = visibleHit.object;
        if (hit.userData.isDoor) {
            openHubDoor(hit.userData.direction);
            return;
        }
        if (hit.userData.isWarp) {
            enterHub(hit.userData.destination);
            return;
        }
    }
    if (allowNearbyWarp) triggerToggle();
}

function onHubClick() {
    interactWithHub(false);
}

// ===== MAZE BUILDER =====
function buildMazeScene(mazeGrid, srcRoom, dstRoom) {
    mazeOrbClickables = [];
    const group = new THREE.Group();
    const accent = new THREE.Color(TESSERACTS[getTess(dstRoom)].color);
    const wallColor = new THREE.Color(GRUVBOX.bg1).lerp(accent, 0.1);
    const wallMaterial = new THREE.MeshStandardMaterial({color:wallColor, roughness:0.9, metalness:0.08});
    const floorMaterial = new THREE.MeshStandardMaterial({color:GRUVBOX.bgHard, roughness:0.94, side:THREE.DoubleSide});
    const ceilingMaterial = new THREE.MeshStandardMaterial({color:GRUVBOX.bg, roughness:0.94, side:THREE.DoubleSide});
    const wallEdgeMaterial = new THREE.LineBasicMaterial({color:accent, transparent:true, opacity:0.45, depthWrite:false});

    function segmentKey(edge) {
        const pointKey = point => `${point.x.toFixed(5)},${point.z.toFixed(5)}`;
        return edge.segment.map(pointKey).sort().join('|');
    }

    function addWallEdges(mesh, colorMaterial = wallEdgeMaterial) {
        const lines = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 25), colorMaterial);
        mesh.add(lines);
    }

    function addWallSegment(edge, material = wallMaterial, edgeMaterial = wallEdgeMaterial) {
        const [a, b] = edge.segment;
        const dx = b.x - a.x, dz = b.z - a.z;
        const length = Math.hypot(dx, dz);
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, WALL_H, WALL_T), material);
        mesh.position.set((a.x + b.x) / 2, WALL_H / 2, (a.z + b.z) / 2);
        mesh.rotation.y = -Math.atan2(dz, dx);
        group.add(mesh);
        addWallEdges(mesh, edgeMaterial);
        return mesh;
    }

    function addDoorwayWall(edge, doorwayWidth = DOOR_W) {
        const [a, b] = edge.segment;
        const dx = b.x - a.x, dz = b.z - a.z;
        const length = Math.hypot(dx, dz);
        const tx = dx / length, tz = dz / length;
        const midpoint = edgeMidpoint(edge);
        const capLength = Math.max(0, (length - doorwayWidth) / 2);
        for (const side of [-1, 1]) {
            if (capLength <= 0.001) continue;
            const inner = {
                x:midpoint.x + tx * side * doorwayWidth / 2,
                z:midpoint.z + tz * side * doorwayWidth / 2
            };
            const outer = {
                x:midpoint.x + tx * side * length / 2,
                z:midpoint.z + tz * side * length / 2
            };
            addWallSegment({segment:[inner, outer]});
        }
        const lintelHeight = WALL_H - DOOR_H;
        if (lintelHeight > 0.001) {
            const lintel = new THREE.Mesh(
                new THREE.BoxGeometry(doorwayWidth, lintelHeight, WALL_T),
                wallMaterial
            );
            lintel.position.set(midpoint.x, DOOR_H + lintelHeight / 2, midpoint.z);
            lintel.rotation.y = -Math.atan2(dz, dx);
            group.add(lintel);
            addWallEdges(lintel);
        }
    }

    function polygonGeometry(cell) {
        const shape = new THREE.Shape();
        cell.vertices.forEach((point, index) => {
            if (index === 0) shape.moveTo(point.x, point.z);
            else shape.lineTo(point.x, point.z);
        });
        shape.closePath();
        return new THREE.ShapeGeometry(shape);
    }

    for (const cell of mazeGrid.cells) {
        if (cell.layer === 'b') continue;
        const floor = new THREE.Mesh(polygonGeometry(cell), floorMaterial);
        floor.rotation.x = Math.PI / 2;
        floor.position.y = 0;
        group.add(floor);
        if (cell.doorRoom) continue;
        const ceiling = new THREE.Mesh(polygonGeometry(cell), ceilingMaterial);
        ceiling.rotation.x = Math.PI / 2;
        ceiling.position.y = WALL_H;
        group.add(ceiling);
    }

    const rotatingCell = mazeGrid.rotatingChamber?.cell;
    const staticWalls = new Set();
    for (const cell of mazeGrid.cells) {
        if (cell.layerRegion) continue;
        for (const edge of cell.edges) {
            if (edge.open) continue;
            if (rotatingCell && (cell === rotatingCell || edge.neighbor === rotatingCell)) continue;
            const key = segmentKey(edge);
            if (staticWalls.has(key)) continue;
            staticWalls.add(key);
            if (edge === mazeGrid.entranceDoorRoom?.panelEdge ||
                edge === mazeGrid.exitDoorRoom?.panelEdge) {
                addDoorwayWall(edge);
                continue;
            }
            addWallSegment(edge);
        }
    }

    if (mazeGrid.overlapRegion) {
        const region = mazeGrid.overlapRegion;
        const regionWalls = new Set();
        region.panels = [];
        region.occluders = [];
        for (const cellA of region.cellsA) {
            for (const edgeA of cellA.edges) {
                if (edgeA.neighbor?.layerRegion !== region) continue;
                const key = segmentKey(edgeA);
                if (regionWalls.has(key)) continue;
                regionWalls.add(key);
                const edgeB = cellA.twin.edges[edgeA.index];
                if (edgeA.open === edgeB.open) {
                    if (!edgeA.open) addWallSegment(edgeA);
                    continue;
                }
                const layer = edgeA.open ? 'b' : 'a';
                const edge = layer === 'a' ? edgeA : edgeB;
                region.panels.push({layer, visual:addWallSegment(edge)});
            }
        }
        for (const portal of region.portals) {
            const edge = {segment:portal.segment};
            addDoorwayWall(edge, OVERLAP_PORTAL_W);
            const [a, b] = portal.segment;
            const dx = b.x - a.x, dz = b.z - a.z;
            const length = Math.hypot(dx, dz);
            const midpoint = edgeMidpoint(edge);
            let rotation = -Math.atan2(dz, dx);
            const nx = -dz / length, nz = dx / length;
            if ((portal.vestibule.center.x - midpoint.x) * nx +
                (portal.vestibule.center.z - midpoint.z) * nz < 0) rotation += Math.PI;
            const visual = new THREE.Mesh(
                new THREE.PlaneGeometry(OVERLAP_PORTAL_W, DOOR_H),
                new THREE.MeshStandardMaterial({color:GRUVBOX.bgHard, side:THREE.FrontSide})
            );
            visual.position.set(midpoint.x, DOOR_H / 2, midpoint.z);
            visual.rotation.y = rotation;
            group.add(visual);
            region.occluders.push({layer:portal.severedEdge.cell.layer, visual});
            if (cheatMode) {
                const color = OVERLAP_LAYER_COLORS[portal.layer];
                const marker = new THREE.Mesh(
                    new THREE.TorusGeometry(0.35, 0.055, 8, 24),
                    new THREE.MeshBasicMaterial({color})
                );
                marker.rotation.x = -Math.PI / 2;
                marker.position.set(midpoint.x, 0.1, midpoint.z);
                group.add(marker);
                const light = new THREE.PointLight(color, 1.2, 4.5);
                light.position.set(midpoint.x, 0.25, midpoint.z);
                group.add(light);
            }
        }
        applyOverlapVisibility(mazeGrid);
    }

    if (mazeGrid.rotatingChamber) {
        const chamber = mazeGrid.rotatingChamber;
        const rotorEdgeMaterial = new THREE.LineBasicMaterial({color:GRUVBOX.yellow, transparent:true, opacity:0.72});
        chamber.panels = chamber.cell.edges.map(edge => ({
            edge,
            visual:addWallSegment(edge, wallMaterial, rotorEdgeMaterial)
        }));
        for (const panel of chamber.panels) panel.visual.visible = !panel.edge.open;
    }

    function addDoorRoom(room, color) {
        if (!room) return;
        const center = room.center;
        room.panelOpen = true;

        for (const cell of room.cells) {
            const cap = new THREE.Mesh(polygonGeometry(cell), ceilingMaterial);
            cap.rotation.x = Math.PI / 2;
            cap.position.y = WALL_H;
            group.add(cap);
        }

        const light = new THREE.PointLight(color, 1.0, 4.5);
        light.position.set(center.x, WALL_H - 0.38, center.z);
        group.add(light);
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.42, Math.min(1.05, mazeGrid.edgeLen * 0.32), 6),
            new THREE.MeshBasicMaterial({color, transparent:true, opacity:0.45, side:THREE.DoubleSide})
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(center.x, 0.025, center.z);
        group.add(ring);
    }

    addDoorRoom(mazeGrid.entranceDoorRoom, GRUVBOX.green);
    addDoorRoom(mazeGrid.exitDoorRoom, TESSERACTS[getTess(dstRoom)].color);

    const exitRoom = mazeGrid.exitDoorRoom;
    if (exitRoom) {
        const returnDir = findReturnDir(srcRoom, dstRoom) || DIRECTIONS[0];
        const exitMid = edgeMidpoint(exitRoom.panelEdge);
        const returnAngle = DIR_ANGLES[returnDir];
        const returnNormal = {x:Math.sin(returnAngle), z:-Math.cos(returnAngle)};
        const targetNormal = {x:-exitRoom.panelNormal.x, z:-exitRoom.panelNormal.z};
        const preview = buildHub(dstRoom, {preview:true, openDirection:returnDir});
        preview.position.set(
            exitMid.x + exitRoom.panelNormal.x * HUB_APO,
            0,
            exitMid.z + exitRoom.panelNormal.z * HUB_APO
        );
        preview.rotation.y = Math.atan2(returnNormal.z, returnNormal.x) -
            Math.atan2(targetNormal.z, targetNormal.x);
        group.add(preview);
        mazeGrid.exitPreview = preview;
    }

    // Boundary edges stay physically sealed; a fold crosses their plane and
    // reappears at its pair without placing geometry outside maze space.
    if (mazeGrid.spaceFold) {
        const foldColor = GRUVBOX.purple;
        const addFoldMarker = (endpoint, label) => {
            const {x, z} = edgeMidpoint(endpoint.edge);
            const light = new THREE.PointLight(foldColor, 1.4, 9);
            light.position.set(x, 1, z);
            group.add(light);
            const ring = new THREE.Mesh(
                new THREE.RingGeometry(0.48, 0.76, 32),
                new THREE.MeshBasicMaterial({color:foldColor, transparent:true, opacity:0.8, side:THREE.DoubleSide})
            );
            ring.rotation.x = -Math.PI / 2;
            ring.position.set(x, 0.03, z);
            group.add(ring);
            const foldLabel = makeFloorInscription(label, '#d3869b', {
                size: 28,
                worldWidth: 1.72,
                worldHeight: 0.34,
                plaque: true
            });
            foldLabel.position.set(endpoint.cell.center.x, 0.055, endpoint.cell.center.z);
            group.add(foldLabel);
        };
        addFoldMarker(mazeGrid.spaceFold.a, 'FOLD α');
        addFoldMarker(mazeGrid.spaceFold.b, 'FOLD β');
    }

    // One-way thresholds remain visually open. Floor arrows show the legal
    // direction and small posts mark the collision plane without resembling a
    // solid wall.
    for (const gate of mazeGrid.oneWayGates) {
        const gateColor = GRUVBOX.aqua;
        const fromX = gate.from.center.x;
        const fromZ = gate.from.center.z;
        const toX = gate.to.center.x;
        const toZ = gate.to.center.z;
        const dx = toX - fromX, dz = toZ - fromZ;
        const length = Math.hypot(dx, dz);
        const ux = dx / length, uz = dz / length;
        const px = -uz, pz = ux;
        const mx = (fromX + toX) / 2, mz = (fromZ + toZ) / 2;
        const tipX = mx + ux * 0.65, tipZ = mz + uz * 0.65;
        const baseX = tipX - ux * 0.34, baseZ = tipZ - uz * 0.34;
        const arrowPoints = [
            new THREE.Vector3(mx - ux * 0.65, 0.06, mz - uz * 0.65),
            new THREE.Vector3(tipX, 0.06, tipZ),
            new THREE.Vector3(tipX, 0.06, tipZ),
            new THREE.Vector3(baseX + px * 0.28, 0.06, baseZ + pz * 0.28),
            new THREE.Vector3(tipX, 0.06, tipZ),
            new THREE.Vector3(baseX - px * 0.28, 0.06, baseZ - pz * 0.28)
        ];
        const arrowGeometry = new THREE.BufferGeometry().setFromPoints(arrowPoints);
        const arrowMaterial = new THREE.LineBasicMaterial({color:gateColor, transparent:true, opacity:0.95, depthWrite:false});
        group.add(new THREE.LineSegments(arrowGeometry, arrowMaterial));

        const postGeometry = new THREE.CylinderGeometry(0.04, 0.04, 0.75, 8);
        const postMaterial = new THREE.MeshBasicMaterial({color:gateColor, transparent:true, opacity:0.75});
        for (const side of [-1, 1]) {
            const post = new THREE.Mesh(postGeometry.clone(), postMaterial.clone());
            post.position.set(mx + px * 0.82 * side, 0.375, mz + pz * 0.82 * side);
            group.add(post);
        }
        postGeometry.dispose();
        postMaterial.dispose();

        const gateLight = new THREE.PointLight(gateColor, 0.55, 4.5);
        gateLight.position.set(mx, 0.5, mz);
        group.add(gateLight);
    }

    if (mazeGrid.spatialLoop) {
        const loop = mazeGrid.spatialLoop;
        const loopColor = GRUVBOX.blue;
        const loopCss = '#83a598';
        const addLoopMarker = (cell, label) => {
            const {x, z} = cell.center;
            const ring = new THREE.Mesh(
                new THREE.RingGeometry(0.42, 0.72, 32),
                new THREE.MeshBasicMaterial({color:loopColor, transparent:true, opacity:0.82, side:THREE.DoubleSide})
            );
            ring.rotation.x = -Math.PI / 2;
            ring.position.set(x, 0.045, z);
            group.add(ring);
            const core = new THREE.Mesh(
                new THREE.CircleGeometry(0.24, 24),
                new THREE.MeshBasicMaterial({color:loopColor, transparent:true, opacity:0.25, side:THREE.DoubleSide})
            );
            core.rotation.x = -Math.PI / 2;
            core.position.set(x, 0.04, z);
            group.add(core);
            const text = makeFloorInscription(label, loopCss, {
                size: 46,
                canvasWidth: 128,
                canvasHeight: 128,
                worldWidth: 0.36,
                worldHeight: 0.36
            });
            text.position.set(x, 0.065, z);
            group.add(text);
            const light = new THREE.PointLight(loopColor, 0.8, 5.5);
            light.position.set(x, 0.65, z);
            group.add(light);
        };
        addLoopMarker(loop.a, 'α');
        addLoopMarker(loop.b, 'β');
    }

    if (mazeGrid.rotatingChamber) {
        const chamber = mazeGrid.rotatingChamber;
        const {x, z} = chamber.cell.center;
        const plate = new THREE.Mesh(
            new THREE.RingGeometry(0.42, 0.82, 32),
            new THREE.MeshBasicMaterial({color:GRUVBOX.yellow, transparent:true, opacity:0.82, side:THREE.DoubleSide})
        );
        plate.rotation.x = -Math.PI / 2;
        plate.position.set(x, 0.045, z);
        group.add(plate);
        const rotor = new THREE.Group();
        rotor.position.set(x, 0.075, z);
        const rotorGeometry = new THREE.BufferGeometry().setFromPoints(
            chamber.cell.vertices.flatMap(point => [
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3((point.x - x) * 0.5, 0, (point.z - z) * 0.5)
            ])
        );
        rotor.add(new THREE.LineSegments(rotorGeometry, new THREE.LineBasicMaterial({color:GRUVBOX.yellow, transparent:true, opacity:0.95})));
        group.add(rotor);
        chamber.visual = rotor;
        const label = makeFloorInscription('ROTATE', '#fabd2f', {
            size: 28,
            worldWidth: 1.4,
            worldHeight: 0.32,
            plaque: true
        });
        label.position.set(x, 0.055, z + 1.05);
        group.add(label);
        const light = new THREE.PointLight(GRUVBOX.yellow, 0.9, 6);
        light.position.set(x, 0.75, z);
        group.add(light);
    }

    // Chambers
    const chamberCenters = new Set();
    for (const c of mazeGrid.cells) {
        if (!c.chamber || !c.chamberCenter) continue;
        const key = c.chamberId;
        if (chamberCenters.has(key)) continue;
        chamberCenters.add(key);

        const ccx = c.center.x, ccz = c.center.z;

        // Chamber floor highlight
        const chFloor = new THREE.Mesh(
            new THREE.CircleGeometry(Math.min(1.2, mazeGrid.edgeLen * 0.32), c.vertices.length),
            new THREE.MeshBasicMaterial({color: GRUVBOX.bgHard, transparent: true, opacity: 0.3, side: THREE.DoubleSide})
        );
        chFloor.rotation.x = -Math.PI / 2;
        chFloor.position.set(ccx, 0.01, ccz);
        group.add(chFloor);

        // Chamber light
        const chLight = new THREE.PointLight(GRUVBOX.blue, 0.5, 6);
        chLight.position.set(ccx, WALL_H - 0.3, ccz);
        group.add(chLight);

    }

    const orbChamber = mazeGrid.orbChamber;
    if (orbChamber && !collectedObelisks.has(orbChamber.tess)) {
        const {x, z} = orbChamber.center.center;
        const tess = orbChamber.tess;
        const color = TESSERACTS[tess].color;
        const orb = new THREE.Mesh(
            new THREE.SphereGeometry(0.35, 24, 24),
            new THREE.MeshStandardMaterial({
                color,
                emissive:color,
                emissiveIntensity:0.6,
                metalness:0.25,
                roughness:0.24
            })
        );
        orb.position.set(x, 1.4, z);
        orb.userData = {isObelisk:true, tess};
        group.add(orb);
        const light = new THREE.PointLight(color, 1.0, 5);
        light.position.copy(orb.position);
        group.add(light);
        orb._obeliskLight = light;
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.38, 0.68, 32),
            new THREE.MeshBasicMaterial({color, transparent:true, opacity:0.68, side:THREE.DoubleSide})
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(x, 0.035, z);
        group.add(ring);
        mazeOrbClickables.push(orb);
    }

    // Traps
    for (const c of mazeGrid.cells) {
        if (!c.trap) continue;
        const tcx = c.center.x, tcz = c.center.z;
        // Glowing rune circle
        const runeGeom = new THREE.RingGeometry(0.3, 0.5, 6);
        const runeMat = new THREE.MeshBasicMaterial({color: GRUVBOX.red, transparent: true, opacity: 0.35, side: THREE.DoubleSide});
        const rune = new THREE.Mesh(runeGeom, runeMat);
        rune.rotation.x = -Math.PI / 2;
        rune.position.set(tcx, 0.02, tcz);
        group.add(rune);
        // Inner dot
        const dot = new THREE.Mesh(
            new THREE.CircleGeometry(0.15, 8),
            new THREE.MeshBasicMaterial({color: GRUVBOX.red, transparent: true, opacity: 0.2, side: THREE.DoubleSide})
        );
        dot.rotation.x = -Math.PI / 2;
        dot.position.set(tcx, 0.02, tcz);
        group.add(dot);
    }

    // Dormant lair apparition — only when no Shade is already loose in the run
    if (mazeGrid.hunter && !activeShade && !shadeDisabled) {
        const hunter = mazeGrid.hunter;
        const shade = makeShadeVisual();
        shade.position.set(hunter.x, 0, hunter.z);
        group.add(shade);
        hunter.visual = shade;
    }

    // Player light (follows camera, added to scene not group)
    playerLight = new THREE.PointLight(GRUVBOX.fg, 1.15, 20);
    playerLight.position.set(playerPos.x, playerPos.y, playerPos.z);
    scene.add(playerLight);

    if (cheatMode) addCheatLine(group, mazeGrid);
    if (cheatMode && mazeGrid.orbChamber &&
        !collectedObelisks.has(mazeGrid.orbChamber.tess)) {
        let orbPath = mazeGrid.findPath(
            mazeGrid.entranceCell,
            mazeGrid.orbChamber.center
        );
        if (!orbPath.length) {
            orbPath = mazeGrid.findPath(
                mazeGrid.entranceCell,
                mazeGrid.orbChamber.center,
                {respectOneWay:false}
            );
        }
        addCheatPath(
            group,
            mazeGrid,
            orbPath,
            TESSERACTS[mazeGrid.orbChamber.tess].color
        );
    }

    return group;
}

// ===== ATTACHED MAZE STATE =====
let attachedMazeGroup = null;
let attachedMazeGrid = null;
let attachedMazeParams = null;
let attachedMazeDest = null;
let playerInMaze = false;
let mazeSpaceActive = false;
let minimapBase = null;
let minimapLayout = null;

// Find return direction: from destRoom, which dir goes back to srcRoom?
function findReturnDir(srcRoom, destRoom) {
    const nav = roomNavigation[destRoom] || {};
    for (const [dir, room] of Object.entries(nav)) {
        if (room === srcRoom) return dir;
    }
    return null;
}

// Transform between world coords and maze-local coords
function worldToMazeLocal(wx, wz) {
    if (!attachedMazeGroup) return {x: wx, z: wz};
    const a = attachedMazeGroup.rotation.y;
    const dx = wx - attachedMazeGroup.position.x;
    const dz = wz - attachedMazeGroup.position.z;
    return {
        x: dx * Math.cos(a) - dz * Math.sin(a),
        z: dx * Math.sin(a) + dz * Math.cos(a)
    };
}
function mazeLocalToWorld(lx, lz) {
    if (!attachedMazeGroup) return {x: lx, z: lz};
    const a = attachedMazeGroup.rotation.y;
    return {
        x: lx * Math.cos(a) + lz * Math.sin(a) + attachedMazeGroup.position.x,
        z: -lx * Math.sin(a) + lz * Math.cos(a) + attachedMazeGroup.position.z
    };
}

function captureMazeExitPose() {
    const preview = attachedMazeGrid?.exitPreview;
    if (!attachedMazeGroup || !preview) return null;

    const local = worldToMazeLocal(playerPos.x, playerPos.z);
    const dx = local.x - preview.position.x;
    const dz = local.z - preview.position.z;
    const previewAngle = preview.rotation.y;
    const cosPreview = Math.cos(previewAngle);
    const sinPreview = Math.sin(previewAngle);

    camera.getWorldDirection(moveForward);
    const mazeAngle = attachedMazeGroup.rotation.y;
    const mazeDirX = moveForward.x * Math.cos(mazeAngle) - moveForward.z * Math.sin(mazeAngle);
    const mazeDirZ = moveForward.x * Math.sin(mazeAngle) + moveForward.z * Math.cos(mazeAngle);
    const hubDirX = mazeDirX * cosPreview - mazeDirZ * sinPreview;
    const hubDirZ = mazeDirX * sinPreview + mazeDirZ * cosPreview;

    return {
        x:dx * cosPreview - dz * sinPreview,
        z:dx * sinPreview + dz * cosPreview,
        pitch:camera.rotation.x,
        yaw:Math.atan2(-hubDirX, -hubDirZ)
    };
}

// ===== STATE MACHINE =====
function enterHub(roomId, fromRoom, arrivalPose = null) {
    // Find return direction before clearing state
    let arrivalDir = null;
    if (fromRoom) {
        arrivalDir = findReturnDir(fromRoom, roomId);
    }
    lastArrivalDir = arrivalDir;

    // An awake Shade follows through room transitions: pull its visual out
    // before the scene is torn down and let it travel unseen.
    if (activeShade && activeShade.mode !== 'lag') {
        if (activeShade.visual) {
            scene.remove(activeShade.visual);
            disposeObjectTree(activeShade.visual);
        }
        activeShade = {mode: 'lag', lagUntil: performance.now() + SHADE_LAG_MS, grid: null, cell: null, targetCell: null, visual: null};
    }

    clearScene();
    detachMaze();

    gameState = 'HUB';
    currentRoomId = roomId;
    playerInMaze = false;
    mazeSpaceActive = false;
    if (roomTrail[roomTrail.length - 1] !== roomId) roomTrail.push(roomId);

    if (roomId === '3.02') { enterWin(); return; }

    currentGroup = buildHub(roomId);
    scene.add(currentGroup);
    scene.fog.far = 30;

    if (arrivalPose) {
        playerPos.set(arrivalPose.x, EYE_H, arrivalPose.z);
        camera.rotation.set(arrivalPose.pitch, arrivalPose.yaw, 0, 'YXZ');
    } else if (arrivalDir) {
        // Arrived from a maze — spawn near the arrival door, facing center
        const angle = DIR_ANGLES[arrivalDir];
        const spawnDist = HUB_APO - 1.5;
        playerPos.set(
            Math.sin(angle) * spawnDist,
            EYE_H,
            -Math.cos(angle) * spawnDist
        );
        // Face inward (toward center = opposite of door direction)
        camera.rotation.set(0, angle + Math.PI, 0, 'YXZ');
    } else {
        // Default spawn: center, looking north
        playerPos.set(0, EYE_H, 0);
        camera.rotation.set(0, 0, 0, 'YXZ');
    }
    verticalVelocity = 0;
    trackedPos.x = playerPos.x;
    trackedPos.z = playerPos.z;
    camera.position.set(playerPos.x, playerPos.y, playerPos.z);
    updateHUD();
}

function attachMaze(dir) {
    detachMaze();
    const nav = roomNavigation[currentRoomId] || {};
    const dest = nav[dir];
    if (!dest) return;

    const {grid, params} = generateMaze(masterSeed, currentRoomId, dest, {allFeatures:testMazeMode});
    if (activeShade && activeShade.mode !== 'lag') {
        if (activeShade.visual) {
            scene.remove(activeShade.visual);
            disposeObjectTree(activeShade.visual);
        }
        activeShade = {mode:'lag', lagUntil:performance.now() + SHADE_LAG_MS,
            grid:null, cell:null, targetCell:null, visual:null};
    }
    const mazeGroup = buildMazeScene(grid, currentRoomId, dest);

    const angle = DIR_ANGLES[dir];
    const hubNormal = {x:Math.sin(angle), z:-Math.cos(angle)};
    const entrance = grid.entranceDoorRoom;
    const entranceMid = edgeMidpoint(entrance.panelEdge);
    const targetNormal = {x:-hubNormal.x, z:-hubNormal.z};
    const rotation = Math.atan2(entrance.panelNormal.z, entrance.panelNormal.x) -
        Math.atan2(targetNormal.z, targetNormal.x);
    mazeGroup.rotation.y = rotation;
    const rotatedMid = {
        x:entranceMid.x * Math.cos(rotation) + entranceMid.z * Math.sin(rotation),
        z:-entranceMid.x * Math.sin(rotation) + entranceMid.z * Math.cos(rotation)
    };
    mazeGroup.position.x = hubNormal.x * HUB_APO - rotatedMid.x;
    mazeGroup.position.z = hubNormal.z * HUB_APO - rotatedMid.z;

    scene.add(mazeGroup);
    scene.fog.far = Math.max(30, params.fogFar);

    attachedMazeGroup = mazeGroup;
    attachedMazeGrid = grid;
    attachedMazeParams = params;
    attachedMazeDest = dest;
    mazeSpaceActive = false;
    playerInMaze = false;
    buildMinimapBase(grid);
    updateHUD();
}

function disposeGroup(g) {
    if (!g) return;
    scene.remove(g);
    disposeObjectTree(g);
}
function detachMaze() {
    if (attachedMazeGrid?.spatialLoop) attachedMazeGrid.spatialLoop.cooldown = null;
    disposeGroup(attachedMazeGroup);
    attachedMazeGroup = null;
    attachedMazeGrid = null;
    attachedMazeParams = null;
    attachedMazeDest = null;
    playerInMaze = false;
    mazeSpaceActive = false;
    minimapBase = null;
    minimapLayout = null;
    mazeOrbClickables = [];
    scene.fog.far = 30;
    if (playerLight) {
        scene.remove(playerLight);
        playerLight = null;
    }
}

function tesseractGlyphs() {
    const trail = [];
    for (const r of roomTrail) {
        const t = getTess(r);
        if (trail[trail.length - 1] !== t) trail.push(t);
    }
    let glyphs = trail.map(t => TESSERACTS[t].emoji);
    if (glyphs.length > 24) glyphs = [...glyphs.slice(0, 11), '…', ...glyphs.slice(-12)];
    return glyphs.join('');
}

function obeliskResultLine() {
    const eligible = orbTesseracts();
    const glyphs = eligible.filter(tess => collectedObelisks.has(tess))
        .map(tess => TESSERACTS[tess].emoji).join('');
    return `Obelisks: ${collectedObelisks.size}/${eligible.length}${glyphs ? ` · ${glyphs}` : ''}`;
}

function enterWin() {
    gameState = 'WIN';
    destroyShade();
    controls.unlock();
    const elapsedMs = elapsedPlayMs + (playStartedAt ? performance.now() - playStartedAt : 0);
    const elapsed = Math.floor(elapsedMs / 1000);
    const min = Math.floor(elapsed / 60);
    const sec = elapsed % 60;
    const timeStr = `${min}:${sec.toString().padStart(2,'0')}${hardEntireRun ? '*' : ''}${shadeDisabledEntireRun ? '°' : ''}${cheatUsed ? '†' : ''}`;
    const glyphs = tesseractGlyphs();
    const roomsSeen = new Set(roomTrail).size;
    document.getElementById('winTime').textContent = `Time: ${timeStr}`;
    document.getElementById('winMazes').textContent = `Mazes traversed: ${mazeCount} · Rooms: ${roomsSeen}`;
    document.getElementById('winTrail').textContent = glyphs;
    let winObelisks = document.getElementById('winObelisks');
    if (!winObelisks) {
        winObelisks = document.createElement('p');
        winObelisks.id = 'winObelisks';
        document.getElementById('shareBtn').before(winObelisks);
    }
    const obeliskLine = obeliskResultLine();
    winObelisks.textContent = obeliskLine;
    lastShareText = [
        'THE DREADFUL ENGINE',
        seedLabel + (cheatUsed ? ' † CHEAT' : ''),
        glyphs,
        `${timeStr} · ${mazeCount} mazes · ${roomsSeen} rooms`,
        obeliskLine,
        isDailyRun ? 'pknull.ai/maze' : `pknull.ai/maze?key=${encodeURIComponent(activeKey)}`,
    ].join('\n');
    document.getElementById('win').style.display = 'flex';
    document.getElementById('blocker').classList.add('hidden');
    document.getElementById('hud').style.display = 'none';
}

function refreshSeedDisplay() {
    const label = seedLabel + (cheatMode ? ' † CHEAT' : '');
    document.getElementById('seedLine').textContent = label;
    document.getElementById('seedInfo').textContent = label;
}

function shareResult() {
    if (!lastShareText) return;
    const btn = document.getElementById('shareBtn');
    const done = () => {
        btn.classList.add('copied');
        btn.textContent = 'COPIED ✓';
        setTimeout(() => { btn.classList.remove('copied'); btn.textContent = 'SHARE RESULT'; }, 2000);
    };
    const fallback = () => {
        const ta = document.createElement('textarea');
        ta.value = lastShareText;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); done(); } catch (e) { /* clipboard unavailable */ }
        document.body.removeChild(ta);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(lastShareText).then(done, fallback);
    } else {
        fallback();
    }
}

function triggerToggle() {
    if (gameState !== 'HUB' || playerInMaze) return;
    const togDest = roomToggles[currentRoomId];
    if (!togDest) return;
    const dist = Math.sqrt(playerPos.x * playerPos.x + playerPos.z * playerPos.z);
    if (dist < TOGGLE_RAD) {
        enterHub(togDest);
    }
}

let eventMessageTimer = null;
function showEventMessage(text, duration = 1600) {
    const message = document.getElementById('eventMessage');
    clearTimeout(eventMessageTimer);
    message.textContent = text;
    message.classList.add('visible');
    eventMessageTimer = setTimeout(() => { message.classList.remove('visible'); }, duration);
}

function makeShadeVisual() {
    const shade = new THREE.Group();
    const body = new THREE.Mesh(
        new THREE.ConeGeometry(0.38, 1.9, 8),
        new THREE.MeshBasicMaterial({color: 0x1d2021, transparent: true, opacity: 0.92})
    );
    body.position.y = 0.95;
    shade.add(body);
    const glow = new THREE.PointLight(GRUVBOX.red, 1.3, 8);
    glow.position.y = 1.3;
    shade.add(glow);
    return shade;
}

function destroyShade() {
    if (activeShade?.visual) {
        scene.remove(activeShade.visual);
        disposeObjectTree(activeShade.visual);
    }
    activeShade = null;
    setShadeVeil(0);
}

function triggerTrap(destRoom, verb = 'DISPLACED') {
    // Displacement breaks pursuit: scattered across the Engine, the Shade
    // loses you and returns to the Loom.
    destroyShade();
    const flash = document.getElementById('trap-flash');
    const tess = TESSERACTS[getTess(destRoom)];
    flash.style.opacity = '1';
    showEventMessage(`${verb} → ${destRoom} (${tess.name})`, 2200);
    setTimeout(() => { flash.style.opacity = '0'; }, 300);
    enterHub(destRoom);
}

// ===== MOVEMENT + COLLISION =====
function updateMovement(delta) {
    if (gameState !== 'HUB') return;

    // Nothing legitimate moves the player between frames — internal
    // teleports sync trackedPos at their sites. A position written from
    // outside the module snaps back before movement resolves (issue #4):
    // the maze must be walked.
    if (Math.hypot(playerPos.x - trackedPos.x, playerPos.z - trackedPos.z) > 0.25) {
        playerPos.x = trackedPos.x;
        playerPos.z = trackedPos.z;
    }

    const previousX = playerPos.x;
    const previousZ = playerPos.z;

    camera.getWorldDirection(moveForward);
    moveForward.y = 0;
    moveForward.normalize();
    moveRight.crossVectors(moveForward, camera.up).normalize();

    moveDirection.set(0, 0, 0);
    if (moveState.forward) moveDirection.add(moveForward);
    if (moveState.backward) moveDirection.sub(moveForward);
    if (moveState.right) moveDirection.add(moveRight);
    if (moveState.left) moveDirection.sub(moveRight);
    if (moveDirection.lengthSq() > 0) {
        moveDirection.normalize();
        playerPos.x += moveDirection.x * MOVE_SPD * delta;
        playerPos.z += moveDirection.z * MOVE_SPD * delta;
    }
    playerPos.y += verticalVelocity * delta - 0.5 * GRAVITY * delta * delta;
    verticalVelocity -= GRAVITY * delta;
    if (playerPos.y <= EYE_H) {
        playerPos.y = EYE_H;
        verticalVelocity = 0;
    }

    // Determine if player is past the open door (in the maze area)
    const wasPlayerInMaze = playerInMaze;
    const inMazeArea = isPlayerInMaze();
    playerInMaze = inMazeArea;

    if (inMazeArea && attachedMazeGrid) {
        if (!wasPlayerInMaze) {
            const hunter = attachedMazeGrid.hunter;
            if (hunter && !hunter.wakeAt && !activeShade && !shadeDisabled) {
                hunter.wakeAt = performance.now() + HUNTER_WAKE_DELAY_MS;
                showEventMessage('THE SHADE STIRS', 2600);
            }
        }
        const exitDoorRoom = attachedMazeGrid.exitDoorRoom;
        const local = worldToMazeLocal(playerPos.x, playerPos.z);
        let beyondOpenExit = false;
        if (exitDoorRoom?.panelOpen) {
            const {frame, normal} = doorRoomThreshold(exitDoorRoom);
            const exitDepth = (local.x - frame.x) * normal.x +
                (local.z - frame.z) * normal.z;
            beyondOpenExit = exitDepth > P_RAD + 0.04;
        }
        const doorCrossing = checkMazeExit(previousX, previousZ);
        if (doorCrossing === 'exit' || beyondOpenExit) {
            const destination = attachedMazeDest;
            const source = currentRoomId;
            const arrivalPose = captureMazeExitPose();
            mazeCount++;
            enterHub(destination, source, arrivalPose);
            return;
        }
        checkOverlapPortals(previousX, previousZ);
        if (!checkSpaceFold(previousX, previousZ)) {
            collideInMaze(previousX, previousZ);
            updateOverlapApproach();
        }
        checkRotatingChamber();
        checkSpatialLoop();
        checkMazeTraps();
    } else {
        // Hub collision
        collideWithHub();
    }

    trackedPos.x = playerPos.x;
    trackedPos.z = playerPos.z;
    camera.position.set(playerPos.x, playerPos.y, playerPos.z);

    // Update player light
    if (playerLight) playerLight.position.set(playerPos.x, playerPos.y, playerPos.z);
}

function checkRotatingChamber() {
    const chamber = attachedMazeGrid?.rotatingChamber;
    if (!chamber || chamber.activated) return;
    const local = worldToMazeLocal(playerPos.x, playerPos.z);
    const centerX = chamber.cell.center.x;
    const centerZ = chamber.cell.center.z;
    if (Math.hypot(local.x - centerX, local.z - centerZ) > 0.68) return;
    if (!attachedMazeGrid.activateRotatingChamber()) return;
    attachedMazeGrid._closedWallCache = null;
    for (const panel of chamber.panels || []) panel.visual.visible = !panel.edge.open;
    buildMinimapBase(attachedMazeGrid);
    showEventMessage('CHAMBER ROTATED · EXIT OPEN');
}

function checkSpatialLoop() {
    const loop = attachedMazeGrid?.spatialLoop;
    if (!loop) return;
    const local = worldToMazeLocal(playerPos.x, playerPos.z);
    const center = cell => cell.center;

    if (loop.cooldown) {
        const lockedCenter = center(loop.cooldown);
        if (Math.hypot(local.x - lockedCenter.x, local.z - lockedCenter.z) < 0.9) return;
        loop.cooldown = null;
    }

    const aCenter = center(loop.a), bCenter = center(loop.b);
    const from = Math.hypot(local.x - aCenter.x, local.z - aCenter.z) < 0.5 ? loop.a
        : Math.hypot(local.x - bCenter.x, local.z - bCenter.z) < 0.5 ? loop.b : null;
    if (!from) return;
    const to = from === loop.a ? loop.b : loop.a;
    const fromCenter = from === loop.a ? aCenter : bCenter;
    const toCenter = to === loop.a ? aCenter : bCenter;
    const world = mazeLocalToWorld(
        toCenter.x + (local.x - fromCenter.x),
        toCenter.z + (local.z - fromCenter.z)
    );
    playerPos.x = world.x;
    playerPos.z = world.z;
    loop.cooldown = to;
    showEventMessage(`SPATIAL LOOP ${from === loop.a ? 'α → β' : 'β → α'}`);
}

function isPlayerInMaze() {
    if (!hubDoorOpen || !attachedMazeGroup) {
        mazeSpaceActive = false;
        return false;
    }
    const angle = DIR_ANGLES[hubDoorOpen];
    const nx = Math.sin(angle), nz = -Math.cos(angle);
    mazeSpaceActive = playerPos.x * nx + playerPos.z * nz > HUB_APO - 0.2;
    return mazeSpaceActive;
}

function collideWithHub() {
    const nav = roomNavigation[currentRoomId] || {};
    for (const dir of DIRECTIONS) {
        const angle = DIR_ANGLES[dir];
        const nx = Math.sin(angle), nz = -Math.cos(angle);
        const dot = playerPos.x * nx + playerPos.z * nz;
        if (dot > HUB_APO - P_RAD) {
            const isDoorOpen = (hubDoorOpen === dir && !!nav[dir]);
            if (isDoorOpen) {
                const tx = Math.cos(angle), tz = Math.sin(angle);
                const tangent = Math.abs(playerPos.x * tx + playerPos.z * tz);
                if (tangent < DOOR_W / 2 - P_RAD * 0.5) {
                    continue; // allow through open door
                }
            }
            const pushback = dot - (HUB_APO - P_RAD);
            playerPos.x -= nx * pushback;
            playerPos.z -= nz * pushback;
        }
    }
}

function collideInMaze(previousWorldX, previousWorldZ) {
    const grid = attachedMazeGrid;
    if (!grid) return;
    let local = worldToMazeLocal(playerPos.x, playerPos.z);
    const previous = worldToMazeLocal(previousWorldX, previousWorldZ);
    if (!grid._closedWallCache) {
        const seen = new Set();
        grid._closedWallCache = [];
        for (const cell of grid.cells) {
            if (cell.layerRegion && cell.layer !== cell.layerRegion.activeLayer) continue;
            for (const edge of cell.edges) {
                if (edge.open) continue;
                const key = edge.segment.map(point =>
                    `${point.x.toFixed(5)},${point.z.toFixed(5)}`).sort().join('|');
                if (seen.has(key)) continue;
                seen.add(key);
                if (edge === grid.entranceDoorRoom?.panelEdge ||
                    edge === grid.exitDoorRoom?.panelEdge) {
                    const [a, b] = edge.segment;
                    const dx = b.x - a.x, dz = b.z - a.z;
                    const length = Math.hypot(dx, dz);
                    const midpoint = edgeMidpoint(edge);
                    const tangent = {x:dx / length, z:dz / length};
                    for (const side of [-1, 1]) {
                        grid._closedWallCache.push({
                            edge:{segment:[
                                side < 0 ? a : b,
                                {
                                    x:midpoint.x + tangent.x * side * DOOR_W / 2,
                                    z:midpoint.z + tangent.z * side * DOOR_W / 2
                                }
                            ]},
                            owner:cell
                        });
                    }
                    continue;
                }
                grid._closedWallCache.push({edge, owner:cell});
            }
        }
        for (const portal of grid.overlapRegion?.portals || []) {
            const [a, b] = portal.segment;
            const dx = b.x - a.x, dz = b.z - a.z;
            const length = Math.hypot(dx, dz);
            const midpoint = edgeMidpoint({segment:portal.segment});
            const tangent = {x:dx / length, z:dz / length};
            for (const side of [-1, 1]) {
                grid._closedWallCache.push({
                    edge:{segment:[
                        side < 0 ? a : b,
                        {
                            x:midpoint.x + tangent.x * side * OVERLAP_PORTAL_W / 2,
                            z:midpoint.z + tangent.z * side * OVERLAP_PORTAL_W / 2
                        }
                    ]},
                    owner:portal.outsideCell
                });
            }
        }
    }
    const walls = [...grid._closedWallCache];
    const previousCell = grid.cellContainingPoint(previous.x, previous.z);
    for (const edge of previousCell?.edges || []) {
        if (edge.oneWayBlocked && edge.open) walls.push({edge, owner:previousCell});
    }

    // Sweep against every relevant segment before proximity relaxation so a
    // low frame cannot tunnel from one polygon to the far side of a wall.
    for (const {edge, owner} of walls) {
        const [a, b] = edge.segment;
        const reach = P_RAD + Math.hypot(local.x - previous.x, local.z - previous.z);
        if (Math.max(previous.x, local.x) < Math.min(a.x, b.x) - reach ||
            Math.min(previous.x, local.x) > Math.max(a.x, b.x) + reach ||
            Math.max(previous.z, local.z) < Math.min(a.z, b.z) - reach ||
            Math.min(previous.z, local.z) > Math.max(a.z, b.z) + reach) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        const length = Math.hypot(dx, dz);
        const nx = -dz / length, nz = dx / length;
        const ownerSide = Math.sign((owner.center.x - a.x) * nx + (owner.center.z - a.z) * nz) || 1;
        const previousSide = (previous.x - a.x) * nx + (previous.z - a.z) * nz;
        const currentSide = (local.x - a.x) * nx + (local.z - a.z) * nz;
        const keepSide = Math.sign(previousSide) || ownerSide;
        const along = ((local.x - a.x) * dx + (local.z - a.z) * dz) / (length * length);
        if (keepSide * currentSide <= 0 && along > -0.05 && along < 1.05) {
            local.x += nx * keepSide * (P_RAD - keepSide * currentSide + 0.001);
            local.z += nz * keepSide * (P_RAD - keepSide * currentSide + 0.001);
        }
    }

    // Two-dimensional Gauss-Seidel relaxation gives the expected FPS wall
    // slide on 60-degree corners without coupling collision to eye height.
    for (let pass = 0; pass < 3; pass++) {
        for (const {edge, owner} of walls) {
            const [a, b] = edge.segment;
            if (local.x < Math.min(a.x, b.x) - P_RAD ||
                local.x > Math.max(a.x, b.x) + P_RAD ||
                local.z < Math.min(a.z, b.z) - P_RAD ||
                local.z > Math.max(a.z, b.z) + P_RAD) continue;
            const dx = b.x - a.x, dz = b.z - a.z;
            const lengthSq = dx * dx + dz * dz;
            const t = Math.max(0, Math.min(1, ((local.x - a.x) * dx + (local.z - a.z) * dz) / lengthSq));
            const qx = a.x + dx * t, qz = a.z + dz * t;
            const px = local.x - qx, pz = local.z - qz;
            const distance = Math.hypot(px, pz);
            if (distance >= P_RAD) continue;
            let ux, uz;
            if (distance > 1e-7) {
                ux = px / distance;
                uz = pz / distance;
            } else {
                const length = Math.sqrt(lengthSq);
                ux = -(b.z - a.z) / length;
                uz = (b.x - a.x) / length;
                const ownerSide = Math.sign((owner.center.x - a.x) * ux + (owner.center.z - a.z) * uz) || 1;
                ux *= ownerSide;
                uz *= ownerSide;
            }
            const push = P_RAD - distance + 0.001;
            local.x += ux * push;
            local.z += uz * push;
        }
    }

    // Preserve the old final fallback: if relaxation found the exterior,
    // keep the last trusted position rather than accepting a clipped frame.
    const inOpenExit = grid.exitDoorRoom?.panelOpen &&
        pointInDoorwayOpening(local, grid.exitDoorRoom);
    if (!grid.cellContainingPoint(local.x, local.z) &&
        !pointInDoorwayOpening(local, grid.entranceDoorRoom) && !inOpenExit) local = previous;

    // Convert back to world
    const world = mazeLocalToWorld(local.x, local.z);
    playerPos.x = world.x;
    playerPos.z = world.z;
}

function crossesEdgePlane(previous, current, edge, interiorCenter,
    triggerInset = P_RAD + 0.04, halfWidth = null) {
    const [a, b] = edge.segment;
    const dx = b.x - a.x, dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    let nx = -dz / length, nz = dx / length;
    if ((interiorCenter.x - a.x) * nx + (interiorCenter.z - a.z) * nz > 0) {
        nx = -nx;
        nz = -nz;
    }
    const before = (previous.x - a.x) * nx + (previous.z - a.z) * nz;
    const after = (current.x - a.x) * nx + (current.z - a.z) * nz;
    const triggerPlane = -triggerInset;
    if (halfWidth === null) {
        const along = ((current.x - a.x) * dx + (current.z - a.z) * dz) / (length * length);
        return before < triggerPlane && after >= triggerPlane && along >= 0 && along <= 1;
    }
    if (before >= triggerPlane || after < triggerPlane) return false;
    const crossingRatio = (triggerPlane - before) / (after - before);
    const crossingX = previous.x + (current.x - previous.x) * crossingRatio;
    const crossingZ = previous.z + (current.z - previous.z) * crossingRatio;
    const midpoint = edgeMidpoint(edge);
    const tangentDistance = Math.abs(
        (crossingX - midpoint.x) * dx / length +
        (crossingZ - midpoint.z) * dz / length
    );
    return tangentDistance <= halfWidth;
}

function checkOverlapPortals(previousWorldX, previousWorldZ) {
    const grid = attachedMazeGrid;
    const region = grid?.overlapRegion;
    if (!region) return;
    const previous = worldToMazeLocal(previousWorldX, previousWorldZ);
    const current = worldToMazeLocal(playerPos.x, playerPos.z);
    for (const portal of region.portals) {
        // The shared helper detects outward motion. Reversing the traversal
        // makes actual entry cross the outside-side trigger plane.
        if (crossesEdgePlane(current, previous, portal.outsideEdge,
            portal.vestibule.center, -(P_RAD + 0.04), OVERLAP_PORTAL_W / 2 - P_RAD)) {
            setActiveOverlapLayer(grid, portal.layer);
        }
    }
}

function updateOverlapApproach() {
    const grid = attachedMazeGrid;
    const region = grid?.overlapRegion;
    if (!region) return;
    const local = worldToMazeLocal(playerPos.x, playerPos.z);
    const {minX, maxX, minZ, maxZ} = region.bbox;
    if (local.x >= minX && local.x <= maxX && local.z >= minZ && local.z <= maxZ &&
        grid.cellContainingPoint(local.x, local.z)?.layerRegion === region) return;

    const portals = region.portals.map(portal => ({
        portal,
        distance:Math.hypot(
            local.x - (portal.segment[0].x + portal.segment[1].x) / 2,
            local.z - (portal.segment[0].z + portal.segment[1].z) / 2
        )
    })).sort((a, b) => a.distance - b.distance);
    const nearest = portals[0];
    if (!nearest || nearest.distance > OVERLAP_SWAP_RADIUS_FACTOR * grid.edgeLen ||
        nearest.portal.layer === region.activeLayer) return;
    const nearestActive = portals.find(candidate =>
        candidate.portal.layer === region.activeLayer)?.distance ?? Infinity;
    if (nearest.distance + OVERLAP_HYSTERESIS_MARGIN >= nearestActive) return;

    let shouldSwap = nearest.distance <= OVERLAP_FORCE_RADIUS_FACTOR * grid.edgeLen;
    if (!shouldSwap) {
        const center = mazeLocalToWorld((minX + maxX) / 2, (minZ + maxZ) / 2);
        const toRegionX = center.x - playerPos.x;
        const toRegionZ = center.z - playerPos.z;
        const length = Math.hypot(toRegionX, toRegionZ);
        camera.getWorldDirection(minimapForward);
        const forwardLength = Math.hypot(minimapForward.x, minimapForward.z);
        shouldSwap = length > 1e-7 && forwardLength > 1e-7 &&
            (minimapForward.x * toRegionX + minimapForward.z * toRegionZ) / length <
                OVERLAP_VIEW_AWAY_DOT * forwardLength;
    }
    if (shouldSwap) setActiveOverlapLayer(grid, nearest.portal.layer);
}

function checkSpaceFold(previousWorldX, previousWorldZ) {
    const fold = attachedMazeGrid?.spaceFold;
    if (!fold) return false;
    const previous = worldToMazeLocal(previousWorldX, previousWorldZ);
    const current = worldToMazeLocal(playerPos.x, playerPos.z);
    let from = null, to = null, label = '';
    if (crossesEdgePlane(previous, current, fold.a.edge, fold.a.cell.center)) {
        from = fold.a; to = fold.b; label = 'α → β';
    } else if (crossesEdgePlane(previous, current, fold.b.edge, fold.b.cell.center)) {
        from = fold.b; to = fold.a; label = 'β → α';
    }
    if (!from) return false;
    const sourceMid = edgeMidpoint(from.edge);
    const targetMid = edgeMidpoint(to.edge);
    const [sa, sb] = from.edge.segment;
    const [ta, tb] = to.edge.segment;
    const sourceLength = Math.hypot(sb.x - sa.x, sb.z - sa.z);
    const targetLength = Math.hypot(tb.x - ta.x, tb.z - ta.z);
    const along = ((current.x - sourceMid.x) * (sb.x - sa.x) +
        (current.z - sourceMid.z) * (sb.z - sa.z)) / sourceLength;
    const mapped = Math.max(-targetLength * 0.3, Math.min(targetLength * 0.3, along));
    const target = {
        x:to.cell.center.x + (tb.x - ta.x) / targetLength * mapped,
        z:to.cell.center.z + (tb.z - ta.z) / targetLength * mapped
    };
    const world = mazeLocalToWorld(target.x, target.z);
    playerPos.x = world.x;
    playerPos.z = world.z;
    showEventMessage(`SPACE FOLDS: ${label}`);
    return true;
}

const shadeVeilEl = document.getElementById('shade-veil');
function setShadeVeil(strength) {
    shadeVeilEl.style.opacity = strength.toFixed(3);
}

function shadeInInactiveOverlap(shade) {
    const region = shade?.grid?.overlapRegion;
    return Boolean(region && shade.cell?.layerRegion === region &&
        shade.cell.layer !== region.activeLayer);
}

function updateHunter(delta) {
    if (shadeDisabled && !activeShade) return;

    const now = performance.now();

    // Dormant lair apparition: bobs in its maze until the stir completes,
    // then it is promoted to the run-level Shade that persists across
    // rooms and mazes until a displacement breaks pursuit.
    const spec = attachedMazeGrid?.hunter;
    if (!activeShade) {
        if (!spec || !spec.visual) { setShadeVeil(0); return; }
        spec.visual.position.y = Math.sin(now / 320) * 0.12;
        if (!spec.wakeAt || now < spec.wakeAt) { setShadeVeil(0); return; }
        attachedMazeGroup.remove(spec.visual);
        disposeObjectTree(spec.visual);
        spec.visual = null;
        const w = mazeLocalToWorld(spec.x, spec.z);
        activeShade = {
            mode: 'maze', grid: attachedMazeGrid,
            cell: spec.cell, targetCell: null,
            x: w.x, z: w.z, visual: makeShadeVisual()
        };
        activeShade.visual.position.set(w.x, 0, w.z);
        scene.add(activeShade.visual);
    }
    const shade = activeShade;
    const step = MOVE_SPD * HUNTER_SPEED_FACTOR * delta;

    // Between rooms it travels unseen; the dark thickens before it arrives.
    if (shade.mode === 'lag') {
        const remain = shade.lagUntil - now;
        setShadeVeil(0.3 * Math.min(1, Math.max(0, 1 - remain / SHADE_LAG_MS)));
        if (remain > 0) return;
        if (playerInMaze && attachedMazeGrid) {
            const e = attachedMazeGrid.entranceCell;
            const w = mazeLocalToWorld(e.center.x, e.center.z);
            Object.assign(shade, {mode: 'maze', grid: attachedMazeGrid, cell: e, targetCell: null, x: w.x, z: w.z});
        } else {
            let ex = 0, ez = 0;
            if (lastArrivalDir) {
                const a = DIR_ANGLES[lastArrivalDir];
                ex = Math.sin(a) * (HUB_APO - 0.8);
                ez = -Math.cos(a) * (HUB_APO - 0.8);
            }
            Object.assign(shade, {mode: 'hub', grid: null, cell: null, targetCell: null, x: ex, z: ez});
        }
        if (!shade.visual) shade.visual = makeShadeVisual();
        shade.visual.position.set(shade.x, 0, shade.z);
        scene.add(shade.visual);
        showEventMessage('IT CAME THROUGH', 2200);
    }

    const shadeIsInactive = shadeInInactiveOverlap(shade);
    shade.visual.visible = !shadeIsInactive;
    shade.visual.position.y = Math.sin(now / 320) * 0.12;

    // Veil + catch work in world coordinates, hub and maze alike. The ramp
    // is straight-line on purpose: darkness through walls means it is close
    // even when you cannot see it.
    const dx = playerPos.x - shade.x, dz = playerPos.z - shade.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    setShadeVeil(0.78 * Math.min(1, Math.max(0, (12 - dist) / 10.5)));
    if (!shadeIsInactive && dist < 0.75) {
        const pool = scatterPool(currentRoomId, attachedMazeDest);
        triggerTrap(shadeRng.pick(pool), 'SEIZED BY THE SHADE');
        return;
    }

    if (shade.mode === 'hub') {
        if (playerInMaze && attachedMazeGrid) {
            // The player fled through the open door — make for the entrance.
            const e = attachedMazeGrid.entranceCell;
            const w = mazeLocalToWorld(e.center.x, e.center.z);
            const mx = w.x - shade.x, mz = w.z - shade.z;
            const md = Math.sqrt(mx * mx + mz * mz);
            if (md <= step) {
                Object.assign(shade, {mode: 'maze', grid: attachedMazeGrid, cell: e, targetCell: null, x: w.x, z: w.z});
            } else {
                shade.x += (mx / md) * step;
                shade.z += (mz / md) * step;
            }
        } else if (dist > 0.01) {
            // Open hub: straight pursuit.
            shade.x += (dx / dist) * step;
            shade.z += (dz / dist) * step;
        }
        shade.visual.position.x = shade.x;
        shade.visual.position.z = shade.z;
        return;
    }

    // Maze mode — BFS over the full graph (loops and folds included, one-way
    // gates ignored), re-pathed at every waypoint against the live goal: the
    // player's cell, or the doorway if the player stepped back into the hub.
    const grid = shade.grid;
    if (grid !== attachedMazeGrid) {
        // Scene changed beneath it — travel between spaces instead.
        if (shade.visual) { scene.remove(shade.visual); disposeObjectTree(shade.visual); }
        Object.assign(shade, {mode: 'lag', lagUntil: now + SHADE_LAG_MS, grid: null, cell: null, targetCell: null, visual: null});
        return;
    }
    const localPlayer = worldToMazeLocal(playerPos.x, playerPos.z);
    const playerCell = grid.cellContainingPoint(localPlayer.x, localPlayer.z);
    if (!playerInMaze && shade.cell === grid.entranceCell && !shade.targetCell) {
        // At the doorway with the player outside: cross into the hub.
        Object.assign(shade, {mode: 'hub', grid: null, cell: null});
        shade.visual.visible = true;
        return;
    }
    if (!shade.targetCell) {
        const goalCell = playerInMaze ? playerCell : grid.entranceCell;
        if (!goalCell) return;
        const path = grid.findPath(shade.cell, goalCell,
            {respectOneWay: false, includeSpatialLoop: true, includeSpaceFold: true});
        if (path.length < 2) return;
        shade.targetCell = path[1];
        // Fold/loop edges connect non-adjacent cells: the Shade crosses
        // them instantly rather than gliding through walls.
        if (!grid.areAdjacent(shade.targetCell, shade.cell)) {
            shade.cell = shade.targetCell;
            shade.targetCell = null;
            const w = mazeLocalToWorld(shade.cell.center.x, shade.cell.center.z);
            shade.x = w.x; shade.z = w.z;
            shade.visual.position.x = w.x;
            shade.visual.position.z = w.z;
            shade.visual.visible = !shadeInInactiveOverlap(shade);
            return;
        }
    }
    const t = mazeLocalToWorld(shade.targetCell.center.x, shade.targetCell.center.z);
    const mx = t.x - shade.x, mz = t.z - shade.z;
    const md = Math.sqrt(mx * mx + mz * mz);
    if (md <= step) {
        const w = mazeLocalToWorld(shade.targetCell.center.x, shade.targetCell.center.z);
        shade.x = w.x; shade.z = w.z;
        shade.cell = shade.targetCell;
        shade.targetCell = null;
    } else {
        shade.x += (mx / md) * step;
        shade.z += (mz / md) * step;
    }
    shade.visual.position.x = shade.x;
    shade.visual.position.z = shade.z;
    shade.visual.visible = !shadeInInactiveOverlap(shade);
}

function checkMazeTraps() {
    const grid = attachedMazeGrid;
    if (!grid) return;
    const local = worldToMazeLocal(playerPos.x, playerPos.z);
    const c = grid.cellContainingPoint(local.x, local.z);
    if (!c || !c.trap) return;
    const lx = local.x - c.center.x;
    const lz = local.z - c.center.z;
    if (Math.sqrt(lx * lx + lz * lz) < 0.6) {
        c.trap = false;
        triggerTrap(c.trapDest);
    }
}

function checkMazeExit(previousWorldX, previousWorldZ) {
    if (!attachedMazeGrid) return null;
    const previous = worldToMazeLocal(previousWorldX, previousWorldZ);
    const current = worldToMazeLocal(playerPos.x, playerPos.z);
    const room = attachedMazeGrid.exitDoorRoom;
    if (room?.panelOpen && crossesEdgePlane(previous, current, room.panelEdge, room.center,
        -(P_RAD + 0.04), DOOR_W / 2)) return room.kind;
    return null;
}

// ===== HUD =====
function updateHUD() {
    const roomInfo = document.getElementById('roomInfo');
    const tessInfo = document.getElementById('tessInfo');
    const mazeLabel = document.getElementById('mazeLabel');
    const hint = document.getElementById('hint');

    if (gameState === 'HUB') {
        const tess = TESSERACTS[getTess(currentRoomId)];
        roomInfo.textContent = `${tess.emoji} ${currentRoomId}`;
        const passageCount = distances[currentRoomId];
        const passageText = Number.isFinite(passageCount)
            ? (passageCount === 1 ? '1 passage' : `${passageCount} passages`)
            : 'route unknown';
        tessInfo.textContent = `${tess.name} Tesseract · ${passageText} to Entryway`;
        mazeLabel.textContent = '';

        const togDest = roomToggles[currentRoomId];
        const dist = Math.sqrt(playerPos.x * playerPos.x + playerPos.z * playerPos.z);
        if (togDest && dist < TOGGLE_RAD + 1) {
            const dt = TESSERACTS[getTess(togDest)];
            hint.textContent = `[CLICK / E] Warp to ${togDest} (${dt.name})`;
            hint.classList.add('visible');
        } else {
            hint.classList.remove('visible');
        }
    }
    // Show maze info when in maze area
    if (playerInMaze && attachedMazeDest) {
        const srcTess = TESSERACTS[getTess(currentRoomId)];
        roomInfo.textContent = `${srcTess.emoji} ${currentRoomId} · MAZE · ${attachedMazeDest}`;
        const tier = ['Simple','Moderate','Complex','Labyrinthine'];
        const tierName = attachedMazeParams ? tier[attachedMazeParams.tier] : '';
        mazeLabel.textContent = tierName;
        const local = worldToMazeLocal(playerPos.x, playerPos.z);
        const nearbyGate = attachedMazeGrid.oneWayGates.find(gate => {
            const x = (gate.from.center.x + gate.to.center.x) / 2;
            const z = (gate.from.center.z + gate.to.center.z) / 2;
            return Math.hypot(local.x - x, local.z - z) < 2.2;
        });
        if (nearbyGate) {
            hint.textContent = 'ONE-WAY THRESHOLD';
            hint.classList.add('visible');
        } else {
            hint.classList.remove('visible');
        }
    }
}

// ===== MINIMAP =====
const minimapEl = document.getElementById('minimap');

function buildMinimapBase(grid) {
    const mw = 160, mh = 160;
    const {minX, maxX, minZ, maxZ} = grid.bounds;
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxZ - minZ);
    const scale = Math.min((mw - 20) / width, (mh - 20) / height);
    const ox = (mw - width * scale) / 2;
    const oz = (mh - height * scale) / 2;
    const toCanvas = point => ({
        x:ox + (point.x - minX) * scale,
        y:oz + (point.z - minZ) * scale
    });
    minimapBase = document.createElement('canvas');
    minimapBase.width = mw;
    minimapBase.height = mh;
    minimapLayout = {scale, ox, oz, minX, minZ};
    const ctx = minimapBase.getContext('2d');

    ctx.fillStyle = 'rgba(40,40,40,0.9)';
    ctx.fillRect(0, 0, mw, mh);

    // Polygon footprints make either tessellation legible. Passages are
    // overdrawn in aqua while closed edges retain the wall language.
    for (const cell of grid.cells) {
        if (cell.layer === 'b') continue;
        const points = cell.vertices.map(toCanvas);
        ctx.beginPath();
        points.forEach((point, index) => {
            if (index === 0) ctx.moveTo(point.x, point.y);
            else ctx.lineTo(point.x, point.y);
        });
        ctx.closePath();
        ctx.fillStyle = cell.chamber ? 'rgba(131,165,152,0.24)' : 'rgba(60,56,54,0.2)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(235,219,178,0.08)';
        ctx.lineWidth = 0.6;
        ctx.stroke();
    }

    if (cheatMode && grid.overlapRegion) {
        ctx.fillStyle = 'rgba(211,134,155,0.18)';
        for (const cell of grid.overlapRegion.cellsA) {
            const points = cell.vertices.map(toCanvas);
            ctx.beginPath();
            points.forEach((point, index) => {
                if (index === 0) ctx.moveTo(point.x, point.y);
                else ctx.lineTo(point.x, point.y);
            });
            ctx.closePath();
            ctx.fill();
        }
    }

    if (cheatMode && grid.orbChamber) {
        const point = toCanvas(grid.orbChamber.center.center);
        ctx.fillStyle = TESSERACTS[grid.orbChamber.tess].color;
        ctx.beginPath(); ctx.arc(point.x, point.y, 2.5, 0, Math.PI * 2); ctx.fill();
    }

    const edgeKey = edge => edge.segment.map(point =>
        `${point.x.toFixed(5)},${point.z.toFixed(5)}`).sort().join('|');
    const drawEdge = (edge, open = edge.open, alpha = 1) => {
        const [a, b] = edge.segment.map(toCanvas);
        ctx.strokeStyle = open
            ? `rgba(142,192,124,${0.28 * alpha})`
            : `rgba(235,219,178,${0.42 * alpha})`;
        ctx.lineWidth = open ? 1.2 : 1;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    };
    const portalEdges = new Set((grid.overlapRegion?.portals || []).map(portal =>
        edgeKey({segment:portal.segment})));
    const seenEdges = new Set();
    for (const cell of grid.cells) {
        if (cell.layerRegion) continue;
        for (const edge of cell.edges) {
            const key = edgeKey(edge);
            if (seenEdges.has(key) || portalEdges.has(key)) continue;
            seenEdges.add(key);
            drawEdge(edge);
        }
    }

    const region = grid.overlapRegion;
    if (region) {
        const seenRegionEdges = new Set();
        for (const cellA of region.cellsA) {
            for (const edgeA of cellA.edges) {
                if (edgeA.neighbor?.layerRegion !== region) continue;
                const key = edgeKey(edgeA);
                if (seenRegionEdges.has(key)) continue;
                seenRegionEdges.add(key);
                const edgeB = cellA.twin.edges[edgeA.index];
                if (edgeA.open === edgeB.open) drawEdge(edgeA);
                else {
                    const alpha = cheatMode ? 1 : OVERLAP_MINIMAP_ALPHA;
                    drawEdge(edgeA, edgeA.open, alpha);
                    drawEdge(edgeB, edgeB.open, alpha);
                }
            }
        }
        for (const portal of region.portals) {
            const edge = {segment:portal.segment};
            drawEdge(edge, true, OVERLAP_MINIMAP_ALPHA);
            drawEdge(edge, false, OVERLAP_MINIMAP_ALPHA);
            if (cheatMode) {
                const point = toCanvas(edgeMidpoint(edge));
                ctx.fillStyle = OVERLAP_LAYER_COLORS[portal.layer];
                ctx.beginPath(); ctx.arc(point.x, point.y, 2.5, 0, Math.PI * 2); ctx.fill();
            }
        }
    }

    if (grid.rotatingChamber) {
        const point = toCanvas(grid.rotatingChamber.cell.center);
        ctx.strokeStyle = '#fabd2f';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(point.x, point.y, 5, 0, Math.PI * 2); ctx.stroke();
    }

    for (const cell of grid.cells) {
        if (!cell.trap) continue;
        const point = toCanvas(cell.center);
        ctx.fillStyle = 'rgba(255,100,83,0.55)';
        ctx.beginPath(); ctx.arc(point.x, point.y, 2, 0, Math.PI * 2); ctx.fill();
    }

    for (const gate of grid.oneWayGates) {
        const from = toCanvas(gate.from.center);
        const to = toCanvas(gate.to.center);
        const dx = to.x - from.x, dy = to.y - from.y;
        const length = Math.hypot(dx, dy);
        const ux = dx / length, uy = dy / length;
        const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
        const tipX = mx + ux * 4, tipY = my + uy * 4;
        ctx.save();
        ctx.strokeStyle = '#8ec07c';
        ctx.fillStyle = '#8ec07c';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(mx - ux * 4, my - uy * 4); ctx.lineTo(tipX, tipY); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - ux * 3 - uy * 2.5, tipY - uy * 3 + ux * 2.5);
        ctx.lineTo(tipX - ux * 3 + uy * 2.5, tipY - uy * 3 - ux * 2.5);
        ctx.closePath(); ctx.fill();
        ctx.restore();
    }

    if (grid.spatialLoop) {
        const loop = grid.spatialLoop;
        const a = toCanvas(loop.a.center), b = toCanvas(loop.b.center);
        const color = '#83a598';
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        const bendX = (a.x + b.x) / 2 + (b.y - a.y) * 0.35;
        const bendY = (a.y + b.y) / 2 - (b.x - a.x) * 0.35;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(bendX, bendY, b.x, b.y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const [x, y, label] of [[a.x,a.y,'α'],[b.x,b.y,'β']]) {
            ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#282828'; ctx.fillText(label, x, y + 0.5); ctx.fillStyle = color;
        }
        ctx.restore();
    }

    for (const [room, color] of [
        [grid.entranceDoorRoom, '#b8bb26'],
        [grid.exitDoorRoom, '#fabd2f']
    ]) {
        if (!room) continue;
        const point = toCanvas(room.center);
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(point.x, point.y, 3.5, 0, Math.PI * 2); ctx.fill();
    }

    if (grid.spaceFold) {
        const a = toCanvas(edgeMidpoint(grid.spaceFold.a.edge));
        const b = toCanvas(edgeMidpoint(grid.spaceFold.b.edge));
        ctx.save();
        ctx.strokeStyle = 'rgba(211,134,155,0.55)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = '#d3869b';
        ctx.lineWidth = 2;
        for (const point of [a, b]) {
            ctx.beginPath(); ctx.arc(point.x, point.y, 4, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.restore();
    }
}

function drawMinimap() {
    if (hardMode || !playerInMaze || !attachedMazeGrid || !minimapBase || !minimapLayout) {
        minimapEl.style.display = 'none';
        return;
    }
    minimapEl.style.display = 'block';
    const ctx = minimapEl.getContext('2d');
    const {scale, ox, oz, minX, minZ} = minimapLayout;
    const local = worldToMazeLocal(playerPos.x, playerPos.z);
    const toCanvas = point => ({
        x:ox + (point.x - minX) * scale,
        y:oz + (point.z - minZ) * scale
    });
    ctx.clearRect(0, 0, minimapEl.width, minimapEl.height);
    ctx.drawImage(minimapBase, 0, 0);

    const player = toCanvas(local);
    ctx.fillStyle = '#8ec07c';
    ctx.beginPath(); ctx.arc(player.x, player.y, 3.5, 0, Math.PI * 2); ctx.fill();

    if (activeShade && activeShade.mode === 'maze' && activeShade.grid === attachedMazeGrid &&
        !shadeInInactiveOverlap(activeShade)) {
        const shadeLocal = worldToMazeLocal(activeShade.x, activeShade.z);
        const shadePoint = toCanvas(shadeLocal);
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180);
        ctx.fillStyle = '#ff6453';
        ctx.globalAlpha = 0.55 + 0.45 * pulse;
        ctx.beginPath(); ctx.arc(shadePoint.x, shadePoint.y, 2.8 + 1.6 * pulse, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
    }

    camera.getWorldDirection(minimapForward);
    const mazeRot = attachedMazeGroup ? attachedMazeGroup.rotation.y : 0;
    const localDirX = minimapForward.x * Math.cos(mazeRot) - minimapForward.z * Math.sin(mazeRot);
    const localDirZ = minimapForward.x * Math.sin(mazeRot) + minimapForward.z * Math.cos(mazeRot);
    const dirLen = 8;
    ctx.strokeStyle = '#8ec07c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(player.x, player.y);
    ctx.lineTo(player.x + localDirX * dirLen, player.y + localDirZ * dirLen);
    ctx.stroke();
}
// ===== EVENT HANDLERS =====
function resumePlayTimer() {
    if (!playStartedAt && gameState !== 'WIN') playStartedAt = performance.now();
}

function pausePlayTimer() {
    if (!playStartedAt) return;
    elapsedPlayMs += performance.now() - playStartedAt;
    playStartedAt = 0;
}

function clearMovementState() {
    moveState.forward = false;
    moveState.backward = false;
    moveState.left = false;
    moveState.right = false;
}

function setupEvents() {
    const blocker = document.getElementById('blocker');

    const rebuildCurrentHub = () => {
        if (gameState !== 'HUB' || playerInMaze || !currentGroup) return;
        clearScene();
        currentGroup = buildHub(currentRoomId);
        scene.add(currentGroup);
    };

    blocker.addEventListener('click', event => {
        if (event.target.closest('a') || event.target.closest('.options')) return;
        controls.lock();
    });

    const hardToggle = document.getElementById('optHard');
    try { hardMode = localStorage.getItem('dreadfulEngine.hardMode') === '1'; } catch (e) { /* storage unavailable */ }
    hardToggle.checked = hardMode;
    hardToggle.addEventListener('change', () => {
        hardMode = hardToggle.checked;
        try { localStorage.setItem('dreadfulEngine.hardMode', hardMode ? '1' : '0'); } catch (e) { /* private browsing */ }
        if (!hardMode) hardEntireRun = false;
        rebuildCurrentHub();
    });

    const cheatToggle = document.getElementById('optCheat');
    cheatToggle.checked = cheatMode;
    cheatToggle.addEventListener('change', () => {
        cheatMode = cheatToggle.checked;
        if (cheatMode && runStarted) cheatUsed = true;
        refreshSeedDisplay();
        rebuildCurrentHub();
    });

    const dateInput = document.getElementById('optDate');
    const today = localDateKey();
    dateInput.max = today;
    dateInput.value = /^\d{4}-\d{2}-\d{2}$/.test(activeKey) ? activeKey : today;
    dateInput.addEventListener('change', () => {
        const v = dateInput.value;
        if (!v || v === activeKey) return;
        const params = new URLSearchParams();
        if (v !== localDateKey()) params.set('key', v);
        if (cheatMode) params.set('cheat', 'true');
        if (shadeDisabled) params.set('shade', 'false');
        const qs = params.toString();
        location.href = location.pathname + (qs ? '?' + qs : '');
    });

    controls.addEventListener('lock', () => {
        if (!runStarted) {
            runStarted = true;
            hardEntireRun = hardMode;
            shadeDisabledEntireRun = shadeDisabled;
            if (cheatMode) cheatUsed = true;
            hardToggle.disabled = true;
        }
        resumePlayTimer();
        blocker.classList.add('hidden');
    });

    document.addEventListener('click', e => {
        if (!e.isTrusted) return;
        if (controls.isLocked) onHubClick();
    });

    controls.addEventListener('unlock', () => {
        pausePlayTimer();
        clearMovementState();
        if (gameState !== 'WIN') {
            blocker.classList.remove('hidden');
        }
    });

    window.addEventListener('blur', e => {
        if (!e.isTrusted) return;
        clearMovementState();
    });

    document.addEventListener('keydown', e => {
        if (!e.isTrusted) return;
        switch (e.code) {
            case 'KeyW': case 'ArrowUp': moveState.forward = true; break;
            case 'KeyS': case 'ArrowDown': moveState.backward = true; break;
            case 'KeyA': case 'ArrowLeft': moveState.left = true; break;
            case 'KeyD': case 'ArrowRight': moveState.right = true; break;
            case 'Space':
                if (!e.repeat && gameState === 'HUB' && playerPos.y === EYE_H) {
                    verticalVelocity = JUMP_VELOCITY;
                }
                break;
            case 'KeyE':
                if (!e.repeat) interactWithHub(true);
                break;
        }
    });

    document.addEventListener('keyup', e => {
        if (!e.isTrusted) return;
        switch (e.code) {
            case 'KeyW': case 'ArrowUp': moveState.forward = false; break;
            case 'KeyS': case 'ArrowDown': moveState.backward = false; break;
            case 'KeyA': case 'ArrowLeft': moveState.left = false; break;
            case 'KeyD': case 'ArrowRight': moveState.right = false; break;
        }
    });
}

// ===== ANIMATION =====
let prevTime = 0;
function animate(time) {
    requestAnimationFrame(animate);
    const delta = Math.min((time - prevTime) / 1000, 0.1);
    prevTime = time;

    if (controls.isLocked && gameState === 'HUB') {
        updateMovement(delta);
        if (gameState === 'HUB') updateHunter(delta);
        updateHUD();
    }

    const rotating = attachedMazeGrid?.rotatingChamber;
    if (rotating?.visual) {
        const target = rotating.activated ? rotating.angle : 0;
        rotating.visual.rotation.y += (target - rotating.visual.rotation.y) * Math.min(1, delta * 5);
    }

    drawMinimap();
    renderer.render(scene, camera);
}

// ===== INIT =====
function localDateKey(now = new Date()) {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function init() {
    const params = new URLSearchParams(window.location.search);
    const suppliedKey = params.get('key');
    testMazeMode = params.get('test') === 'features';
    activeKey = suppliedKey && suppliedKey.trim() ? suppliedKey.trim()
        : testMazeMode ? 'feature-test' : localDateKey();
    const isDaily = !suppliedKey || !suppliedKey.trim();

    cheatMode = testMazeMode || params.get('cheat') === 'true';
    shadeDisabled = params.get('shade') === 'false';
    masterSeed = String(fnv1a(activeKey));
    const seedRng = new Rng(fnv1a(activeKey));
    const startRoom = testMazeMode ? '5.13' : CONTROL_ROOMS[seedRng.nextInt(0, CONTROL_ROOMS.length - 1)];

    const isDateKey = /^\d{4}-\d{2}-\d{2}$/.test(activeKey);
    seedLabel = `${testMazeMode ? 'FEATURE TEST' : (isDaily || isDateKey) ? 'DAILY' : 'KEY'} ${activeKey}`;
    isDailyRun = isDaily;
    refreshSeedDisplay();
    document.getElementById('shareBtn').addEventListener('click', shareResult);

    computeDistances();
    setupThree();
    setupEvents();

    elapsedPlayMs = 0;
    playStartedAt = 0;
    mazeCount = 0;
    roomTrail = [];
    lastShareText = '';
    collectedObelisks = new Set();
    activeShade = null;
    lastArrivalDir = null;
    shadeRng = new Rng(fnv1a(activeKey + '|shade'));

    enterHub(startRoom);
    document.documentElement.dataset.mazeReady = 'true';

    requestAnimationFrame(animate);
}

if (document.fonts && document.fonts.ready) document.fonts.ready.then(init);
else init();
