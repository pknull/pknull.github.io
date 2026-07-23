// ===== GRUVBOX PALETTE =====
const GRUVBOX = Object.freeze({
    bgHard: 0x32302f,
    bg: 0x282828,
    bg1: 0x3c3836,
    bg2: 0x504945,
    gray: 0x928374,
    fg3: 0xbdae93,
    fg2: 0xd5c4a1,
    fg: 0xebdbb2,
    red: 0xff6453,
    green: 0xb8bb26,
    yellow: 0xfabd2f,
    blue: 0x83a598,
    purple: 0xd3869b,
    aqua: 0x8ec07c,
    orange: 0xfe8019
});

// ===== TOPOLOGY =====
const TESSERACTS = {
    1:{name:'Fauna',emoji:'\u{1F98C}',color:'#fe8019'},
    2:{name:'Heart',emoji:'\u2764\uFE0F',color:'#ff6453'},
    3:{name:'Entryway',emoji:'\u{1F6AA}',color:'#d3869b'},
    4:{name:'Flora',emoji:'\u{1F33F}',color:'#b8bb26'},
    5:{name:'Space/Time',emoji:'\u{1F30C}',color:'#83a598'},
    6:{name:'Body',emoji:'\u{1F9EC}',color:'#fabd2f'},
    7:{name:'Mind',emoji:'\u{1F9E0}',color:'#8ec07c'},
    8:{name:'Control',emoji:'\u{1F39B}\uFE0F',color:'#bdae93'},
    9:{name:'Soul',emoji:'\u{1F47B}',color:'#b16286'},
    10:{name:'Energy',emoji:'\u26A1',color:'#ebdbb2'},
};

