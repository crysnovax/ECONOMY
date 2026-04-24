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
function cleanPhone(phone) {
  return String(phone).replace(/[^0-9]/g, '');
}

function phoneKey(phone) {
  return 'phone:' + cleanPhone(phone);
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
    user.phone = cleanPhone(phone);
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
  const c = cleanPhone(phone);
  if (c.length < 7) return errorResponse('Invalid phone number');
  if (await getUser(env, c)) return errorResponse('Already activated! Use .balance to check.');
  const user = JSON.parse(JSON.stringify(DEFAULT_USER));
  user.phone = c;
  await saveUser(env, c, user);
  return jsonResponse({ message: 'Activated!', balance: 100, bank: 0 });
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
  senderPhone = cleanPhone(senderPhone);
  targetPhone = cleanPhone(targetPhone);
  if (!amount || amount <= 0) return errorResponse('Amount must be positive');
  if (senderPhone === targetPhone) return errorResponse('Cannot pay yourself');
  const sender = await getUser(env, senderPhone);
  if (!sender) return errorResponse('You are not activated! Use .economy activate');
  if (sender.balance < amount) return errorResponse(`Insufficient wallet! You have ${sender.balance} coins`);
  const target = await getUser(env, targetPhone);
  if (!target) return errorResponse('Recipient not activated yet!');
  sender.balance -= amount;
  await saveUser(env, senderPhone, sender);
  target.balance += amount;
  await saveUser(env, targetPhone, target);
  return jsonResponse({ message: `Sent ${amount} coins!`, senderBalance: sender.balance });
}

// ==================== ROB (WALLET ONLY - BANK IS SAFE) ====================
async function handleRob(env, robberPhone, targetPhone) {
  robberPhone = cleanPhone(robberPhone);
  targetPhone = cleanPhone(targetPhone);
  if (robberPhone === targetPhone) return errorResponse('Cannot rob yourself');
  const robber = await getUser(env, robberPhone);
  if (!robber) return errorResponse('You are not activated!');
  const target = await getUser(env, targetPhone);
  if (!target) return errorResponse('Target not activated yet!');
  const now = Date.now();
  if (now - robber.lastRob < COOLDOWNS.rob) {
    const secs = Math.ceil((COOLDOWNS.rob - (now - robber.lastRob)) / 1000);
    return errorResponse(`Cooldown: ${secs} seconds`);
  }
  // ✅ ONLY STEAL FROM WALLET, BANK IS UNTOUCHED
  if (target.balance <= 0) return errorResponse('Target has no money in wallet! (Bank is safe from robbery)');
  const successChance = 0.4 + (robber.level - target.level) * 0.02;
  const success = Math.random() < successChance;
  robber.lastRob = now;
  if (success) {
    const stolen = Math.floor(Math.random() * target.balance * 0.3) + 1;
    target.balance -= stolen;
    await saveUser(env, targetPhone, target);
    robber.balance += stolen;
    await saveUser(env, robberPhone, robber);
    return jsonResponse({ success: true, stolen, balance: robber.balance });
  } else {
    // ✅ ROBBER PAYS PENALTY, TARGET LOSES NOTHING
    const penalty = 50;
    robber.balance = Math.max(0, robber.balance - penalty);
    await saveUser(env, robberPhone, robber);
    return jsonResponse({ success: false, message: `Caught! You lost ${penalty} coins. Target keeps their money.` });
  }
}

// ==================== ATTACK ====================
async function handleAttack(env, attackerPhone, targetPhone) {
  attackerPhone = cleanPhone(attackerPhone);
  targetPhone = cleanPhone(targetPhone);
  if (attackerPhone === targetPhone) return errorResponse('Cannot attack yourself');
  const attacker = await getUser(env, attackerPhone);
  if (!attacker) return errorResponse('You are not activated!');
  const target = await getUser(env, targetPhone);
  if (!target) return errorResponse('Target not activated!');
  const now = Date.now();
  if (now - attacker.lastAttack < COOLDOWNS.attack) {
    const secs = Math.ceil((COOLDOWNS.attack - (now - attacker.lastAttack)) / 1000);
    return errorResponse(`Cooldown: ${secs} seconds`);
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
    return jsonResponse({ win: false, message: 'You lost 30 coins!' });
  }
}

