// ==================== CONFIGURATION ====================
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Key, X-User-Phone',
};

const DEFAULT_USER = {
  phone: '',
  balance: 100,
  bank: 0,
  level: 1,
  xp: 0,
  inventory: [],
  lastDaily: 0, lastWeekly: 0, lastWork: 0, lastRob: 0,
  lastFish: 0, lastMine: 0, lastHunt: 0, lastCrime: 0,
  lastBeg: 0, lastAttack: 0, lastDrugs: 0, lastTravel: 0, lastTraining: 0,
  loanAmount: 0, loanDue: 0,
  training: { strength: 0, luck: 0, intelligence: 0 },
  travel: { destination: null, returnTime: 0 },
  faction: null
};

// ✅ SHORT COOLDOWNS — 1 MINUTE EACH
const COOLDOWNS = {
  rob: 60000, work: 60000, fish: 60000, mine: 60000,
  hunt: 60000, crime: 60000, beg: 60000, attack: 60000,
  drugs: 60000, travel: 60000, training: 60000,
  daily: 86400000, weekly: 604800000
};

const SHOP_ITEMS = [
  { id: 'pickaxe', name: 'Pickaxe', price: 200, description: 'Boost mining yield' },
  { id: 'fishing_rod', name: 'Fishing Rod', price: 150, description: 'Better fishing' },
  { id: 'weapon', name: 'Weapon', price: 300, description: 'Boost robbery' },
  { id: 'armor', name: 'Armor', price: 250, description: 'Reduce damage' },
  { id: 'lucky_charm', name: 'Lucky Charm', price: 100, description: 'Boost luck' }
];

// ==================== HELPERS ====================
function phoneKey(phone) {
  return 'phone:' + String(phone).replace(/[^0-9]/g, '');
}

async function getUser(env, phone) {
  const key = phoneKey(phone);
  const data = await env.ECONOMY_KV.get(key);
  return data ? JSON.parse(data) : null;
}

async function saveUser(env, phone, user) {
  const key = phoneKey(phone);
  await env.ECONOMY_KV.put(key, JSON.stringify(user));
}

async function getOrCreateUser(env, phone) {
  let user = await getUser(env, phone);
  if (!user) {
    user = JSON.parse(JSON.stringify(DEFAULT_USER));
    user.phone = String(phone).replace(/[^0-9]/g, '');
    await saveUser(env, phone, user);
  }
  return user;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, status);
}

// ==================== ACTIVATION ====================
async function handleActivate(env, phone) {
  const clean = String(phone).replace(/[^0-9]/g, '');
  if (clean.length < 7) return errorResponse('Invalid phone number');
  const existing = await getUser(env, clean);
  if (existing) return errorResponse('Already activated! Use .balance to check.');
  const user = JSON.parse(JSON.stringify(DEFAULT_USER));
  user.phone = clean;
  await saveUser(env, clean, user);
  return jsonResponse({ message: 'Activated!', balance: user.balance, bank: user.bank });
}

// ==================== BALANCE ====================
async function handleBalance(env, phone) {
  const user = await getOrCreateUser(env, phone);
  return jsonResponse({ balance: user.balance, bank: user.bank, level: user.level });
}

// ==================== DEPOSIT ====================
async function handleDeposit(env, phone, amount) {
  if (amount <= 0) return errorResponse('Amount must be positive');
  const user = await getOrCreateUser(env, phone);
  if (user.balance < amount) return errorResponse('Insufficient wallet');
  user.balance -= amount;
  user.bank += amount;
  await saveUser(env, phone, user);
  return jsonResponse({ balance: user.balance, bank: user.bank });
}

// ==================== WITHDRAW ====================
async function handleWithdraw(env, phone, amount) {
  if (amount <= 0) return errorResponse('Amount must be positive');
  const user = await getOrCreateUser(env, phone);
  if (user.bank < amount) return errorResponse('Insufficient bank');
  user.bank -= amount;
  user.balance += amount;
  await saveUser(env, phone, user);
  return jsonResponse({ balance: user.balance, bank: user.bank });
}