const roomNavigation = {
    "1.07":{"B":"1.08","E":"1.21","I":"1.33","O":"1.30","T":"1.17","W":"1.36"},
    "1.08":{"E":"1.21","I":"1.33","N":"1.07","O":"1.30","S":"1.29","W":"1.36"},
    "1.17":{"E":"1.21","I":"1.33","N":"1.07","O":"1.30","S":"1.29","W":"1.36"},
    "1.21":{"B":"1.08","I":"1.33","N":"1.07","O":"1.30","S":"1.29","T":"1.17"},
    "1.29":{"B":"1.08","E":"1.21","I":"1.33","O":"1.30","T":"1.17","W":"1.36"},
    "1.30":{"B":"1.08","E":"1.21","N":"1.07","S":"1.29","T":"1.17","W":"1.36"},
    "1.33":{"B":"1.08","E":"1.21","N":"1.07","S":"1.29","T":"1.17","W":"1.36"},
    "1.36":{"B":"1.08","I":"1.33","N":"1.07","O":"1.30","S":"1.29","T":"1.17"},
    "2.02":{"B":"2.23","E":"2.40","I":"2.33","O":"2.38","T":"2.10","W":"2.22"},
    "2.09":{"B":"2.23","E":"2.40","I":"2.33","O":"2.38","T":"2.10","W":"2.22"},
    "2.10":{"E":"2.40","I":"2.33","N":"2.02","O":"2.38","S":"2.09","W":"2.22"},
    "2.22":{"B":"2.23","I":"2.33","N":"2.02","O":"2.38","S":"2.09","T":"2.10"},
    "2.23":{"E":"2.40","I":"2.33","N":"2.02","O":"2.38","S":"2.09","W":"2.22"},
    "2.33":{"B":"2.23","E":"2.40","N":"2.02","S":"2.09","T":"2.10","W":"2.22"},
    "2.38":{"B":"2.23","E":"2.40","N":"2.02","S":"2.09","T":"2.10","W":"2.22"},
    "2.40":{"B":"2.23","I":"2.33","N":"2.02","O":"2.38","S":"2.09","T":"2.10"},
    "3.01":{"E":"3.26","N":"3.07","O":"3.16","S":"3.05","W":"3.03"},
    "3.02":{},
    "3.03":{"B":"3.01","N":"3.07","O":"3.16","S":"3.05","T":"3.34"},
    "3.05":{"B":"3.01","E":"3.26","O":"3.16","T":"3.34","W":"3.03"},
    "3.07":{"B":"3.01","E":"3.26","O":"3.16","T":"3.34","W":"3.03"},
    "3.16":{"B":"3.01","E":"3.26","N":"3.07","S":"3.05","T":"3.34","W":"3.03"},
    "3.26":{"B":"3.01","N":"3.07","O":"3.16","S":"3.05","T":"3.34"},
    "3.34":{"E":"3.26","N":"3.07","O":"3.16","S":"3.05","W":"3.03"},
    "4.04":{"B":"4.32","E":"4.31","N":"4.34","S":"4.35","T":"4.17","W":"4.06"},
    "4.06":{"B":"4.32","I":"4.10","N":"4.34","O":"4.04","S":"4.35","T":"4.17"},
    "4.10":{"B":"4.32","E":"4.31","N":"4.34","S":"4.35","T":"4.17","W":"4.06"},
    "4.17":{"E":"4.31","I":"4.10","N":"4.34","O":"4.04","S":"4.35","W":"4.06"},
    "4.31":{"B":"4.32","I":"4.10","N":"4.34","O":"4.04","S":"4.35","T":"4.17"},
    "4.32":{"E":"4.31","I":"4.10","N":"4.34","O":"4.04","S":"4.35","W":"4.06"},
    "4.34":{"B":"4.32","E":"4.31","I":"4.10","O":"4.04","T":"4.17","W":"4.06"},
    "4.35":{"B":"4.32","E":"4.31","I":"4.10","O":"4.04","T":"4.17","W":"4.06"},
    "5.03":{"B":"5.15","E":"5.11","I":"5.22","O":"5.37","T":"5.06","W":"5.36"},
    "5.06":{"E":"5.11","I":"5.22","N":"5.03","O":"5.37","S":"5.13","W":"5.36"},
    "5.11":{"B":"5.15","I":"5.22","N":"5.03","O":"5.37","S":"5.13","T":"5.06"},
    "5.13":{"B":"5.15","E":"5.11","I":"5.22","O":"5.37","T":"5.06","W":"5.36"},
    "5.15":{"E":"5.11","I":"5.22","N":"5.03","O":"5.37","S":"5.13","W":"5.36"},
    "5.22":{"B":"5.15","E":"5.11","N":"5.03","S":"5.13","T":"5.06","W":"5.36"},
    "5.36":{"B":"5.15","I":"5.22","N":"5.03","O":"5.37","S":"5.13","T":"5.06"},
    "5.37":{"B":"5.15","E":"5.11","N":"5.03","S":"5.13","T":"5.06","W":"5.36"},
    "6.05":{"B":"6.24","E":"6.27","I":"6.14","O":"6.38","T":"6.32","W":"6.11"},
    "6.11":{"B":"6.24","I":"6.14","N":"6.05","O":"6.38","S":"6.25","T":"6.32"},
    "6.14":{"B":"6.24","E":"6.27","N":"6.05","S":"6.25","T":"6.32","W":"6.11"},
    "6.24":{"E":"6.27","I":"6.14","N":"6.05","O":"6.38","S":"6.25","W":"6.11"},
    "6.25":{"B":"6.24","E":"6.27","I":"6.14","O":"6.38","T":"6.32","W":"6.11"},
    "6.27":{"B":"6.24","I":"6.14","N":"6.05","O":"6.38","S":"6.25","T":"6.32"},
    "6.32":{"E":"6.27","I":"6.14","N":"6.05","O":"6.38","S":"6.25","W":"6.11"},
    "6.38":{"B":"6.24","E":"6.27","N":"6.05","S":"6.25","T":"6.32","W":"6.11"},
    "7.04":{"E":"7.12","I":"7.14","N":"7.16","O":"7.30","S":"7.18","W":"7.37"},
    "7.12":{"B":"7.20","I":"7.14","N":"7.16","O":"7.30","S":"7.18","T":"7.04"},
    "7.14":{"B":"7.20","E":"7.12","N":"7.16","S":"7.18","T":"7.04","W":"7.37"},
    "7.16":{"B":"7.20","E":"7.12","I":"7.14","O":"7.30","T":"7.04","W":"7.37"},
    "7.18":{"B":"7.20","E":"7.12","I":"7.14","O":"7.30","T":"7.04","W":"7.37"},
    "7.20":{"E":"7.12","I":"7.14","N":"7.16","O":"7.30","S":"7.18","W":"7.37"},
    "7.30":{"B":"7.20","E":"7.12","N":"7.16","S":"7.18","T":"7.04","W":"7.37"},
    "7.37":{"B":"7.20","I":"7.14","N":"7.16","O":"7.30","S":"7.18","T":"7.04"},
    "8.09":{},"8.13":{},"8.18":{},"8.19":{},"8.25":{},"8.29":{},"8.35":{},"8.39":{},
    "9.01":{"B":"9.08","E":"9.28","I":"9.23","O":"9.20","T":"9.24","W":"9.15"},
    "9.08":{"E":"9.28","I":"9.23","N":"9.01","O":"9.20","S":"9.19","W":"9.15"},
    "9.15":{"B":"9.08","I":"9.23","N":"9.01","O":"9.20","S":"9.19","T":"9.24"},
    "9.19":{"B":"9.08","E":"9.28","I":"9.23","O":"9.20","T":"9.24","W":"9.15"},
    "9.20":{"B":"9.08","E":"9.28","N":"9.01","S":"9.19","T":"9.24","W":"9.15"},
    "9.23":{"B":"9.08","E":"9.28","N":"9.01","S":"9.19","T":"9.24","W":"9.15"},
    "9.24":{"E":"9.28","I":"9.23","N":"9.01","O":"9.20","S":"9.19","W":"9.15"},
    "9.28":{"B":"9.08","I":"9.23","N":"9.01","O":"9.20","S":"9.19","T":"9.24"},
    "10.12":{"B":"10.28","E":"10.21","N":"10.26","S":"10.39","T":"10.31","W":"10.27"},
    "10.21":{"B":"10.28","I":"10.40","N":"10.26","O":"10.12","S":"10.39","T":"10.31"},
    "10.26":{"B":"10.28","E":"10.21","I":"10.40","O":"10.12","T":"10.31","W":"10.27"},
    "10.27":{"B":"10.28","I":"10.40","N":"10.26","O":"10.12","S":"10.39","T":"10.31"},
    "10.28":{"E":"10.21","I":"10.40","N":"10.26","O":"10.12","S":"10.39","W":"10.27"},
    "10.31":{"E":"10.21","I":"10.40","N":"10.26","O":"10.12","S":"10.39","W":"10.27"},
    "10.39":{"B":"10.28","E":"10.21","I":"10.40","O":"10.12","T":"10.31","W":"10.27"},
    "10.40":{"B":"10.28","E":"10.21","N":"10.26","S":"10.39","T":"10.31","W":"10.27"}
};