// ==================== GIFT ====================
async function handleGift(env, senderPhone, targetPhone, amount) {
  senderPhone = cleanPhone(senderPhone);
  targetPhone = cleanPhone(targetPhone);
  if (!amount || amount <= 0) return errorResponse('Amount must be positive');
  if (senderPhone === targetPhone) return errorResponse('Cannot gift yourself');
  const sender = await getUser(env, senderPhone);
  if (!sender) return errorResponse('You are not activated!');
  if (sender.balance < amount) return errorResponse(`Insufficient wallet! You have ${sender.balance} coins`);
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
    const secs = Math.ceil((COOLDOWNS.work - (now - user.lastWork)) / 1000);
    return errorResponse(`Cooldown: ${secs} seconds`);
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
    const secs = Math.ceil((COOLDOWNS.fish - (now - user.lastFish)) / 1000);
    return errorResponse(`Cooldown: ${secs} seconds`);
  }
  user.lastFish = now;
  const rewards = [
    { name: 'Old Boot', value: 5 },
    { name: 'Salmon', value: 20 },
    { name: 'Tuna', value: 50 },
    { name: 'Golden Fish', value: 200 }
  ];
  const reward = rewards[Math.floor(Math.random() * rewards.length)];
  user.balance += reward.value;
  await saveUser(env, phone, user);
  return jsonResponse({ item: reward.name, reward: reward.value });
}

// ==================== MINE ====================
async function handleMine(env, phone) {
  const user = await getOrCreateUser(env, phone);
  const now = Date.now();
  if (now - user.lastMine < COOLDOWNS.mine) {
    const secs = Math.ceil((COOLDOWNS.mine - (now - user.lastMine)) / 1000);
    return errorResponse(`Cooldown: ${secs} seconds`);
  }
  user.lastMine = now;
  const ores = [
    { name: 'Stone', value: 5 },
    { name: 'Iron', value: 20 },
    { name: 'Gold', value: 50 },
    { name: 'Diamond', value: 150 }
  ];
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
  if (now - user.lastHunt < COOLDOWNS.hunt) {
    const secs = Math.ceil((COOLDOWNS.hunt - (now - user.lastHunt)) / 1000);
    return errorResponse(`Cooldown: ${secs} seconds`);
  }
  user.lastHunt = now;
  const animals = [
    { name: 'Rabbit', value: 15 },
    { name: 'Deer', value: 40 },
    { name: 'Bear', value: 100 }
  ];
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
  if (now - user.lastBeg < COOLDOWNS.beg) {
    const secs = Math.ceil((COOLDOWNS.beg - (now - user.lastBeg)) / 1000);
    return errorResponse(`Cooldown: ${secs} seconds`);
  }
  user.lastBeg = now;
  const amount = Math.floor(Math.random() * 20) + 1;
  user.balance += amount;
  await saveUser(env, phone, user);
  return jsonResponse({ reward: amount });
}

// ==================== CRIME ====================
async function handleCrime(env, phone) {
  const user = await getOrCreateUser(env, phone);
  const now = Date.now();
  if (now - user.lastCrime < COOLDOWNS.crime) {
    const secs = Math.ceil((COOLDOWNS.crime - (now - user.lastCrime)) / 1000);
    return errorResponse(`Cooldown: ${secs} seconds`);
  }
  user.lastCrime = now;
  const caught = Math.random() < 0.3;
  if (caught) {
    user.balance = Math.max(0, user.balance - 100);
    await saveUser(env, phone, user);
    return jsonResponse({ success: false, message: 'Caught! Lost 100 coins.' });
  }
  const reward = Math.floor(Math.random() * 200) + 50;
  user.balance += reward;
  await saveUser(env, phone, user);
  return jsonResponse({ success: true, reward });
}

// ==================== DRUGS ====================
async function handleDrugs(env, phone) {
  const user = await getOrCreateUser(env, phone);
  const now = Date.now();
  if (now - user.lastDrugs < COOLDOWNS.drugs) {
    const secs = Math.ceil((COOLDOWNS.drugs - (now - user.lastDrugs)) / 1000);
    return errorResponse(`Cooldown: ${secs} seconds`);
  }
  user.lastDrugs = now;
  const busted = Math.random() < 0.4;
  if (busted) {
    user.balance = Math.max(0, user.balance - 200);
    await saveUser(env, phone, user);
    return jsonResponse({ success: false, message: 'Busted! Lost 200 coins.' });
  }
  const profit = Math.floor(Math.random() * 500) + 100;
  user.balance += profit;
  await saveUser(env, phone, user);
  return jsonResponse({ success: true, profit });
}

// ==================== DAILY ====================
async function handleDaily(env, phone) {
  const user = await getOrCreateUser(env, phone);
  const now = Date.now();
  if (now - user.lastDaily < COOLDOWNS.daily) {
    const hours = Math.ceil((COOLDOWNS.daily - (now - user.lastDaily)) / 3600000);
    return errorResponse(`Already claimed! Come back in ${hours} hours`);
  }
  user.balance += 500;
  user.lastDaily = now;
  await saveUser(env, phone, user);
  return jsonResponse({ reward: 500 });
}