// ==================== PAY (PHONE TO PHONE) ====================
async function handlePay(env, senderPhone, targetPhone, amount) {
  if (amount <= 0) return errorResponse('Amount must be positive');
  if (senderPhone === targetPhone) return errorResponse('Cannot pay yourself');
  const sender = await getOrCreateUser(env, senderPhone);
  if (sender.balance < amount) return errorResponse('Insufficient funds');
  const target = await getUser(env, targetPhone);
  if (!target) return errorResponse('This person has not activated economy yet!');
  sender.balance -= amount;
  await saveUser(env, senderPhone, sender);
  target.balance += amount;
  await saveUser(env, targetPhone, target);
  return jsonResponse({ senderBalance: sender.balance, message: `Sent ${amount} coins!` });
}

// ==================== ROB (PHONE TO PHONE) ====================
async function handleRob(env, robberPhone, targetPhone) {
  if (robberPhone === targetPhone) return errorResponse('Cannot rob yourself');
  const robber = await getOrCreateUser(env, robberPhone);
  const target = await getUser(env, targetPhone);
  if (!target) return errorResponse('This person is not in the economy yet!');
  const now = Date.now();
  if (now - robber.lastRob < COOLDOWNS.rob) {
    const remaining = Math.ceil((COOLDOWNS.rob - (now - robber.lastRob)) / 60000);
    return errorResponse(`Cooldown: ${remaining} minute(s). Relax!`);
  }
  if (target.balance <= 0) return errorResponse('Target has no money. Too poor!');
  const successChance = 0.4 + (robber.level - target.level) * 0.02;
  const success = Math.random() < successChance;
  robber.lastRob = now;
  if (success) {
    const stolen = Math.floor(Math.random() * target.balance * 0.3) + 1;
    target.balance -= stolen;
    await saveUser(env, targetPhone, target);
    robber.balance += stolen;
    await saveUser(env, robberPhone, robber);
    return jsonResponse({ success: true, stolen, newBalance: robber.balance });
  } else {
    const penalty = 50;
    robber.balance = Math.max(0, robber.balance - penalty);
    await saveUser(env, robberPhone, robber);
    return jsonResponse({ success: false, message: `Caught! Lost ${penalty} coins.` });
  }
}

// ==================== ATTACK (PHONE TO PHONE) ====================
async function handleAttack(env, attackerPhone, targetPhone) {
  if (attackerPhone === targetPhone) return errorResponse('Cannot attack yourself');
  const attacker = await getOrCreateUser(env, attackerPhone);
  const target = await getUser(env, targetPhone);
  if (!target) return errorResponse('This person is not in the economy!');
  const now = Date.now();
  if (now - attacker.lastAttack < COOLDOWNS.attack) {
    const remaining = Math.ceil((COOLDOWNS.attack - (now - attacker.lastAttack)) / 60000);
    return errorResponse(`Cooldown: ${remaining} minute(s)`);
  }
  const strengthDiff = (attacker.training.strength || 0) - (target.training.strength || 0);
  const winChance = 0.5 + strengthDiff * 0.05;
  const win = Math.random() < winChance;
  attacker.lastAttack = now;
  if (win) {
    const stolen = Math.floor(Math.random() * 30) + 10;
    target.balance = Math.max(0, target.balance - stolen);
    await saveUser(env, targetPhone, target);
    attacker.balance += stolen;
    await saveUser(env, attackerPhone, attacker);
    return jsonResponse({ win: true, stolen });
  } else {
    attacker.balance = Math.max(0, attacker.balance - 30);
    await saveUser(env, attackerPhone, attacker);
    return jsonResponse({ win: false, message: 'You lost the fight!' });
  }
}

// ==================== GIFT (PHONE TO PHONE) ====================
async function handleGift(env, senderPhone, targetPhone, amount) {
  if (amount <= 0) return errorResponse('Amount must be positive');
  if (senderPhone === targetPhone) return errorResponse('Cannot gift yourself');
  const sender = await getOrCreateUser(env, senderPhone);
  if (sender.balance < amount) return errorResponse('Insufficient funds');
  const target = await getUser(env, targetPhone);
  if (!target) return errorResponse('This person has not activated economy!');
  sender.balance -= amount;
  await saveUser(env, senderPhone, sender);
  target.balance += amount;
  await saveUser(env, targetPhone, target);
  return jsonResponse({ message: `Gifted ${amount} coins!` });
}

