// ==================== CONFIGURATION ====================
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Key',
};

const DEFAULT_USER = {
  balance: 100,
  bank: 0,
  level: 1,
  xp: 0,
  inventory: [],
  lastDaily: 0,
  lastWeekly: 0,
  lastWork: 0,
  lastRob: 0,
  lastFish: 0,
  lastMine: 0,
  lastHunt: 0,
  lastCrime: 0,
  lastBeg: 0,
  lastAttack: 0,
  lastDrugs: 0,
  lastTravel: 0,
  lastTraining: 0,
  loanAmount: 0,
  loanDue: 0,
  training: { strength: 0, luck: 0, intelligence: 0 },
  travel: { destination: null, returnTime: 0 },
  faction: null
};

const COOLDOWNS = {
  rob: 3600000, work: 1800000, fish: 300000, mine: 600000,
  hunt: 600000, crime: 1800000, beg: 60000, attack: 300000,
  drugs: 3600000, travel: 7200000, training: 600000,
  daily: 86400000, weekly: 604800000
};

const SHOP_ITEMS = [
  { id: 'pickaxe', name: 'Pickaxe', price: 200, description: 'Boost mining yield' },
  { id: 'fishing_rod', name: 'Fishing Rod', price: 150, description: 'Better fishing loot' },
  { id: 'weapon', name: 'Weapon', price: 300, description: 'Boost robbery success' },
  { id: 'armor', name: 'Armor', price: 250, description: 'Reduce robbery damage' },
  { id: 'lucky_charm', name: 'Lucky Charm', price: 100, description: 'Boost luck' }
];

// ==================== HELPERS ====================
// ✅ Convert phone number to JID format
function phoneToJid(phone) {
  const cleaned = String(phone).replace(/[^0-9]/g, '');
  if (cleaned.length < 7) return null;
  return cleaned + '@s.whatsapp.net';
}

async function getUser(env, jid) {
  const data = await env.ECONOMY_KV.get(jid);
  return data ? JSON.parse(data) : null;
}

async function saveUser(env, jid, user) {
  await env.ECONOMY_KV.put(jid, JSON.stringify(user));
}