// ==================== WEEKLY ====================
async function handleWeekly(env, phone) {
  const user = await getOrCreateUser(env, phone);
  const now = Date.now();
  if (now - user.lastWeekly < COOLDOWNS.weekly) {
    const days = Math.ceil((COOLDOWNS.weekly - (now - user.lastWeekly)) / 86400000);
    return errorResponse(`Already claimed! Come back in ${days} days`);
  }
  user.balance += 2000;
  user.lastWeekly = now;
  await saveUser(env, phone, user);
  return jsonResponse({ reward: 2000 });
}

// ==================== LOAN ====================
async function handleLoan(env, phone, amount) {
  if (amount <= 0 || amount > 1000) return errorResponse('Loan amount must be 1-1000 coins');
  const user = await getOrCreateUser(env, phone);
  if (user.loanAmount > 0) return errorResponse('You already have an outstanding loan');
  user.balance += amount;
  user.loanAmount = amount;
  user.loanDue = Date.now() + 86400000;
  await saveUser(env, phone, user);
  return jsonResponse({ loanAmount: amount });
}

// ==================== TRAINING ====================
async function handleTraining(env, phone, stat) {
  if (!['strength', 'luck', 'intelligence'].includes(stat)) return errorResponse('Invalid stat');
  const user = await getOrCreateUser(env, phone);
  const now = Date.now();
  if (now - user.lastTraining < COOLDOWNS.training) {
    const secs = Math.ceil((COOLDOWNS.training - (now - user.lastTraining)) / 1000);
    return errorResponse(`Cooldown: ${secs} seconds`);
  }
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
  if (user.xp < xpNeeded) return errorResponse(`Need ${xpNeeded} XP (you have ${user.xp})`);
  user.xp -= xpNeeded;
  user.level++;
  await saveUser(env, phone, user);
  return jsonResponse({ level: user.level });
}

// ==================== INVENTORY ====================
async function handleInventory(env, phone) {
  const user = await getOrCreateUser(env, phone);
  return jsonResponse({ inventory: user.inventory });
}

// ==================== SHOP ====================
async function handleShop() {
  return jsonResponse({ shop: SHOP_ITEMS });
}

// ==================== BUY ====================
async function handleBuy(env, phone, itemId) {
  const item = SHOP_ITEMS.find(i => i.id === itemId);
  if (!item) return errorResponse('Item not found');
  const user = await getOrCreateUser(env, phone);
  if (user.balance < item.price) return errorResponse('Insufficient funds');
  user.balance -= item.price;
  const existing = user.inventory.find(i => i.id === item.id);
  if (existing) existing.quantity++;
  else user.inventory.push({ id: item.id, name: item.name, quantity: 1 });
  await saveUser(env, phone, user);
  return jsonResponse({ message: `Bought ${item.name}!` });
}

// ==================== SELL ====================
async function handleSell(env, phone, itemId) {
  const user = await getOrCreateUser(env, phone);
  const idx = user.inventory.findIndex(i => i.id === itemId);
  if (idx === -1) return errorResponse('Item not in inventory');
  const item = user.inventory[idx];
  const shopItem = SHOP_ITEMS.find(s => s.id === itemId);
  const sellPrice = shopItem ? Math.floor(shopItem.price * 0.6) : 10;
  user.balance += sellPrice;
  if (item.quantity > 1) item.quantity--;
  else user.inventory.splice(idx, 1);
  await saveUser(env, phone, user);
  return jsonResponse({ message: `Sold ${item.name} for ${sellPrice} coins` });
}

// ==================== PROFILE ====================
async function handleProfile(env, phone) {
  const user = await getOrCreateUser(env, phone);
  return jsonResponse({
    balance: user.balance,
    bank: user.bank,
    level: user.level,
    xp: user.xp,
    stats: user.training,
    faction: user.faction,
    inventory: user.inventory.length,
    loan: user.loanAmount
  });
}

