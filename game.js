// ============================================================
// Zac's Football Game - a simplified arcade football sim
// ============================================================

// ---------- Pitch geometry (real proportions, in metres) ----------
const PITCH_LEN = 105;
const PITCH_WID = 68;
const SCALE = 10;           // pixels per metre
const MARGIN = 40;          // canvas margin around the pitch
const GOAL_WIDTH = 7.32;
const BOX_DEPTH = 16.5;
const BOX_WIDTH = 40.32;
const SIX_DEPTH = 5.5;
const SIX_WIDTH = 18.32;
const CENTER_CIRCLE_R = 9.15;
const PEN_SPOT_DIST = 11;
const CENTER_POS = { x: PITCH_LEN / 2, y: PITCH_WID / 2 };

function toCanvasX(xm) { return MARGIN + xm * SCALE; }
function toCanvasY(ym) { return MARGIN + ym * SCALE; }

// ---------- Teams ----------
const TEAMS = [
  { name: 'Crimson FC', shirt: '#e63946', shorts: '#1a1a1a' },
  { name: 'Azure United', shirt: '#1d4ed8', shorts: '#ffffff' },
  { name: 'Emerald Town', shirt: '#16a34a', shorts: '#0d3d1c' },
  { name: 'Golden Rovers', shirt: '#eab308', shorts: '#1a1a1a' },
  { name: 'Violet City', shirt: '#7c3aed', shorts: '#ffffff' },
  { name: 'Monochrome Athletic', shirt: '#1a1a1a', shorts: '#ffffff' },
];
const GK_COLORS = ['#a3e635', '#ec4899']; // home GK, away GK

// ---------- Formation (fractions, attacking toward x=1) ----------
const FORMATION = [
  { group: 'GK', x: 0.04, y: 0.50 },
  { group: 'DEF', x: 0.16, y: 0.15 },
  { group: 'DEF', x: 0.16, y: 0.38 },
  { group: 'DEF', x: 0.16, y: 0.62 },
  { group: 'DEF', x: 0.16, y: 0.85 },
  { group: 'MID', x: 0.42, y: 0.25 },
  { group: 'MID', x: 0.42, y: 0.50 },
  { group: 'MID', x: 0.42, y: 0.75 },
  { group: 'FWD', x: 0.68, y: 0.20 },
  { group: 'FWD', x: 0.68, y: 0.50 },
  { group: 'FWD', x: 0.68, y: 0.80 },
];

// ---------- Skill presets (apply to every AI-controlled player) ----------
// speed * pressBoost is kept below HUMAN_SPEED on every difficulty, so
// opponents never actually outrun you, even when they're pressing you.
const SKILLS = {
  easy:   { speed: 4.4, pressBoost: 1.08, tackleChance: 0.40, noise: 3.0, reassessMin: 0.7, reassessMax: 1.4, shootRange: 16 },
  medium: { speed: 5.0, pressBoost: 1.10, tackleChance: 0.52, noise: 1.6, reassessMin: 0.5, reassessMax: 1.0, shootRange: 20 },
  hard:   { speed: 5.6, pressBoost: 1.10, tackleChance: 0.62, noise: 0.6, reassessMin: 0.3, reassessMax: 0.7, shootRange: 26 },
};
const HUMAN_SPEED = 6.2;
const TACKLE_RADIUS = 1.6;
const TACKLE_RETRY_SEC = 0.9;
const PICKUP_RADIUS = 1.1;
const HUMAN_TACKLE_CHANCE = 0.65;
const PASS_MIN_SPEED = 9, PASS_MAX_SPEED = 23;
const SHOT_MIN_SPEED = 13, SHOT_MAX_SPEED = 29;
const GK_SAVE_CHANCE = 0.35;
const GK_SPEED_MULT = 0.55; // goalkeepers move slower than outfield players
const GOAL_DEPTH = 2;       // how far into the net (metres) players/ball can enter, matches the drawn goal frame

// ---------- Keybinds ----------
const KEYS = { up: 'w', down: 's', left: 'a', right: 'd', pass: 'j', shoot: 'k', tackle: 'l', switchPlayer: 'q', pause: 'p' };

// ---------- Small helpers ----------
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
function len(v) { return Math.hypot(v.x, v.y); }
function norm(v) { const l = len(v); return l < 1e-6 ? { x: 0, y: 0 } : { x: v.x / l, y: v.y / l }; }
function lerp(a, b, t) { return a + (b - a) * t; }

// Keeps a player inside the pitch, but lets them step into the goal mouth
// (within the goal's width) so a carried ball can actually cross the line.
function clampToPitch(pos) {
  const withinGoalY = Math.abs(pos.y - PITCH_WID / 2) <= GOAL_WIDTH / 2;
  const minX = withinGoalY ? -GOAL_DEPTH : 0.2;
  const maxX = withinGoalY ? PITCH_LEN + GOAL_DEPTH : PITCH_LEN - 0.2;
  pos.x = clamp(pos.x, minX, maxX);
  pos.y = clamp(pos.y, 0.2, PITCH_WID - 0.2);
}

// ============================================================
// Game state
// ============================================================
const STATE = { MENU: 'MENU', SETUP: 'SETUP', PLAYING: 'PLAYING', PAUSED: 'PAUSED', HALFTIME: 'HALFTIME', FULLTIME: 'FULLTIME' };