const roomToggles = {
    "1.07":"3.07","1.08":"9.08","1.17":"4.17","1.21":"10.21",
    "1.29":"8.29","1.30":"7.30","1.33":"2.33","1.36":"5.36",
    "2.02":"3.02","2.09":"8.09","2.10":"4.10","2.22":"5.22",
    "2.23":"9.23","2.33":"1.33","2.38":"6.38","2.40":"10.40",
    "3.01":"9.01","3.02":"2.02","3.03":"5.03","3.05":"6.05",
    "3.07":"1.07","3.16":"7.16","3.26":"10.26","3.34":"4.34",
    "4.04":"7.04","4.06":"5.06","4.10":"2.10","4.17":"1.17",
    "4.31":"10.31","4.32":"6.32","4.34":"3.34","4.35":"8.35",
    "5.03":"3.03","5.06":"4.06","5.11":"6.11","5.13":"8.13",
    "5.15":"9.15","5.22":"2.22","5.36":"1.36","5.37":"7.37",
    "6.05":"3.05","6.11":"5.11","6.14":"7.14","6.24":"9.24",
    "6.25":"8.25","6.27":"10.27","6.32":"4.32","6.38":"2.38",
    "7.04":"4.04","7.12":"10.12","7.14":"6.14","7.16":"3.16",
    "7.18":"8.18","7.20":"9.20","7.30":"1.30","7.37":"5.37",
    "8.09":"2.09","8.13":"5.13","8.18":"7.18","8.19":"9.19",
    "8.25":"6.25","8.29":"1.29","8.35":"4.35","8.39":"10.39",
    "9.01":"3.01","9.08":"1.08","9.15":"5.15","9.19":"8.19",
    "9.20":"7.20","9.23":"2.23","9.24":"6.24","9.28":"10.28",
    "10.12":"7.12","10.21":"1.21","10.26":"3.26","10.27":"6.27",
    "10.28":"9.28","10.31":"4.31","10.39":"8.39","10.40":"2.40"
};

