/*
 * 泰拉瑞亚风格 2D 侧视沙盒生存游戏
 * 纯 HTML5 Canvas + 原生 JavaScript，无第三方依赖。
 *
 * 模块划分：
 *   1. 常量与图块表      T / TILEINFO
 *   2. 噪声与地形生成    hash / noise / fbm / genWorld
 *   3. 物品与配方        ITEMS / RECIPES
 *   4. 物理碰撞          solidAt / collides / moveEntity
 *   5. 玩家与僵尸        Player / Zombie
 *   6. 交互              mine / place / attack
 *   7. 光照与渲染        drawDarkness / render
 *   8. 输入与主循环      bindInput / loop
 *
 * 无头运行：设置 global.__HEADLESS__ = true 后加载本文件，
 * 会跳过 canvas 初始化与 requestAnimationFrame，只暴露 window.__game 供测试驱动。
 */
(function (global) {
  'use strict';

  var HEADLESS = !!global.__HEADLESS__;

  /* ============================================================
   * 1. 常量与图块表
   * ============================================================ */

  var TILE = 20;              // 单图块像素
  var WORLD_W = 260;          // 世界宽（图块）
  var WORLD_H = 130;          // 世界高（图块）
  var GRAVITY = 1500;         // 重力加速度 px/s^2
  var MOVE_SPEED = 150;       // 水平速度 px/s
  var JUMP_SPEED = 470;       // 起跳初速度
  var REACH = 5.5;            // 交互距离（图块）
  var DAY_LENGTH = 120;       // 一个完整昼夜的秒数
  var DAY_RATIO = 0.65;       // 白天占比

  // 图块类型
  var T = {
    AIR: 0,
    GRASS: 1,
    DIRT: 2,
    STONE: 3,
    COAL: 4,
    IRON: 5,
    GOLD: 6,
    WOOD: 7,
    LEAVES: 8,
    TORCH: 9,
    TABLE: 10,
    PLANK: 11,
    BEDROCK: 12
  };

  // 图块属性：hardness=挖掘所需累计功；pick=所需镐等级；drop=掉落物；solid=是否阻挡
  var TILEINFO = {};
  TILEINFO[T.AIR] = { name: '空气', solid: false, hardness: 0, pick: 0, drop: null, color: '#000000' };
  TILEINFO[T.GRASS] = { name: '草地', solid: true, hardness: 0.35, pick: 1, drop: 'dirt', color: '#4c9a3f' };
  TILEINFO[T.DIRT] = { name: '泥土', solid: true, hardness: 0.35, pick: 1, drop: 'dirt', color: '#7a5230' };
  TILEINFO[T.STONE] = { name: '石块', solid: true, hardness: 0.8, pick: 1, drop: 'stone', color: '#6b6b74' };
  TILEINFO[T.COAL] = { name: '煤矿', solid: true, hardness: 0.9, pick: 1, drop: 'coal', color: '#33333a' };
  TILEINFO[T.IRON] = { name: '铁矿', solid: true, hardness: 1.2, pick: 2, drop: 'iron', color: '#b08d74' };
  TILEINFO[T.GOLD] = { name: '金矿', solid: true, hardness: 1.6, pick: 3, drop: 'gold', color: '#d8b23a' };
  TILEINFO[T.WOOD] = { name: '树干', solid: true, hardness: 0.5, pick: 1, drop: 'wood', color: '#6a4a2a' };
  TILEINFO[T.LEAVES] = { name: '树叶', solid: false, hardness: 0.15, pick: 1, drop: 'wood', color: '#2f7a34' };
  TILEINFO[T.TORCH] = { name: '火把', solid: false, hardness: 0.1, pick: 1, drop: 'torch', color: '#ffb347', light: 1 };
  TILEINFO[T.TABLE] = { name: '工作台', solid: true, hardness: 0.3, pick: 1, drop: 'table', color: '#8a6239' };
  TILEINFO[T.PLANK] = { name: '木板', solid: true, hardness: 0.3, pick: 1, drop: 'plank', color: '#a97b45' };
  TILEINFO[T.BEDROCK] = { name: '基岩', solid: true, hardness: Infinity, pick: 99, drop: null, color: '#242429' };

  /* ============================================================
   * 2. 噪声与地形生成
   * ============================================================ */

  function hash1(n) {
    var x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  function hash2(x, y) {
    var n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  }

  function smooth(t) {
    return t * t * (3 - 2 * t);
  }

  // 一维平滑噪声
  function noise1(x) {
    var i = Math.floor(x);
    var f = x - i;
    var a = hash1(i);
    var b = hash1(i + 1);
    return a + (b - a) * smooth(f);
  }

  // 二维平滑噪声
  function noise2(x, y) {
    var xi = Math.floor(x);
    var yi = Math.floor(y);
    var xf = x - xi;
    var yf = y - yi;
    var a = hash2(xi, yi);
    var b = hash2(xi + 1, yi);
    var c = hash2(xi, yi + 1);
    var d = hash2(xi + 1, yi + 1);
    var u = smooth(xf);
    var v = smooth(yf);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }

  // 分形叠加噪声
  function fbm(x, y, octaves) {
    var n = 0;
    var amp = 1;
    var freq = 1;
    var total = 0;
    var o = octaves || 4;
    for (var i = 0; i < o; i++) {
      n += noise2(x * freq, y * freq) * amp;
      total += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return n / total;
  }

  function makeWorld() {
    var w = new Array(WORLD_W);
    for (var x = 0; x < WORLD_W; x++) {
      w[x] = new Uint8Array(WORLD_H);
    }
    return w;
  }

  // 世界生成：噪声定地表 → 2D 噪声掏洞穴 → 随机游走画矿脉 → 概率种树
  function genWorld(world, seed) {
    var s = seed || 1;
    var x, y;

    // 地表高度（1D 噪声，起伏平缓）
    var surface = new Int32Array(WORLD_W);
    for (x = 0; x < WORLD_W; x++) {
      var base = Math.floor(WORLD_H * 0.34);
      var h = base + (noise1(x * 0.045 + s) - 0.5) * 16 + (fbm(x * 0.012 + s * 3, 0.5) - 0.5) * 10;
      surface[x] = Math.max(8, Math.min(WORLD_H - 20, Math.floor(h)));
    }

    // 填充：地表以上空气，以下泥土 + 深层石块
    for (x = 0; x < WORLD_W; x++) {
      for (y = 0; y < WORLD_H; y++) {
        if (y < surface[x]) {
          world[x][y] = T.AIR;
        } else if (y === surface[x]) {
          world[x][y] = T.GRASS;
        } else if (y < surface[x] + 5) {
          world[x][y] = T.DIRT;
        } else if (y < WORLD_H - 1) {
          world[x][y] = T.STONE;
        } else {
          world[x][y] = T.BEDROCK;
        }
      }
    }

    // 洞穴：2D fbm 超过阈值处挖空
    for (x = 2; x < WORLD_W - 2; x++) {
      for (y = surface[x] + 3; y < WORLD_H - 2; y++) {
        var c = fbm(x * 0.07 + s * 7, y * 0.07 + s * 11, 3);
        if (c > 0.62) {
          world[x][y] = T.AIR;
        }
      }
    }

    // 矿脉：随机游走
    function veins(type, count, len, minY, maxY) {
      for (var i = 0; i < count; i++) {
        var vx = 3 + Math.floor(Math.random() * (WORLD_W - 6));
        var vy = minY + Math.floor(Math.random() * Math.max(1, maxY - minY));
        for (var k = 0; k < len; k++) {
          if (vx > 0 && vx < WORLD_W - 1 && vy > 0 && vy < WORLD_H - 1) {
            if (world[vx][vy] === T.STONE) world[vx][vy] = type;
          }
          vx += Math.random() < 0.5 ? 1 : (Math.random() < 0.5 ? -1 : 0);
          vy += Math.random() < 0.5 ? 1 : (Math.random() < 0.5 ? -1 : 0);
        }
      }
    }
    veins(T.COAL, 90, 7, Math.floor(WORLD_H * 0.42), WORLD_H - 6);
    veins(T.IRON, 55, 5, Math.floor(WORLD_H * 0.55), WORLD_H - 6);
    veins(T.GOLD, 26, 4, Math.floor(WORLD_H * 0.72), WORLD_H - 6);

    // 种树：草地上按概率生成 4~7 格高的树干 + 树冠
    for (x = 4; x < WORLD_W - 4; x++) {
      if (world[x][surface[x]] !== T.GRASS) continue;
      if (Math.random() > 0.11) continue;
      var th = 4 + Math.floor(Math.random() * 4);
      var top = surface[x] - th;
      if (top < 3) continue;
      for (y = top; y < surface[x]; y++) {
        world[x][y] = T.WOOD;
      }
      // 树冠
      for (var dx = -2; dx <= 2; dx++) {
        for (var dy = -2; dy <= 1; dy++) {
          var lx = x + dx;
          var ly = top + dy;
          if (lx < 0 || lx >= WORLD_W || ly < 0 || ly >= WORLD_H) continue;
          if (world[lx][ly] === T.AIR && Math.abs(dx) + Math.abs(dy) <= 3) {
            world[lx][ly] = T.LEAVES;
          }
        }
      }
    }

    return surface;
  }

  /* ============================================================
   * 3. 物品与配方
   * ============================================================ */

  var ITEMS = {
    dirt: { name: '泥土', tile: T.DIRT, place: true },
    stone: { name: '石块', tile: T.STONE, place: true },
    wood: { name: '木材', tile: T.WOOD, place: true },
    plank: { name: '木板', tile: T.PLANK, place: true },
    coal: { name: '煤炭', place: false },
    iron: { name: '铁矿', place: false },
    gold: { name: '金矿', place: false },
    torch: { name: '火把', tile: T.TORCH, place: true },
    table: { name: '工作台', tile: T.TABLE, place: true },
    woodPick: { name: '木镐', pick: 1, place: false },
    stonePick: { name: '石镐', pick: 2, place: false },
    ironPick: { name: '铁镐', pick: 3, place: false },
    goldPick: { name: '金镐', pick: 4, place: false },
    woodSword: { name: '木剑', damage: 12, place: false },
    stoneSword: { name: '石剑', damage: 20, place: false },
    ironSword: { name: '铁剑', damage: 30, place: false },
    goldSword: { name: '金剑', damage: 45, place: false }
  };

  // cost: {item: count}；table: 是否需要靠近工作台；out: 产出数量
  var RECIPES = [
    { id: 'table', out: 'table', count: 1, cost: { wood: 10 }, table: false },
    { id: 'plank', out: 'plank', count: 2, cost: { wood: 1 }, table: false },
    { id: 'torch', out: 'torch', count: 4, cost: { wood: 1, coal: 1 }, table: false },
    { id: 'woodPick', out: 'woodPick', count: 1, cost: { wood: 8 }, table: false },
    { id: 'woodSword', out: 'woodSword', count: 1, cost: { wood: 7 }, table: false },
    { id: 'stonePick', out: 'stonePick', count: 1, cost: { stone: 8, wood: 3 }, table: true },
    { id: 'stoneSword', out: 'stoneSword', count: 1, cost: { stone: 8, wood: 3 }, table: true },
    { id: 'ironPick', out: 'ironPick', count: 1, cost: { iron: 10, wood: 3 }, table: true },
    { id: 'ironSword', out: 'ironSword', count: 1, cost: { iron: 10, wood: 3 }, table: true },
    { id: 'goldPick', out: 'goldPick', count: 1, cost: { gold: 12, wood: 3 }, table: true },
    { id: 'goldSword', out: 'goldSword', count: 1, cost: { gold: 12, wood: 3 }, table: true }
  ];

  function makeInventory() {
    var inv = {};
    for (var k in ITEMS) {
      if (Object.prototype.hasOwnProperty.call(ITEMS, k)) inv[k] = 0;
    }
    return inv;
  }

  /* ============================================================
   * 4. 物理碰撞
   * ============================================================ */

  function tileAt(world, tx, ty) {
    if (tx < 0 || tx >= WORLD_W || ty < 0 || ty >= WORLD_H) return T.BEDROCK;
    return world[tx][ty];
  }

  function solidAt(world, tx, ty) {
    return !!TILEINFO[tileAt(world, tx, ty)].solid;
  }

  // AABB 与图块网格碰撞检测
  function collides(world, x, y, w, h) {
    var x0 = Math.floor(x / TILE);
    var x1 = Math.floor((x + w - 1) / TILE);
    var y0 = Math.floor(y / TILE);
    var y1 = Math.floor((y + h - 1) / TILE);
    for (var ty = y0; ty <= y1; ty++) {
      for (var tx = x0; tx <= x1; tx++) {
        if (solidAt(world, tx, ty)) return true;
      }
    }
    return false;
  }

  // 分轴解算：先 X 后 Y，避免斜向穿墙
  function moveEntity(world, e, dx, dy) {
    var nx = e.x + dx;
    if (!collides(world, nx, e.y, e.w, e.h)) {
      e.x = nx;
    } else {
      // 逐像素逼近，尽量贴墙
      var step = dx > 0 ? 1 : -1;
      while (Math.abs(nx - e.x) > 0.5) {
        nx -= step;
        if (!collides(world, nx, e.y, e.w, e.h)) {
          e.x = nx;
          break;
        }
      }
      e.vx = 0;
      e.blockedX = true;
    }

    var ny = e.y + dy;
    if (!collides(world, e.x, ny, e.w, e.h)) {
      e.y = ny;
      e.onGround = false;
    } else {
      var stepY = dy > 0 ? 1 : -1;
      while (Math.abs(ny - e.y) > 0.5) {
        ny -= stepY;
        if (!collides(world, e.x, ny, e.w, e.h)) {
          e.y = ny;
          break;
        }
      }
      if (dy > 0) e.onGround = true;
      e.vy = 0;
    }
  }

  /* ============================================================
   * 5. 状态容器
   * ============================================================ */

  function createState(seed) {
    var world = makeWorld();
    var surface = genWorld(world, seed);

    // 出生点：世界中央地表上方
    var sx = Math.floor(WORLD_W / 2);
    var sy = surface[sx] - 3;

    var player = {
      x: sx * TILE + 4,
      y: sy * TILE,
      w: 14,
      h: 28,
      vx: 0,
      vy: 0,
      onGround: false,
      blockedX: false,
      hp: 100,
      maxHp: 100,
      coins: 0,
      facing: 1,
      invuln: 0,
      swing: 0,
      pickTier: 1
    };

    var state = {
      seed: seed || 1,
      world: world,
      surface: surface,
      player: player,
      zombies: [],
      inv: makeInventory(),
      hotbar: ['woodPick', 'woodSword', 'torch', 'dirt', 'stone', 'wood', 'plank', 'table', 'coal', 'iron'],
      hotIndex: 0,
      time: 0,          // 世界累计秒数
      day: 1,
      mining: null,     // {tx, ty, progress}
      spawnTimer: 0,
      messages: [],
      helpOpen: false,
      // 统计（供测试断言）
      stats: { mined: 0, placed: 0, crafted: 0, zombiesSpawned: 0, zombiesKilled: 0, daysPassed: 0 }
    };

    // 初始补给，保证开局能立刻合成
    state.inv.wood = 20;
    state.inv.dirt = 10;

    return state;
  }

  function addMessage(state, text) {
    state.messages.push({ text: text, t: state.time });
    if (state.messages.length > 6) state.messages.shift();
  }

  function giveItem(state, item, n) {
    if (!item) return;
    state.inv[item] = (state.inv[item] || 0) + (n || 1);
  }

  /* ============================================================
   * 6. 昼夜
   * ============================================================ */

  // 返回 0..1 的天空亮度
  function skyLight(state) {
    var phase = (state.time % DAY_LENGTH) / DAY_LENGTH;
    if (phase < DAY_RATIO) {
      // 白天：正弦拱形
      var p = phase / DAY_RATIO;
      return 0.18 + 0.82 * Math.sin(Math.PI * p);
    }
    // 夜晚：低亮度
    var q = (phase - DAY_RATIO) / (1 - DAY_RATIO);
    return 0.12 + 0.06 * Math.sin(Math.PI * q);
  }

  function isNight(state) {
    return (state.time % DAY_LENGTH) / DAY_LENGTH >= DAY_RATIO;
  }

  /* ============================================================
   * 7. 玩家更新
   * ============================================================ */

  function updatePlayer(state, dt, input) {
    var p = state.player;
    var world = state.world;

    // 水平
    var dir = 0;
    if (input.left) dir -= 1;
    if (input.right) dir += 1;
    if (dir !== 0) p.facing = dir;
    p.vx = dir * MOVE_SPEED;

    // 跳跃
    if (input.jump && p.onGround) {
      p.vy = -JUMP_SPEED;
      p.onGround = false;
    }

    // 重力
    p.vy += GRAVITY * dt;
    if (p.vy > 1400) p.vy = 1400;

    moveEntity(world, p, p.vx * dt, p.vy * dt);

    // 无敌帧与挥砍计时
    if (p.invuln > 0) p.invuln -= dt;
    if (p.swing > 0) p.swing -= dt;

    // 当前手持工具的镐等级
    var held = state.hotbar[state.hotIndex];
    p.pickTier = (held && ITEMS[held] && ITEMS[held].pick) || 0;

    // 掉出世界保护
    if (p.y > WORLD_H * TILE) {
      p.x = (WORLD_W / 2) * TILE;
      p.y = (state.surface[Math.floor(WORLD_W / 2)] - 3) * TILE;
      p.vy = 0;
      p.hp = Math.max(1, p.hp - 20);
      addMessage(state, '你掉出了世界，受到 20 点伤害');
    }
  }

  /* ============================================================
   * 8. 挖掘 / 放置 / 攻击
   * ============================================================ */

  function nearTable(state) {
    var p = state.player;
    var ptx = Math.floor((p.x + p.w / 2) / TILE);
    var pty = Math.floor((p.y + p.h / 2) / TILE);
    for (var dx = -4; dx <= 4; dx++) {
      for (var dy = -3; dy <= 3; dy++) {
        if (tileAt(state.world, ptx + dx, pty + dy) === T.TABLE) return true;
      }
    }
    return false;
  }

  function inReach(state, tx, ty) {
    var p = state.player;
    var px = (p.x + p.w / 2) / TILE;
    var py = (p.y + p.h / 2) / TILE;
    var d = Math.hypot(tx + 0.5 - px, ty + 0.5 - py);
    return d <= REACH;
  }

  function mineAt(state, tx, ty, dt) {
    var info = TILEINFO[tileAt(state.world, tx, ty)];
    if (!info.solid && tileAt(state.world, tx, ty) !== T.LEAVES && tileAt(state.world, tx, ty) !== T.TORCH) {
      state.mining = null;
      return;
    }
    if (!inReach(state, tx, ty)) {
      state.mining = null;
      return;
    }
    if (state.player.pickTier < info.pick) {
      state.mining = null;
      addMessage(state, '需要更高级的镐才能挖 ' + info.name);
      return;
    }

    if (!state.mining || state.mining.tx !== tx || state.mining.ty !== ty) {
      state.mining = { tx: tx, ty: ty, progress: 0 };
    }
    // 镐等级越高越快
    var speed = 0.8 + state.player.pickTier * 0.7;
    state.mining.progress += dt * speed;

    if (state.mining.progress >= info.hardness) {
      var type = tileAt(state.world, tx, ty);
      state.world[tx][ty] = T.AIR;
      giveItem(state, info.drop, 1);
      state.stats.mined++;
      state.mining = null;
      // 挖掉树干时连带掉树叶
      if (type === T.WOOD || type === T.LEAVES) {
        // 不做连锁，保持简单
      }
    }
  }

  function placeAt(state, tx, ty) {
    if (!inReach(state, tx, ty)) return false;
    var cur = tileAt(state.world, tx, ty);
    if (cur !== T.AIR) return false;

    var held = state.hotbar[state.hotIndex];
    var def = ITEMS[held];
    if (!def || !def.place) return false;
    if ((state.inv[held] || 0) <= 0) return false;

    // 不允许把方块放在玩家身体里
    var p = state.player;
    var bx = tx * TILE;
    var by = ty * TILE;
    if (bx < p.x + p.w && bx + TILE > p.x && by < p.y + p.h && by + TILE > p.y) return false;

    state.world[tx][ty] = def.tile;
    state.inv[held]--;
    state.stats.placed++;
    return true;
  }

  function attack(state) {
    var p = state.player;
    if (p.swing > 0) return;
    p.swing = 0.28;

    var held = state.hotbar[state.hotIndex];
    var def = ITEMS[held];
    var dmg = (def && def.damage) || 4;

    var px = p.x + p.w / 2;
    var py = p.y + p.h / 2;
    for (var i = state.zombies.length - 1; i >= 0; i--) {
      var z = state.zombies[i];
      var zx = z.x + z.w / 2;
      var zy = z.y + z.h / 2;
      var d = Math.hypot(zx - px, zy - py);
      if (d > TILE * 2.6) continue;
      // 必须朝向敌人
      if ((zx - px) * p.facing < -TILE) continue;
      z.hp -= dmg;
      z.hitFlash = 0.15;
      if (z.hp <= 0) {
        state.zombies.splice(i, 1);
        state.player.coins += 1 + Math.floor(Math.random() * 3);
        state.stats.zombiesKilled++;
      }
    }
  }

  /* ============================================================
   * 9. 合成
   * ============================================================ */

  function canCraft(state, recipe) {
    if (recipe.table && !nearTable(state)) return false;
    for (var k in recipe.cost) {
      if (!Object.prototype.hasOwnProperty.call(recipe.cost, k)) continue;
      if ((state.inv[k] || 0) < recipe.cost[k]) return false;
    }
    return true;
  }

  function craft(state, recipeId) {
    for (var i = 0; i < RECIPES.length; i++) {
      if (RECIPES[i].id !== recipeId) continue;
      var r = RECIPES[i];
      if (!canCraft(state, r)) return false;
      for (var k in r.cost) {
        if (Object.prototype.hasOwnProperty.call(r.cost, k)) state.inv[k] -= r.cost[k];
      }
      state.inv[r.out] = (state.inv[r.out] || 0) + r.count;
      state.stats.crafted++;
      addMessage(state, '合成 ' + ITEMS[r.out].name + ' x' + r.count);
      return true;
    }
    return false;
  }

  /* ============================================================
   * 10. 僵尸
   * ============================================================ */

  function spawnZombie(state) {
    var p = state.player;
    var side = Math.random() < 0.5 ? -1 : 1;
    var tx = Math.floor(p.x / TILE) + side * (14 + Math.floor(Math.random() * 6));
    if (tx < 2) tx = 2;
    if (tx > WORLD_W - 3) tx = WORLD_W - 3;

    // 从地表往下找到第一个可站立位置
    var ty = 2;
    for (var y = 2; y < WORLD_H - 2; y++) {
      if (solidAt(state.world, tx, y)) {
        ty = y - 1;
        break;
      }
    }

    state.zombies.push({
      x: tx * TILE + 3,
      y: ty * TILE,
      w: 14,
      h: 28,
      vx: 0,
      vy: 0,
      onGround: false,
      hp: 40,
      burning: 0,
      hitFlash: 0,
      attackCd: 0
    });
    state.stats.zombiesSpawned++;
  }

  function updateZombies(state, dt) {
    var p = state.player;
    var night = isNight(state);

    // 夜间生成，白天不生成
    if (night) {
      state.spawnTimer -= dt;
      if (state.spawnTimer <= 0 && state.zombies.length < 6) {
        state.spawnTimer = 2.5;
        spawnZombie(state);
      }
    }

    for (var i = state.zombies.length - 1; i >= 0; i--) {
      var z = state.zombies[i];

      if (z.hitFlash > 0) z.hitFlash -= dt;
      if (z.attackCd > 0) z.attackCd -= dt;

      // 天亮自燃
      if (!night) {
        z.burning += dt;
        z.hp -= dt * 18;
        if (z.hp <= 0) {
          state.zombies.splice(i, 1);
          state.stats.zombiesKilled++;
          continue;
        }
      }

      // 追踪玩家
      var dx = p.x - z.x;
      var dir = dx > 0 ? 1 : -1;
      z.vx = dir * 62;

      // 遇墙或前方有落差时跳跃
      var frontTx = Math.floor((z.x + (dir > 0 ? z.w + 2 : -2)) / TILE);
      var footTy = Math.floor((z.y + z.h - 4) / TILE);
      if (z.onGround && (solidAt(state.world, frontTx, footTy) || solidAt(state.world, frontTx, footTy - 1))) {
        z.vy = -420;
        z.onGround = false;
      }

      z.vy += GRAVITY * dt;
      if (z.vy > 1400) z.vy = 1400;
      moveEntity(state.world, z, z.vx * dt, z.vy * dt);

      // 接触伤害
      var overlap = z.x < p.x + p.w && z.x + z.w > p.x && z.y < p.y + p.h && z.y + z.h > p.y;
      if (overlap && p.invuln <= 0 && z.attackCd <= 0) {
        p.hp -= 8;
        p.invuln = 0.9;
        z.attackCd = 0.9;
        if (p.hp <= 0) {
          p.hp = p.maxHp;
          p.x = (WORLD_W / 2) * TILE;
          p.y = (state.surface[Math.floor(WORLD_W / 2)] - 3) * TILE;
          addMessage(state, '你被僵尸击倒了，已在出生点复活');
        }
      }

      // 离玩家过远则移除，避免堆积
      if (Math.abs(z.x - p.x) > TILE * 60) {
        state.zombies.splice(i, 1);
      }
    }
  }

  /* ============================================================
   * 11. 主更新
   * ============================================================ */

  function update(state, dt, input) {
    input = input || {};
    var prevDay = state.day;
    state.time += dt;
    state.day = 1 + Math.floor(state.time / DAY_LENGTH);
    if (state.day !== prevDay) {
      state.stats.daysPassed++;
      addMessage(state, '第 ' + state.day + ' 天开始了');
    }

    updatePlayer(state, dt, input);

    // 鼠标左键：挖 / 放 / 打
    if (input.mouseDown && input.tx !== undefined && input.ty !== undefined) {
      var held = state.hotbar[state.hotIndex];
      var def = ITEMS[held];
      if (def && def.damage) {
        if (state.zombies.length > 0) attack(state);
      } else {
        var cur = tileAt(state.world, input.tx, input.ty);
        if (cur === T.AIR) {
          placeAt(state, input.tx, input.ty);
          state.mining = null;
        } else {
          mineAt(state, input.tx, input.ty, dt);
        }
      }
    } else {
      state.mining = null;
    }

    updateZombies(state, dt);

    // 消息过期
    while (state.messages.length > 0 && state.time - state.messages[0].t > 4) {
      state.messages.shift();
    }
  }

  /* ============================================================
   * 12. 渲染
   * ============================================================ */

  var canvas = null;
  var ctx = null;
  var lightCanvas = null;
  var lightCtx = null;
  var VIEW_W = 960;
  var VIEW_H = 600;

  function initCanvas() {
    canvas = document.getElementById('game');
    if (!canvas) return false;
    ctx = canvas.getContext('2d');
    lightCanvas = document.createElement('canvas');
    lightCtx = lightCanvas.getContext('2d');
    resize();
    global.addEventListener('resize', resize);
    return true;
  }

  function resize() {
    if (!canvas) return;
    var w = Math.min(global.innerWidth, 1280);
    var h = Math.min(global.innerHeight - 40, 760);
    canvas.width = w;
    canvas.height = h;
    VIEW_W = w;
    VIEW_H = h;
    lightCanvas.width = w;
    lightCanvas.height = h;
  }

  // 用哈希做伪随机纹理，让同一种图块看起来不呆板
  function tileShade(tx, ty, base, range) {
    var n = hash2(tx * 3.7, ty * 5.1);
    var v = Math.floor((n - 0.5) * range);
    var c = base.map(function (x) { return Math.max(0, Math.min(255, x + v)); });
    return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
  }

  var TILE_COLORS = {};
  TILE_COLORS[T.GRASS] = [76, 154, 63];
  TILE_COLORS[T.DIRT] = [122, 82, 48];
  TILE_COLORS[T.STONE] = [107, 107, 116];
  TILE_COLORS[T.COAL] = [51, 51, 58];
  TILE_COLORS[T.IRON] = [176, 141, 116];
  TILE_COLORS[T.GOLD] = [216, 178, 58];
  TILE_COLORS[T.WOOD] = [106, 74, 42];
  TILE_COLORS[T.LEAVES] = [47, 122, 52];
  TILE_COLORS[T.TABLE] = [138, 98, 57];
  TILE_COLORS[T.PLANK] = [169, 123, 69];
  TILE_COLORS[T.BEDROCK] = [36, 36, 41];

  function drawTile(c, type, tx, ty, sx, sy) {
    var base = TILE_COLORS[type];
    if (base) {
      c.fillStyle = tileShade(tx, ty, base, 26);
      c.fillRect(sx, sy, TILE, TILE);
      // 草地顶部亮边
      if (type === T.GRASS) {
        c.fillStyle = 'rgba(126, 200, 96, 0.55)';
        c.fillRect(sx, sy, TILE, 3);
      }
      // 矿石斑点
      if (type === T.COAL || type === T.IRON || type === T.GOLD) {
        c.fillStyle = 'rgba(255,255,255,0.18)';
        for (var i = 0; i < 3; i++) {
          var ox = hash2(tx + i * 7, ty + i * 3) * (TILE - 6) + 2;
          var oy = hash2(tx + i * 11, ty + i * 5) * (TILE - 6) + 2;
          c.fillRect(sx + ox, sy + oy, 3, 3);
        }
      }
    } else if (type === T.TORCH) {
      c.fillStyle = '#6a4a2a';
      c.fillRect(sx + TILE / 2 - 1, sy + 6, 2, TILE - 8);
      var flick = 0.75 + Math.sin(performanceNow() * 0.008 + tx) * 0.25;
      c.fillStyle = 'rgba(255, 190, 80, ' + flick + ')';
      c.beginPath();
      c.arc(sx + TILE / 2, sy + 5, 4, 0, Math.PI * 2);
      c.fill();
    }
  }

  function performanceNow() {
    if (typeof performance !== 'undefined' && performance.now) return performance.now();
    return Date.now();
  }

  function drawHumanoid(c, x, y, w, h, skin, cloth, facing, flash) {
    c.fillStyle = flash ? '#ffffff' : cloth;
    c.fillRect(x, y + h * 0.35, w, h * 0.65);
    c.fillStyle = flash ? '#ffffff' : skin;
    c.fillRect(x + 1, y, w - 2, h * 0.36);
    // 眼睛
    if (!flash) {
      c.fillStyle = '#1a1a1a';
      var ex = facing > 0 ? x + w - 5 : x + 2;
      c.fillRect(ex, y + 6, 2, 2);
    }
  }

  function drawDarkness(state) {
    var sky = skyLight(state);
    var p = state.player;
    var camX = p.x + p.w / 2 - VIEW_W / 2;
    var camY = p.y + p.h / 2 - VIEW_H / 2;

    lightCtx.globalCompositeOperation = 'source-over';
    lightCtx.clearRect(0, 0, VIEW_W, VIEW_H);
    lightCtx.fillStyle = 'rgba(4, 6, 14, ' + (1 - sky) * 0.86 + ')';
    lightCtx.fillRect(0, 0, VIEW_W, VIEW_H);

    // 挖亮：火把 + 玩家微光
    lightCtx.globalCompositeOperation = 'destination-out';

    function punch(sx, sy, radius, strength) {
      var g = lightCtx.createRadialGradient(sx, sy, 0, sx, sy, radius);
      g.addColorStop(0, 'rgba(0,0,0,' + strength + ')');
      g.addColorStop(0.55, 'rgba(0,0,0,' + strength * 0.55 + ')');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      lightCtx.fillStyle = g;
      lightCtx.beginPath();
      lightCtx.arc(sx, sy, radius, 0, Math.PI * 2);
      lightCtx.fill();
    }

    var tx0 = Math.max(0, Math.floor(camX / TILE));
    var tx1 = Math.min(WORLD_W - 1, Math.ceil((camX + VIEW_W) / TILE));
    var ty0 = Math.max(0, Math.floor(camY / TILE));
    var ty1 = Math.min(WORLD_H - 1, Math.ceil((camY + VIEW_H) / TILE));

    for (var tx = tx0; tx <= tx1; tx++) {
      for (var ty = ty0; ty <= ty1; ty++) {
        if (state.world[tx][ty] === T.TORCH) {
          punch(tx * TILE + TILE / 2 - camX, ty * TILE + TILE / 2 - camY, TILE * 4.2, 0.95);
        }
      }
    }
    punch(p.x + p.w / 2 - camX, p.y + p.h / 2 - camY, TILE * 3.4, 0.8);

    lightCtx.globalCompositeOperation = 'source-over';
    ctx.drawImage(lightCanvas, 0, 0);
  }

  function render(state) {
    if (!ctx) return;
    var p = state.player;
    var camX = Math.round(p.x + p.w / 2 - VIEW_W / 2);
    var camY = Math.round(p.y + p.h / 2 - VIEW_H / 2);
    if (camX < 0) camX = 0;
    if (camY < 0) camY = 0;
    if (camX > WORLD_W * TILE - VIEW_W) camX = WORLD_W * TILE - VIEW_W;
    if (camY > WORLD_H * TILE - VIEW_H) camY = WORLD_H * TILE - VIEW_H;

    // 天空渐变
    var sky = skyLight(state);
    var g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    if (sky > 0.55) {
      g.addColorStop(0, '#4a9fe0');
      g.addColorStop(1, '#bfe3f7');
    } else if (sky > 0.3) {
      g.addColorStop(0, '#2c3f6b');
      g.addColorStop(1, '#8a6f8e');
    } else {
      g.addColorStop(0, '#070a16');
      g.addColorStop(1, '#131a2e');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // 星空
    if (sky < 0.45) {
      ctx.fillStyle = 'rgba(255,255,255,' + (0.45 - sky) * 2 + ')';
      for (var s = 0; s < 90; s++) {
        var sxp = (hash1(s * 12.9) * VIEW_W) | 0;
        var syp = (hash1(s * 7.3) * VIEW_H * 0.55) | 0;
        ctx.fillRect(sxp, syp, 1, 1);
      }
    }

    // 日月
    var phase = (state.time % DAY_LENGTH) / DAY_LENGTH;
    var ang = phase * Math.PI * 2 - Math.PI / 2;
    var cx = VIEW_W / 2 + Math.cos(ang) * VIEW_W * 0.42;
    var cy = VIEW_H * 0.62 + Math.sin(ang) * VIEW_H * 0.55;
    if (phase < DAY_RATIO) {
      ctx.fillStyle = '#ffe9a8';
      ctx.beginPath();
      ctx.arc(cx, cy, 22, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#e8eefc';
      ctx.beginPath();
      ctx.arc(cx, cy, 16, 0, Math.PI * 2);
      ctx.fill();
    }

    // 图块
    var tx0 = Math.max(0, Math.floor(camX / TILE));
    var tx1 = Math.min(WORLD_W - 1, Math.ceil((camX + VIEW_W) / TILE));
    var ty0 = Math.max(0, Math.floor(camY / TILE));
    var ty1 = Math.min(WORLD_H - 1, Math.ceil((camY + VIEW_H) / TILE));

    for (var tx = tx0; tx <= tx1; tx++) {
      for (var ty = ty0; ty <= ty1; ty++) {
        var type = state.world[tx][ty];
        if (type === T.AIR) continue;
        drawTile(ctx, type, tx, ty, tx * TILE - camX, ty * TILE - camY);
      }
    }

    // 挖掘进度高亮
    if (state.mining) {
      var mx = state.mining.tx * TILE - camX;
      var my = state.mining.ty * TILE - camY;
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1;
      ctx.strokeRect(mx + 0.5, my + 0.5, TILE - 1, TILE - 1);
      var info = TILEINFO[tileAt(state.world, state.mining.tx, state.mining.ty)];
      var prog = Math.min(1, state.mining.progress / Math.max(0.001, info.hardness));
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(mx, my, TILE, TILE);
      ctx.fillStyle = 'rgba(120,220,120,0.6)';
      ctx.fillRect(mx, my + TILE - 3, TILE * prog, 3);
    }

    // 僵尸
    for (var i = 0; i < state.zombies.length; i++) {
      var z = state.zombies[i];
      var zf = z.hitFlash > 0;
      drawHumanoid(ctx, z.x - camX, z.y - camY, z.w, z.h, '#7fa06a', '#3f5a4a', 1, zf);
      if (z.burning > 0) {
        ctx.fillStyle = 'rgba(255,140,40,' + Math.min(0.8, z.burning) + ')';
        ctx.fillRect(z.x - camX, z.y - camY, z.w, z.h);
      }
    }

    // 玩家
    var pf = p.invuln > 0 && Math.floor(p.invuln * 20) % 2 === 0;
    drawHumanoid(ctx, p.x - camX, p.y - camY, p.w, p.h, '#f2c9a0', '#3a6ea5', p.facing, pf);

    // 手持物
    var held = state.hotbar[state.hotIndex];
    if (held && ITEMS[held]) {
      var hx = p.x - camX + (p.facing > 0 ? p.w + 1 : -5);
      var hy = p.y - camY + 10;
      ctx.fillStyle = ITEMS[held].damage ? '#dfe6f2' : '#c9a06a';
      ctx.fillRect(hx, hy, 4, 12);
    }

    // 光照遮罩
    drawDarkness(state);

    // HUD
    drawHud(state);

    // 消息
    drawMessages(state);

    // 帮助
    if (state.helpOpen) drawHelp();
  }

  function drawHud(state) {
    var p = state.player;

    // 红心生命条
    var hearts = 10;
    var per = p.maxHp / hearts;
    for (var i = 0; i < hearts; i++) {
      var x = 16 + i * 22;
      var y = 16;
      var filled = p.hp - i * per;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(x - 1, y - 1, 18, 18);
      ctx.fillStyle = filled >= per ? '#e8434f' : (filled > 0 ? '#8d2b33' : '#2a2a33');
      ctx.fillRect(x, y, 16, 16);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(x + 3, y + 3, 4, 4);
    }

    // 金币
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(16, 42, 118, 24);
    ctx.fillStyle = '#ffd75e';
    ctx.beginPath();
    ctx.arc(30, 54, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '13px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('金币 ' + p.coins, 44, 59);

    // 天数与时间
    var phase = (state.time % DAY_LENGTH) / DAY_LENGTH;
    var label = phase < DAY_RATIO ? '白天' : '夜晚';
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(VIEW_W - 150, 16, 134, 24);
    ctx.fillStyle = phase < DAY_RATIO ? '#ffe9a8' : '#b9c6ff';
    ctx.fillText('第 ' + state.day + ' 天 · ' + label, VIEW_W - 140, 33);

    // 快捷栏 10 格
    var slot = 44;
    var totalW = slot * 10;
    var sx = (VIEW_W - totalW) / 2;
    var sy = VIEW_H - slot - 14;
    for (var k = 0; k < 10; k++) {
      var bx = sx + k * slot;
      var active = k === state.hotIndex;
      ctx.fillStyle = active ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.45)';
      ctx.fillRect(bx, sy, slot - 4, slot - 4);
      ctx.strokeStyle = active ? '#ffd75e' : 'rgba(255,255,255,0.18)';
      ctx.lineWidth = active ? 2 : 1;
      ctx.strokeRect(bx + 0.5, sy + 0.5, slot - 5, slot - 5);

      var item = state.hotbar[k];
      if (item && ITEMS[item]) {
        ctx.fillStyle = 'rgba(200,220,255,0.85)';
        ctx.font = '10px "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(ITEMS[item].name.slice(0, 3), bx + (slot - 4) / 2, sy + 22);
        var cnt = state.inv[item] || 0;
        if (cnt > 0) {
          ctx.fillStyle = '#fff';
          ctx.font = '10px sans-serif';
          ctx.textAlign = 'right';
          ctx.fillText(String(cnt), bx + slot - 8, sy + slot - 10);
        }
      }
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(String((k + 1) % 10), bx + 3, sy + 11);
    }

    // 背包提示
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '11px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('E 背包/合成   H 帮助', 16, VIEW_H - 18);
  }

  function drawMessages(state) {
    ctx.font = '12px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left';
    for (var i = 0; i < state.messages.length; i++) {
      var m = state.messages[i];
      var age = state.time - m.t;
      var alpha = Math.max(0, 1 - age / 4);
      ctx.fillStyle = 'rgba(0,0,0,' + alpha * 0.4 + ')';
      var w = ctx.measureText(m.text).width + 16;
      ctx.fillRect(16, 78 + i * 22, w, 18);
      ctx.fillStyle = 'rgba(255,255,255,' + alpha + ')';
      ctx.fillText(m.text, 24, 91 + i * 22);
    }
  }

  function drawHelp() {
    var w = 420;
    var h = 260;
    var x = (VIEW_W - w) / 2;
    var y = (VIEW_H - h) / 2;
    ctx.fillStyle = 'rgba(8,10,18,0.92)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    ctx.fillStyle = '#ffd75e';
    ctx.font = 'bold 16px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('操作说明', x + 20, y + 32);

    var lines = [
      'A / D        左右移动',
      '空格 / W     跳跃',
      '鼠标左键     挖掘 / 放置 / 攻击（取决于手持物）',
      '1~0 / 滚轮   切换快捷栏',
      'E            背包与合成（在工作台旁可合成高级装备）',
      'H            关闭本帮助',
      '',
      '提示：先用木材合成工作台并放置，靠近它才能合成石镐。'
    ];
    ctx.font = '13px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = 'rgba(230,238,250,0.9)';
    for (var i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], x + 20, y + 62 + i * 22);
    }
  }

  /* ============================================================
   * 13. 输入
   * ============================================================ */

  var input = {
    left: false,
    right: false,
    jump: false,
    mouseDown: false,
    tx: 0,
    ty: 0
  };

  function bindInput(state) {
    global.addEventListener('keydown', function (e) {
      var k = e.key.toLowerCase();
      if (k === 'a' || k === 'arrowleft') input.left = true;
      if (k === 'd' || k === 'arrowright') input.right = true;
      if (k === ' ' || k === 'w' || k === 'arrowup') { input.jump = true; e.preventDefault(); }
      if (k === 'h') state.helpOpen = !state.helpOpen;
      if (k === 'e') toggleCraft(state);
      if (k >= '0' && k <= '9') {
        state.hotIndex = (parseInt(k, 10) + 9) % 10;
      }
    });

    global.addEventListener('keyup', function (e) {
      var k = e.key.toLowerCase();
      if (k === 'a' || k === 'arrowleft') input.left = false;
      if (k === 'd' || k === 'arrowright') input.right = false;
      if (k === ' ' || k === 'w' || k === 'arrowup') input.jump = false;
    });

    canvas.addEventListener('mousedown', function () { input.mouseDown = true; });
    global.addEventListener('mouseup', function () { input.mouseDown = false; });
    canvas.addEventListener('mousemove', function (e) {
      var r = canvas.getBoundingClientRect();
      var p = state.player;
      var camX = Math.round(p.x + p.w / 2 - VIEW_W / 2);
      var camY = Math.round(p.y + p.h / 2 - VIEW_H / 2);
      if (camX < 0) camX = 0;
      if (camY < 0) camY = 0;
      if (camX > WORLD_W * TILE - VIEW_W) camX = WORLD_W * TILE - VIEW_W;
      if (camY > WORLD_H * TILE - VIEW_H) camY = WORLD_H * TILE - VIEW_H;
      input.tx = Math.floor((e.clientX - r.left + camX) / TILE);
      input.ty = Math.floor((e.clientY - r.top + camY) / TILE);
    });
    canvas.addEventListener('wheel', function (e) {
      state.hotIndex = (state.hotIndex + (e.deltaY > 0 ? 1 : 9)) % 10;
      e.preventDefault();
    }, { passive: false });
  }

  // 简易合成界面：按顺序尝试可合成的高级物品（教学版，不做完整 GUI）
  function toggleCraft(state) {
    var order = ['table', 'woodPick', 'stonePick', 'ironPick', 'goldPick', 'woodSword', 'stoneSword', 'ironSword', 'goldSword', 'torch', 'plank'];
    for (var i = 0; i < order.length; i++) {
      var r = null;
      for (var j = 0; j < RECIPES.length; j++) {
        if (RECIPES[j].id === order[i]) { r = RECIPES[j]; break; }
      }
      if (r && canCraft(state, r)) {
        craft(state, r.id);
        return;
      }
    }
    addMessage(state, '材料不足，或需要靠近工作台');
  }

  /* ============================================================
   * 14. 主循环
   * ============================================================ */

  var lastTs = 0;

  function loop(ts) {
    if (!lastTs) lastTs = ts;
    var dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (dt > 0.05) dt = 0.05;   // 防止切后台后大跳
    update(STATE, dt, input);
    render(STATE);
    global.requestAnimationFrame(loop);
  }

  /* ============================================================
   * 15. 启动
   * ============================================================ */

  var STATE = createState(7);

  // 供测试与外部驱动的 API
  global.__game = {
    T: T,
    TILE: TILE,
    WORLD_W: WORLD_W,
    WORLD_H: WORLD_H,
    DAY_LENGTH: DAY_LENGTH,
    ITEMS: ITEMS,
    RECIPES: RECIPES,
    getState: function () { return STATE; },
    reset: function (seed) { STATE = createState(seed || 7); return STATE; },
    update: function (dt, inp) { update(STATE, dt, inp || {}); },
    render: function () { render(STATE); },
    craft: function (id) { return craft(STATE, id); },
    canCraft: function (id) {
      for (var i = 0; i < RECIPES.length; i++) {
        if (RECIPES[i].id === id) return canCraft(STATE, RECIPES[i]);
      }
      return false;
    },
    mine: function (tx, ty, dt) { mineAt(STATE, tx, ty, dt || 1); },
    place: function (tx, ty) { return placeAt(STATE, tx, ty); },
    spawnZombie: function () { spawnZombie(STATE); },
    skyLight: function () { return skyLight(STATE); },
    isNight: function () { return isNight(STATE); },
    tileAt: function (tx, ty) { return tileAt(STATE.world, tx, ty); },
    nearTable: function () { return nearTable(STATE); }
  };

  if (!HEADLESS) {
    if (initCanvas()) {
      bindInput(STATE);
      global.requestAnimationFrame(loop);
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