const G = {
  state: STATE.MENU,
  teams: [null, null],       // teams[0] is always the human team
  ball: { pos: { x: PITCH_LEN / 2, y: PITCH_WID / 2 }, vel: { x: 0, y: 0 }, owner: null, lastTouchTeam: 0, kickImmuneFrom: null, kickImmuneUntil: 0 },
  controlled: null,
  skill: SKILLS.medium,
  half: 1,
  elapsedSec: 0,
  halfLengthSec: 120,
  matchTotalSec: 240,
  displayedSec: -1,
  halftimeInterval: null,
  fulltimeTimeout: null,
  keysDown: {},
  charge: { pass: false, shoot: false, passStart: 0, shootStart: 0 },
  joystick: { x: 0, y: 0 }, // analog vector from the on-screen joystick, each axis in [-1, 1]
  kickoffPending: false,
  lastTs: 0,
};

function buildTeam(def, attackDir, gkColor) {
  const players = FORMATION.map((slot, i) => ({
    idx: i,
    group: slot.group,
    isGK: slot.group === 'GK',
    slot,
    home: { x: 0, y: 0 },
    pos: { x: 0, y: 0 },
    vel: { x: 0, y: 0 },
    facing: { x: attackDir, y: 0 },
    pressing: false,
    decisionTimer: rand(0.4, 1.0),
    lastTackleTry: -10,
    noiseSeed: Math.random() * 1000,
  }));
  return {
    def, attackDir, score: 0,
    shirt: def.shirt, shorts: def.shorts, gkColor,
    players,
  };
}

function computeHomePositions(team) {
  for (const p of team.players) {
    const fx = team.attackDir === 1 ? p.slot.x : 1 - p.slot.x;
    p.home.x = fx * PITCH_LEN;
    p.home.y = p.slot.y * PITCH_WID;
  }
}

// Snaps players back to their formation spot, but keeps everyone in their own
// half - the formation shape itself (home.x) can push forwards past halfway
// for open play, which isn't valid at a kickoff/restart.
function placeAtHome(team) {
  const halfway = PITCH_LEN / 2;
  for (const p of team.players) {
    p.pos.x = team.attackDir === 1 ? Math.min(p.home.x, halfway - 0.5) : Math.max(p.home.x, halfway + 0.5);
    p.pos.y = p.home.y;
    p.vel = { x: 0, y: 0 };
  }
}

function outfield(team) { return team.players.filter(p => !p.isGK); }

// ---------- Kickoff / restarts ----------
function doKickoff(kickingIdx) {
  for (const team of G.teams) { computeHomePositions(team); placeAtHome(team); }
  G.ball.pos = { x: PITCH_LEN / 2, y: PITCH_WID / 2 };
  G.ball.vel = { x: 0, y: 0 };
  const kicker = G.teams[kickingIdx].players.find(p => p.group === 'MID' && Math.abs(p.slot.y - 0.5) < 0.01) || outfield(G.teams[kickingIdx])[0];
  kicker.pos.x = PITCH_LEN / 2;
  kicker.pos.y = PITCH_WID / 2;
  kicker.decisionTimer = rand(0.35, 0.75); // how long an AI kicker waits before passing
  G.ball.owner = kicker;
  G.ball.lastTouchTeam = kickingIdx;
  G.kickoffPending = true;
  autoAssignControl();
}

// While a restart is pending, everyone except the kicker must stay in their
// own half and out of the centre circle - same as a real kickoff.
function applyKickoffRestraint(p, team) {
  const halfway = PITCH_LEN / 2;
  if (team.attackDir === 1) p.pos.x = Math.min(p.pos.x, halfway - 0.3);
  else p.pos.x = Math.max(p.pos.x, halfway + 0.3);
  const toP = sub(p.pos, CENTER_POS);
  const d = len(toP);
  const minD = CENTER_CIRCLE_R + 0.3;
  if (d < minD) {
    const dir = d < 1e-6 ? { x: team.attackDir === 1 ? -1 : 1, y: 0 } : { x: toP.x / d, y: toP.y / d };
    p.pos.x = CENTER_POS.x + dir.x * minD;
    p.pos.y = CENTER_POS.y + dir.y * minD;
    if (team.attackDir === 1) p.pos.x = Math.min(p.pos.x, halfway - 0.3);
    else p.pos.x = Math.max(p.pos.x, halfway + 0.3);
  }
}

// AI kicker: wait a beat then pass - never shoots or dribbles from the kickoff spot.
function handleKickoffKicker(p, team, dt) {
  p.decisionTimer -= dt;
  if (p.decisionTimer > 0) return;
  releasePass(p, team, rand(0.5, 0.85));
}

function autoAssignControl() {
  if (G.ball.owner && G.ball.owner.__team === 0) {
    G.controlled = G.ball.owner;
  } else if (!G.controlled || G.controlled.__team !== 0) {
    const mine = outfield(G.teams[0]);
    mine.sort((a, b) => dist(a.pos, G.ball.pos) - dist(b.pos, G.ball.pos));
    G.controlled = mine[0];
  }
}

// tag each player with which team index they belong to, for quick lookup
function tagTeams() {
  G.teams[0].players.forEach(p => p.__team = 0);
  G.teams[1].players.forEach(p => p.__team = 1);
}

// ============================================================
// Match setup
// ============================================================
function initMatch(yourIdx, oppIdx, halfLenMin, skillKey) {
  G.teams[0] = buildTeam(TEAMS[yourIdx], 1, GK_COLORS[0]);
  G.teams[1] = buildTeam(TEAMS[oppIdx], -1, GK_COLORS[1]);
  tagTeams();
  G.skill = SKILLS[skillKey];
  G.half = 1;
  G.elapsedSec = 0;
  G.displayedSec = -1;
  G.keysDown = {};
  G.charge = { pass: false, shoot: false, passStart: 0, shootStart: 0 };
  G.halfLengthSec = halfLenMin * 60;
  G.matchTotalSec = G.halfLengthSec * 2;
  document.getElementById('score-home-name').textContent = TEAMS[yourIdx].name;
  document.getElementById('score-away-name').textContent = TEAMS[oppIdx].name;
  document.getElementById('score-home').textContent = '0';
  document.getElementById('score-away').textContent = '0';
  document.getElementById('half-label').textContent = '1st Half';
  doKickoff(0);
  G.state = STATE.PLAYING;
}