const CONTROL_ROOMS = ['8.09','8.13','8.18','8.19','8.25','8.29','8.35','8.39'];
const DIRECTIONS = ['N','I','E','B','S','O','W','T'];
const DIR_ANGLES = {N:0,I:Math.PI/4,E:Math.PI/2,B:3*Math.PI/4,S:Math.PI,O:5*Math.PI/4,W:3*Math.PI/2,T:7*Math.PI/4};
function getTess(id) { return parseInt(id.split('.')[0]); }

// Space folds may manifest anywhere, but remain more common within Space/Time.
const DEFAULT_MAZE_LAW = Object.freeze({id:'space-fold', label:'SPACE FOLD', chance:0.22});
// Roster order is the RNG draw-order contract. Future features append at the END, never the middle.
const MAZE_FEATURE_ROSTER = Object.freeze([
    'one-way', 'spatial-loop', 'layered-overlap', 'rotating-chamber'
]);
const MAZE_FEATURE_CHANCES = Object.freeze({
    'one-way':Object.freeze([0.28, 0.36, 0.45, 0.55]),
    'spatial-loop':Object.freeze([0.20, 0.26, 0.36, 0.48]),
    'layered-overlap':Object.freeze([0.15, 0.25, 0.35, 0.50]),
    'rotating-chamber':Object.freeze([0.16, 0.22, 0.30, 0.40])
});
const MAZE_FEATURE_REQUIRED_CHANCE = Object.freeze({
    'one-way':0.6,
    'spatial-loop':0.6,
    'layered-overlap':0.6,
    'rotating-chamber':0
});
const TESSERACT_LAWS = Object.freeze({
    5: Object.freeze({id:'space-fold', label:'SPACE FOLD', chance:0.6})
});

// The Shade — the Loom's failsafe construct — stalks some maze segments.
// Fauna is hunting ground; Soul is haunted. Keyed by destination tesseract.
// It matches player speed exactly: flight is a stalemate, hesitation is not.
const HUNTER_BASE_CHANCE = 0.15;
const HUNTER_TESSERACT_CHANCE = Object.freeze({1: 0.45, 9: 0.3});
const HUNTER_SPEED_FACTOR = 1.0;
const HUNTER_WAKE_DELAY_MS = 1500;
const SHADE_LAG_MS = 5000;

// Mines scatter the player to a random room of the Engine. Never the
// Entryway (3.02) or its antechamber (2.02) — a mine must never be able
// to hand out the win, only chaos.
function scatterPool(srcRoom, dstRoom) {
    return Object.keys(roomNavigation).filter(r =>
        r !== srcRoom && r !== dstRoom && r !== '3.02' && r !== '2.02');
}
function getTesseractLaw(roomId) {
    return TESSERACT_LAWS[getTess(roomId)] || DEFAULT_MAZE_LAW;
}

