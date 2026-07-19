import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import {
    CELL,
    CONTROL_ROOMS,
    DIRECTIONS,
    DIR_ANGLES,
    DOOR_H,
    DOOR_W,
    EYE_H,
    EXIT_HANDOFF_DEPTH,
    GRUVBOX,
    HUB_APO,
    HUB_H,
    HUB_RAD,
    HUNTER_SPEED_FACTOR,
    HUNTER_WAKE_DELAY_MS,
    MOVE_SPD,
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
import { Rng, fnv1a, generateMaze } from './generation.js';

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

function addCheatLine(group, grid) {
    const path = solveMaze(grid);
    if (path.length < 2) return;
    const mat = new THREE.LineBasicMaterial({color: GRUVBOX.red, transparent: true, opacity: 0.5, depthWrite: false});
    const centerPoint = cell => new THREE.Vector3(cell.x * CELL + CELL / 2, 0.1, cell.y * CELL + CELL / 2);
    const foldPoint = cell => new THREE.Vector3(
        cell.x * CELL + CELL / 2,
        0.1,
        cell === grid.spaceFold?.north ? 0.3 : grid.h * CELL - 0.3
    );
    let segment = [centerPoint(path[0])];
    const flush = () => {
        if (segment.length < 2) { segment = []; return; }
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(segment), mat.clone()));
        segment = [];
    };
    for (let i = 0; i < path.length - 1; i++) {
        const from = path[i], to = path[i + 1];
        if (Math.abs(from.x - to.x) + Math.abs(from.y - to.y) === 1) {
            segment.push(centerPoint(to));
            continue;
        }
        const foldJump = grid.spaceFold && (
            (from === grid.spaceFold.north && to === grid.spaceFold.south) ||
            (from === grid.spaceFold.south && to === grid.spaceFold.north)
        );
        if (foldJump) segment.push(foldPoint(from));
        flush();
        segment = foldJump ? [foldPoint(to), centerPoint(to)] : [centerPoint(to)];
    }
    flush();
    mat.dispose();
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
    const angle = DIR_ANGLES[bestDir];
    const points = [
        new THREE.Vector3(0, 0.1, 0),
        new THREE.Vector3(Math.sin(angle) * (HUB_APO - 0.5), 0.1, -Math.cos(angle) * (HUB_APO - 0.5))
    ];
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({color: GRUVBOX.red, transparent: true, opacity: 0.5, depthWrite: false});
    group.add(new THREE.Line(geom, mat));
    // Arrow at the end
    const arrowGeo = new THREE.ConeGeometry(0.12, 0.25, 4);
    const arrowMat = new THREE.MeshBasicMaterial({color: GRUVBOX.red, transparent: true, opacity: 0.5});
    const arrow = new THREE.Mesh(arrowGeo, arrowMat);
    arrow.rotation.x = -Math.PI / 2;
    arrow.rotation.z = -angle;
    arrow.position.set(Math.sin(angle) * (HUB_APO - 0.3), 0.1, -Math.cos(angle) * (HUB_APO - 0.3));
    group.add(arrow);
}