// ==================== TRAVEL ====================
async function handleTravel(env, phone, destinationId) {
  const destinations = [
    { id: 'city', name: 'City', cost: 50 },
    { id: 'forest', name: 'Forest', cost: 30 },
    { id: 'ocean', name: 'Ocean', cost: 40 },
    { id: 'mountains', name: 'Mountains', cost: 60 }
  ];
  const dest = destinations.find(d => d.id === destinationId);
  if (!dest) return errorResponse('Invalid destination');
  const user = await getOrCreateUser(env, phone);
  const now = Date.now();
  if (now - user.lastTravel < COOLDOWNS.travel) return errorResponse('Cooldown active');
  if (user.balance < dest.cost) return errorResponse('Not enough money');
  user.balance -= dest.cost;
  user.travel = { destination: dest.id, returnTime: now + COOLDOWNS.travel };
  user.lastTravel = now;
  await saveUser(env, phone, user);
  return jsonResponse({ message: `Travelled to ${dest.name}!` });
}

// ==================== FACTION ====================
async function handleFaction(env, phone, action, factionId) {
  const factions = [
    { id: 'thieves', name: 'Thieves Guild' },
    { id: 'hunters', name: 'Hunters Union' },
    { id: 'miners', name: 'Miners Brotherhood' }
  ];
  const user = await getOrCreateUser(env, phone);
  if (action === 'join') {
    const faction = factions.find(f => f.id === factionId);
    if (!faction) return errorResponse('Invalid faction');
    user.faction = faction.id;
  } else if (action === 'leave') {
    user.faction = null;
  } else {
    return errorResponse('Action must be "join" or "leave"');
  }
  await saveUser(env, phone, user);
  return jsonResponse({ faction: user.faction });
}

// ==================== ADMIN HANDLERS ====================
async function handleAdminStats(env) {
  try {
    const users = [];
    const list = await env.ECONOMY_KV.list({ prefix: 'phone:' });
    for (const key of list.keys) {
      const data = await env.ECONOMY_KV.get(key.name);
      if (data) {
        users.push(JSON.parse(data));
      }
    }
    const totalUsers = users.length;
    const totalMoney = users.reduce((sum, u) => sum + u.balance + u.bank, 0);
    const richest = users.sort((a, b) => (b.balance + b.bank) - (a.balance + a.bank))[0];
    return jsonResponse({
      totalUsers,
      totalMoneyInCirculation: totalMoney,
      richestUser: richest ? { phone: richest.phone, total: richest.balance + richest.bank } : null,
      users: users.map(u => ({
        phone: u.phone,
        balance: u.balance,
        bank: u.bank,
        level: u.level,
        loan: u.loanAmount
      }))
    });
  } catch (e) {
    return jsonResponse({ totalUsers: 0, totalMoneyInCirculation: 0, users: [] });
  }
}

async function handleAdminAddMoney(env, phone, amount) {
  const user = await getOrCreateUser(env, phone);
  user.balance += amount;
  await saveUser(env, phone, user);
  return jsonResponse({ message: `Added ${amount} coins to ${phone}`, newBalance: user.balance });
}

async function handleAdminRemoveMoney(env, phone, amount) {
  const user = await getOrCreateUser(env, phone);
  user.balance = Math.max(0, user.balance - amount);
  await saveUser(env, phone, user);
  return jsonResponse({ message: `Removed ${amount} coins from ${phone}`, newBalance: user.balance });
}