// ============================================================
// AI
// ============================================================
function goalkeeperTarget(p, team) {
  const lineX = team.attackDir === 1 ? 1.5 : PITCH_LEN - 1.5;
  const halfGoal = GOAL_WIDTH / 2 - 0.4;
  const gy = clamp(G.ball.pos.y, PITCH_WID / 2 - halfGoal, PITCH_WID / 2 + halfGoal);
  return { x: lineX, y: gy };
}

function attackTarget(p, team) {
  const shift = p.group === 'FWD' ? 8 : p.group === 'MID' ? 5 : 2;
  const tx = p.home.x + shift * team.attackDir;
  const ty = lerp(p.home.y, G.ball.pos.y, 0.35);
  return { x: tx, y: ty };
}

function defendTarget(p, team) {
  const drop = p.group === 'FWD' ? 6 : p.group === 'MID' ? 3 : 1;
  const tx = p.home.x - drop * team.attackDir;
  const ty = lerp(p.home.y, G.ball.pos.y, 0.25);
  return { x: tx, y: ty };
}

function updatePressing(dt) {
  const possTeam = G.ball.owner ? G.ball.owner.__team : null;
  for (let t = 0; t < 2; t++) {
    const team = G.teams[t];
    for (const p of outfield(team)) p.pressing = false;
    if (possTeam === t) continue; // team in possession doesn't press
    const candidates = outfield(team).slice().sort((a, b) => dist(a.pos, G.ball.pos) - dist(b.pos, G.ball.pos));
    for (let i = 0; i < Math.min(2, candidates.length); i++) candidates[i].pressing = true;
  }
}

function aiMovePlayer(p, team, dt) {
  if (p === G.controlled) return; // human-controlled, skip AI movement
  const possTeam = G.ball.owner ? G.ball.owner.__team : null;
  let target;
  if (p.isGK) {
    target = goalkeeperTarget(p, team);
  } else if (possTeam === p.__team) {
    target = attackTarget(p, team);
  } else if (p.pressing) {
    target = G.ball.pos;
  } else {
    target = defendTarget(p, team);
  }
  // small jitter so players don't all move identically
  const jitter = Math.sin(performance.now() / 500 + p.noiseSeed) * G.skill.noise * 0.15;
  const tgt = { x: target.x, y: clamp(target.y + jitter, 0.5, PITCH_WID - 0.5) };
  const toTarget = sub(tgt, p.pos);
  const d = len(toTarget);
  let speed = G.skill.speed;
  if (p.isGK) speed *= GK_SPEED_MULT;
  if (p.pressing) speed *= G.skill.pressBoost;
  if (d > 0.15) {
    const dir = norm(toTarget);
    p.vel = { x: dir.x * speed, y: dir.y * speed };
    p.facing = dir;
  } else {
    p.vel = { x: 0, y: 0 };
  }
  p.pos.x += p.vel.x * dt;
  p.pos.y += p.vel.y * dt;
  clampToPitch(p.pos);
}

function aiTackleAttempt(p, dt) {
  if (p === G.controlled) return;
  if (!p.pressing || p.isGK) return;
  if (!G.ball.owner || G.ball.owner.__team === p.__team) return;
  if (dist(p.pos, G.ball.pos) > TACKLE_RADIUS) return;
  const now = performance.now() / 1000;
  if (now - p.lastTackleTry < TACKLE_RETRY_SEC) return;
  p.lastTackleTry = now;
  if (Math.random() < G.skill.tackleChance) {
    loseBallFrom(G.ball.owner, p.__team);
  }
}

function aiPossessionDecision(p, team, dt) {
  if (p === G.controlled) return;
  if (G.ball.owner !== p) return;
  p.decisionTimer -= dt;
  if (p.decisionTimer > 0) return;
  p.decisionTimer = rand(G.skill.reassessMin, G.skill.reassessMax);
  const goalX = team.attackDir === 1 ? PITCH_LEN : 0;
  const goalY = PITCH_WID / 2;
  const distToGoal = dist(p.pos, { x: goalX, y: goalY });
  const opponents = outfield(G.teams[1 - p.__team]);
  opponents.sort((a, b) => dist(a.pos, p.pos) - dist(b.pos, p.pos));
  const underPressure = opponents.length && dist(opponents[0].pos, p.pos) < 4;

  if (distToGoal < G.skill.shootRange && Math.random() < 0.8) {
    const power = clamp(0.4 + (G.skill.shootRange - distToGoal) / G.skill.shootRange, 0.4, 1);
    releaseShot(p, team, power);
  } else if (underPressure || Math.random() < 0.35) {
    const power = rand(0.4, 0.9);
    releasePass(p, team, power);
  }
  // otherwise: keep dribbling forward (handled by aiMovePlayer's attackTarget)
}

// ============================================================
// Ball physics
// ============================================================
function loseBallFrom(prevOwner, newTouchTeam) {
  const knockDir = norm({ x: rand(-1, 1), y: rand(-1, 1) });
  G.ball.owner = null;
  G.ball.vel = { x: knockDir.x * 2.5, y: knockDir.y * 2.5 };
  G.ball.lastTouchTeam = newTouchTeam;
}