// ==================== WORK ====================
async function handleWork(env, phone) {
  const user = await getOrCreateUser(env, phone);
  const now = Date.now();
  if (now - user.lastWork < COOLDOWNS.work) {
    const remaining = Math.ceil((COOLDOWNS.work - (now - user.lastWork)) / 60000);
    return errorResponse(`Cooldown: ${remaining} minute(s)`);
  }
  const earnings = Math.floor(Math.random() * 40) + 10;
  user.balance += earnings;
  user.xp += 10;
  user.lastWork = now;
  const xpNeeded = user.level * 100;
  if (user.xp >= xpNeeded) { user.xp -= xpNeeded; user.level++; }
  await saveUser(env, phone, user);
  return jsonResponse({ earnings, newBalance: user.balance, level: user.level });
}

// ==================== FISH ====================
async function handleFish(env, phone) {
  const user = await getOrCreateUser(env, phone);
  const now = Date.now();
  if (now - user.lastFish < COOLDOWNS.fish) {
    const remaining = Math.ceil((COOLDOWNS.fish - (now - user.lastFish)) / 1000);
    return errorResponse(`Cooldown: ${remaining} seconds`);
  }
  user.lastFish = now;
  const rewards = [{ name: 'Old Boot', value: 5 }, { name: 'Salmon', value: 20 }, { name: 'Tuna', value: 50 }, { name: 'Golden Fish', value: 200 }];
  const reward = rewards[Math.floor(Math.random() * rewards.length)];
  user.balance += reward.value;
  await saveUser(env, phone, user);
  return jsonResponse({ item: reward.name, reward: reward.value });
}

// ==================== MINE ====================
async function handleMine(env, phone) {
  const user = await getOrCreateUser(env, phone);
  const now = Date.now();
  if (now - user.lastMine < COOLDOWNS.mine) return errorResponse('Cooldown: 1 minute');
  user.lastMine = now;
  const ores = [{ name: 'Stone', value: 5 }, { name: 'Iron', value: 20 }, { name: 'Gold', value: 50 }, { name: 'Diamond', value: 150 }];
  const ore = ores[Math.floor(Math.random() * ores.length)];
  user.balance += ore.value;
  user.inventory.push({ id: ore.name.toLowerCase(), name: ore.name, quantity: 1 });
  await saveUser(env, phone, user);
  return jsonResponse({ ore: ore.name, reward: ore.value });
}

// ==================== HUNT ====================
async function handleHunt(env, phone) {
  const user = await getOrCreateUser(env, phone);
  const now = Date.now();
  if (now - user.lastHunt < COOLDOWNS.hunt) return errorResponse('Cooldown: 1 minute');
  user.lastHunt = now;
  const animals = [{ name: 'Rabbit', value: 15 }, { name: 'Deer', value: 40 }, { name: 'Bear', value: 100 }];
  const animal = animals[Math.floor(Math.random() * animals.length)];
  user.balance += animal.value;
  user.inventory.push({ id: animal.name.toLowerCase(), name: animal.name, quantity: 1 });
  await saveUser(env, phone, user);
  return jsonResponse({ animal: animal.name, reward: animal.value });
}

// ==================== BEG ====================
async function handleBeg(env, phone) {
  const user = await getOrCreateUser(env, phone);
  const now = Date.now();
  if (now - user.lastBeg < COOLDOWNS.beg) return errorResponse('Cooldown: 1 minute');
  const amount = Math.floor(Math.random() * 20) + 1;
  user.balance += amount;
  user.lastBeg = now;
  await saveUser(env, phone, user);
  return jsonResponse({ reward: amount });
}

// ==================== CRIME ====================
async function handleCrime(env, phone) {
  const user = await getOrCreateUser(env, phone);
  const now = Date.now();
  if (now - user.lastCrime < COOLDOWNS.crime) return errorResponse('Cooldown: 1 minute');
  user.lastCrime = now;
  const caught = Math.random() < 0.3;
  if (caught) { user.balance = Math.max(0, user.balance - 100); await saveUser(env, phone, user); return jsonResponse({ success: false, message: 'Caught! Lost 100 coins.' }); }
  const reward = Math.floor(Math.random() * 200) + 50;
  user.balance += reward;
  await saveUser(env, phone, user);
  return jsonResponse({ success: true, reward });
}

