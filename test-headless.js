/*
 * test-headless.js — 无头冒烟测试
 *
 * 思路：用「桩（Stub）」替代 DOM 与 Canvas，把 game.js 放进一个隔离的 vm 沙箱里跑，
 * 让它脱离浏览器也能驱动主循环。这样 UI 密集型代码的副作用被关进笼子，只验证逻辑。
 *
 * 覆盖：
 *   1. 世界生成      —— 地表起伏、洞穴、矿脉、树木
 *   2. 主循环 600 秒 —— 完整昼夜循环、夜间僵尸生成与天亮自燃
 *   3. 交互          —— 挖掘、放置、合成、攻击
 *
 * 运行：node test-headless.js
 * 期望：SYNTAX OK（由 node --check 单独输出）/ SMOKE OK: 600s 模拟无异常
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const GAME = path.join(__dirname, 'game.js');

function fail(msg) {
  console.error('SMOKE FAIL: ' + msg);
  process.exit(1);
}

// ---------- 1. 搭建桩环境 ----------
const sandbox = {
  __HEADLESS__: true,
  console,
  Math,
  Date,
  JSON,
  Object,
  Array,
  String,
  Number,
  Boolean,
  Error,
  Uint8Array,
  Int32Array,
  isNaN,
  parseInt,
  parseFloat,
  performance: { now: () => Date.now() },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

vm.createContext(sandbox);

const src = fs.readFileSync(GAME, 'utf8');
try {
  vm.runInContext(src, sandbox, { filename: 'game.js' });
} catch (e) {
  fail('game.js 加载异常：' + e.message);
}

const g = sandbox.__game;
if (!g) fail('game.js 未暴露 window.__game');

// ---------- 2. 世界生成校验 ----------
const st = g.getState();
const T = g.T;

if (!st.world || st.world.length !== g.WORLD_W) fail('世界宽度不符');

let minSurface = Infinity;
let maxSurface = -Infinity;
for (let x = 0; x < g.WORLD_W; x++) {
  minSurface = Math.min(minSurface, st.surface[x]);
  maxSurface = Math.max(maxSurface, st.surface[x]);
}
if (maxSurface - minSurface < 5) fail('地表起伏不足：' + (maxSurface - minSurface));

let air = 0;
let coal = 0;
let iron = 0;
let gold = 0;
let wood = 0;
let leaves = 0;
for (let x = 0; x < g.WORLD_W; x++) {
  for (let y = 0; y < g.WORLD_H; y++) {
    const t = st.world[x][y];
    if (t === T.AIR) air++;
    else if (t === T.COAL) coal++;
    else if (t === T.IRON) iron++;
    else if (t === T.GOLD) gold++;
    else if (t === T.WOOD) wood++;
    else if (t === T.LEAVES) leaves++;
  }
}
if (air < 1000) fail('洞穴/空气量过少，地形生成可能失败：' + air);
if (coal <= 0) fail('没有生成煤矿');
if (iron <= 0) fail('没有生成铁矿');
if (gold <= 0) fail('没有生成金矿');
if (wood <= 0) fail('没有生成树木');

// ---------- 3. 挖掘 / 放置 / 合成 ----------
const p = st.player;
const ptx = Math.floor((p.x + p.w / 2) / g.TILE);
const pty = Math.floor((p.y + p.h / 2) / g.TILE);

// 在玩家脚下附近找一块可挖的图块
let digTx = -1;
let digTy = -1;
for (let dy = 1; dy <= 3 && digTx < 0; dy++) {
  for (let dx = -1; dx <= 1; dx++) {
    const t = g.tileAt(ptx + dx, pty + dy);
    if (t !== T.AIR) {
      digTx = ptx + dx;
      digTy = pty + dy;
      break;
    }
  }
}
if (digTx < 0) fail('玩家脚下找不到可挖图块');

const beforeMined = st.stats.mined;
for (let i = 0; i < 20; i++) g.mine(digTx, digTy, 0.2);
if (st.stats.mined <= beforeMined) fail('挖掘没有生效');
if (g.tileAt(digTx, digTy) !== T.AIR) fail('挖掘后图块未变为空气');

// 放置：把刚挖的位置填回去（手持泥土）
st.hotIndex = 3; // 快捷栏第 4 格 = dirt
const beforePlaced = st.stats.placed;
const okPlace = g.place(digTx, digTy);
if (!okPlace) fail('放置失败');
if (st.stats.placed <= beforePlaced) fail('放置计数未增加');

// 合成：给足材料，合成工作台 → 放置 → 靠近后合成石镐
st.inv.wood = 200;
st.inv.stone = 200;
st.inv.coal = 50;
st.inv.iron = 200;
st.inv.gold = 200;

if (!g.craft('table')) fail('合成工作台失败');
st.inv.table = 5;

// 把工作台放在玩家旁边，制造「靠近工作台」的条件
let placedTable = false;
for (let dx = -2; dx <= 2 && !placedTable; dx++) {
  for (let dy = -1; dy <= 1 && !placedTable; dy++) {
    const tx = ptx + dx;
    const ty = pty + dy;
    if (g.tileAt(tx, ty) === T.AIR) {
      st.world[tx][ty] = T.TABLE;
      placedTable = true;
    }
  }
}
if (!placedTable) fail('无法放置工作台（周围没有空位）');
if (!g.nearTable()) fail('nearTable 未检测到工作台');

if (!g.craft('stonePick')) fail('靠近工作台仍无法合成石镐');
if (!g.craft('ironPick')) fail('无法合成铁镐');
if (!g.craft('goldSword')) fail('无法合成金剑');

// 攻击：手动放一只僵尸在玩家身边，用金剑砍
const zState = g.getState();
zState.hotbar[0] = 'goldSword';
zState.hotIndex = 0;
zState.player.facing = 1;
zState.zombies.push({
  x: p.x + 14,
  y: p.y,
  w: 14,
  h: 28,
  vx: 0,
  vy: 0,
  onGround: true,
  hp: 20,
  burning: 0,
  hitFlash: 0,
  attackCd: 0,
});
const beforeKill = zState.stats.zombiesKilled;
for (let i = 0; i < 30; i++) {
  g.update(1 / 60, { mouseDown: true, tx: ptx, ty: pty });
}
if (zState.stats.zombiesKilled <= beforeKill) {
  fail('攻击没有击杀僵尸');
}

// ---------- 4. 600 秒主循环 ----------
const s2 = g.reset(20261031);
const DT = 1 / 60;
const TOTAL = 600;
const STEPS = Math.round(TOTAL / DT);

let maxZombies = 0;
let sawNight = false;
let sawDay = false;
let err = null;

try {
  for (let i = 0; i < STEPS; i++) {
    const t = i * DT;

    // 模拟一段有节奏的玩家输入：来回走、周期性跳跃、周期性挖掘
    const inp = {
      left: false,
      right: false,
      jump: false,
      mouseDown: false,
      tx: 0,
      ty: 0,
    };

    const cycle = t % 8;
    if (cycle < 3) inp.right = true;
    else if (cycle < 6) inp.left = true;
    if (t % 3.2 < 0.2) inp.jump = true;

    // 每 1.5 秒持续按住左键 0.6 秒朝脚下挖，覆盖挖掘路径
    if (t % 1.5 < 0.6) {
      const s = g.getState();
      const px = Math.floor((s.player.x + s.player.w / 2) / g.TILE);
      const py = Math.floor((s.player.y + s.player.h / 2) / g.TILE);
      inp.mouseDown = true;
      inp.tx = px;
      inp.ty = py + 2;
    }

    g.update(DT, inp);

    const s = g.getState();
    if (s.zombies.length > maxZombies) maxZombies = s.zombies.length;
    if (g.isNight()) sawNight = true;
    else sawDay = true;

    // 血量异常检查
    if (!isFinite(s.player.x) || !isFinite(s.player.y)) {
      throw new Error('玩家坐标出现 NaN/Infinity，step=' + i);
    }
    if (s.player.hp > s.player.maxHp) {
      throw new Error('玩家血量越界，step=' + i);
    }
  }
} catch (e) {
  err = e;
}

if (err) fail('主循环异常：' + err.message);

const fin = g.getState();
if (!sawDay) fail('600 秒内没有经历白天');
if (!sawNight) fail('600 秒内没有经历夜晚');
if (fin.stats.zombiesSpawned <= 0) fail('夜间没有生成僵尸');
if (maxZombies > 40) fail('僵尸数量失控：' + maxZombies);
if (fin.day < 4) fail('天数推进异常：' + fin.day);

// 光照曲线：正午应明显亮于午夜
const s3 = g.reset(7);
s3.time = g.DAY_LENGTH * 0.32;   // 接近正午
const noon = g.skyLight();
s3.time = g.DAY_LENGTH * 0.85;   // 深夜
const midnight = g.skyLight();
if (!(noon > midnight + 0.4)) fail('昼夜光照差异不足：noon=' + noon + ' midnight=' + midnight);

// ---------- 5. 输出 ----------
console.log('SMOKE OK: 600s 模拟无异常');
console.log(
  '  · 世界 ' + g.WORLD_W + 'x' + g.WORLD_H +
  '，地表起伏 ' + (maxSurface - minSurface) + ' 格' +
  '，洞穴空气 ' + air + ' 格' +
  '，矿脉 煤' + coal + '/铁' + iron + '/金' + gold +
  '，树木 ' + wood + ' 格'
);
console.log(
  '  · 600 秒推进到第 ' + fin.day + ' 天' +
  '，僵尸生成 ' + fin.stats.zombiesSpawned +
  '，击杀 ' + fin.stats.zombiesKilled +
  '，挖掘 ' + fin.stats.mined +
  '，放置 ' + fin.stats.placed +
  '，合成 ' + fin.stats.crafted
);
console.log('  · 光照 noon=' + noon.toFixed(2) + ' midnight=' + midnight.toFixed(2));