function releasePass(player, team, power) {
  if (G.kickoffPending && G.ball.owner === player) G.kickoffPending = false;
  const teammates = team.players.filter(p => p !== player);
  const facing = len(player.facing) > 0.01 ? norm(player.facing) : { x: team.attackDir, y: 0 };
  let cone = teammates.filter(t => {
    const d = norm(sub(t.pos, player.pos));
    return (d.x * facing.x + d.y * facing.y) > 0.26;
  });
  if (cone.length === 0) cone = teammates;
  cone.sort((a, b) => dist(a.pos, player.pos) - dist(b.pos, player.pos));
  const target = cone[0];
  const dir = norm(sub(target.pos, player.pos));
  const speed = PASS_MIN_SPEED + power * (PASS_MAX_SPEED - PASS_MIN_SPEED);
  G.ball.owner = null;
  G.ball.pos = { x: player.pos.x + facing.x * 0.4, y: player.pos.y + facing.y * 0.4 };
  G.ball.vel = { x: dir.x * speed, y: dir.y * speed };
  G.ball.lastTouchTeam = player.__team;
  G.ball.kickImmuneFrom = player;
  G.ball.kickImmuneUntil = performance.now() / 1000 + 0.5;
}

function releaseShot(player, team, power) {
  const goalX = team.attackDir === 1 ? PITCH_LEN : 0;
  const goalY = PITCH_WID / 2;
  const edgeX = team.attackDir === 1 ? PITCH_LEN - BOX_DEPTH : BOX_DEPTH;
  const nearest = { x: edgeX, y: clamp(player.pos.y, goalY - BOX_WIDTH / 2, goalY + BOX_WIDTH / 2) };
  const insideBox = team.attackDir === 1
    ? (player.pos.x >= PITCH_LEN - BOX_DEPTH && Math.abs(player.pos.y - goalY) <= BOX_WIDTH / 2)
    : (player.pos.x <= BOX_DEPTH && Math.abs(player.pos.y - goalY) <= BOX_WIDTH / 2);
  const distBeyond = insideBox ? 0 : dist(player.pos, nearest);
  const tenths = distBeyond / (PITCH_LEN / 10);
  const onTargetChance = insideBox ? 1 : clamp(1 - 0.3 * tenths, 0, 1);
  const onTarget = Math.random() < onTargetChance;

  let aimPoint;
  if (onTarget) {
    aimPoint = { x: goalX, y: goalY + rand(-1, 1) * (GOAL_WIDTH / 2 - 0.6) };
  } else {
    const side = Math.random() < 0.5 ? -1 : 1;
    aimPoint = { x: goalX, y: clamp(goalY + side * (GOAL_WIDTH / 2 + rand(1, 6)), 0, PITCH_WID) };
  }
  const dir = norm(sub(aimPoint, player.pos));
  const speed = SHOT_MIN_SPEED + power * (SHOT_MAX_SPEED - SHOT_MIN_SPEED);
  G.ball.owner = null;
  G.ball.pos = { x: player.pos.x + dir.x * 0.4, y: player.pos.y + dir.y * 0.4 };
  G.ball.vel = { x: dir.x * speed, y: dir.y * speed };
  G.ball.lastTouchTeam = player.__team;
  G.ball.kickImmuneFrom = player;
  G.ball.kickImmuneUntil = performance.now() / 1000 + 0.5;
}

function updateBall(dt) {
  const b = G.ball;
  if (b.owner) {
    const facing = len(b.owner.facing) > 0.01 ? norm(b.owner.facing) : { x: 1, y: 0 };
    b.pos.x = b.owner.pos.x + facing.x * 0.35;
    b.pos.y = b.owner.pos.y + facing.y * 0.35;
    b.vel = { x: 0, y: 0 };
    checkCarriedGoal();
    return;
  }
  // free-flight with friction
  b.pos.x += b.vel.x * dt;
  b.pos.y += b.vel.y * dt;
  const speed = len(b.vel);
  if (speed > 0.01) {
    const decel = 3.2 * dt;
    const newSpeed = Math.max(0, speed - decel);
    const dir = norm(b.vel);
    b.vel = { x: dir.x * newSpeed, y: dir.y * newSpeed };
  } else {
    b.vel = { x: 0, y: 0 };
  }

  checkGoalMouth();
  if (G.state !== STATE.PLAYING) return; // a goal/save may have ended the phase
  checkPickup();
  checkOutOfBounds();
}

function checkPickup() {
  const b = G.ball;
  if (b.owner) return;
  const now = performance.now() / 1000;
  let best = null, bestD = PICKUP_RADIUS;
  for (const team of G.teams) {
    for (const p of team.players) {
      if (p === b.kickImmuneFrom && now < b.kickImmuneUntil) continue;
      const d = dist(p.pos, b.pos);
      if (d < bestD) { bestD = d; best = p; }
    }
  }
  if (best) {
    b.owner = best;
    b.lastTouchTeam = best.__team;
    autoAssignControl();
  }
}

function checkGoalMouth() {
  const b = G.ball;
  const halfGoal = GOAL_WIDTH / 2;
  if (b.pos.x >= PITCH_LEN && Math.abs(b.pos.y - PITCH_WID / 2) <= halfGoal) {
    resolveGoalAttempt(1); // ball heading into the goal at x=PITCH_LEN, defended by whoever attacks -1 there
  } else if (b.pos.x <= 0 && Math.abs(b.pos.y - PITCH_WID / 2) <= halfGoal) {
    resolveGoalAttempt(-1);
  }
}