// ==================== DRUGS ====================
async function handleDrugs(env, phone) {
  const user = await getOrCreateUser(env, phone);
  const now = Date.now();
  if (now - user.lastDrugs < COOLDOWNS.drugs) return errorResponse('Cooldown: 1 minute');
  user.lastDrugs = now;
  const busted = Math.random() < 0.4;
  if (busted) { user.balance = Math.max(0, user.balance - 200); await saveUser(env, phone, user); return jsonResponse({ success: false, message: 'Busted! Lost 200 coins.' }); }
  const profit = Math.floor(Math.random() * 500) + 100;
  user.balance += profit;
  await saveUser(env, phone, user);
  return jsonResponse({ success: true, profit });
}

// ==================== DAILY ====================
async function handleDaily(env, phone) {
  const user = await getOrCreateUser(env, phone);
  const now = Date.now();
  if (now - user.lastDaily < COOLDOWNS.daily) return errorResponse('Already claimed today!');
  user.balance += 500;
  user.lastDaily = now;
  await saveUser(env, phone, user);
  return jsonResponse({ reward: 500 });
}

// ==================== WEEKLY ====================
async function handleWeekly(env, phone) {
  const user = await getOrCreateUser(env, phone);
  const now = Date.now();
  if (now - user.lastWeekly < COOLDOWNS.weekly) return errorResponse('Already claimed this week!');
  user.balance += 2000;
  user.lastWeekly = now;
  await saveUser(env, phone, user);
  return jsonResponse({ reward: 2000 });
}

// ==================== LOAN ====================
async function handleLoan(env, phone, amount) {
  if (amount <= 0 || amount > 1000) return errorResponse('Loan: 1-1000 coins');
  const user = await getOrCreateUser(env, phone);
  if (user.loanAmount > 0) return errorResponse('Already have an outstanding loan');
  user.balance += amount;
  user.loanAmount = amount;
  user.loanDue = Date.now() + 86400000;
  await saveUser(env, phone, user);
  return jsonResponse({ loanAmount: amount });
}

// ==================== TRAINING ====================
async function handleTraining(env, phone, stat) {
  if (!['strength','luck','intelligence'].includes(stat)) return errorResponse('Invalid stat');
  const user = await getOrCreateUser(env, phone);
  const now = Date.now();
  if (now - user.lastTraining < COOLDOWNS.training) return errorResponse('Cooldown: 1 minute');
  if (user.balance < 50) return errorResponse('Training costs 50 coins');
  user.balance -= 50;
  user.training[stat] = (user.training[stat] || 0) + 1;
  user.lastTraining = now;
  await saveUser(env, phone, user);
  return jsonResponse({ message: `Trained ${stat}!`, stats: user.training });
}

// ==================== LEVEL UP ====================
async function handleLevelUp(env, phone) {
  const user = await getOrCreateUser(env, phone);
  const xpNeeded = user.level * 100;
  if (user.xp < xpNeeded) return errorResponse(`Need ${xpNeeded} XP`);
  user.xp -= xpNeeded;
  user.level++;
  await saveUser(env, phone, user);
  return jsonResponse({ level: user.level });
}

// ==================== INVENTORY, SHOP, BUY, SELL, PROFILE, TRAVEL, FACTION ====================
async function handleInventory(env, phone) { const u = await getOrCreateUser(env, phone); return jsonResponse({ inventory: u.inventory }); }
async function handleShop() { return jsonResponse({ shop: SHOP_ITEMS }); }

async function handleBuy(env, phone, itemId) {
  const item = SHOP_ITEMS.find(i => i.id === itemId);
  if (!item) return errorResponse('Item not found');
  const user = await getOrCreateUser(env, phone);
  if (user.balance < item.price) return errorResponse('Insufficient funds');
  user.balance -= item.price;
  const existing = user.inventory.find(i => i.id === item.id);
  if (existing) existing.quantity++; else user.inventory.push({ id: item.id, name: item.name, quantity: 1 });
  await saveUser(env, phone, user);
  return jsonResponse({ message: `Bought ${item.name}!` });
}