async function handleAdminResetEconomy(env) {
  try {
    const list = await env.ECONOMY_KV.list({ prefix: 'phone:' });
    for (const key of list.keys) {
      await env.ECONOMY_KV.delete(key.name);
    }
  } catch (e) {}
  return jsonResponse({ message: 'Economy reset successfully' });
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
    .status-badge{display:inline-flex;align-items:center;gap:8px;background:rgba(10,30,10,0.5);border:1px solid #10b981;padding:8px 20px;border-radius:40px;font-size:0.95rem;margin-bottom:1rem}
    .pulse-dot{width:12px;height:12px;background:#10b981;border-radius:50%;box-shadow:0 0 15px #10b981;animation:pulse 2s infinite}
    @keyframes pulse{0%{opacity:1;transform:scale(1)}50%{opacity:0.6;transform:scale(1.2)}100%{opacity:1;transform:scale(1)}}
    .stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:15px;margin-bottom:2rem}
    .stat-card{background:rgba(10,30,10,0.6);border:1px solid rgba(16,185,129,0.2);border-radius:20px;padding:1.5rem;text-align:center;backdrop-filter:blur(8px);transition:all 0.3s}
    .stat-card:hover{border-color:#10b981;box-shadow:0 0 20px rgba(16,185,129,0.15);transform:translateY(-3px)}
    .stat-number{font-size:2.5rem;font-weight:700;color:#10b981}
    .stat-label{color:#86c9a0;font-size:0.9rem;margin-top:0.5rem}
    .category-section{margin-bottom:2.5rem}
    .category-title{font-size:1.5rem;font-weight:600;color:#10b981;margin-bottom:1rem;padding-bottom:0.5rem;border-bottom:1px solid rgba(16,185,129,0.3);display:flex;align-items:center}
    .endpoint-count{display:inline-block;background:#10b981;color:#0a0f0a;padding:4px 12px;border-radius:20px;font-size:0.9rem;font-weight:600;margin-left:10px}
    .endpoints-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:15px}
    .card{background:rgba(10,30,10,0.6);backdrop-filter:blur(8px);border:1px solid rgba(16,185,129,0.2);border-radius:15px;padding:1rem;transition:all 0.3s}
    .card:hover{border-color:#10b981;box-shadow:0 0 20px rgba(16,185,129,0.15);transform:translateY(-2px)}
    .method{background:#10b981;color:#0a0f0a;font-weight:600;padding:3px 8px;border-radius:10px;font-size:0.7rem;margin-right:8px}
    .endpoint-path{font-family:'Monaco','Menlo',monospace;font-size:0.8rem;color:#34d399;word-break:break-all}
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
      <div class="subtitle">27+ Endpoints • Phone-Based Storage • 1-Min Cooldowns • Bank-Safe Robbery</div>
      <div class="status-badge"><span class="pulse-dot"></span><span>🌐 System Operational</span></div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-number" id="totalUsers">0</div>
        <div class="stat-label">👥 Total Users</div>
      </div>
      <div class="stat-card">
        <div class="stat-number" id="totalMoney">0</div>
        <div class="stat-label">💰 In Circulation</div>
      </div>
      <div class="stat-card">
        <div class="stat-number" id="richestUser">—</div>
        <div class="stat-label">🏆 Richest User</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">🟢</div>
        <div class="stat-label">📡 API Status</div>
      </div>
    </div>

    <div class="category-section">
      <h2 class="category-title">🏦 Core Banking <span class="endpoint-count">5</span></h2>
      <div class="endpoints-grid">
        <div class="card"><span class="method">GET</span><span class="endpoint-path">/balance</span><p>Check wallet & bank balance</p></div>
        <div class="card"><span class="method">POST</span><span class="endpoint-path">/activate</span><p>Activate new account</p></div>
        <div class="card"><span class="method">POST</span><span class="endpoint-path">/deposit</span><p>Deposit to bank (safe from robbery)</p></div>
        <div class="card"><span class="method">POST</span><span class="endpoint-path">/withdraw</span><p>Withdraw from bank</p></div>
        <div class="card"><span class="method">POST</span><span class="endpoint-path">/loan</span><p>Get a loan (max 1000)</p></div>
      </div>
    </div>

    <div class="category-section">
      <h2 class="category-title">💸 Transfers <span class="endpoint-count">4</span></h2>
      <div class="endpoints-grid">
        <div class="card"><span class="method">POST</span><span class="endpoint-path">/pay</span><p>Pay someone by phone number</p></div>
        <div class="card"><span class="method">POST</span><span class="endpoint-path">/rob</span><p>Rob someone (wallet only, bank is safe)</p></div>
        <div class="card"><span class="method">POST</span><span class="endpoint-path">/attack</span><p>Attack another player</p></div>
        <div class="card"><span class="method">POST</span><span class="endpoint-path">/gift</span><p>Send a gift</p></div>
      </div>
    </div>

    <div class="category-section">
      <h2 class="category-title">💼 Jobs & Income <span class="endpoint-count">7</span></h2>
      <div class="endpoints-grid">
        <div class="card"><span class="method">POST</span><span class="endpoint-path">/work</span><p>Work for coins & XP</p></div>
        <div class="card"><span class="method">POST</span><span class="endpoint-path">/fish</span><p>Go fishing</p></div>
        <div class="card"><span class="method">POST</span><span class="endpoint-path">/mine</span><p>Mine for ores</p></div>
        <div class="card"><span class="method">POST</span><span class="endpoint-path">/hunt</span><p>Hunt animals</p></div>
        <div class="card"><span class="method">POST</span><span class="endpoint-path">/beg</span><p>Beg for coins</p></div>
        <div class="card"><span class="method">POST</span><span class="endpoint-path">/daily</span><p>Daily reward (500 coins)</p></div>
        <div class="card"><span class="method">POST</span><span class="endpoint-path">/weekly</span><p>Weekly bonus (2000 coins)</p></div>
      </div>
    </div>

    <div class="category-section">
      <h2 class="category-title">⚠️ Crime & Risk <span class="endpoint-count">2</span></h2>
      <div class="endpoints-grid">
        <div class="card"><span class="method">POST</span><span class="endpoint-path">/crime</span><p>Commit a crime</p></div>
        <div class="card"><span class="method">POST</span><span class="endpoint-path">/drugs</span><p>Deal drugs (high risk)</p></div>
      </div>
    </div>

    <div class="category-section">
      <h2 class="category-title">🎮 Progression <span class="endpoint-count">6</span></h2>
      <div class="endpoints-grid">
        <div class="card"><span class="method">POST</span><span class="endpoint-path">/training</span><p>Train stats</p></div>
        <div class="card"><span class="method">POST</span><span class="endpoint-path">/levelup</span><p>Level up</p></div>
        <div class="card"><span class="method">POST</span><span class="endpoint-path">/travel</span><p>Travel to locations</p></div>
        <div class="card"><span class="method">POST</span><span class="endpoint-path">/faction</span><p>Join/leave factions</p></div>
        <div class="card"><span class="method">GET</span><span class="endpoint-path">/profile</span><p>View full profile</p></div>
        <div class="card"><span class="method">GET</span><span class="endpoint-path">/inventory</span><p>View your backpack</p></div>
      </div>
    </div>

    <div class="category-section">
      <h2 class="category-title">🛍️ Shop & Trading <span class="endpoint-count">3</span></h2>
      <div class="endpoints-grid">
        <div class="card"><span class="method">GET</span><span class="endpoint-path">/shop</span><p>View item shop</p></div>
        <div class="card"><span class="method">POST</span><span class="endpoint-path">/buy</span><p>Buy an item</p></div>
        <div class="card"><span class="method">POST</span><span class="endpoint-path">/sell</span><p>Sell an item</p></div>
      </div>
    </div>

    <div class="admin-link">
      <a href="/admin">🔐 Admin Dashboard</a>
    </div>
    <div class="footer">🏦 CRYSN⚉VA Economy • Realistic Virtual Economy Engine • © 2026</div>
  </div>
  <script>
    async function loadStats() {
      try {
        const res = await fetch('/admin/stats');
        const data = await res.json();
        document.getElementById('totalUsers').textContent = data.totalUsers || 0;
        document.getElementById('totalMoney').textContent = (data.totalMoneyInCirculation || 0).toLocaleString();
        document.getElementById('richestUser').textContent = data.richestUser ? data.richestUser.total.toLocaleString() : '—';
      } catch(e) {}
    }
    loadStats();
    
    // Starfield animation
    const canvas = document.getElementById('starfield');
    const ctx = canvas.getContext('2d');
    let width, height;
    let stars = [];
    function resize() { width = window.innerWidth; height = window.innerHeight; canvas.width = width; canvas.height = height; }
    window.addEventListener('resize', resize);
    resize();
    for (let i = 0; i < 150; i++) stars.push({ x: Math.random() * width, y: Math.random() * height, size: Math.random() * 2 + 1 });
    function draw() {
      ctx.fillStyle = '#0a0f0a';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#10b981';
      stars.forEach(s => { ctx.fillRect(s.x, s.y, s.size, s.size); });
      requestAnimationFrame(draw);
    }
    draw();
  </script>
</body>
</html>`;

const ADMIN_LOGIN_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>🔐 Admin Login</title>
  <style>
    body{background:#0a0f0a;color:#d4edda;font-family:'Inter';display:flex;justify-content:center;align-items:center;height:100vh;margin:0}
    .box{background:rgba(10,30,10,0.8);border:1px solid #10b981;padding:2rem;border-radius:20px;text-align:center;width:350px}
    h2{color:#10b981}
    input{background:#0a1a0a;border:1px solid #10b981;color:#d4edda;padding:0.8rem;border-radius:10px;width:100%;margin:1rem 0}
    button{background:#10b981;color:#0a0f0a;border:none;padding:0.8rem 2rem;border-radius:30px;cursor:pointer;font-weight:bold}
    #error{color:#ef4444;margin-top:0.5rem}
  </style>
</head>
<body>
  <div class="box">
    <h2>🔐 Admin Login</h2>
    <input type="password" id="pwd" placeholder="Admin Password">
    <button onclick="login()">Login</button>
    <p id="error"></p>
  </div>
  <script>
    async function login() {
      const p = document.getElementById('pwd').value;
      const r = await fetch('/admin/stats', { headers: { 'X-Admin-Key': p } });
      if (r.ok) { localStorage.setItem('ak', p); window.location.href = '/admin/dashboard'; }
      else document.getElementById('error').textContent = 'Wrong password';
    }
  </script>
</body>
</html>`;

const ADMIN_DASHBOARD_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>🏦 Admin Dashboard</title>
  <style>
    body{background:#0a0f0a;color:#d4edda;font-family:'Inter';padding:1rem;margin:0}
    .container{max-width:1000px;margin:0 auto}
    h1{color:#10b981}
    .card{background:rgba(10,30,10,0.6);border:1px solid rgba(16,185,129,0.2);border-radius:15px;padding:1rem;margin:1rem 0}
    table{width:100%;border-collapse:collapse;font-size:0.9rem}
    th,td{padding:0.5rem;border-bottom:1px solid rgba(16,185,129,0.2);text-align:left}
    th{background:rgba(16,185,129,0.1);color:#10b981}
    input,button{background:#0a1a0a;border:1px solid #10b981;color:#d4edda;padding:0.5rem;border-radius:8px;margin:0.2rem}
    button{background:#10b981;color:#0a0f0a;cursor:pointer;font-weight:bold}
    #resetBtn{background:#ef4444}
    .actions{display:flex;gap:1rem;flex-wrap:wrap;margin:1rem 0}
    p{font-size:0.8rem;color:#86c9a0;margin-top:0.5rem}
  </style>
</head>
<body>
  <div class="container">
    <h1>🏦 Admin Dashboard</h1>
    <div class="card">
      <h2>💰 Manage Money Circulation</h2>
      <div class="actions">
        <input id="phoneInput" placeholder="Phone number (e.g. 2348077528901)">
        <input id="amountInput" type="number" placeholder="Amount">
        <button onclick="addMoney()">➕ Add Money</button>
        <button onclick="removeMoney()">➖ Remove Money</button>
        <button id="resetBtn" onclick="resetEconomy()">💣 Reset All Economy</button>
      </div>
      <p>💡 Just enter the phone number — it auto-converts to the correct format!</p>
    </div>
    <div class="card">
      <h2>👥 All Users</h2>
      <table id="usersTable">
        <tr><th>Phone</th><th>💰 Balance</th><th>🏦 Bank</th><th>⭐ Level</th><th>💳 Loan</th></tr>
      </table>
    </div>
  </div>
  <script>
    const ak = localStorage.getItem('ak');
    if (!ak) window.location.href = '/admin';

    async function api(url, method = 'GET', body = null) {
      const headers = { 'X-Admin-Key': ak };
      if (body) headers['Content-Type'] = 'application/json';
      const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
      return res.json();
    }

    async function loadUsers() {
      const data = await api('/admin/stats');
      const table = document.getElementById('usersTable');
      table.innerHTML = '<tr><th>Phone</th><th>💰 Balance</th><th>🏦 Bank</th><th>⭐ Level</th><th>💳 Loan</th></tr>';
      if (data.users) {
        data.users.forEach(u => {
          const row = table.insertRow();
          row.innerHTML = \`<td>\${u.phone}</td><td>💰 \${(u.balance || 0).toLocaleString()}</td><td>🏦 \${(u.bank || 0).toLocaleString()}</td><td>⭐ \${u.level || 1}</td><td>💳 \${u.loan || 0}</td>\`;
        });
      }
    }

    async function addMoney() {
      const phone = document.getElementById('phoneInput').value;
      const amount = parseInt(document.getElementById('amountInput').value);
      if (phone && amount) {
        await api('/admin/add-money', 'POST', { phone, amount });
        loadUsers();
      }
    }

    async function removeMoney() {
      const phone = document.getElementById('phoneInput').value;
      const amount = parseInt(document.getElementById('amountInput').value);
      if (phone && amount) {
        await api('/admin/remove-money', 'POST', { phone, amount });
        loadUsers();
      }
    }

    async function resetEconomy() {
      if (confirm('⚠️ This will DELETE ALL economy data! This cannot be undone!\n\nAre you absolutely sure?')) {
        await api('/admin/reset', 'POST');
        loadUsers();
        alert('✅ Economy has been completely reset.');
      }
    }

    loadUsers();
  </script>
</body>
</html>`;

// ==================== ROUTER ====================
const ROUTES = {
  // Auth
  'POST /activate': (env, phone) => handleActivate(env, phone),
  
  // Banking
  'GET /balance': (env, phone) => handleBalance(env, phone),
  'POST /deposit': (env, phone, body) => handleDeposit(env, phone, body.amount),
  'POST /withdraw': (env, phone, body) => handleWithdraw(env, phone, body.amount),
  
  // Transfers
  'POST /pay': (env, phone, body) => handlePay(env, phone, body.to, body.amount),
  'POST /rob': (env, phone, body) => handleRob(env, phone, body.target),
  'POST /attack': (env, phone, body) => handleAttack(env, phone, body.target),
  'POST /gift': (env, phone, body) => handleGift(env, phone, body.to, body.amount),
  
  // Jobs
  'POST /work': (env, phone) => handleWork(env, phone),
  'POST /fish': (env, phone) => handleFish(env, phone),
  'POST /mine': (env, phone) => handleMine(env, phone),
  'POST /hunt': (env, phone) => handleHunt(env, phone),
  'POST /beg': (env, phone) => handleBeg(env, phone),
  'POST /crime': (env, phone) => handleCrime(env, phone),
  'POST /drugs': (env, phone) => handleDrugs(env, phone),
  
  // Rewards
  'POST /daily': (env, phone) => handleDaily(env, phone),
  'POST /weekly': (env, phone) => handleWeekly(env, phone),
  
  // Financial
  'POST /loan': (env, phone, body) => handleLoan(env, phone, body.amount),
  
  // Progression
  'POST /training': (env, phone, body) => handleTraining(env, phone, body.stat),
  'POST /levelup': (env, phone) => handleLevelUp(env, phone),
  'POST /travel': (env, phone, body) => handleTravel(env, phone, body.destination),
  'POST /faction': (env, phone, body) => handleFaction(env, phone, body.action, body.faction),
  
  // Info
  'GET /inventory': (env, phone) => handleInventory(env, phone),
  'GET /shop': (env) => handleShop(),
  'GET /profile': (env, phone) => handleProfile(env, phone),
  
  // Shop
  'POST /buy': (env, phone, body) => handleBuy(env, phone, body.item),
  'POST /sell': (env, phone, body) => handleSell(env, phone, body.item),
  
  // Admin (require X-Admin-Key header)
  'GET /admin/stats': async (env, request) => {
    if (request.headers.get('X-Admin-Key') !== env.ADMIN_PASSWORD) return errorResponse('Unauthorized', 401);
    return handleAdminStats(env);
  },
  'POST /admin/add-money': async (env, request) => {
    if (request.headers.get('X-Admin-Key') !== env.ADMIN_PASSWORD) return errorResponse('Unauthorized', 401);
    const body = await request.json();
    return handleAdminAddMoney(env, body.phone, body.amount);
  },
  'POST /admin/remove-money': async (env, request) => {
    if (request.headers.get('X-Admin-Key') !== env.ADMIN_PASSWORD) return errorResponse('Unauthorized', 401);
    const body = await request.json();
    return handleAdminRemoveMoney(env, body.phone, body.amount);
  },
  'POST /admin/reset': async (env, request) => {
    if (request.headers.get('X-Admin-Key') !== env.ADMIN_PASSWORD) return errorResponse('Unauthorized', 401);
    return handleAdminResetEconomy(env);
  },
};

// ==================== MAIN FETCH ====================
export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // ==================== FRONTEND ROUTES ====================
    if (method === 'GET' && (path === '/' || path === '')) {
      return new Response(LANDING_HTML, { 
        headers: { 'Content-Type': 'text/html;charset=UTF-8' } 
      });
    }
    
    if (method === 'GET' && path === '/admin') {
      return new Response(ADMIN_LOGIN_HTML, { 
        headers: { 'Content-Type': 'text/html;charset=UTF-8' } 
      });
    }
    
    if (method === 'GET' && path === '/admin/dashboard') {
      return new Response(ADMIN_DASHBOARD_HTML, { 
        headers: { 'Content-Type': 'text/html;charset=UTF-8' } 
      });
    }

    // ==================== API ROUTES ====================
    const phone = request.headers.get('X-User-Phone') || '0';
    let body = {};
    
    if (method === 'POST') {
      try {
        body = await request.json();
      } catch (e) {
        body = {};
      }
    }

    // Admin routes need the full request object for header checking
    if (path.startsWith('/admin/')) {
      const routeKey = `${method} ${path}`;
      const handler = ROUTES[routeKey];
      if (!handler) {
        return jsonResponse({ error: 'Admin endpoint not found' }, 404);
      }
      try {
        return await handler(env, request);
      } catch (err) {
        console.error('[ADMIN ERROR]', err);
        return errorResponse('Internal server error', 500);
      }
    }

    // Regular API routes
    const routeKey = `${method} ${path}`;
    const handler = ROUTES[routeKey];
    
    if (!handler) {
      return jsonResponse({ error: 'Endpoint not found' }, 404);
    }

    try {
      return await handler(env, phone, body);
    } catch (err) {
      console.error('[API ERROR]', err);
      return errorResponse('Internal server error', 500);
    }
  }
};