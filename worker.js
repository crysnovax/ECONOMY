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
    status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
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
  if (existing) return errorResponse('Already activated!');
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

// ==================== PAY ====================
async function handlePay(env, senderPhone, targetPhone, amount) {
  if (amount <= 0) return errorResponse('Amount must be positive');
  if (senderPhone === targetPhone) return errorResponse('Cannot pay yourself');
  const sender = await getOrCreateUser(env, senderPhone);
  if (sender.balance < amount) return errorResponse('Insufficient funds');
  const target = await getUser(env, targetPhone);
  if (!target) return errorResponse('Recipient not activated yet!');
  sender.balance -= amount;
  await saveUser(env, senderPhone, sender);
  target.balance += amount;
  await saveUser(env, targetPhone, target);
  return jsonResponse({ senderBalance: sender.balance, message: `Sent ${amount} coins!` });
}

// ==================== ROB ====================
async function handleRob(env, robberPhone, targetPhone) {
  if (robberPhone === targetPhone) return errorResponse('Cannot rob yourself');
  const robber = await getOrCreateUser(env, robberPhone);
  const target = await getUser(env, targetPhone);
  if (!target) return errorResponse('Target not in economy!');
  const now = Date.now();
  if (now - robber.lastRob < COOLDOWNS.rob) {
    const remaining = Math.ceil((COOLDOWNS.rob - (now - robber.lastRob)) / 60000);
    return errorResponse(`Cooldown: ${remaining} minute(s)`);
  }
  if (target.balance <= 0) return errorResponse('Target is broke!');
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

// ==================== ATTACK ====================
async function handleAttack(env, attackerPhone, targetPhone) {
  if (attackerPhone === targetPhone) return errorResponse('Cannot attack yourself');
  const attacker = await getOrCreateUser(env, attackerPhone);
  const target = await getUser(env, targetPhone);
  if (!target) return errorResponse('Target not in economy!');
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

// ==================== GIFT ====================
async function handleGift(env, senderPhone, targetPhone, amount) {
  if (amount <= 0) return errorResponse('Amount must be positive');
  if (senderPhone === targetPhone) return errorResponse('Cannot gift yourself');
  const sender = await getOrCreateUser(env, senderPhone);
  if (sender.balance < amount) return errorResponse('Insufficient funds');
  const target = await getUser(env, targetPhone);
  if (!target) return errorResponse('Recipient not activated!');
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

// ==================== FRONTEND ====================
const LANDING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🏦 CRYSNOVA Economy API</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#0a0f0a;min-height:100vh;font-family:'Inter',system-ui,sans-serif;color:#d4edda;padding:2rem 1rem;position:relative;overflow-x:hidden}
    .container{max-width:1200px;margin:0 auto;position:relative;z-index:2}
    .header{text-align:center;margin-bottom:3rem;backdrop-filter:blur(8px);background:rgba(10,30,10,0.5);border:1px solid rgba(16,185,129,0.3);border-radius:40px;padding:2.5rem 2rem}
    h1{font-size:3.5rem;font-weight:700;background:linear-gradient(135deg,#10b981 0%,#34d399 50%,#6ee7b7 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .subtitle{font-size:1.2rem;color:#86c9a0;margin:1rem 0}
    .powered-by{display:inline-block;background:rgba(16,185,129,0.15);border:1px solid #10b981;padding:6px 20px;border-radius:40px;font-size:0.9rem;margin-bottom:1rem}
    .pulse-dot{width:12px;height:12px;background:#10b981;border-radius:50%;box-shadow:0 0 15px #10b981;animation:pulse 2s infinite;display:inline-block;margin-right:8px}
    @keyframes pulse{0%{opacity:1;transform:scale(1)}50%{opacity:0.6;transform:scale(1.2)}100%{opacity:1;transform:scale(1)}}
    .stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:15px;margin-bottom:2rem}
    .stat-card{background:rgba(10,30,10,0.6);border:1px solid rgba(16,185,129,0.2);border-radius:20px;padding:1.5rem;text-align:center;backdrop-filter:blur(8px)}
    .stat-card:hover{border-color:#10b981;transform:translateY(-3px);transition:all 0.3s}
    .stat-number{font-size:2rem;font-weight:700;color:#10b981}
    .stat-label{color:#86c9a0;font-size:0.9rem;margin-top:0.5rem}
    .section{margin-bottom:2rem}
    .section-title{font-size:1.3rem;color:#10b981;border-bottom:1px solid rgba(16,185,129,0.3);padding-bottom:0.5rem;margin-bottom:1rem}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
    .card{background:rgba(10,30,10,0.6);border:1px solid rgba(16,185,129,0.2);border-radius:12px;padding:1rem;transition:all 0.3s}
    .card:hover{border-color:#10b981;transform:translateY(-2px)}
    .method{background:#10b981;color:#0a0f0a;font-weight:600;padding:2px 8px;border-radius:8px;font-size:0.7rem;margin-right:8px}
    .path{font-family:monospace;color:#34d399;font-size:0.85rem}
    .desc{color:#86c9a0;font-size:0.8rem;margin-top:6px}
    .admin-link{text-align:center;margin:2rem 0}
    .admin-link a{color:#10b981;border:1px solid #10b981;padding:10px 24px;border-radius:30px;text-decoration:none;transition:all 0.2s}
    .admin-link a:hover{background:#10b981;color:#0a0f0a}
    .footer{text-align:center;color:#5a8a6a;margin-top:3rem;border-top:1px solid rgba(16,185,129,0.2);padding-top:2rem;font-size:0.9rem}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🏦 CRYSN⎔VA Economy</h1>
      <div class="powered-by">💰 REALISTIC VIRTUAL ECONOMY ENGINE 💰</div>
      <div class="subtitle">27+ Endpoints • Phone-Based Storage • 1-Min Cooldowns</div>
      <div style="display:inline-flex;align-items:center;background:rgba(10,30,10,0.5);border:1px solid #10b981;padding:8px 20px;border-radius:40px;font-size:0.95rem"><span class="pulse-dot"></span>🌐 System Operational</div>
    </div>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-number" id="totalUsers">—</div><div class="stat-label">👥 Total Users</div></div>
      <div class="stat-card"><div class="stat-number" id="totalMoney">—</div><div class="stat-label">💰 In Circulation</div></div>
      <div class="stat-card"><div class="stat-number" id="richestUser">—</div><div class="stat-label">🏆 Richest</div></div>
      <div class="stat-card"><div class="stat-number">🟢</div><div class="stat-label">📡 API Status</div></div>
    </div>
    <div class="section"><div class="section-title">🏦 Banking <span style="color:#10b981;font-size:0.8rem">(5 endpoints)</span></div><div class="grid"><div class="card"><span class="method">GET</span><span class="path">/balance</span><div class="desc">Check wallet & bank</div></div><div class="card"><span class="method">POST</span><span class="path">/activate</span><div class="desc">Activate account</div></div><div class="card"><span class="method">POST</span><span class="path">/deposit</span><div class="desc">Deposit to bank</div></div><div class="card"><span class="method">POST</span><span class="path">/withdraw</span><div class="desc">Withdraw from bank</div></div><div class="card"><span class="method">POST</span><span class="path">/loan</span><div class="desc">Get a loan</div></div></div></div>
    <div class="section"><div class="section-title">💸 Transfers <span style="color:#10b981;font-size:0.8rem">(4 endpoints)</span></div><div class="grid"><div class="card"><span class="method">POST</span><span class="path">/pay</span><div class="desc">Pay someone</div></div><div class="card"><span class="method">POST</span><span class="path">/rob</span><div class="desc">Rob someone</div></div><div class="card"><span class="method">POST</span><span class="path">/attack</span><div class="desc">Attack someone</div></div><div class="card"><span class="method">POST</span><span class="path">/gift</span><div class="desc">Gift coins</div></div></div></div>
    <div class="section"><div class="section-title">💼 Jobs <span style="color:#10b981;font-size:0.8rem">(7 endpoints)</span></div><div class="grid"><div class="card"><span class="method">POST</span><span class="path">/work</span><div class="desc">Work for coins</div></div><div class="card"><span class="method">POST</span><span class="path">/fish</span><div class="desc">Go fishing</div></div><div class="card"><span class="method">POST</span><span class="path">/mine</span><div class="desc">Mine ores</div></div><div class="card"><span class="method">POST</span><span class="path">/hunt</span><div class="desc">Hunt animals</div></div><div class="card"><span class="method">POST</span><span class="path">/beg</span><div class="desc">Beg for coins</div></div><div class="card"><span class="method">POST</span><span class="path">/daily</span><div class="desc">Daily reward</div></div><div class="card"><span class="method">POST</span><span class="path">/weekly</span><div class="desc">Weekly bonus</div></div></div></div>
    <div class="section"><div class="section-title">⚠️ Crime <span style="color:#10b981;font-size:0.8rem">(2 endpoints)</span></div><div class="grid"><div class="card"><span class="method">POST</span><span class="path">/crime</span><div class="desc">Commit a crime</div></div><div class="card"><span class="method">POST</span><span class="path">/drugs</span><div class="desc">Deal drugs</div></div></div></div>
    <div class="section"><div class="section-title">🎮 Progression <span style="color:#10b981;font-size:0.8rem">(6 endpoints)</span></div><div class="grid"><div class="card"><span class="method">POST</span><span class="path">/training</span><div class="desc">Train stats</div></div><div class="card"><span class="method">POST</span><span class="path">/levelup</span><div class="desc">Level up</div></div><div class="card"><span class="method">POST</span><span class="path">/travel</span><div class="desc">Travel</div></div><div class="card"><span class="method">POST</span><span class="path">/faction</span><div class="desc">Join faction</div></div><div class="card"><span class="method">GET</span><span class="path">/profile</span><div class="desc">View profile</div></div><div class="card"><span class="method">GET</span><span class="path">/inventory</span><div class="desc">View backpack</div></div></div></div>
    <div class="section"><div class="section-title">🛍️ Shop <span style="color:#10b981;font-size:0.8rem">(3 endpoints)</span></div><div class="grid"><div class="card"><span class="method">GET</span><span class="path">/shop</span><div class="desc">View items</div></div><div class="card"><span class="method">POST</span><span class="path">/buy</span><div class="desc">Buy item</div></div><div class="card"><span class="method">POST</span><span class="path">/sell</span><div class="desc">Sell item</div></div></div></div>
    <div class="admin-link"><a href="/admin">🔐 Admin Dashboard</a></div>
    <div class="footer">🏦 CRYSN⚉VA Economy • Realistic Virtual Economy Engine • © 2026</div>
  </div>
  <script>
    async function loadStats(){try{const r=await fetch('/admin/stats');const d=await r.json();document.getElementById('totalUsers').textContent=d.totalUsers||0;document.getElementById('totalMoney').textContent=(d.totalMoneyInCirculation||0).toLocaleString();document.getElementById('richestUser').textContent=d.richestUser?d.richestUser.total.toLocaleString():'—'}catch(e){}}
    loadStats();
  </script>
</body>
</html>`;

const ADMIN_LOGIN_HTML = `<!DOCTYPE html><html><head><title>🔐 Admin Login</title><style>body{background:#0a0f0a;color:#d4edda;font-family:'Inter';display:flex;justify-content:center;align-items:center;height:100vh}.box{background:rgba(10,30,10,0.8);border:1px solid #10b981;padding:2rem;border-radius:20px;text-align:center;width:350px}h2{color:#10b981}input{background:#0a1a0a;border:1px solid #10b981;color:#d4edda;padding:0.8rem;border-radius:10px;width:100%;margin:1rem 0}button{background:#10b981;color:#0a0f0a;border:none;padding:0.8rem 2rem;border-radius:30px;cursor:pointer;font-weight:bold}#error{color:#ef4444;margin-top:0.5rem}</style></head><body><div class="box"><h2>🔐 Admin Login</h2><input type="password" id="pwd" placeholder="Admin Password"><button onclick="login()">Login</button><p id="error"></p></div><script>async function login(){const p=document.getElementById('pwd').value;const r=await fetch('/admin/stats',{headers:{'X-Admin-Key':p}});if(r.ok){localStorage.setItem('ak',p);window.location.href='/admin/dashboard'}else document.getElementById('error').textContent='Wrong password'}</script></body></html>`;

const ADMIN_DASHBOARD_HTML = `<!DOCTYPE html><html><head><title>🏦 Admin Dashboard</title><style>body{background:#0a0f0a;color:#d4edda;font-family:'Inter';padding:1rem}.container{max-width:1000px;margin:0 auto}h1{color:#10b981}.card{background:rgba(10,30,10,0.6);border:1px solid rgba(16,185,129,0.2);border-radius:15px;padding:1rem;margin:1rem 0}table{width:100%;border-collapse:collapse;font-size:0.9rem}th,td{padding:0.5rem;border-bottom:1px solid rgba(16,185,129,0.2);text-align:left}th{background:rgba(16,185,129,0.1);color:#10b981}input,button{background:#0a1a0a;border:1px solid #10b981;color:#d4edda;padding:0.5rem;border-radius:8px;margin:0.2rem}button{background:#10b981;color:#0a0f0a;cursor:pointer;font-weight:bold}#resetBtn{background:#ef4444}.actions{display:flex;gap:1rem;flex-wrap:wrap;margin:1rem 0}</style></head><body><div class="container"><h1>🏦 Admin Dashboard</h1><div class="card"><h2>💰 Manage Money</h2><div class="actions"><input id="phoneInput" placeholder="Phone (e.g. 2348077528901)"><input id="amountInput" type="number" placeholder="Amount"><button onclick="addMoney()">➕ Add</button><button onclick="removeMoney()">➖ Remove</button><button id="resetBtn" onclick="resetEconomy()">💣 Reset All</button></div><p style="font-size:0.8rem;color:#86c9a0;margin-top:0.5rem">💡 Just enter phone number — auto-converts!</p></div><div class="card"><h2>👥 Users</h2><table id="usersTable"><tr><th>Phone</th><th>Balance</th><th>Bank</th><th>Level</th><th>Loan</th></tr></table></div></div><script>const ak=localStorage.getItem('ak');if(!ak)window.location.href='/admin';async function api(u,m='GET',b=null){const h={'X-Admin-Key':ak};if(b)h['Content-Type']='application/json';const r=await fetch(u,{method:m,headers:h,body:b?JSON.stringify(b):undefined});return r.json()}async function load(){const d=await api('/admin/stats');const t=document.getElementById('usersTable');t.innerHTML='<tr><th>Phone</th><th>Balance</th><th>Bank</th><th>Level</th><th>Loan</th></tr>';if(d.users)d.users.forEach(u=>{const r=t.insertRow();r.innerHTML=\`<td>\${u.phone}</td><td>💰 \${(u.balance||0).toLocaleString()}</td><td>🏦 \${(u.bank||0).toLocaleString()}</td><td>⭐ \${u.level||1}</td><td>💳 \${u.loan||0}</td>\`})}async function addMoney(){const p=document.getElementById('phoneInput').value;const a=parseInt(document.getElementById('amountInput').value);if(p&&a){await api('/admin/add-money','POST',{phone:p,amount:a});load()}}async function removeMoney(){const p=document.getElementById('phoneInput').value;const a=parseInt(document.getElementById('amountInput').value);if(p&&a){await api('/admin/remove-money','POST',{phone:p,amount:a});load()}}async function resetEconomy(){if(confirm('Reset ALL data?')){await api('/admin/reset','POST');load()}}load();</script></body></html>`;

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

    // Frontend pages
    if (method === 'GET' && (path === '/' || path === '')) return new Response(LANDING_HTML, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
    if (method === 'GET' && path === '/admin') return new Response(ADMIN_LOGIN_HTML, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
    if (method === 'GET' && path === '/admin/dashboard') return new Response(ADMIN_DASHBOARD_HTML, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });

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