async function handleSell(env, phone, itemId) {
  const user = await getOrCreateUser(env, phone);
  const idx = user.inventory.findIndex(i => i.id === itemId);
  if (idx === -1) return errorResponse('Item not in inventory');
  const item = user.inventory[idx];
  const shopItem = SHOP_ITEMS.find(s => s.id === itemId);
  const sellPrice = shopItem ? Math.floor(shopItem.price * 0.6) : 10;
  user.balance += sellPrice;
  if (item.quantity > 1) item.quantity--; else user.inventory.splice(idx, 1);
  await saveUser(env, phone, user);
  return jsonResponse({ message: `Sold ${item.name} for ${sellPrice}` });
}

async function handleProfile(env, phone) {
  const u = await getOrCreateUser(env, phone);
  return jsonResponse({ balance: u.balance, bank: u.bank, level: u.level, xp: u.xp, stats: u.training, faction: u.faction, inventoryCount: u.inventory.length, loan: u.loanAmount });
}

async function handleTravel(env, phone, destinationId) {
  const dest = [{ id: 'city', name: 'City', cost: 50 }, { id: 'forest', name: 'Forest', cost: 30 }, { id: 'ocean', name: 'Ocean', cost: 40 }, { id: 'mountains', name: 'Mountains', cost: 60 }].find(d => d.id === destinationId);
  if (!dest) return errorResponse('Invalid destination');
  const user = await getOrCreateUser(env, phone);
  const now = Date.now();
  if (now - user.lastTravel < COOLDOWNS.travel) return errorResponse('Cooldown: 1 minute');
  if (user.balance < dest.cost) return errorResponse('Not enough money');
  user.balance -= dest.cost;
  user.travel = { destination: dest.id, returnTime: now + COOLDOWNS.travel };
  user.lastTravel = now;
  await saveUser(env, phone, user);
  return jsonResponse({ message: `Travelled to ${dest.name}!` });
}

async function handleFaction(env, phone, action, factionId) {
  const factions = [{ id: 'thieves', name: 'Thieves Guild' }, { id: 'hunters', name: 'Hunters Union' }, { id: 'miners', name: 'Miners Brotherhood' }];
  const user = await getOrCreateUser(env, phone);
  if (action === 'join') { const f = factions.find(x => x.id === factionId); if (!f) return errorResponse('Invalid faction'); user.faction = f.id; }
  else if (action === 'leave') { user.faction = null; }
  else return errorResponse('Action must be "join" or "leave"');
  await saveUser(env, phone, user);
  return jsonResponse({ faction: user.faction });
}

// ==================== ADMIN ====================
async function handleAdminStats(env) {
  try {
    const users = [];
    const list = await env.ECONOMY_KV.list({ prefix: 'phone:' });
    for (const k of list.keys) { const d = await env.ECONOMY_KV.get(k.name); if (d) users.push(JSON.parse(d)); }
    const totalUsers = users.length;
    const totalMoney = users.reduce((s, u) => s + u.balance + u.bank, 0);
    const richest = users.sort((a, b) => (b.balance + b.bank) - (a.balance + a.bank))[0];
    return jsonResponse({ totalUsers, totalMoneyInCirculation: totalMoney, richestUser: richest ? { phone: richest.phone, total: richest.balance + richest.bank } : null, users: users.map(u => ({ phone: u.phone, balance: u.balance, bank: u.bank, level: u.level })) });
  } catch { return jsonResponse({ totalUsers: 0, totalMoneyInCirculation: 0, users: [] }); }
}

async function handleAdminAddMoney(env, phone, amount) {
  const user = await getOrCreateUser(env, phone);
  user.balance += amount;
  await saveUser(env, phone, user);
  return jsonResponse({ message: `Added ${amount} to ${phone}` });
}

async function handleAdminRemoveMoney(env, phone, amount) {
  const user = await getOrCreateUser(env, phone);
  user.balance = Math.max(0, user.balance - amount);
  await saveUser(env, phone, user);
  return jsonResponse({ message: `Removed ${amount} from ${phone}` });
}