// A player who has dribbled the ball across the line has already beaten the
// keeper physically, so this counts straight away - no save roll needed.
function checkCarriedGoal() {
  const b = G.ball;
  if (Math.abs(b.pos.y - PITCH_WID / 2) > GOAL_WIDTH / 2) return;
  let endDir = 0;
  if (b.pos.x >= PITCH_LEN) endDir = 1;
  else if (b.pos.x <= 0) endDir = -1;
  if (!endDir) return;
  const attacker = attackingTeamAtGoalEnd(endDir);
  scoreGoal(attacker === G.teams[0] ? 0 : 1);
}

function defendingTeamAtGoalEnd(endDir) {
  return G.teams.find(t => t.attackDir === -endDir);
}
function attackingTeamAtGoalEnd(endDir) {
  return G.teams.find(t => t.attackDir === endDir);
}

function resolveGoalAttempt(endDir) {
  const defender = defendingTeamAtGoalEnd(endDir);
  const attacker = attackingTeamAtGoalEnd(endDir);
  const saved = Math.random() < GK_SAVE_CHANCE;
  if (saved) {
    const gk = defender.players.find(p => p.isGK);
    G.ball.owner = gk;
    G.ball.vel = { x: 0, y: 0 };
    G.ball.pos = { x: gk.pos.x, y: gk.pos.y };
    G.ball.lastTouchTeam = gk.__team;
    autoAssignControl();
  } else {
    scoreGoal(attacker === G.teams[0] ? 0 : 1);
  }
}

function scoreGoal(scoringIdx) {
  G.teams[scoringIdx].score++;
  document.getElementById('score-home').textContent = G.teams[0].score;
  document.getElementById('score-away').textContent = G.teams[1].score;
  doKickoff(1 - scoringIdx);
}

function checkOutOfBounds() {
  const b = G.ball;
  if (b.owner) return;
  if (b.pos.y < 0 || b.pos.y > PITCH_WID) {
    const restartTeam = 1 - b.lastTouchTeam;
    b.pos.y = clamp(b.pos.y, 0, PITCH_WID);
    b.vel = { x: 0, y: 0 };
    giveBallToNearest(restartTeam);
    return;
  }
  if (b.pos.x < 0 || b.pos.x > PITCH_LEN) {
    const endDir = b.pos.x > PITCH_LEN ? 1 : -1;
    const defender = defendingTeamAtGoalEnd(endDir);
    const attacker = attackingTeamAtGoalEnd(endDir);
    b.pos.x = clamp(b.pos.x, 0, PITCH_LEN);
    b.vel = { x: 0, y: 0 };
    if (b.lastTouchTeam === (defender === G.teams[0] ? 0 : 1)) {
      // corner to attacker
      b.pos.y = clamp(b.pos.y, 0, PITCH_WID);
      giveBallToNearest(attacker === G.teams[0] ? 0 : 1);
    } else {
      // goal kick to defender
      b.pos.x = endDir === 1 ? PITCH_LEN - SIX_DEPTH : SIX_DEPTH;
      b.pos.y = PITCH_WID / 2;
      const gk = defender.players.find(p => p.isGK);
      b.owner = gk;
      b.lastTouchTeam = gk.__team;
      autoAssignControl();
    }
  }
}

function giveBallToNearest(teamIdx) {
  const team = G.teams[teamIdx];
  const candidates = team.players.slice().sort((a, b) => dist(a.pos, G.ball.pos) - dist(b.pos, G.ball.pos));
  const winner = candidates[0];
  G.ball.owner = winner;
  G.ball.lastTouchTeam = teamIdx;
  autoAssignControl();
}

// ============================================================
// Human input
// ============================================================
function handleHumanMovement(dt) {
  if (!G.controlled) return;
  if (G.kickoffPending && G.ball.owner === G.controlled) return; // locked at the kickoff spot until you pass
  let mx = 0, my = 0;
  if (G.keysDown[KEYS.up]) my -= 1;
  if (G.keysDown[KEYS.down]) my += 1;
  if (G.keysDown[KEYS.left]) mx -= 1;
  if (G.keysDown[KEYS.right]) mx += 1;
  mx += G.joystick.x;
  my += G.joystick.y;
  const p = G.controlled;
  // the joystick is analog - a light push moves slower, a full push at the edge is full speed
  const pushAmount = clamp(Math.hypot(mx, my), 0, 1);
  if (pushAmount > 0.05) {
    const dir = norm({ x: mx, y: my });
    p.vel = { x: dir.x * HUMAN_SPEED * pushAmount, y: dir.y * HUMAN_SPEED * pushAmount };
    p.facing = dir;
  } else {
    p.vel = { x: 0, y: 0 };
  }
  p.pos.x += p.vel.x * dt;
  p.pos.y += p.vel.y * dt;
  clampToPitch(p.pos);
}

function tryHumanTackle() {
  if (G.state !== STATE.PLAYING) return;
  const b = G.ball;
  if (!b.owner || b.owner.__team === 0) return;
  if (dist(G.controlled.pos, b.pos) > TACKLE_RADIUS) return;
  if (Math.random() < HUMAN_TACKLE_CHANCE) {
    const tackler = G.controlled;
    b.owner = tackler;
    b.vel = { x: 0, y: 0 };
    b.lastTouchTeam = 0;
    b.kickImmuneFrom = null;
    autoAssignControl();
  }
}

function trySwitchPlayer() {
  if (G.state !== STATE.PLAYING) return;
  const b = G.ball;
  if (b.owner && b.owner.__team === 0) return; // only allowed when not in possession
  const mine = outfield(G.teams[0]).slice().sort((a, b2) => dist(a.pos, b.pos) - dist(b2.pos, b.pos));
  if (mine.length) G.controlled = mine[0];
}