// ===== CONSTANTS =====
// Delta is the default playtest lattice. Sigma uses flat-top hexagons.
const MAZE_TESSELLATION = 'delta';
const DELTA_EDGE_LEN = 3.6;
const SIGMA_EDGE_LEN = 2.4;
const EDGE_LEN = MAZE_TESSELLATION === 'delta' ? DELTA_EDGE_LEN : SIGMA_EDGE_LEN;
const DOOR_AUTO_OPEN_RANGE = 2.2;
const DOOR_MIN_DIST_FACTOR = 1.5;
const DOOR_MIN_DIST_CELL_FRACTION = 0.30;
const DELTA_TIER_RANGES = Object.freeze([[8,9],[10,12],[13,15],[16,18]]);
const SIGMA_TIER_RANGES = Object.freeze([[10,12],[13,16],[17,20],[21,24]]);
const OVERLAP_REGION_SIZE = Object.freeze({
    delta:[[10,12],[12,14],[14,18],[16,20]],
    sigma:[[6,7],[7,8],[8,10],[10,12]]
});
const OVERLAP_ATTEMPTS = 12;
const ROTATION_MIN_GAIN = 6;
const WALL_H = 3;
const WALL_T = 0.15;
const EYE_H = 1.6;
const P_RAD = 0.35;
const MOVE_SPD = 5;
const HUB_APO = 5;
const HUB_RAD = HUB_APO / Math.cos(Math.PI / 8);
const HUB_H = 5;
const DOOR_W = 2;
const DOOR_H = 3;
const OVERLAP_PORTAL_W = DOOR_W;
const OVERLAP_SWAP_RADIUS_FACTOR = 1.25;
const OVERLAP_FORCE_RADIUS_FACTOR = 0.9;
const OVERLAP_HYSTERESIS_MARGIN = 0.5;
const OVERLAP_VIEW_AWAY_DOT = 0.1;
const OVERLAP_MINIMAP_ALPHA = 0.5;
const TOGGLE_RAD = 3;

export {
    GRUVBOX,
    TESSERACTS,
    roomNavigation,
    roomToggles,
    CONTROL_ROOMS,
    DIRECTIONS,
    DIR_ANGLES,
    getTess,
    DEFAULT_MAZE_LAW,
    MAZE_FEATURE_ROSTER,
    MAZE_FEATURE_CHANCES,
    MAZE_FEATURE_REQUIRED_CHANCE,
    HUNTER_BASE_CHANCE,
    HUNTER_TESSERACT_CHANCE,
    HUNTER_SPEED_FACTOR,
    HUNTER_WAKE_DELAY_MS,
    SHADE_LAG_MS,
    scatterPool,
    getTesseractLaw,
    MAZE_TESSELLATION,
    DELTA_EDGE_LEN,
    SIGMA_EDGE_LEN,
    EDGE_LEN,
    DOOR_AUTO_OPEN_RANGE,
    DOOR_MIN_DIST_FACTOR,
    DOOR_MIN_DIST_CELL_FRACTION,
    DELTA_TIER_RANGES,
    SIGMA_TIER_RANGES,
    OVERLAP_REGION_SIZE,
    OVERLAP_ATTEMPTS,
    ROTATION_MIN_GAIN,
    WALL_H,
    WALL_T,
    EYE_H,
    P_RAD,
    MOVE_SPD,
    HUB_APO,
    HUB_RAD,
    HUB_H,
    DOOR_W,
    DOOR_H,
    OVERLAP_PORTAL_W,
    OVERLAP_SWAP_RADIUS_FACTOR,
    OVERLAP_FORCE_RADIUS_FACTOR,
    OVERLAP_HYSTERESIS_MARGIN,
    OVERLAP_VIEW_AWAY_DOT,
    OVERLAP_MINIMAP_ALPHA,
    TOGGLE_RAD
};