async function handleAdminReset(env) {
  try { const list = await env.ECONOMY_KV.list({ prefix: 'phone:' }); for (const k of list.keys) await env.ECONOMY_KV.delete(k.name); } catch(e) {}
  return jsonResponse({ message: 'Economy reset' });
}

// ==================== ROUTER ====================
const ROUTES = {
  'POST /activate': (env, p, b) => handleActivate(env, p),
  'GET /balance': (env, p) => handleBalance(env, p),
  'POST /deposit': (env, p, b) => handleDeposit(env, p, b.amount),
  'POST /withdraw': (env, p, b) => handleWithdraw(env, p, b.amount),
  'POST /pay': (env, p, b) => handlePay(env, p, b.to, b.amount),
  'POST /rob': (env, p, b) => handleRob(env, p, b.target),
  'POST /attack': (env, p, b) => handleAttack(env, p, b.target),
  'POST /gift': (env, p, b) => handleGift(env, p, b.to, b.amount),
  'POST /work': (env, p) => handleWork(env, p),
  'POST /fish': (env, p) => handleFish(env, p),
  'POST /mine': (env, p) => handleMine(env, p),
  'POST /hunt': (env, p) => handleHunt(env, p),
  'POST /beg': (env, p) => handleBeg(env, p),
  'POST /crime': (env, p) => handleCrime(env, p),
  'POST /drugs': (env, p) => handleDrugs(env, p),
  'POST /daily': (env, p) => handleDaily(env, p),
  'POST /weekly': (env, p) => handleWeekly(env, p),
  'POST /loan': (env, p, b) => handleLoan(env, p, b.amount),
  'POST /training': (env, p, b) => handleTraining(env, p, b.stat),
  'POST /levelup': (env, p) => handleLevelUp(env, p),
  'GET /inventory': (env, p) => handleInventory(env, p),
  'GET /shop': (env) => handleShop(),
  'POST /buy': (env, p, b) => handleBuy(env, p, b.item),
  'POST /sell': (env, p, b) => handleSell(env, p, b.item),
  'GET /profile': (env, p) => handleProfile(env, p),
  'POST /travel': (env, p, b) => handleTravel(env, p, b.destination),
  'POST /faction': (env, p, b) => handleFaction(env, p, b.action, b.faction),
  'GET /admin/stats': async (e, r) => r.headers.get('X-Admin-Key') === e.ADMIN_PASSWORD ? handleAdminStats(e) : errorResponse('Unauthorized', 401),
  'POST /admin/add-money': async (e, r) => { if (r.headers.get('X-Admin-Key') !== e.ADMIN_PASSWORD) return errorResponse('Unauthorized', 401); const b = await r.json(); return handleAdminAddMoney(e, b.phone, b.amount); },
  'POST /admin/remove-money': async (e, r) => { if (r.headers.get('X-Admin-Key') !== e.ADMIN_PASSWORD) return errorResponse('Unauthorized', 401); const b = await r.json(); return handleAdminRemoveMoney(e, b.phone, b.amount); },
  'POST /admin/reset': async (e, r) => r.headers.get('X-Admin-Key') === e.ADMIN_PASSWORD ? handleAdminReset(e) : errorResponse('Unauthorized', 401),
};

// ==================== MAIN ====================
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'GET' && path === '/') {
      return new Response(`<!DOCTYPE html><html><head><title>🏦 CRYSNOVA Economy</title><style>body{background:#0a0f0a;color:#10b981;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}h1{font-size:3rem}</style></head><body><div style="text-align:center"><h1>🏦 CRYSNOVA Economy</h1><p>API is running. Use the bot commands!</p></div></body></html>`, { headers: { 'Content-Type': 'text/html' } });
    }

    const phone = request.headers.get('X-User-Phone') || 'default';
    let body = {};
    if (method === 'POST') { try { body = await request.json(); } catch(e) {} }

    if (path.startsWith('/admin/')) {
      const h = ROUTES[`${method} ${path}`];
      return h ? h(env, request) : errorResponse('Not found', 404);
    }

    const h = ROUTES[`${method} ${path}`];
    if (!h) return errorResponse('Not found', 404);
    try { return await h(env, phone, body); } catch (err) { console.error(err); return errorResponse('Internal error', 500); }
  }
};