function onChargeRelease(kind) {
  const startKey = kind === 'pass' ? 'passStart' : 'shootStart';
  const held = clamp((performance.now() - G.charge[startKey]) / 1000, 0, 2);
  const power = held / 2;
  G.charge[kind] = false;
  if (G.state !== STATE.PLAYING) return;
  const p = G.controlled;
  if (!p || G.ball.owner !== p) return;
  if (kind === 'shoot' && G.kickoffPending) return; // kickoff must be passed, not shot
  if (kind === 'pass') releasePass(p, G.teams[0], power);
  else releaseShot(p, G.teams[0], power);
}

// ============================================================
// Timer / halftime / fulltime
// ============================================================
function enterHalftime() {
  G.state = STATE.HALFTIME;
  document.getElementById('half-label').textContent = 'Half Time';
  document.getElementById('halftime-overlay').classList.remove('hidden');
  let remaining = 30;
  document.getElementById('halftime-timer').textContent = remaining;
  G.halftimeInterval = setInterval(() => {
    remaining--;
    document.getElementById('halftime-timer').textContent = Math.max(remaining, 0);
    if (remaining <= 0) endHalftime();
  }, 1000);
}

function endHalftime() {
  if (G.halftimeInterval) { clearInterval(G.halftimeInterval); G.halftimeInterval = null; }
  document.getElementById('halftime-overlay').classList.add('hidden');
  G.half = 2;
  G.teams[0].attackDir *= -1;
  G.teams[1].attackDir *= -1;
  document.getElementById('half-label').textContent = '2nd Half';
  doKickoff(1); // team that didn't kick off half 1 kicks off half 2
  G.state = STATE.PLAYING;
}

function enterFulltime() {
  G.state = STATE.FULLTIME;
  document.getElementById('half-label').textContent = 'Full Time';
  document.getElementById('fulltime-score').textContent =
    `${document.getElementById('score-home-name').textContent} ${G.teams[0].score} - ${G.teams[1].score} ${document.getElementById('score-away-name').textContent}`;
  document.getElementById('fulltime-overlay').classList.remove('hidden');
  G.fulltimeTimeout = setTimeout(() => goToMainMenu(), 8000);
}

function updateClock(dt) {
  G.elapsedSec += dt;
  const shown = Math.floor(G.elapsedSec);
  if (shown !== G.displayedSec) {
    G.displayedSec = shown;
    const mm = String(Math.floor(shown / 60)).padStart(2, '0');
    const ss = String(shown % 60).padStart(2, '0');
    document.getElementById('match-clock').textContent = `${mm}:${ss}`;
  }
  if (G.half === 1 && G.elapsedSec >= G.halfLengthSec) {
    enterHalftime();
  } else if (G.half === 2 && G.elapsedSec >= G.matchTotalSec) {
    enterFulltime();
  }
}

// ============================================================
// Main update / render
// ============================================================
function update(dt) {
  handleHumanMovement(dt);
  updatePressing(dt);
  for (const team of G.teams) {
    for (const p of team.players) {
      const isKickoffKicker = G.kickoffPending && G.ball.owner === p;
      if (isKickoffKicker) {
        if (p !== G.controlled) handleKickoffKicker(p, team, dt);
        p.vel = { x: 0, y: 0 }; // stands still on the kickoff spot until the pass is away
      } else {
        if (G.ball.owner === p && p !== G.controlled) aiPossessionDecision(p, team, dt);
        aiMovePlayer(p, team, dt);
        if (G.kickoffPending) applyKickoffRestraint(p, team);
      }
      aiTackleAttempt(p, dt);
    }
  }
  updateBall(dt);
  autoAssignControl();
  if (G.state === STATE.PLAYING) updateClock(dt);
}

function drawPitchMarkings(ctx) {
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  const x0 = toCanvasX(0), y0 = toCanvasY(0), x1 = toCanvasX(PITCH_LEN), y1 = toCanvasY(PITCH_WID);
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  // center line
  ctx.beginPath();
  ctx.moveTo(toCanvasX(PITCH_LEN / 2), y0);
  ctx.lineTo(toCanvasX(PITCH_LEN / 2), y1);
  ctx.stroke();
  // center circle + spot
  ctx.beginPath();
  ctx.arc(toCanvasX(PITCH_LEN / 2), toCanvasY(PITCH_WID / 2), CENTER_CIRCLE_R * SCALE, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.fillRect(toCanvasX(PITCH_LEN / 2) - 2, toCanvasY(PITCH_WID / 2) - 2, 4, 4);

  [1, -1].forEach(dir => {
    const goalX = dir === 1 ? PITCH_LEN : 0;
    const edgeBox = dir === 1 ? PITCH_LEN - BOX_DEPTH : BOX_DEPTH;
    const edgeSix = dir === 1 ? PITCH_LEN - SIX_DEPTH : SIX_DEPTH;
    const topBox = PITCH_WID / 2 - BOX_WIDTH / 2, botBox = PITCH_WID / 2 + BOX_WIDTH / 2;
    const topSix = PITCH_WID / 2 - SIX_WIDTH / 2, botSix = PITCH_WID / 2 + SIX_WIDTH / 2;
    // penalty box
    ctx.strokeRect(toCanvasX(Math.min(goalX, edgeBox)), toCanvasY(topBox), Math.abs(goalX - edgeBox) * SCALE, (botBox - topBox) * SCALE);
    // six yard box
    ctx.strokeRect(toCanvasX(Math.min(goalX, edgeSix)), toCanvasY(topSix), Math.abs(goalX - edgeSix) * SCALE, (botSix - topSix) * SCALE);
    // penalty spot
    const spotX = dir === 1 ? PITCH_LEN - PEN_SPOT_DIST : PEN_SPOT_DIST;
    ctx.fillRect(toCanvasX(spotX) - 2, toCanvasY(PITCH_WID / 2) - 2, 4, 4);
    // goal frame (drawn just outside the pitch)
    const goalTop = PITCH_WID / 2 - GOAL_WIDTH / 2, goalBot = PITCH_WID / 2 + GOAL_WIDTH / 2;
    ctx.strokeStyle = '#dddddd';
    if (dir === 1) {
      ctx.strokeRect(toCanvasX(PITCH_LEN), toCanvasY(goalTop), 2 * SCALE, (goalBot - goalTop) * SCALE);
    } else {
      ctx.strokeRect(toCanvasX(0) - 2 * SCALE, toCanvasY(goalTop), 2 * SCALE, (goalBot - goalTop) * SCALE);
    }
    ctx.strokeStyle = '#ffffff';
  });
}

function drawPlayerSprite(ctx, cx, cy, shirt, shorts, controlled) {
  ctx.fillStyle = '#000';
  ctx.fillRect(cx - 4, cy - 9, 8, 15);
  ctx.fillStyle = '#f1c27d';
  ctx.fillRect(cx - 3, cy - 8, 6, 4);
  ctx.fillStyle = shirt;
  ctx.fillRect(cx - 3, cy - 3, 6, 5);
  ctx.fillStyle = shorts;
  ctx.fillRect(cx - 3, cy + 1, 6, 4);
  if (controlled) {
    ctx.fillStyle = '#ff1e1e';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 12);
    ctx.lineTo(cx - 5, cy - 19);
    ctx.lineTo(cx + 5, cy - 19);
    ctx.closePath();
    ctx.fill();
  }
}