// ===== THREE.JS SETUP =====
let scene, camera, renderer, controls;
const playerPos = new THREE.Vector3();
const moveState = {forward:false, backward:false, left:false, right:false};
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
let runStarted = false;
let cheatUsed = false;
let activeShade = null;
let lastArrivalDir = null;
let shadeRng = null;
let testMazeMode = false;
let playerLight = null;

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
        const hasDoor = !!nav[dir];
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

            // Sealed door panel (blocks the opening until clicked)
            const dest = nav[dir];
            const dt = TESSERACTS[getTess(dest)];
            const doorColor = new THREE.Color(dt.color);
            const closerToEntryway = distances[dest] < distances[roomId];
            const doorMat = new THREE.MeshStandardMaterial({
                map: getDoorTexture(getTess(dest), dt.color),
                color: GRUVBOX.fg,
                emissive: doorColor,
                emissiveIntensity: closerToEntryway ? 0.2 : 0.07,
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

            if (preview && dir === openDirection) {
                doorPanel.visible = false;
                doorWire.visible = false;
                label.visible = false;
                sigil.visible = false;
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

    if (cheatMode && !preview) addHubCheatLine(group, roomId);

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
    if (gameState !== 'HUB' || playerInMaze || !controls.isLocked) return;
    raycaster.setFromCamera(pointer, camera);
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
    const group = new THREE.Group();
    const {w, h} = mazeGrid;
    const totalW = w * CELL, totalH = h * CELL;
    const accent = new THREE.Color(TESSERACTS[getTess(dstRoom)].color);
    const wallColor = new THREE.Color(GRUVBOX.bg1).lerp(accent, 0.1);

    // Collect unit wall segments by grid line, then collapse consecutive
    // segments into long runs. This avoids outlining every cell as a panel.
    const solidGeoms = [];
    const horizontalWalls = new Map();
    const verticalWalls = new Map();

    function addWall(x, y, z, wid, hei, dep) {
        const g = new THREE.BoxGeometry(wid, hei, dep);
        g.translate(x, y, z);
        solidGeoms.push(g);
    }

    function markWall(map, fixedAxis, unit) {
        if (!map.has(fixedAxis)) map.set(fixedAxis, []);
        map.get(fixedAxis).push(unit);
    }

    function buildWallRuns(map, horizontal) {
        for (const [fixedAxis, units] of map) {
            units.sort((a, b) => a - b);
            let start = units[0];
            let end = units[0];
            const flush = () => {
                const length = (end - start + 1) * CELL;
                const center = (start + end + 1) * CELL / 2;
                if (horizontal) addWall(center, WALL_H / 2, fixedAxis * CELL, length, WALL_H, WALL_T);
                else addWall(fixedAxis * CELL, WALL_H / 2, center, WALL_T, WALL_H, length);
            };
            for (let i = 1; i < units.length; i++) {
                if (units[i] === end + 1) {
                    end = units[i];
                } else {
                    flush();
                    start = end = units[i];
                }
            }
            flush();
        }
    }

    function isRotatingEdge(a, b) {
        const chamber = mazeGrid.rotatingChamber;
        if (!chamber || !a || !b) return false;
        return (a === chamber.entry && b === chamber.cell) ||
            (a === chamber.cell && b === chamber.entry) ||
            (a === chamber.cell && b === chamber.exit) ||
            (a === chamber.exit && b === chamber.cell);
    }

    // Catalogue each physical wall once using south/east cell faces plus the
    // north/west outer boundaries.
    for (let gy = 0; gy < h; gy++) {
        for (let gx = 0; gx < w; gx++) {
            const c = mazeGrid.cell(gx, gy);
            if (gy === 0 && c.N) markWall(horizontalWalls, gy, gx);
            if (gx === 0 && c.W) markWall(verticalWalls, gx, gy);
            const south = mazeGrid.cell(gx, gy + 1);
            const east = mazeGrid.cell(gx + 1, gy);
            if (c.S && !isRotatingEdge(c, south)) markWall(horizontalWalls, gy + 1, gx);
            if (c.E && !isRotatingEdge(c, east)) markWall(verticalWalls, gx + 1, gy);
        }
    }
    buildWallRuns(horizontalWalls, true);
    buildWallRuns(verticalWalls, false);

    // Maze cells are wider than hub doors. Close the unused portion of each
    // boundary cell so both sides meet at the same 2 m opening.
    const doorwayCapDepth = (CELL - DOOR_W) / 2;
    function addDoorwayCaps(x, cell) {
        if (!cell || doorwayCapDepth <= 0) return;
        const centerZ = cell.y * CELL + CELL / 2;
        const offset = DOOR_W / 2 + doorwayCapDepth / 2;
        addWall(x, WALL_H / 2, centerZ - offset, WALL_T, WALL_H, doorwayCapDepth);
        addWall(x, WALL_H / 2, centerZ + offset, WALL_T, WALL_H, doorwayCapDepth);
    }
    addDoorwayCaps(0, mazeGrid.entranceCell);
    addDoorwayCaps(totalW, mazeGrid.exitCell);

    function addFoldCaps(z, cell) {
        if (!cell || doorwayCapDepth <= 0) return;
        const centerX = cell.x * CELL + CELL / 2;
        const offset = DOOR_W / 2 + doorwayCapDepth / 2;
        addWall(centerX - offset, WALL_H / 2, z, doorwayCapDepth, WALL_H, WALL_T);
        addWall(centerX + offset, WALL_H / 2, z, doorwayCapDepth, WALL_H, WALL_T);
    }
    if (mazeGrid.spaceFold) {
        addFoldCaps(0, mazeGrid.spaceFold.north);
        addFoldCaps(totalH, mazeGrid.spaceFold.south);
    }

    // Merge and add solid walls
    if (solidGeoms.length > 0) {
        const merged = BufferGeometryUtils.mergeGeometries(solidGeoms);
        const solidMat = new THREE.MeshStandardMaterial({
            color: wallColor,
            roughness: 0.9,
            metalness: 0.08
        });
        group.add(new THREE.Mesh(merged, solidMat));
        const edgeGeometry = new THREE.EdgesGeometry(merged, 25);
        const edgeMaterial = new THREE.LineBasicMaterial({
            color: accent,
            transparent: true,
            opacity: 0.45,
            depthWrite: false
        });
        group.add(new THREE.LineSegments(edgeGeometry, edgeMaterial));
        solidGeoms.forEach(g => g.dispose());
    }

    if (mazeGrid.rotatingChamber) {
        const chamber = mazeGrid.rotatingChamber;
        const makeDynamicPanel = (a, b) => {
            const panelGroup = new THREE.Group();
            const horizontal = a.y !== b.y;
            const x = horizontal ? a.x * CELL + CELL / 2 : Math.max(a.x, b.x) * CELL;
            const z = horizontal ? Math.max(a.y, b.y) * CELL : a.y * CELL + CELL / 2;
            const geometry = new THREE.BoxGeometry(horizontal ? CELL : WALL_T, WALL_H, horizontal ? WALL_T : CELL);
            const material = new THREE.MeshStandardMaterial({color:wallColor, roughness:0.86, metalness:0.12});
            const panel = new THREE.Mesh(geometry, material);
            panel.position.set(x, WALL_H / 2, z);
            panelGroup.add(panel);
            const edges = new THREE.LineSegments(
                new THREE.EdgesGeometry(geometry),
                new THREE.LineBasicMaterial({color:GRUVBOX.yellow, transparent:true, opacity:0.72})
            );
            edges.position.copy(panel.position);
            panelGroup.add(edges);
            panelGroup.visible = a[mazeGrid.passageDirection(a, b)];
            group.add(panelGroup);
            return panelGroup;
        };
        chamber.entryPanel = makeDynamicPanel(chamber.entry, chamber.cell);
        chamber.exitPanel = makeDynamicPanel(chamber.cell, chamber.exit);
    }

    // Floor
    const floorGeom = new THREE.PlaneGeometry(totalW, totalH);
    const floorMat = new THREE.MeshStandardMaterial({color: GRUVBOX.bgHard, roughness: 0.94, side: THREE.DoubleSide});
    const floor = new THREE.Mesh(floorGeom, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(totalW / 2, 0, totalH / 2);
    group.add(floor);

    // Ceiling
    const ceilGeom = new THREE.PlaneGeometry(totalW, totalH);
    const ceilMat = new THREE.MeshStandardMaterial({color: GRUVBOX.bg, roughness: 0.94, side: THREE.DoubleSide});
    const ceil = new THREE.Mesh(ceilGeom, ceilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(totalW / 2, WALL_H, totalH / 2);
    group.add(ceil);

    // Entrance marker (green glow)
    const ec = mazeGrid.entranceCell;
    if (ec) {
        const eLight = new THREE.PointLight(GRUVBOX.green, 1.5, 8);
        eLight.position.set(ec.x * CELL + CELL / 2, 1, ec.y * CELL + CELL / 2);
        group.add(eLight);
        const ePlane = new THREE.Mesh(
            new THREE.PlaneGeometry(CELL * 0.6, CELL * 0.6),
            new THREE.MeshBasicMaterial({color: GRUVBOX.green, transparent: true, opacity: 0.15, side: THREE.DoubleSide})
        );
        ePlane.rotation.x = -Math.PI / 2;
        ePlane.position.set(ec.x * CELL + CELL / 2, 0.02, ec.y * CELL + CELL / 2);
        group.add(ePlane);
        const eLabel = makeFloorInscription(`BACK · ${srcRoom}`, '#b8bb26', {
            size: 28,
            worldWidth: 2.2,
            worldHeight: 0.38,
            plaque: true
        });
        eLabel.position.set(ec.x * CELL + CELL / 2, 0.055, ec.y * CELL + CELL / 2);
        group.add(eLabel);
    }

    // Exit marker (gold glow)
    const xc = mazeGrid.exitCell;
    if (xc) {
        const xLight = new THREE.PointLight(GRUVBOX.yellow, 2, 10);
        xLight.position.set(xc.x * CELL + CELL / 2, 1, xc.y * CELL + CELL / 2);
        group.add(xLight);
        const xPlane = new THREE.Mesh(
            new THREE.PlaneGeometry(CELL * 0.6, CELL * 0.6),
            new THREE.MeshBasicMaterial({color: GRUVBOX.yellow, transparent: true, opacity: 0.2, side: THREE.DoubleSide})
        );
        xPlane.rotation.x = -Math.PI / 2;
        xPlane.position.set(xc.x * CELL + CELL / 2, 0.02, xc.y * CELL + CELL / 2);
        group.add(xPlane);
        const xLabel = makeFloorInscription(`EXIT · ${dstRoom}`, '#fabd2f', {
            size: 28,
            worldWidth: 2.2,
            worldHeight: 0.38,
            plaque: true
        });
        xLabel.position.set(xc.x * CELL + CELL / 2, 0.055, xc.y * CELL + CELL / 2);
        group.add(xLabel);

        // Visual-only destination hub beyond the exit. The real state
        // transition still happens at the threshold, keeping collision and
        // interaction ownership with the current room.
        const returnDir = findReturnDir(srcRoom, dstRoom);
        if (returnDir) {
            const previewHub = buildHub(dstRoom, {preview: true, openDirection: returnDir});
            previewHub.position.set(totalW + HUB_APO, 0, xc.y * CELL + CELL / 2);
            previewHub.rotation.y = DIR_ANGLES[returnDir] + Math.PI / 2;
            group.add(previewHub);
        }
    }

    // Paired boundary apertures. Passing through either edge returns through
    // the other without rotating the player, making the topology legible.
    if (mazeGrid.spaceFold) {
        const foldColor = GRUVBOX.purple;
        const addFoldMarker = (cell, label, edgeZ) => {
            const x = cell.x * CELL + CELL / 2;
            const z = cell.y * CELL + CELL / 2;
            const light = new THREE.PointLight(foldColor, 1.4, 9);
            light.position.set(x, 1, z);
            group.add(light);
            const ring = new THREE.Mesh(
                new THREE.RingGeometry(0.48, 0.76, 32),
                new THREE.MeshBasicMaterial({color:foldColor, transparent:true, opacity:0.8, side:THREE.DoubleSide})
            );
            ring.rotation.x = -Math.PI / 2;
            ring.position.set(x, 0.03, edgeZ);
            group.add(ring);
            const foldLabel = makeFloorInscription(label, '#d3869b', {
                size: 28,
                worldWidth: 1.72,
                worldHeight: 0.34,
                plaque: true
            });
            foldLabel.position.set(x, 0.055, z);
            group.add(foldLabel);
        };
        addFoldMarker(mazeGrid.spaceFold.north, 'FOLD α', 0.3);
        addFoldMarker(mazeGrid.spaceFold.south, 'FOLD β', totalH - 0.3);
    }

    // One-way thresholds remain visually open. Floor arrows show the legal
    // direction and small posts mark the collision plane without resembling a
    // solid wall.
    for (const gate of mazeGrid.oneWayGates) {
        const gateColor = gate.required ? GRUVBOX.yellow : GRUVBOX.aqua;
        const gateCss = gate.required ? '#fabd2f' : '#8ec07c';
        const fromX = gate.from.x * CELL + CELL / 2;
        const fromZ = gate.from.y * CELL + CELL / 2;
        const toX = gate.to.x * CELL + CELL / 2;
        const toZ = gate.to.y * CELL + CELL / 2;
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

        const gateLight = new THREE.PointLight(gateColor, gate.required ? 0.85 : 0.55, 4.5);
        gateLight.position.set(mx, 0.5, mz);
        group.add(gateLight);
        if (gate.required) {
            const gateLabel = makeFloorInscription('COMMIT', gateCss, {
                size: 28,
                worldWidth: 1.45,
                worldHeight: 0.32,
                plaque: true
            });
            gateLabel.position.set(mx - ux * 0.95, 0.075, mz - uz * 0.95);
            group.add(gateLabel);
        }
    }

    if (mazeGrid.spatialLoop) {
        const loop = mazeGrid.spatialLoop;
        const loopColor = loop.required ? GRUVBOX.yellow : GRUVBOX.blue;
        const loopCss = loop.required ? '#fabd2f' : '#83a598';
        const addLoopMarker = (cell, label) => {
            const x = cell.x * CELL + CELL / 2, z = cell.y * CELL + CELL / 2;
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
        const x = chamber.cell.x * CELL + CELL / 2, z = chamber.cell.y * CELL + CELL / 2;
        const plate = new THREE.Mesh(
            new THREE.RingGeometry(0.42, 0.82, 32),
            new THREE.MeshBasicMaterial({color:GRUVBOX.yellow, transparent:true, opacity:0.82, side:THREE.DoubleSide})
        );
        plate.rotation.x = -Math.PI / 2;
        plate.position.set(x, 0.045, z);
        group.add(plate);
        const rotor = new THREE.Group();
        rotor.position.set(x, 0.075, z);
        const rotorGeometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(-0.62,0,0), new THREE.Vector3(0.62,0,0),
            new THREE.Vector3(0,0,-0.62), new THREE.Vector3(0,0,0.62)
        ]);
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
        const key = `${c.x},${c.y}`;
        if (chamberCenters.has(key)) continue;
        chamberCenters.add(key);

        const ccx = c.x * CELL + CELL / 2, ccz = c.y * CELL + CELL / 2;

        // Chamber floor highlight
        const chFloor = new THREE.Mesh(
            new THREE.PlaneGeometry(CELL * 0.8, CELL * 0.8),
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

    // Traps
    for (const c of mazeGrid.cells) {
        if (!c.trap) continue;
        const tcx = c.x * CELL + CELL / 2, tcz = c.y * CELL + CELL / 2;
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
    if (mazeGrid.hunter && !activeShade) {
        const hunter = mazeGrid.hunter;
        const shade = makeShadeVisual();
        shade.position.set(hunter.x, 0, hunter.z);
        group.add(shade);
        hunter.visual = shade;
    }

    // Player light (follows camera, added to scene not group)
    playerLight = new THREE.PointLight(GRUVBOX.fg, 1.15, 20);
    playerLight.position.copy(playerPos);
    scene.add(playerLight);

    if (cheatMode) addCheatLine(group, mazeGrid);

    return group;
}

// ===== ATTACHED MAZE STATE =====
let attachedMazeGroup = null;
let attachedMazeGrid = null;
let attachedMazeParams = null;
let attachedMazeDest = null;
let playerInMaze = false;
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

// Preserve the player's position and view when the rendered destination-hub
// preview becomes the real hub. Both use the same transform, so the scene can
// change ownership without a visible teleport.
function captureMazeExitPose() {
    if (!attachedMazeGroup || !attachedMazeGrid || !attachedMazeDest) return null;
    const returnDir = findReturnDir(currentRoomId, attachedMazeDest);
    if (!returnDir) return null;

    const local = worldToMazeLocal(playerPos.x, playerPos.z);
    const exit = attachedMazeGrid.exitCell;
    const previewAngle = DIR_ANGLES[returnDir] + Math.PI / 2;
    const centerX = attachedMazeGrid.w * CELL + HUB_APO;
    const centerZ = exit.y * CELL + CELL / 2;
    const dx = local.x - centerX;
    const dz = local.z - centerZ;
    const cosPreview = Math.cos(previewAngle);
    const sinPreview = Math.sin(previewAngle);

    camera.getWorldDirection(moveForward);
    const mazeAngle = attachedMazeGroup.rotation.y;
    const mazeDirX = moveForward.x * Math.cos(mazeAngle) - moveForward.z * Math.sin(mazeAngle);
    const mazeDirZ = moveForward.x * Math.sin(mazeAngle) + moveForward.z * Math.cos(mazeAngle);
    const hubDirX = mazeDirX * cosPreview - mazeDirZ * sinPreview;
    const hubDirZ = mazeDirX * sinPreview + mazeDirZ * cosPreview;

    return {
        x: dx * cosPreview - dz * sinPreview,
        z: dx * sinPreview + dz * cosPreview,
        pitch: camera.rotation.x,
        yaw: Math.atan2(-hubDirX, -hubDirZ)
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
    camera.position.set(playerPos.x, playerPos.y, playerPos.z);
    updateHUD();
}

function attachMaze(dir) {
    detachMaze();
    const nav = roomNavigation[currentRoomId] || {};
    const dest = nav[dir];
    if (!dest) return;

    const {grid, params} = generateMaze(masterSeed, currentRoomId, dest, {allFeatures:testMazeMode});
    const mazeGroup = buildMazeScene(grid, currentRoomId, dest);

    // Rotate maze so entrance aligns with the hub door
    // Maze entrance faces west (-X). We need it to face back toward hub.
    const angle = DIR_ANGLES[dir];
    const rot = Math.PI / 2 - angle;
    mazeGroup.rotation.y = rot;

    // Position so entrance opening meets the door
    const ec = grid.entranceCell;
    const ecZ = ec.y * CELL + CELL / 2;
    const doorDist = HUB_APO;
    const doorX = Math.sin(angle) * doorDist;
    const doorZ = -Math.cos(angle) * doorDist;
    // Entrance center in maze-local is (0, 0, ecZ). After rotation:
    const entrWorldX = 0 * Math.cos(rot) + ecZ * Math.sin(rot);
    const entrWorldZ = -0 * Math.sin(rot) + ecZ * Math.cos(rot);
    mazeGroup.position.x = doorX - entrWorldX;
    mazeGroup.position.z = doorZ - entrWorldZ;

    scene.add(mazeGroup);
    scene.fog.far = params.fogFar;

    attachedMazeGroup = mazeGroup;
    attachedMazeGrid = grid;
    attachedMazeParams = params;
    attachedMazeDest = dest;
    buildMinimapBase(grid);

    // Destination preview geometry is owned by the maze group.
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
    minimapBase = null;
    minimapLayout = null;
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

function enterWin() {
    gameState = 'WIN';
    destroyShade();
    controls.unlock();
    const elapsedMs = elapsedPlayMs + (playStartedAt ? performance.now() - playStartedAt : 0);
    const elapsed = Math.floor(elapsedMs / 1000);
    const min = Math.floor(elapsed / 60);
    const sec = elapsed % 60;
    const timeStr = `${min}:${sec.toString().padStart(2,'0')}${hardEntireRun ? '*' : ''}${cheatUsed ? '†' : ''}`;
    const glyphs = tesseractGlyphs();
    const roomsSeen = new Set(roomTrail).size;
    document.getElementById('winTime').textContent = `Time: ${timeStr}`;
    document.getElementById('winMazes').textContent = `Mazes traversed: ${mazeCount} · Rooms: ${roomsSeen}`;
    document.getElementById('winTrail').textContent = glyphs;
    lastShareText = [
        'THE DREADFUL ENGINE',
        seedLabel + (cheatUsed ? ' † CHEAT' : ''),
        glyphs,
        `${timeStr} · ${mazeCount} mazes · ${roomsSeen} rooms`,
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
    playerPos.y = EYE_H;

    // Determine if player is past the open door (in the maze area)
    const inMazeArea = isPlayerInMaze();

    if (inMazeArea && attachedMazeGrid) {
        if (!playerInMaze) {
            playerInMaze = true;
            const hunter = attachedMazeGrid.hunter;
            if (hunter && !hunter.wakeAt && !activeShade) {
                hunter.wakeAt = performance.now() + HUNTER_WAKE_DELAY_MS;
                showEventMessage('THE SHADE STIRS', 2600);
            }
        }
        // Maze collision in local coords
        collideInMaze(previousX, previousZ);
        checkRotatingChamber();
        checkSpatialLoop();
        checkMazeTraps();
        if (checkMazeExit()) {
            const destination = attachedMazeDest;
            const source = currentRoomId;
            const arrivalPose = captureMazeExitPose();
            mazeCount++;
            enterHub(destination, source, arrivalPose);
            return;
        }
    } else {
        if (playerInMaze) {
            playerInMaze = false;
        }
        // Hub collision
        collideWithHub();
    }

    camera.position.set(playerPos.x, playerPos.y, playerPos.z);

    // Update player light
    if (playerLight) playerLight.position.set(playerPos.x, playerPos.y, playerPos.z);
}

function checkRotatingChamber() {
    const chamber = attachedMazeGrid?.rotatingChamber;
    if (!chamber || chamber.activated) return;
    const local = worldToMazeLocal(playerPos.x, playerPos.z);
    const centerX = chamber.cell.x * CELL + CELL / 2;
    const centerZ = chamber.cell.y * CELL + CELL / 2;
    if (Math.hypot(local.x - centerX, local.z - centerZ) > 0.68) return;
    if (!attachedMazeGrid.activateRotatingChamber()) return;
    if (chamber.entryPanel) chamber.entryPanel.visible = true;
    if (chamber.exitPanel) chamber.exitPanel.visible = false;
    buildMinimapBase(attachedMazeGrid);
    showEventMessage('CHAMBER ROTATED · EXIT OPEN');
}

function checkSpatialLoop() {
    const loop = attachedMazeGrid?.spatialLoop;
    if (!loop) return;
    const local = worldToMazeLocal(playerPos.x, playerPos.z);
    const center = cell => ({x:cell.x * CELL + CELL / 2, z:cell.y * CELL + CELL / 2});

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
    if (!hubDoorOpen || !attachedMazeGroup) return false;
    const angle = DIR_ANGLES[hubDoorOpen];
    const nx = Math.sin(angle), nz = -Math.cos(angle);
    const dot = playerPos.x * nx + playerPos.z * nz;
    return dot > HUB_APO - 0.2;
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
    const totalW = grid.w * CELL, totalH = grid.h * CELL;
    const ec = grid.entranceCell, xc = grid.exitCell;
    const openingHalfWidth = DOOR_W / 2 - P_RAD * 0.5;
    const atEntrance = ec && Math.abs(local.z - (ec.y * CELL + CELL / 2)) < openingHalfWidth;
    const atExit = xc && Math.abs(local.z - (xc.y * CELL + CELL / 2)) < openingHalfWidth;
    const fold = grid.spaceFold;
    const northCenterX = fold ? fold.north.x * CELL + CELL / 2 : 0;
    const southCenterX = fold ? fold.south.x * CELL + CELL / 2 : 0;
    const atNorthFold = fold && Math.abs(local.x - northCenterX) < openingHalfWidth;
    const atSouthFold = fold && Math.abs(local.x - southCenterX) < openingHalfWidth;

    // Boundary clamp (entrance/exit are open)
    if (local.x < P_RAD && !atEntrance) local.x = P_RAD;
    if (local.x > totalW - P_RAD && !atExit) local.x = totalW - P_RAD;
    if (local.z < P_RAD && !atNorthFold) local.z = P_RAD;
    if (local.z > totalH - P_RAD && !atSouthFold) local.z = totalH - P_RAD;

    // Sweep from the previous cell before resolving proximity. Without this,
    // crossing a wall within one frame places the player on its far side.
    const previousGX = Math.floor(previous.x / CELL);
    const previousGY = Math.floor(previous.z / CELL);
    const previousCell = grid.cell(previousGX, previousGY);
    if (previousCell) {
        if (local.x > previous.x && (previousCell.E || previousCell.oneWayBlocked.E)) {
            local.x = Math.min(local.x, (previousGX + 1) * CELL - P_RAD);
        } else if (local.x < previous.x && (previousCell.W || previousCell.oneWayBlocked.W)) {
            local.x = Math.max(local.x, previousGX * CELL + P_RAD);
        }

        const zCellX = Math.floor(local.x / CELL);
        const zCell = grid.cell(zCellX, previousGY);
        if (zCell) {
            if (local.z > previous.z && (zCell.S || zCell.oneWayBlocked.S)) {
                local.z = Math.min(local.z, (previousGY + 1) * CELL - P_RAD);
            } else if (local.z < previous.z && (zCell.N || zCell.oneWayBlocked.N)) {
                local.z = Math.max(local.z, previousGY * CELL + P_RAD);
            }
        }
    }

    // Axis-separated cell wall collision for sliding
    const gx = Math.floor(local.x / CELL);
    const gy = Math.floor(local.z / CELL);
    const c = grid.cell(gx, gy);
    if (c) {
        const cx = local.x - gx * CELL;
        const cz = local.z - gy * CELL;
        // Clamp each axis independently — allows sliding along walls
        if (c.W && cx < P_RAD) local.x = gx * CELL + P_RAD;
        if (c.E && cx > CELL - P_RAD) local.x = (gx + 1) * CELL - P_RAD;
        if (c.N && cz < P_RAD) local.z = gy * CELL + P_RAD;
        if (c.S && cz > CELL - P_RAD) local.z = (gy + 1) * CELL - P_RAD;

        // Corner check: if we're near a corner where two walls meet,
        // check the diagonal neighbor to prevent clipping through
        const cx2 = local.x - gx * CELL;
        const cz2 = local.z - gy * CELL;
        if (cx2 < P_RAD && cz2 < P_RAD) {
            const diag = grid.cell(gx - 1, gy - 1);
            if (!diag || (c.W && c.N)) { local.x = gx * CELL + P_RAD; local.z = gy * CELL + P_RAD; }
        }
        if (cx2 > CELL - P_RAD && cz2 < P_RAD) {
            const diag = grid.cell(gx + 1, gy - 1);
            if (!diag || (c.E && c.N)) { local.x = (gx + 1) * CELL - P_RAD; local.z = gy * CELL + P_RAD; }
        }
        if (cx2 < P_RAD && cz2 > CELL - P_RAD) {
            const diag = grid.cell(gx - 1, gy + 1);
            if (!diag || (c.W && c.S)) { local.x = gx * CELL + P_RAD; local.z = (gy + 1) * CELL - P_RAD; }
        }
        if (cx2 > CELL - P_RAD && cz2 > CELL - P_RAD) {
            const diag = grid.cell(gx + 1, gy + 1);
            if (!diag || (c.E && c.S)) { local.x = (gx + 1) * CELL - P_RAD; local.z = (gy + 1) * CELL - P_RAD; }
        }
    }

    if (fold && local.z < 0 && atNorthFold) {
        local.x = southCenterX + (local.x - northCenterX);
        local.z = totalH - P_RAD - 0.05;
        showEventMessage('SPACE FOLDS: α → β');
    } else if (fold && local.z > totalH && atSouthFold) {
        local.x = northCenterX + (local.x - southCenterX);
        local.z = P_RAD + 0.05;
        showEventMessage('SPACE FOLDS: β → α');
    }

    // Convert back to world
    const world = mazeLocalToWorld(local.x, local.z);
    playerPos.x = world.x;
    playerPos.z = world.z;
}

const shadeVeilEl = document.getElementById('shade-veil');
function setShadeVeil(strength) {
    shadeVeilEl.style.opacity = strength.toFixed(3);
}

function updateHunter(delta) {
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
            const w = mazeLocalToWorld(e.x * CELL + CELL / 2, e.y * CELL + CELL / 2);
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

    shade.visual.position.y = Math.sin(now / 320) * 0.12;

    // Veil + catch work in world coordinates, hub and maze alike. The ramp
    // is straight-line on purpose: darkness through walls means it is close
    // even when you cannot see it.
    const dx = playerPos.x - shade.x, dz = playerPos.z - shade.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    setShadeVeil(0.78 * Math.min(1, Math.max(0, (12 - dist) / 10.5)));
    if (dist < 0.75) {
        const pool = scatterPool(currentRoomId, attachedMazeDest);
        triggerTrap(shadeRng.pick(pool), 'SEIZED BY THE SHADE');
        return;
    }

    if (shade.mode === 'hub') {
        if (playerInMaze && attachedMazeGrid) {
            // The player fled through the open door — make for the entrance.
            const e = attachedMazeGrid.entranceCell;
            const w = mazeLocalToWorld(e.x * CELL + CELL / 2, e.y * CELL + CELL / 2);
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
    const playerCell = grid.cell(Math.floor(localPlayer.x / CELL), Math.floor(localPlayer.z / CELL));
    if (!playerInMaze && shade.cell === grid.entranceCell && !shade.targetCell) {
        // At the doorway with the player outside: cross into the hub.
        Object.assign(shade, {mode: 'hub', grid: null, cell: null});
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
        const adj = Math.abs(shade.targetCell.x - shade.cell.x)
                  + Math.abs(shade.targetCell.y - shade.cell.y);
        if (adj !== 1) {
            shade.cell = shade.targetCell;
            shade.targetCell = null;
            const w = mazeLocalToWorld(shade.cell.x * CELL + CELL / 2, shade.cell.y * CELL + CELL / 2);
            shade.x = w.x; shade.z = w.z;
            shade.visual.position.x = w.x;
            shade.visual.position.z = w.z;
            return;
        }
    }
    const t = mazeLocalToWorld(shade.targetCell.x * CELL + CELL / 2, shade.targetCell.y * CELL + CELL / 2);
    const mx = t.x - shade.x, mz = t.z - shade.z;
    const md = Math.sqrt(mx * mx + mz * mz);
    if (md <= step) {
        const w = mazeLocalToWorld(shade.targetCell.x * CELL + CELL / 2, shade.targetCell.y * CELL + CELL / 2);
        shade.x = w.x; shade.z = w.z;
        shade.cell = shade.targetCell;
        shade.targetCell = null;
    } else {
        shade.x += (mx / md) * step;
        shade.z += (mz / md) * step;
    }
    shade.visual.position.x = shade.x;
    shade.visual.position.z = shade.z;
}

function checkMazeTraps() {
    const grid = attachedMazeGrid;
    if (!grid) return;
    const local = worldToMazeLocal(playerPos.x, playerPos.z);
    const gx = Math.floor(local.x / CELL);
    const gy = Math.floor(local.z / CELL);
    const c = grid.cell(gx, gy);
    if (!c || !c.trap) return;
    const lx = local.x - gx * CELL - CELL / 2;
    const lz = local.z - gy * CELL - CELL / 2;
    if (Math.sqrt(lx * lx + lz * lz) < 0.6) {
        c.trap = false;
        triggerTrap(c.trapDest);
    }
}

function checkMazeExit() {
    if (!attachedMazeGrid) return false;
    const local = worldToMazeLocal(playerPos.x, playerPos.z);
    const xc = attachedMazeGrid.exitCell;
    if (!xc) return false;
    const atExitZ = Math.abs(local.z - (xc.y * CELL + CELL / 2)) < DOOR_W / 2 - P_RAD * 0.5;
    return atExitZ && local.x > (xc.x + 1) * CELL + EXIT_HANDOFF_DEPTH;
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
        roomInfo.textContent = `${srcTess.emoji} ${currentRoomId} \u2192 ${attachedMazeDest}`;
        const tier = ['Simple','Moderate','Complex','Labyrinthine'];
        const tierName = attachedMazeParams ? tier[attachedMazeParams.tier] : '';
        const featureNames = [];
        if (attachedMazeGrid.spaceFold) featureNames.push('SPACE FOLD');
        if (attachedMazeGrid.oneWayGates.length) featureNames.push(attachedMazeGrid.oneWayGates[0].required ? 'COMMITMENT GATE' : 'ONE WAY');
        if (attachedMazeGrid.rotatingChamber) featureNames.push('ROTATING CHAMBER');
        if (attachedMazeGrid.spatialLoop) featureNames.push(attachedMazeGrid.spatialLoop.required ? 'REQUIRED LOOP' : 'SPATIAL LOOP');
        mazeLabel.textContent = [tierName, ...featureNames].join(' · ');
        const local = worldToMazeLocal(playerPos.x, playerPos.z);
        const nearbyGate = attachedMazeGrid.oneWayGates.find(gate => {
            const x = (gate.from.x + gate.to.x + 1) * CELL / 2;
            const z = (gate.from.y + gate.to.y + 1) * CELL / 2;
            return Math.hypot(local.x - x, local.z - z) < 2.2;
        });
        const rotating = attachedMazeGrid.rotatingChamber;
        const nearRotationPlate = rotating && !rotating.activated && Math.hypot(
            local.x - (rotating.cell.x * CELL + CELL / 2),
            local.z - (rotating.cell.y * CELL + CELL / 2)
        ) < 2.2;
        const loop = attachedMazeGrid.spatialLoop;
        const nearLoop = loop && [loop.a, loop.b].some(cell => Math.hypot(
            local.x - (cell.x * CELL + CELL / 2),
            local.z - (cell.y * CELL + CELL / 2)
        ) < 2.1);
        if (nearRotationPlate) {
            hint.textContent = 'ROTATION PLATE · CROSS THE CENTER';
            hint.classList.add('visible');
        } else if (nearLoop) {
            hint.textContent = loop.required ? 'REQUIRED SPATIAL LOOP · ENTER THE RING' : 'SPATIAL LOOP · ENTER THE RING';
            hint.classList.add('visible');
        } else if (nearbyGate) {
            hint.textContent = nearbyGate.required ? 'COMMITMENT GATE · NO RETURN' : 'ONE WAY · FOLLOW THE FLOOR ARROW';
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
    const scale = Math.min((mw - 20) / grid.w, (mh - 20) / grid.h);
    const ox = (mw - grid.w * scale) / 2;
    const oz = (mh - grid.h * scale) / 2;
    minimapBase = document.createElement('canvas');
    minimapBase.width = mw;
    minimapBase.height = mh;
    minimapLayout = {scale, ox, oz};
    const ctx = minimapBase.getContext('2d');

    ctx.fillStyle = 'rgba(40,40,40,0.9)';
    ctx.fillRect(0, 0, mw, mh);

    // Draw cells
    ctx.strokeStyle = 'rgba(235,219,178,0.18)';
    ctx.lineWidth = 1;
    for (let gy = 0; gy < grid.h; gy++) {
        for (let gx = 0; gx < grid.w; gx++) {
            const c = grid.cell(gx, gy);
            const sx = ox + gx * scale, sy = oz + gy * scale;
            if (c.N) { ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + scale, sy); ctx.stroke(); }
            if (c.W) { ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, sy + scale); ctx.stroke(); }
            if (gy === grid.h - 1 && c.S) { ctx.beginPath(); ctx.moveTo(sx, sy + scale); ctx.lineTo(sx + scale, sy + scale); ctx.stroke(); }
            if (gx === grid.w - 1 && c.E) { ctx.beginPath(); ctx.moveTo(sx + scale, sy); ctx.lineTo(sx + scale, sy + scale); ctx.stroke(); }
        }
    }

    // Chamber highlights
    for (const c of grid.cells) {
        if (!c.chamber) continue;
        const sx = ox + c.x * scale, sy = oz + c.y * scale;
        ctx.fillStyle = 'rgba(131,165,152,0.24)';
        ctx.fillRect(sx + 1, sy + 1, scale - 2, scale - 2);
    }

    if (grid.rotatingChamber) {
        const c = grid.rotatingChamber.cell;
        const x = ox + (c.x + 0.5) * scale, y = oz + (c.y + 0.5) * scale;
        ctx.strokeStyle = '#fabd2f';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4); ctx.stroke();
    }

    // Trap markers
    for (const c of grid.cells) {
        if (!c.trap) continue;
        const cx = ox + (c.x + 0.5) * scale, cy = oz + (c.y + 0.5) * scale;
        ctx.fillStyle = 'rgba(255,100,83,0.55)';
        ctx.beginPath(); ctx.arc(cx, cy, 2, 0, Math.PI * 2); ctx.fill();
    }

    // One-way arrows
    for (const gate of grid.oneWayGates) {
        const fromX = ox + (gate.from.x + 0.5) * scale;
        const fromY = oz + (gate.from.y + 0.5) * scale;
        const toX = ox + (gate.to.x + 0.5) * scale;
        const toY = oz + (gate.to.y + 0.5) * scale;
        const dx = toX - fromX, dy = toY - fromY;
        const length = Math.hypot(dx, dy);
        const ux = dx / length, uy = dy / length;
        const mx = (fromX + toX) / 2, my = (fromY + toY) / 2;
        const tipX = mx + ux * 4, tipY = my + uy * 4;
        ctx.save();
        ctx.strokeStyle = gate.required ? '#fabd2f' : '#8ec07c';
        ctx.fillStyle = gate.required ? '#fabd2f' : '#8ec07c';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(mx - ux * 4, my - uy * 4);
        ctx.lineTo(tipX, tipY);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - ux * 3 - uy * 2.5, tipY - uy * 3 + ux * 2.5);
        ctx.lineTo(tipX - ux * 3 + uy * 2.5, tipY - uy * 3 - ux * 2.5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    if (grid.spatialLoop) {
        const loop = grid.spatialLoop;
        const aX = ox + (loop.a.x + 0.5) * scale, aY = oz + (loop.a.y + 0.5) * scale;
        const bX = ox + (loop.b.x + 0.5) * scale, bY = oz + (loop.b.y + 0.5) * scale;
        const color = loop.required ? '#fabd2f' : '#83a598';
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        const bendX = (aX + bX) / 2 + (bY - aY) * 0.35;
        const bendY = (aY + bY) / 2 - (bX - aX) * 0.35;
        ctx.beginPath(); ctx.moveTo(aX, aY); ctx.quadraticCurveTo(bendX, bendY, bX, bY); ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const [x, y, label] of [[aX,aY,'α'],[bX,bY,'β']]) {
            ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#282828'; ctx.fillText(label, x, y + 0.5); ctx.fillStyle = color;
        }
        ctx.restore();
    }

    // Entrance marker
    if (grid.entranceCell) {
        const ex = ox + (grid.entranceCell.x + 0.5) * scale;
        const ey = oz + (grid.entranceCell.y + 0.5) * scale;
        ctx.fillStyle = '#b8bb26';
        ctx.beginPath(); ctx.arc(ex, ey, 3, 0, Math.PI * 2); ctx.fill();
    }
    // Exit marker
    if (grid.exitCell) {
        const ex = ox + (grid.exitCell.x + 0.5) * scale;
        const ey = oz + (grid.exitCell.y + 0.5) * scale;
        ctx.fillStyle = '#fabd2f';
        ctx.beginPath(); ctx.arc(ex, ey, 3, 0, Math.PI * 2); ctx.fill();
    }


    // Paired fold gates and their non-Euclidean connection.
    if (grid.spaceFold) {
        const northX = ox + (grid.spaceFold.north.x + 0.5) * scale;
        const northY = oz + (grid.spaceFold.north.y + 0.5) * scale;
        const southX = ox + (grid.spaceFold.south.x + 0.5) * scale;
        const southY = oz + (grid.spaceFold.south.y + 0.5) * scale;
        ctx.save();
        ctx.strokeStyle = 'rgba(211,134,155,0.55)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(northX, northY); ctx.lineTo(southX, southY); ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = '#d3869b';
        ctx.lineWidth = 2;
        for (const [x, y] of [[northX, northY], [southX, southY]]) {
            ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.stroke();
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
    const {scale, ox, oz} = minimapLayout;
    const local = worldToMazeLocal(playerPos.x, playerPos.z);
    const px = local.x / CELL, pz = local.z / CELL;
    ctx.clearRect(0, 0, minimapEl.width, minimapEl.height);
    ctx.drawImage(minimapBase, 0, 0);

    // Player dot
    const ppx = ox + px * scale, ppz = oz + pz * scale;
    ctx.fillStyle = '#8ec07c';
    ctx.beginPath(); ctx.arc(ppx, ppz, 3.5, 0, Math.PI * 2); ctx.fill();

    // The Shade — pulsing so it reads at a glance
    if (activeShade && activeShade.mode === 'maze' && activeShade.grid === attachedMazeGrid) {
        const sl = worldToMazeLocal(activeShade.x, activeShade.z);
        const hx = ox + (sl.x / CELL) * scale, hz = oz + (sl.z / CELL) * scale;
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180);
        ctx.fillStyle = '#ff6453';
        ctx.globalAlpha = 0.55 + 0.45 * pulse;
        ctx.beginPath(); ctx.arc(hx, hz, 2.8 + 1.6 * pulse, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
    }

    // Direction indicator — project camera forward into maze-local space
    camera.getWorldDirection(minimapForward);
    const mazeRot = attachedMazeGroup ? attachedMazeGroup.rotation.y : 0;
    const localDirX = minimapForward.x * Math.cos(mazeRot) - minimapForward.z * Math.sin(mazeRot);
    const localDirZ = minimapForward.x * Math.sin(mazeRot) + minimapForward.z * Math.cos(mazeRot);
    const dirLen = 8;
    ctx.strokeStyle = '#8ec07c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ppx, ppz);
    ctx.lineTo(ppx + localDirX * dirLen, ppz + localDirZ * dirLen);
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
    });

    const cheatToggle = document.getElementById('optCheat');
    cheatToggle.checked = cheatMode;
    cheatToggle.addEventListener('change', () => {
        cheatMode = cheatToggle.checked;
        if (cheatMode && runStarted) cheatUsed = true;
        refreshSeedDisplay();
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
        const qs = params.toString();
        location.href = location.pathname + (qs ? '?' + qs : '');
    });

    controls.addEventListener('lock', () => {
        if (!runStarted) {
            runStarted = true;
            hardEntireRun = hardMode;
            if (cheatMode) cheatUsed = true;
            hardToggle.disabled = true;
        }
        resumePlayTimer();
        blocker.classList.add('hidden');
    });

    document.addEventListener('click', () => {
        if (controls.isLocked) onHubClick();
    });

    controls.addEventListener('unlock', () => {
        pausePlayTimer();
        clearMovementState();
        if (gameState !== 'WIN') {
            blocker.classList.remove('hidden');
        }
    });

    window.addEventListener('blur', clearMovementState);

    document.addEventListener('keydown', e => {
        switch (e.code) {
            case 'KeyW': case 'ArrowUp': moveState.forward = true; break;
            case 'KeyS': case 'ArrowDown': moveState.backward = true; break;
            case 'KeyA': case 'ArrowLeft': moveState.left = true; break;
            case 'KeyD': case 'ArrowRight': moveState.right = true; break;
            case 'KeyE':
                if (!e.repeat) interactWithHub(true);
                break;
        }
    });

    document.addEventListener('keyup', e => {
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
        const target = rotating.activated ? Math.PI / 2 : 0;
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
    activeShade = null;
    lastArrivalDir = null;
    shadeRng = new Rng(fnv1a(activeKey + '|shade'));

    enterHub(startRoom);
    document.documentElement.dataset.mazeReady = 'true';

    requestAnimationFrame(animate);
}

if (document.fonts && document.fonts.ready) document.fonts.ready.then(init);
else init();