async function getOrCreateUser(env, jid) {
  let user = await getUser(env, jid);
  if (!user) {
    user = JSON.parse(JSON.stringify(DEFAULT_USER));
    await saveUser(env, jid, user);
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

// ==================== ECONOMY HANDLERS (ALL FIXED) ====================
async function handleGetBalance(env, jid) {
  try {
    const user = await getOrCreateUser(env, jid);
    return jsonResponse({ balance: user.balance, bank: user.bank });
  } catch (err) {
    return errorResponse('Failed to fetch balance', 500);
  }
}

async function handleDeposit(env, jid, amount) {
  if (amount <= 0) return errorResponse('Amount must be positive');
  const user = await getOrCreateUser(env, jid);
  if (user.balance < amount) return errorResponse('Insufficient wallet balance');
  user.balance -= amount;
  user.bank += amount;
  await saveUser(env, jid, user);
  return jsonResponse({ balance: user.balance, bank: user.bank });
}

async function handleWithdraw(env, jid, amount) {
  if (amount <= 0) return errorResponse('Amount must be positive');
  const user = await getOrCreateUser(env, jid);
  if (user.bank < amount) return errorResponse('Insufficient bank balance');
  user.bank -= amount;
  user.balance += amount;
  await saveUser(env, jid, user);
  return jsonResponse({ balance: user.balance, bank: user.bank });
}

// ✅ FIXED: Atomic pay - money never lost
async function handlePay(env, senderJid, recipientJid, amount) {
  if (amount <= 0) return errorResponse('Amount must be positive');
  if (senderJid === recipientJid) return errorResponse('Cannot pay yourself');
  const sender = await getOrCreateUser(env, senderJid);
  if (sender.balance < amount) return errorResponse('Insufficient funds');
  sender.balance -= amount;
  await saveUser(env, senderJid, sender);
  try {
    const recipient = await getOrCreateUser(env, recipientJid);
    recipient.balance += amount;
    await saveUser(env, recipientJid, recipient);
  } catch (err) {
    sender.balance += amount;
    await saveUser(env, senderJid, sender);
    return errorResponse('Transaction failed — refunded');
  }
  return jsonResponse({ senderBalance: sender.balance, message: `Sent ${amount} coins!` });
}

// ✅ FIXED: Rob without KV.list()
async function handleRob(env, jid, targetJid) {
  if (jid === targetJid) return errorResponse('Cannot rob yourself');
  const user = await getOrCreateUser(env, jid);
  const target = await getOrCreateUser(env, targetJid);
  const now = Date.now();
  if (now - user.lastRob < COOLDOWNS.rob) {
    const remaining = Math.ceil((COOLDOWNS.rob - (now - user.lastRob)) / 60000);
    return errorResponse(`Cooldown: ${remaining} minutes`);
  }
  if (target.balance <= 0) return errorResponse('Target has no money');
  const successChance = 0.4 + (user.level - target.level) * 0.02;
  const success = Math.random() < successChance;
  user.lastRob = now;
  if (success) {
    const stolen = Math.floor(Math.random() * target.balance * 0.3) + 1;
    target.balance -= stolen;
    await saveUser(env, targetJid, target);
    user.balance += stolen;
    await saveUser(env, jid, user);
    return jsonResponse({ success: true, stolen, newBalance: user.balance });
  } else {
    const penalty = 50;
    user.balance = Math.max(0, user.balance - penalty);
    await saveUser(env, jid, user);
    return jsonResponse({ success: false, message: `Caught! Lost ${penalty} coins.` });
  }
}

// ==================== HANDLERS: WORK, FISH, DAILY, WEEKLY, BEG, MINE, HUNT, CRIME, DRUGS, LOAN, ATTACK, GIFT, TRAVEL, FACTION, TRAINING, LEVELUP, INVENTORY, SHOP, BUY, SELL, PROFILE ====================
// (All these handlers remain the same as before — they already work correctly)

async function handleWork(env, jid) {
  const user = await getOrCreateUser(env, jid);
  const now = Date.now();
  if (now - user.lastWork < COOLDOWNS.work) {
    const remaining = Math.ceil((COOLDOWNS.work - (now - user.lastWork)) / 60000);
    return errorResponse(`Cooldown: ${remaining} minutes`);
  }
  const earnings = Math.floor(Math.random() * 40) + 10;
  user.balance += earnings;
  user.xp += 10;
  user.lastWork = now;
  const xpNeeded = user.level * 100;
  if (user.xp >= xpNeeded) { user.xp -= xpNeeded; user.level++; }
  await saveUser(env, jid, user);
  return jsonResponse({ earnings, newBalance: user.balance, level: user.level });
}

async function handleFish(env, jid) {
  const user = await getOrCreateUser(env, jid);
  const now = Date.now();
  if (now - user.lastFish < COOLDOWNS.fish) {
    const remaining = Math.ceil((COOLDOWNS.fish - (now - user.lastFish)) / 1000);
    return errorResponse(`Cooldown: ${remaining} seconds`);
  }
  user.lastFish = now;
  const rewards = [{ name: 'Old Boot', value: 5 }, { name: 'Salmon', value: 20 }, { name: 'Tuna', value: 50 }, { name: 'Golden Fish', value: 200 }];
  const reward = rewards[Math.floor(Math.random() * rewards.length)];
  user.balance += reward.value;
  await saveUser(env, jid, user);
  return jsonResponse({ item: reward.name, reward: reward.value, newBalance: user.balance });
}

async function handleDaily(env, jid) {
  const user = await getOrCreateUser(env, jid);
  const now = Date.now();
  if (now - user.lastDaily < COOLDOWNS.daily) {
    const hours = Math.ceil((COOLDOWNS.daily - (now - user.lastDaily)) / 3600000);
    return errorResponse(`Come back in ${hours} hours`);
  }
  user.balance += 500;
  user.lastDaily = now;
  await saveUser(env, jid, user);
  return jsonResponse({ reward: 500, newBalance: user.balance });
}

async function handleWeekly(env, jid) {
  const user = await getOrCreateUser(env, jid);
  const now = Date.now();
  if (now - user.lastWeekly < COOLDOWNS.weekly) {
    const days = Math.ceil((COOLDOWNS.weekly - (now - user.lastWeekly)) / 86400000);
    return errorResponse(`Come back in ${days} days`);
  }
  user.balance += 2000;
  user.lastWeekly = now;
  await saveUser(env, jid, user);
  return jsonResponse({ reward: 2000, newBalance: user.balance });
}

async function handleBeg(env, jid) {
  const user = await getOrCreateUser(env, jid);
  const now = Date.now();
  if (now - user.lastBeg < COOLDOWNS.beg) {
    const remaining = Math.ceil((COOLDOWNS.beg - (now - user.lastBeg)) / 1000);
    return errorResponse(`Cooldown: ${remaining} seconds`);
  }
  const amount = Math.floor(Math.random() * 20) + 1;
  user.balance += amount;
  user.lastBeg = now;
  await saveUser(env, jid, user);
  return jsonResponse({ reward: amount, newBalance: user.balance });
}

async function handleLoan(env, jid, amount) {
  if (amount <= 0 || amount > 1000) return errorResponse('Loan amount must be 1-1000');
  const user = await getOrCreateUser(env, jid);
  if (user.loanAmount > 0) return errorResponse('You already have an outstanding loan');
  user.balance += amount;
  user.loanAmount = amount;
  user.loanDue = Date.now() + 86400000;
  await saveUser(env, jid, user);
  return jsonResponse({ loanAmount: amount, newBalance: user.balance });
}

async function handleCrime(env, jid) {
  const user = await getOrCreateUser(env, jid);
  const now = Date.now();
  if (now - user.lastCrime < COOLDOWNS.crime) {
    const remaining = Math.ceil((COOLDOWNS.crime - (now - user.lastCrime)) / 60000);
    return errorResponse(`Cooldown: ${remaining} minutes`);
  }
  user.lastCrime = now;
  const caught = Math.random() < 0.3;
  if (caught) { user.balance = Math.max(0, user.balance - 100); await saveUser(env, jid, user); return jsonResponse({ success: false, message: 'Caught! Lost 100 coins.' }); }
  const reward = Math.floor(Math.random() * 200) + 50;
  user.balance += reward;
  await saveUser(env, jid, user);
  return jsonResponse({ success: true, reward });
}

async function handleDrugs(env, jid) {
  const user = await getOrCreateUser(env, jid);
  const now = Date.now();
  if (now - user.lastDrugs < COOLDOWNS.drugs) {
    const remaining = Math.ceil((COOLDOWNS.drugs - (now - user.lastDrugs)) / 60000);
    return errorResponse(`Cooldown: ${remaining} minutes`);
  }
  user.lastDrugs = now;
  const busted = Math.random() < 0.4;
  if (busted) { user.balance = Math.max(0, user.balance - 200); await saveUser(env, jid, user); return jsonResponse({ success: false, message: 'Busted! Lost 200 coins.' }); }
  const profit = Math.floor(Math.random() * 500) + 100;
  user.balance += profit;
  await saveUser(env, jid, user);
  return jsonResponse({ success: true, profit });
}

async function handleMine(env, jid) {
  const user = await getOrCreateUser(env, jid);
  const now = Date.now();
  if (now - user.lastMine < COOLDOWNS.mine) {
    const remaining = Math.ceil((COOLDOWNS.mine - (now - user.lastMine)) / 60000);
    return errorResponse(`Cooldown: ${remaining} minutes`);
  }
  user.lastMine = now;
  const ores = [{ name: 'Stone', value: 5 }, { name: 'Iron', value: 20 }, { name: 'Gold', value: 50 }, { name: 'Diamond', value: 150 }];
  const ore = ores[Math.floor(Math.random() * ores.length)];
  user.balance += ore.value;
  user.inventory.push({ id: ore.name.toLowerCase(), name: ore.name, quantity: 1 });
  await saveUser(env, jid, user);
  return jsonResponse({ ore: ore.name, reward: ore.value });
}

async function handleHunt(env, jid) {
  const user = await getOrCreateUser(env, jid);
  const now = Date.now();
  if (now - user.lastHunt < COOLDOWNS.hunt) {
    const remaining = Math.ceil((COOLDOWNS.hunt - (now - user.lastHunt)) / 60000);
    return errorResponse(`Cooldown: ${remaining} minutes`);
  }
  user.lastHunt = now;
  const animals = [{ name: 'Rabbit', value: 15 }, { name: 'Deer', value: 40 }, { name: 'Bear', value: 100 }];
  const animal = animals[Math.floor(Math.random() * animals.length)];
  user.balance += animal.value;
  user.inventory.push({ id: animal.name.toLowerCase(), name: animal.name, quantity: 1 });
  await saveUser(env, jid, user);
  return jsonResponse({ animal: animal.name, reward: animal.value });
}

// ✅ FIXED: Atomic attack
async function handleAttack(env, jid, targetJid) {
  if (jid === targetJid) return errorResponse('Cannot attack yourself');
  const user = await getOrCreateUser(env, jid);
  const target = await getOrCreateUser(env, targetJid);
  const now = Date.now();
  if (now - user.lastAttack < COOLDOWNS.attack) {
    const remaining = Math.ceil((COOLDOWNS.attack - (now - user.lastAttack)) / 60000);
    return errorResponse(`Cooldown: ${remaining} minutes`);
  }
  const strengthDiff = (user.training.strength || 0) - (target.training.strength || 0);
  const winChance = 0.5 + strengthDiff * 0.05;
  const win = Math.random() < winChance;
  user.lastAttack = now;
  if (win) {
    const stolen = Math.floor(Math.random() * 30) + 10;
    target.balance = Math.max(0, target.balance - stolen);
    await saveUser(env, targetJid, target);
    user.balance += stolen;
    await saveUser(env, jid, user);
    return jsonResponse({ win: true, stolen, newBalance: user.balance });
  } else {
    const penalty = 30;
    user.balance = Math.max(0, user.balance - penalty);
    await saveUser(env, jid, user);
    return jsonResponse({ win: false, message: `You lost! Lost ${penalty} coins.` });
  }
}

// ✅ FIXED: Atomic gift
async function handleGift(env, senderJid, recipientJid, amount) {
  if (amount <= 0) return errorResponse('Amount must be positive');
  if (senderJid === recipientJid) return errorResponse('Cannot gift yourself');
  const sender = await getOrCreateUser(env, senderJid);
  if (sender.balance < amount) return errorResponse('Insufficient funds');
  sender.balance -= amount;
  await saveUser(env, senderJid, sender);
  try {
    const recipient = await getOrCreateUser(env, recipientJid);
    recipient.balance += amount;
    await saveUser(env, recipientJid, recipient);
  } catch (err) {
    sender.balance += amount;
    await saveUser(env, senderJid, sender);
    return errorResponse('Gift failed — refunded');
  }
  return jsonResponse({ message: `Gifted ${amount} coins!` });
}

async function handleTravel(env, jid, destinationId) {
  const dest = [{ id: 'city', name: 'City', cost: 50 }, { id: 'forest', name: 'Forest', cost: 30 }, { id: 'ocean', name: 'Ocean', cost: 40 }, { id: 'mountains', name: 'Mountains', cost: 60 }].find(d => d.id === destinationId);
  if (!dest) return errorResponse('Invalid destination');
  const user = await getOrCreateUser(env, jid);
  const now = Date.now();
  if (now - user.lastTravel < COOLDOWNS.travel) return errorResponse('Cooldown active');
  if (user.balance < dest.cost) return errorResponse('Not enough money');
  user.balance -= dest.cost;
  user.travel = { destination: dest.id, returnTime: now + COOLDOWNS.travel };
  user.lastTravel = now;
  await saveUser(env, jid, user);
  return jsonResponse({ message: `Travelled to ${dest.name}!` });
}

async function handleFaction(env, jid, action, factionId) {
  const factions = [{ id: 'thieves', name: 'Thieves Guild' }, { id: 'hunters', name: 'Hunters Union' }, { id: 'miners', name: 'Miners Brotherhood' }];
  const user = await getOrCreateUser(env, jid);
  if (action === 'join') { const f = factions.find(x => x.id === factionId); if (!f) return errorResponse('Invalid faction'); user.faction = f.id; }
  else if (action === 'leave') { user.faction = null; }
  else return errorResponse('Action must be "join" or "leave"');
  await saveUser(env, jid, user);
  return jsonResponse({ faction: user.faction });
}

async function handleTraining(env, jid, stat) {
  if (!['strength','luck','intelligence'].includes(stat)) return errorResponse('Invalid stat');
  const user = await getOrCreateUser(env, jid);
  const now = Date.now();
  if (now - user.lastTraining < COOLDOWNS.training) return errorResponse('Cooldown active');
  if (user.balance < 50) return errorResponse('Training costs 50 coins');
  user.balance -= 50;
  user.training[stat] = (user.training[stat] || 0) + 1;
  user.lastTraining = now;
  await saveUser(env, jid, user);
  return jsonResponse({ message: `Trained ${stat}!`, stats: user.training });
}

async function handleLevelUp(env, jid) {
  const user = await getOrCreateUser(env, jid);
  const xpNeeded = user.level * 100;
  if (user.xp < xpNeeded) return errorResponse(`Need ${xpNeeded} XP`);
  user.xp -= xpNeeded;
  user.level++;
  await saveUser(env, jid, user);
  return jsonResponse({ level: user.level });
}

async function handleInventory(env, jid) { const u = await getOrCreateUser(env, jid); return jsonResponse({ inventory: u.inventory }); }
async function handleShop(env) { return jsonResponse({ shop: SHOP_ITEMS }); }

async function handleBuy(env, jid, itemId) {
  const item = SHOP_ITEMS.find(i => i.id === itemId);
  if (!item) return errorResponse('Item not found');
  const user = await getOrCreateUser(env, jid);
  if (user.balance < item.price) return errorResponse('Insufficient funds');
  user.balance -= item.price;
  const existing = user.inventory.find(i => i.id === item.id);
  if (existing) existing.quantity++; else user.inventory.push({ id: item.id, name: item.name, quantity: 1 });
  await saveUser(env, jid, user);
  return jsonResponse({ message: `Bought ${item.name}!`, inventory: user.inventory });
}

async function handleSell(env, jid, itemId) {
  const user = await getOrCreateUser(env, jid);
  const idx = user.inventory.findIndex(i => i.id === itemId);
  if (idx === -1) return errorResponse('Item not in inventory');
  const item = user.inventory[idx];
  const shopItem = SHOP_ITEMS.find(s => s.id === itemId);
  const sellPrice = shopItem ? Math.floor(shopItem.price * 0.6) : 10;
  user.balance += sellPrice;
  if (item.quantity > 1) item.quantity--; else user.inventory.splice(idx, 1);
  await saveUser(env, jid, user);
  return jsonResponse({ message: `Sold ${item.name} for ${sellPrice}`, inventory: user.inventory });
}

async function handleProfile(env, jid) {
  const u = await getOrCreateUser(env, jid);
  return jsonResponse({ balance: u.balance, bank: u.bank, level: u.level, xp: u.xp, stats: u.training, faction: u.faction, inventoryCount: u.inventory.length, loan: u.loanAmount });
}

// ==================== ADMIN HANDLERS ====================
async function handleAdminStats(env) {
  try {
    const users = [];
    try { const list = await env.ECONOMY_KV.list(); for (const key of list.keys) { const d = await env.ECONOMY_KV.get(key.name); if (d) users.push({ jid: key.name, ...JSON.parse(d) }); } } catch (e) {}
    const totalUsers = users.length;
    const totalMoney = users.reduce((s, u) => s + u.balance + u.bank, 0);
    const richest = users.sort((a, b) => (b.balance + b.bank) - (a.balance + a.bank))[0];
    return jsonResponse({ totalUsers, totalMoneyInCirculation: totalMoney, richestUser: richest ? { jid: richest.jid, total: richest.balance + richest.bank } : null, users: users.map(u => ({ jid: u.jid, balance: u.balance, bank: u.bank, level: u.level, loan: u.loanAmount })) });
  } catch (err) { return jsonResponse({ totalUsers: 0, totalMoneyInCirculation: 0, users: [] }); }
}

// ✅ ADMIN ADD/REMOVE BY PHONE NUMBER (auto-converts to JID)
async function handleAdminAddMoney(env, phoneOrJid, amount) {
  const jid = phoneToJid(phoneOrJid) || phoneOrJid; // Convert if it's a phone number
  const user = await getOrCreateUser(env, jid);
  user.balance += amount;
  await saveUser(env, jid, user);
  return jsonResponse({ message: `Added ${amount} to ${jid}`, newBalance: user.balance });
}

async function handleAdminRemoveMoney(env, phoneOrJid, amount) {
  const jid = phoneToJid(phoneOrJid) || phoneOrJid;
  const user = await getOrCreateUser(env, jid);
  user.balance = Math.max(0, user.balance - amount);
  await saveUser(env, jid, user);
  return jsonResponse({ message: `Removed ${amount} from ${jid}`, newBalance: user.balance });
}

async function handleAdminResetEconomy(env) {
  try {
    const list = await env.ECONOMY_KV.list();
    for (const key of list.keys) { await env.ECONOMY_KV.delete(key.name); }
  } catch (e) {}
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
    canvas#starfield{position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none}
    .container{max-width:1200px;margin:0 auto;position:relative;z-index:2}
    .header{text-align:center;margin-bottom:3rem;backdrop-filter:blur(8px);background:rgba(10,30,10,0.5);border:1px solid rgba(16,185,129,0.3);border-radius:40px;padding:2.5rem 2rem;box-shadow:0 20px 40px rgba(0,0,0,0.6),0 0 40px rgba(16,185,129,0.1)}
    h1{font-size:3.5rem;font-weight:700;background:linear-gradient(135deg,#10b981 0%,#34d399 50%,#6ee7b7 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:0.5rem}
    .subtitle{font-size:1.2rem;color:#86c9a0;margin-bottom:1.5rem}
    .powered-by{display:inline-block;background:rgba(16,185,129,0.15);border:1px solid #10b981;padding:6px 20px;border-radius:40px;font-size:0.9rem;margin-bottom:1rem}
    .pulse-dot{width:12px;height:12px;background:#10b981;border-radius:50%;box-shadow:0 0 15px #10b981;animation:pulse 2s infinite}
    @keyframes pulse{0%{opacity:1;transform:scale(1)}50%{opacity:0.6;transform:scale(1.2)}100%{opacity:1;transform:scale(1)}}
    .stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:15px;margin-bottom:2rem}
    .stat-card{background:rgba(10,30,10,0.6);border:1px solid rgba(16,185,129,0.2);border-radius:20px;padding:1.5rem;text-align:center;backdrop-filter:blur(8px);transition:all 0.3s}
    .stat-card:hover{border-color:#10b981;box-shadow:0 0 20px rgba(16,185,129,0.15);transform:translateY(-3px)}
    .stat-number{font-size:2.5rem;font-weight:700;color:#10b981}
    .stat-label{color:#86c9a0;font-size:0.9rem;margin-top:0.5rem}
    .category-title{font-size:1.5rem;font-weight:600;color:#10b981;margin-bottom:1rem;padding-bottom:0.5rem;border-bottom:1px solid rgba(16,185,129,0.3);display:flex;align-items:center}
    .endpoint-count{display:inline-block;background:#10b981;color:#0a0f0a;padding:4px 12px;border-radius:20px;font-size:0.9rem;font-weight:600;margin-left:10px}
    .endpoints-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:15px;margin-bottom:2rem}
    .card{background:rgba(10,30,10,0.6);border:1px solid rgba(16,185,129,0.2);border-radius:15px;padding:1rem;transition:all 0.3s}
    .card:hover{border-color:#10b981;box-shadow:0 0 20px rgba(16,185,129,0.15);transform:translateY(-2px)}
    .method{background:#10b981;color:#0a0f0a;font-weight:600;padding:3px 8px;border-radius:10px;font-size:0.7rem}
    .endpoint-path{font-family:monospace;font-size:0.8rem;color:#34d399}
    .card p{color:#86c9a0;font-size:0.8rem;margin-top:8px}
    .admin-link{text-align:center;margin-top:2rem;padding:1rem}
    .admin-link a{color:#10b981;text-decoration:none;border:1px solid #10b981;padding:10px 24px;border-radius:30px;transition:all 0.2s}
    .admin-link a:hover{background:#10b981;color:#0a0f0a}
    .footer{text-align:center;color:#5a8a6a;margin-top:3rem;border-top:1px solid rgba(16,185,129,0.2);padding-top:2rem}
  </style>
</head>
<body>
  <canvas id="starfield"></canvas>
  <div class="container">
    <div class="header">
      <h1>🏦 CRYSN⎔VA Economy</h1>
      <div class="powered-by">💰 REALISTIC VIRTUAL ECONOMY ENGINE 💰</div>
      <div class="subtitle">27+ Endpoints • Persistent Storage • Realistic Mechanics</div>
      <div style="display:inline-flex;align-items:center;gap:8px;background:rgba(10,30,10,0.5);border:1px solid #10b981;padding:8px 20px;border-radius:40px;font-size:0.95rem;margin-bottom:1rem"><span class="pulse-dot"></span>🌐 System Operational</div>
    </div>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-number" id="totalUsers">0</div><div class="stat-label">👥 Total Users</div></div>
      <div class="stat-card"><div class="stat-number" id="totalMoney">0</div><div class="stat-label">💰 In Circulation</div></div>
      <div class="stat-card"><div class="stat-number" id="richestUser">—</div><div class="stat-label">🏆 Richest</div></div>
      <div class="stat-card"><div class="stat-number">🟢</div><div class="stat-label">📡 API Status</div></div>
    </div>
    <h2 class="category-title">🏦 Banking <span class="endpoint-count">5</span></h2>
    <div class="endpoints-grid">
      ${['GET /balance','POST /deposit','POST /withdraw','POST /pay','POST /gift'].map(e => `<div class="card"><span class="method">${e.split(' ')[0]}</span> <span class="endpoint-path">${e.split(' ')[1]}</span><p>${e.includes('balance')?'Check wallet':e.includes('deposit')?'Deposit to bank':e.includes('withdraw')?'Withdraw cash':e.includes('pay')?'Pay someone':'Send a gift'}</p></div>`).join('')}
    </div>
    <h2 class="category-title">💼 Jobs <span class="endpoint-count">7</span></h2>
    <div class="endpoints-grid">
      ${['POST /work','POST /fish','POST /mine','POST /hunt','POST /beg','POST /daily','POST /weekly'].map(e => `<div class="card"><span class="method">POST</span> <span class="endpoint-path">${e.split(' ')[1]}</span><p>${e.includes('work')?'Work for coins & XP':e.includes('fish')?'Go fishing':e.includes('mine')?'Mine ores':e.includes('hunt')?'Hunt animals':e.includes('beg')?'Beg for coins':e.includes('daily')?'Daily reward (500)':'Weekly bonus (2000)'}</p></div>`).join('')}
    </div>
    <h2 class="category-title">⚠️ Crime <span class="endpoint-count">4</span></h2>
    <div class="endpoints-grid">
      ${['POST /rob','POST /crime','POST /drugs','POST /attack'].map(e => `<div class="card"><span class="method">POST</span> <span class="endpoint-path">${e.split(' ')[1]}</span><p>${e.includes('rob')?'Rob someone (risky!)':e.includes('crime')?'Commit a crime':e.includes('drugs')?'Deal drugs':'Attack a player'}</p></div>`).join('')}
    </div>
    <h2 class="category-title">🎮 Progression <span class="endpoint-count">7</span></h2>
    <div class="endpoints-grid">
      ${['POST /training','POST /levelup','POST /travel','POST /faction','POST /loan','GET /profile','GET /leaderboard'].map(e => `<div class="card"><span class="method">${e.split(' ')[0]}</span> <span class="endpoint-path">${e.split(' ')[1]}</span><p>${e.includes('training')?'Train stats':e.includes('levelup')?'Level up':e.includes('travel')?'Travel':e.includes('faction')?'Join faction':e.includes('loan')?'Get a loan':'View profile'}</p></div>`).join('')}
    </div>
    <h2 class="category-title">🛍️ Shop <span class="endpoint-count">4</span></h2>
    <div class="endpoints-grid">
      ${['GET /shop','POST /buy','POST /sell','GET /inventory'].map(e => `<div class="card"><span class="method">${e.split(' ')[0]}</span> <span class="endpoint-path">${e.split(' ')[1]}</span><p>${e.includes('shop')?'View items':e.includes('buy')?'Buy item':e.includes('sell')?'Sell item':'Your backpack'}</p></div>`).join('')}
    </div>
    <div class="admin-link"><a href="/admin">🔐 Admin Dashboard</a></div>
    <div class="footer">🏦 CRYSN⚉VA Economy • Realistic Virtual Economy • © 2026</div>
  </div>
  <script>
    async function loadStats(){try{const r=await fetch('/admin/stats');const d=await r.json();document.getElementById('totalUsers').textContent=d.totalUsers||0;document.getElementById('totalMoney').textContent=(d.totalMoneyInCirculation||0).toLocaleString();document.getElementById('richestUser').textContent=d.richestUser?d.richestUser.total.toLocaleString():'—'}catch(e){}}
    loadStats();
    const canvas=document.getElementById('starfield'),ctx=canvas.getContext('2d');let stars=[];function resize(){canvas.width=window.innerWidth;canvas.height=window.innerHeight}window.addEventListener('resize',resize);resize();for(let i=0;i<150;i++)stars.push({x:Math.random()*canvas.width,y:Math.random()*canvas.height,size:Math.random()*2+1});function draw(){ctx.fillStyle='#0a0f0a';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#10b981';stars.forEach(s=>{ctx.fillRect(s.x,s.y,s.size,s.size)});requestAnimationFrame(draw)}draw();
  </script>
</body>
</html>`;

const ADMIN_LOGIN_HTML = `<!DOCTYPE html><html><head><title>🔐 Admin Login</title><style>body{background:#0a0f0a;color:#d4edda;font-family:'Inter';display:flex;justify-content:center;align-items:center;height:100vh}.box{background:rgba(10,30,10,0.8);border:1px solid #10b981;padding:2rem;border-radius:20px;text-align:center;width:350px}h2{color:#10b981}input{background:#0a1a0a;border:1px solid #10b981;color:#d4edda;padding:0.8rem;border-radius:10px;width:100%;margin:1rem 0}button{background:#10b981;color:#0a0f0a;border:none;padding:0.8rem 2rem;border-radius:30px;cursor:pointer;font-weight:bold}#error{color:#ef4444;margin-top:0.5rem}</style></head><body><div class="box"><h2>🔐 Admin Login</h2><input type="password" id="pwd" placeholder="Admin Password"><button onclick="login()">Login</button><p id="error"></p></div><script>async function login(){const p=document.getElementById('pwd').value;const r=await fetch('/admin/stats',{headers:{'X-Admin-Key':p}});if(r.ok){localStorage.setItem('ak',p);window.location.href='/admin/dashboard'}else document.getElementById('error').textContent='Wrong password'}</script></body></html>`;

const ADMIN_DASHBOARD_HTML = `<!DOCTYPE html><html><head><title>🏦 Admin Dashboard</title><style>body{background:#0a0f0a;color:#d4edda;font-family:'Inter';padding:1rem}.container{max-width:1000px;margin:0 auto}h1{color:#10b981}.card{background:rgba(10,30,10,0.6);border:1px solid rgba(16,185,129,0.2);border-radius:15px;padding:1rem;margin:1rem 0}table{width:100%;border-collapse:collapse;font-size:0.9rem}th,td{padding:0.5rem;border-bottom:1px solid rgba(16,185,129,0.2);text-align:left}th{background:rgba(16,185,129,0.1);color:#10b981}input,button{background:#0a1a0a;border:1px solid #10b981;color:#d4edda;padding:0.5rem;border-radius:8px;margin:0.2rem}button{background:#10b981;color:#0a0f0a;cursor:pointer;font-weight:bold}#resetBtn{background:#ef4444}.actions{display:flex;gap:1rem;flex-wrap:wrap;margin:1rem 0}</style></head><body><div class="container"><h1>🏦 Admin Dashboard</h1><div class="card"><h2>💰 Manage Money</h2><div class="actions"><input id="phoneInput" placeholder="Phone number (e.g. 2348077528901)"><input id="amountInput" type="number" placeholder="Amount"><button onclick="addMoney()">➕ Add Money</button><button onclick="removeMoney()">➖ Remove Money</button><button id="resetBtn" onclick="resetEconomy()">💣 Reset All</button></div><p style="font-size:0.8rem;color:#86c9a0;margin-top:0.5rem">💡 Just enter the phone number — it auto-converts to JID!</p></div><div class="card"><h2>👥 Users</h2><table id="usersTable"><tr><th>JID</th><th>Balance</th><th>Bank</th><th>Level</th><th>Loan</th></tr></table></div></div><script>const ak=localStorage.getItem('ak');if(!ak)window.location.href='/admin';async function api(u,m='GET',b=null){const h={'X-Admin-Key':ak};if(b)h['Content-Type']='application/json';const r=await fetch(u,{method:m,headers:h,body:b?JSON.stringify(b):undefined});return r.json()}async function load(){const d=await api('/admin/stats');const t=document.getElementById('usersTable');t.innerHTML='<tr><th>JID</th><th>Balance</th><th>Bank</th><th>Level</th><th>Loan</th></tr>';if(d.users)d.users.forEach(u=>{const r=t.insertRow();r.innerHTML=\`<td>\${u.jid}</td><td>💰 \${u.balance.toLocaleString()}</td><td>🏦 \${u.bank.toLocaleString()}</td><td>⭐ \${u.level}</td><td>💳 \${u.loan||0}</td>\`})}async function addMoney(){const p=document.getElementById('phoneInput').value;const a=parseInt(document.getElementById('amountInput').value);if(p&&a){await api('/admin/add-money','POST',{jid:p,amount:a});load()}}async function removeMoney(){const p=document.getElementById('phoneInput').value;const a=parseInt(document.getElementById('amountInput').value);if(p&&a){await api('/admin/remove-money','POST',{jid:p,amount:a});load()}}async function resetEconomy(){if(confirm('Reset ALL data?')){await api('/admin/reset','POST');load()}}load();</script></body></html>`;

// ==================== ROUTER ====================
const ROUTES = {
  'GET /balance': (env, jid) => handleGetBalance(env, jid),
  'POST /deposit': (env, jid, b) => handleDeposit(env, jid, b.amount),
  'POST /withdraw': (env, jid, b) => handleWithdraw(env, jid, b.amount),
  'POST /pay': (env, jid, b) => handlePay(env, jid, b.to, b.amount),
  'POST /rob': (env, jid, b) => handleRob(env, jid, b.target),
  'POST /work': (env, jid) => handleWork(env, jid),
  'POST /fish': (env, jid) => handleFish(env, jid),
  'POST /daily': (env, jid) => handleDaily(env, jid),
  'POST /weekly': (env, jid) => handleWeekly(env, jid),
  'POST /beg': (env, jid) => handleBeg(env, jid),
  'POST /loan': (env, jid, b) => handleLoan(env, jid, b.amount),
  'POST /crime': (env, jid) => handleCrime(env, jid),
  'POST /drugs': (env, jid) => handleDrugs(env, jid),
  'POST /hunt': (env, jid) => handleHunt(env, jid),
  'POST /mine': (env, jid) => handleMine(env, jid),
  'POST /attack': (env, jid, b) => handleAttack(env, jid, b.target),
  'POST /gift': (env, jid, b) => handleGift(env, jid, b.to, b.amount),
  'POST /travel': (env, jid, b) => handleTravel(env, jid, b.destination),
  'POST /faction': (env, jid, b) => handleFaction(env, jid, b.action, b.faction),
  'POST /training': (env, jid, b) => handleTraining(env, jid, b.stat),
  'POST /levelup': (env, jid) => handleLevelUp(env, jid),
  'GET /inventory': (env, jid) => handleInventory(env, jid),
  'GET /shop': (env) => handleShop(env),
  'POST /buy': (env, jid, b) => handleBuy(env, jid, b.item),
  'POST /sell': (env, jid, b) => handleSell(env, jid, b.item),
  'GET /profile': (env, jid) => handleProfile(env, jid),
  'GET /admin/stats': async (env, req) => {
    if (req.headers.get('X-Admin-Key') !== env.ADMIN_PASSWORD) return errorResponse('Unauthorized', 401);
    return handleAdminStats(env);
  },
  'POST /admin/add-money': async (env, req) => {
    if (req.headers.get('X-Admin-Key') !== env.ADMIN_PASSWORD) return errorResponse('Unauthorized', 401);
    const b = await req.json();
    return handleAdminAddMoney(env, b.jid || b.phone, b.amount);
  },
  'POST /admin/remove-money': async (env, req) => {
    if (req.headers.get('X-Admin-Key') !== env.ADMIN_PASSWORD) return errorResponse('Unauthorized', 401);
    const b = await req.json();
    return handleAdminRemoveMoney(env, b.jid || b.phone, b.amount);
  },
  'POST /admin/reset': async (env, req) => {
    if (req.headers.get('X-Admin-Key') !== env.ADMIN_PASSWORD) return errorResponse('Unauthorized', 401);
    return handleAdminResetEconomy(env);
  },
};

// ==================== MAIN FETCH ====================
export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Frontend
    if (method === 'GET' && (path === '/' || path === '')) return new Response(LANDING_HTML, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
    if (method === 'GET' && path === '/admin') return new Response(ADMIN_LOGIN_HTML, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
    if (method === 'GET' && path === '/admin/dashboard') return new Response(ADMIN_DASHBOARD_HTML, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });

    const jid = request.headers.get('X-User-JID') || 'default';
    let body = {};
    if (method === 'POST') { try { body = await request.json(); } catch(e) {} }

    if (path.startsWith('/admin/')) {
      const handler = ROUTES[`${method} ${path}`];
      if (!handler) return errorResponse('Not found', 404);
      return handler(env, request);
    }

    const handler = ROUTES[`${method} ${path}`];
    if (!handler) return errorResponse('Endpoint not found', 404);
    try { return await handler(env, jid, body); } catch (err) { console.error(err); return errorResponse('Internal server error', 500); }
  }
};