function drawBallSprite(ctx, cx, cy) {
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#111';
  ctx.fillRect(cx - 1, cy - 1, 2, 2);
}

function drawTackleRange(ctx) {
  if (!G.controlled || !G.ball.owner || G.ball.owner.__team === 0) return;
  const inRange = dist(G.controlled.pos, G.ball.pos) <= TACKLE_RADIUS;
  ctx.beginPath();
  ctx.arc(toCanvasX(G.controlled.pos.x), toCanvasY(G.controlled.pos.y), TACKLE_RADIUS * SCALE, 0, Math.PI * 2);
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = inRange ? 'rgba(255, 230, 0, 0.9)' : 'rgba(255, 255, 255, 0.4)';
  ctx.stroke();
  ctx.setLineDash([]);
}

function render() {
  const canvas = document.getElementById('pitch');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#2e7d32';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // mow stripes
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  for (let i = 0; i < 10; i += 2) {
    ctx.fillRect(toCanvasX(i * (PITCH_LEN / 10)), toCanvasY(0), (PITCH_LEN / 10) * SCALE, PITCH_WID * SCALE);
  }
  drawPitchMarkings(ctx);

  if (G.teams[0] && G.teams[1]) {
    drawTackleRange(ctx);
    for (const team of G.teams) {
      for (const p of team.players) {
        const shirt = p.isGK ? team.gkColor : team.shirt;
        const shorts = p.isGK ? '#222' : team.shorts;
        drawPlayerSprite(ctx, toCanvasX(p.pos.x), toCanvasY(p.pos.y), shirt, shorts, p === G.controlled);
      }
    }
    drawBallSprite(ctx, toCanvasX(G.ball.pos.x), toCanvasY(G.ball.pos.y));
  }
}

function loop(ts) {
  if (!G.lastTs) G.lastTs = ts;
  const dt = Math.min((ts - G.lastTs) / 1000, 0.05);
  G.lastTs = ts;
  if (G.state === STATE.PLAYING) update(dt);
  if (G.state === STATE.PLAYING || G.state === STATE.PAUSED || G.state === STATE.HALFTIME || G.state === STATE.FULLTIME) render();
  requestAnimationFrame(loop);
}

// ============================================================
// UI wiring
// ============================================================
function showScreen(id) {
  ['main-menu', 'setup-screen', 'match-screen'].forEach(s => {
    document.getElementById(s).classList.toggle('hidden', s !== id);
  });
}

function goToMainMenu() {
  if (G.fulltimeTimeout) { clearTimeout(G.fulltimeTimeout); G.fulltimeTimeout = null; }
  if (G.halftimeInterval) { clearInterval(G.halftimeInterval); G.halftimeInterval = null; }
  document.getElementById('pause-overlay').classList.add('hidden');
  document.getElementById('halftime-overlay').classList.add('hidden');
  document.getElementById('fulltime-overlay').classList.add('hidden');
  G.state = STATE.MENU;
  showScreen('main-menu');
}

function populateSetupScreen() {
  const teamSel = document.getElementById('team-select');
  const oppSel = document.getElementById('opp-select');
  teamSel.innerHTML = '';
  oppSel.innerHTML = '';
  TEAMS.forEach((t, i) => {
    teamSel.appendChild(new Option(t.name, i));
    oppSel.appendChild(new Option(t.name, i));
  });
  teamSel.value = 0;
  oppSel.value = 1;
  teamSel.onchange = () => {
    if (teamSel.value === oppSel.value) {
      oppSel.value = (parseInt(teamSel.value) + 1) % TEAMS.length;
    }
  };
  oppSel.onchange = () => {
    if (teamSel.value === oppSel.value) {
      teamSel.value = (parseInt(oppSel.value) + 1) % TEAMS.length;
    }
  };
}

document.addEventListener('DOMContentLoaded', () => {
  populateSetupScreen();

  document.getElementById('btn-play').onclick = () => { showScreen('setup-screen'); };
  document.getElementById('btn-exit').onclick = () => {
    window.close();
    setTimeout(() => { alert("Your browser won't let a page close its own tab - you can close this tab manually now."); }, 300);
  };
  document.getElementById('btn-back-menu').onclick = () => { showScreen('main-menu'); };

  document.getElementById('btn-start-match').onclick = () => {
    const yourIdx = parseInt(document.getElementById('team-select').value);
    const oppIdx = parseInt(document.getElementById('opp-select').value);
    const halfLen = parseInt(document.getElementById('half-select').value);
    const skillKey = document.getElementById('skill-select').value;
    initMatch(yourIdx, oppIdx, halfLen, skillKey);
    showScreen('match-screen');
  };

  document.getElementById('btn-pause').onclick = togglePause;
  document.getElementById('btn-resume').onclick = togglePause;
  document.getElementById('btn-quit-to-menu').onclick = goToMainMenu;
  document.getElementById('btn-continue-halftime').onclick = endHalftime;
  document.getElementById('btn-fulltime-menu').onclick = goToMainMenu;

  document.getElementById('controls-toggle').onclick = () => {
    const body = document.getElementById('controls-body');
    const collapsed = body.classList.toggle('hidden');
    document.getElementById('controls-toggle').innerHTML = collapsed ? 'Controls &#9656;' : 'Controls &#9662;';
  };

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (Object.values(KEYS).includes(k)) e.preventDefault();
    G.keysDown[k] = true;
    if (e.repeat) return;
    if (k === KEYS.pause) togglePause();
    if (k === KEYS.tackle) tryHumanTackle();
    if (k === KEYS.switchPlayer) trySwitchPlayer();
    if (k === KEYS.pass && !G.charge.pass) { G.charge.pass = true; G.charge.passStart = performance.now(); }
    if (k === KEYS.shoot && !G.charge.shoot) { G.charge.shoot = true; G.charge.shootStart = performance.now(); }
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    G.keysDown[k] = false;
    if (k === KEYS.pass && G.charge.pass) onChargeRelease('pass');
    if (k === KEYS.shoot && G.charge.shoot) onChargeRelease('shoot');
  });
  // If the window loses focus (e.g. alt-tab) no keyup ever arrives, which would
  // otherwise leave movement/charge keys stuck "held" forever.
  window.addEventListener('blur', () => {
    G.keysDown = {};
    G.charge.pass = false;
    G.charge.shoot = false;
    G.joystick.x = 0;
    G.joystick.y = 0;
  });

  setupTouchControls();
  requestAnimationFrame(loop);
});

// ============================================================
// On-screen touch controls (same underlying state as the keyboard)
// ============================================================
function setupJoystick() {
  const base = document.getElementById('joystick-base');
  const stick = document.getElementById('joystick-stick');
  const maxR = 35; // px the stick can travel from its base's centre
  let activePointerId = null;

  function setFromClient(clientX, clientY) {
    const rect = base.getBoundingClientRect();
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    const d = Math.min(Math.hypot(dx, dy), maxR);
    const angle = Math.atan2(dy, dx);
    const sx = Math.cos(angle) * d, sy = Math.sin(angle) * d;
    stick.style.transform = `translate(${sx}px, ${sy}px)`;
    G.joystick.x = sx / maxR;
    G.joystick.y = sy / maxR;
  }

  function reset() {
    stick.style.transform = 'translate(0px, 0px)';
    G.joystick.x = 0;
    G.joystick.y = 0;
    activePointerId = null;
  }

  base.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    activePointerId = e.pointerId;
    base.setPointerCapture(e.pointerId);
    setFromClient(e.clientX, e.clientY);
  });
  base.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activePointerId) return;
    e.preventDefault();
    setFromClient(e.clientX, e.clientY);
  });
  const end = (e) => { if (e.pointerId === activePointerId) reset(); };
  base.addEventListener('pointerup', end);
  base.addEventListener('pointercancel', end);
}

function bindChargeButton(id, kind) {
  const el = document.getElementById(id);
  const startKey = kind === 'pass' ? 'passStart' : 'shootStart';
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!G.charge[kind]) { G.charge[kind] = true; G.charge[startKey] = performance.now(); }
  });
  const release = (e) => { e.preventDefault(); if (G.charge[kind]) onChargeRelease(kind); };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointerleave', release);
  el.addEventListener('pointercancel', release);
}

function setTouchControlsVisible(show) {
  document.getElementById('touch-controls').classList.toggle('hidden', !show);
  document.getElementById('btn-toggle-input').textContent = show ? 'Keyboard Controls' : 'Touch Controls';
}

function setupTouchControls() {
  setupJoystick();
  bindChargeButton('td-pass', 'pass');
  bindChargeButton('td-shoot', 'shoot');
  document.getElementById('td-tackle').addEventListener('pointerdown', (e) => { e.preventDefault(); tryHumanTackle(); });
  document.getElementById('td-switch').addEventListener('pointerdown', (e) => { e.preventDefault(); trySwitchPlayer(); });

  let touchControlsOn = window.matchMedia('(pointer: coarse)').matches;
  setTouchControlsVisible(touchControlsOn);
  document.getElementById('btn-toggle-input').onclick = () => {
    touchControlsOn = !touchControlsOn;
    setTouchControlsVisible(touchControlsOn);
  };
}

function togglePause() {
  if (G.state === STATE.PLAYING) {
    G.state = STATE.PAUSED;
    document.getElementById('pause-overlay').classList.remove('hidden');
  } else if (G.state === STATE.PAUSED) {
    G.state = STATE.PLAYING;
    document.getElementById('pause-overlay').classList.add('hidden');
  }
}
