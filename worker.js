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
  rob: 3600000,
  work: 1800000,
  fish: 300000,
  mine: 600000,
  hunt: 600000,
  crime: 1800000,
  beg: 60000,
  attack: 300000,
  drugs: 3600000,
  travel: 7200000,
  training: 600000,
  daily: 86400000,
  weekly: 604800000
};

const SHOP_ITEMS = [
  { id: 'pickaxe', name: 'Pickaxe', price: 200, description: 'Increase mining yield' },
  { id: 'fishing_rod', name: 'Fishing Rod', price: 150, description: 'Better fishing loot' },
  { id: 'weapon', name: 'Weapon', price: 300, description: 'Increase robbery success' },
  { id: 'armor', name: 'Armor', price: 250, description: 'Reduce robbery damage' },
  { id: 'lucky_charm', name: 'Lucky Charm', price: 100, description: 'Boost luck' }
];

const TRAVEL_DESTINATIONS = [
  { id: 'city', name: 'City', cost: 50, bonus: 'work' },
  { id: 'forest', name: 'Forest', cost: 30, bonus: 'hunt' },
  { id: 'ocean', name: 'Ocean', cost: 40, bonus: 'fish' },
  { id: 'mountains', name: 'Mountains', cost: 60, bonus: 'mine' }
];

const FACTIONS = [
  { id: 'thieves', name: 'Thieves Guild', buff: 'rob' },
  { id: 'hunters', name: 'Hunters Union', buff: 'hunt' },
  { id: 'miners', name: 'Miners Brotherhood', buff: 'mine' }
];

// ==================== HELPERS ====================
async function getAllUsers(env) {
  const list = await env.ECONOMY_KV.list();
  const users = [];
  for (const key of list.keys) {
    const data = await env.ECONOMY_KV.get(key.name);
    if (data) {
      users.push({ jid: key.name, ...JSON.parse(data) });
    }
  }
  return users;
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

// ==================== ECONOMY HANDLERS ====================
async function handleGetBalance(env, jid) {
  const user = await getOrCreateUser(env, jid);
  return jsonResponse({ balance: user.balance, bank: user.bank });
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

async function handlePay(env, senderJid, recipientJid, amount) {
  if (amount <= 0) return errorResponse('Amount must be positive');
  if (senderJid === recipientJid) return errorResponse('Cannot pay yourself');
  const sender = await getOrCreateUser(env, senderJid);
  if (sender.balance < amount) return errorResponse('Insufficient funds');
  const recipient = await getOrCreateUser(env, recipientJid);
  sender.balance -= amount;
  recipient.balance += amount;
  await saveUser(env, senderJid, sender);
  await saveUser(env, recipientJid, recipient);
  return jsonResponse({ senderBalance: sender.balance, recipientBalance: recipient.balance });
}

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
    user.balance += stolen;
  } else {
    user.balance = Math.max(0, user.balance - 50);
  }
  await saveUser(env, jid, user);
  await saveUser(env, targetJid, target);
  return jsonResponse(success ? { success: true, stolen } : { success: false, message: 'Caught! Lost 50 coins.' });
}

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
  if (user.xp >= xpNeeded) {
    user.xp -= xpNeeded;
    user.level++;
  }
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
  const rewards = [
    { name: 'Old Boot', value: 5 },
    { name: 'Salmon', value: 20 },
    { name: 'Tuna', value: 50 },
    { name: 'Golden Fish', value: 200 }
  ];
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
  if (caught) {
    user.balance = Math.max(0, user.balance - 100);
    await saveUser(env, jid, user);
    return jsonResponse({ success: false, message: 'Caught! Lost 100 coins.' });
  }
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
  if (busted) {
    user.balance = Math.max(0, user.balance - 200);
    await saveUser(env, jid, user);
    return jsonResponse({ success: false, message: 'Busted! Lost 200 coins.' });
  }
  const profit = Math.floor(Math.random() * 500) + 100;
  user.balance += profit;
  await saveUser(env, jid, user);
  return jsonResponse({ success: true, profit });
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
    user.balance += stolen;
  } else {
    user.balance = Math.max(0, user.balance - 30);
  }
  await saveUser(env, jid, user);
  await saveUser(env, targetJid, target);
  return jsonResponse(win ? { win: true, stolen } : { win: false, message: 'You lost the fight!' });
}

async function handleGift(env, jid, targetJid, amount) {
  if (amount <= 0) return errorResponse('Invalid amount');
  const user = await getOrCreateUser(env, jid);
  if (user.balance < amount) return errorResponse('Insufficient funds');
  const target = await getOrCreateUser(env, targetJid);
  user.balance -= amount;
  target.balance += amount;
  await saveUser(env, jid, user);
  await saveUser(env, targetJid, target);
  return jsonResponse({ message: `Gifted ${amount} coins!` });
}

async function handleTravel(env, jid, destinationId) {
  const dest = TRAVEL_DESTINATIONS.find(d => d.id === destinationId);
  if (!dest) return errorResponse('Invalid destination');
  const user = await getOrCreateUser(env, jid);
  const now = Date.now();
  if (now - user.lastTravel < COOLDOWNS.travel) {
    const remaining = Math.ceil((COOLDOWNS.travel - (now - user.lastTravel)) / 60000);
    return errorResponse(`Cooldown: ${remaining} minutes`);
  }
  if (user.balance < dest.cost) return errorResponse('Not enough money');
  user.balance -= dest.cost;
  user.travel = { destination: dest.id, returnTime: now + COOLDOWNS.travel };
  user.lastTravel = now;
  await saveUser(env, jid, user);
  return jsonResponse({ message: `Travelled to ${dest.name}!` });
}

async function handleFaction(env, jid, action, factionId) {
  const user = await getOrCreateUser(env, jid);
  if (action === 'join') {
    const faction = FACTIONS.find(f => f.id === factionId);
    if (!faction) return errorResponse('Invalid faction');
    user.faction = faction.id;
  } else if (action === 'leave') {
    user.faction = null;
  } else return errorResponse('Action must be "join" or "leave"');
  await saveUser(env, jid, user);
  return jsonResponse({ faction: user.faction });
}

async function handleTraining(env, jid, stat) {
  if (!['strength','luck','intelligence'].includes(stat)) return errorResponse('Invalid stat');
  const user = await getOrCreateUser(env, jid);
  const now = Date.now();
  if (now - user.lastTraining < COOLDOWNS.training) {
    const remaining = Math.ceil((COOLDOWNS.training - (now - user.lastTraining)) / 60000);
    return errorResponse(`Cooldown: ${remaining} minutes`);
  }
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

async function handleInventory(env, jid) {
  const user = await getOrCreateUser(env, jid);
  return jsonResponse({ inventory: user.inventory });
}

async function handleShop(env, jid) {
  return jsonResponse({ shop: SHOP_ITEMS });
}

async function handleBuy(env, jid, itemId) {
  const item = SHOP_ITEMS.find(i => i.id === itemId);
  if (!item) return errorResponse('Item not found');
  const user = await getOrCreateUser(env, jid);
  if (user.balance < item.price) return errorResponse('Insufficient funds');
  user.balance -= item.price;
  const existing = user.inventory.find(i => i.id === item.id);
  if (existing) existing.quantity++;
  else user.inventory.push({ id: item.id, name: item.name, quantity: 1 });
  await saveUser(env, jid, user);
  return jsonResponse({ message: `Bought ${item.name}!`, inventory: user.inventory });
}

async function handleSell(env, jid, itemId) {
  const user = await getOrCreateUser(env, jid);
  const itemIndex = user.inventory.findIndex(i => i.id === itemId);
  if (itemIndex === -1) return errorResponse('Item not in inventory');
  const item = user.inventory[itemIndex];
  const shopItem = SHOP_ITEMS.find(s => s.id === itemId);
  const sellPrice = shopItem ? Math.floor(shopItem.price * 0.6) : 10;
  user.balance += sellPrice;
  if (item.quantity > 1) item.quantity--;
  else user.inventory.splice(itemIndex, 1);
  await saveUser(env, jid, user);
  return jsonResponse({ message: `Sold ${item.name} for ${sellPrice} coins`, inventory: user.inventory });
}

async function handleProfile(env, jid) {
  const user = await getOrCreateUser(env, jid);
  return jsonResponse({
    balance: user.balance,
    bank: user.bank,
    level: user.level,
    xp: user.xp,
    stats: user.training,
    faction: user.faction,
    inventoryCount: user.inventory.length,
    loan: user.loanAmount
  });
}

// ==================== ADMIN HANDLERS ====================
async function handleAdminStats(env) {
  const users = await getAllUsers(env);
  const totalUsers = users.length;
  const totalMoney = users.reduce((sum, u) => sum + u.balance + u.bank, 0);
  const richest = users.sort((a, b) => (b.balance + b.bank) - (a.balance + a.bank))[0];
  return jsonResponse({
    totalUsers,
    totalMoneyInCirculation: totalMoney,
    richestUser: richest ? { jid: richest.jid, total: richest.balance + richest.bank } : null,
    users: users.map(u => ({
      jid: u.jid,
      balance: u.balance,
      bank: u.bank,
      level: u.level,
      loan: u.loanAmount
    }))
  });
}

async function handleAdminAddMoney(env, jid, amount) {
  const user = await getOrCreateUser(env, jid);
  user.balance += amount;
  await saveUser(env, jid, user);
  return jsonResponse({ message: `Added ${amount}`, newBalance: user.balance });
}

async function handleAdminRemoveMoney(env, jid, amount) {
  const user = await getOrCreateUser(env, jid);
  user.balance = Math.max(0, user.balance - amount);
  await saveUser(env, jid, user);
  return jsonResponse({ message: `Removed ${amount}`, newBalance: user.balance });
}

async function handleAdminResetEconomy(env) {
  const users = await getAllUsers(env);
  for (const user of users) {
    await env.ECONOMY_KV.delete(user.jid);
  }
  return jsonResponse({ message: 'Economy reset' });
}

// ==================== FRONTEND LANDING PAGE ====================
const LANDING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🏦 CRYSNOVA Economy API</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#0b0a0c;min-height:100vh;font-family:'Inter',system-ui,sans-serif;color:#e0d6b0;padding:2rem 1rem;position:relative;overflow-x:hidden}
    canvas#starfield{position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none}
    .container{max-width:1200px;margin:0 auto;position:relative;z-index:2}
    .header{text-align:center;margin-bottom:3rem;backdrop-filter:blur(8px);background:rgba(20,15,10,0.3);border:1px solid rgba(212,175,55,0.3);border-radius:40px;padding:2.5rem 2rem;box-shadow:0 20px 40px rgba(0,0,0,0.6),0 0 40px rgba(212,175,55,0.1)}
    h1{font-size:3.5rem;font-weight:700;background:linear-gradient(135deg,#d4af37 0%,#ff4d4d 80%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:0.5rem;text-shadow:0 0 30px rgba(212,175,55,0.3)}
    .subtitle{font-size:1.2rem;color:#b0a080;margin-bottom:1.5rem}
    .powered-by{display:inline-block;background:rgba(212,175,55,0.15);border:1px solid #d4af37;padding:6px 20px;border-radius:40px;font-size:0.9rem;margin-bottom:1rem}
    .status-badge{display:inline-flex;align-items:center;gap:8px;background:rgba(20,15,10,0.5);border:1px solid #d4af37;padding:8px 20px;border-radius:40px;font-size:0.95rem;margin-bottom:1rem}
    .pulse-dot{width:12px;height:12px;background:#10b981;border-radius:50%;box-shadow:0 0 15px #10b981;animation:pulse 2s infinite}
    @keyframes pulse{0%{opacity:1;transform:scale(1)}50%{opacity:0.6;transform:scale(1.2)}100%{opacity:1;transform:scale(1)}}
    .stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:15px;margin-bottom:2rem}
    .stat-card{background:rgba(20,15,10,0.6);border:1px solid rgba(212,175,55,0.2);border-radius:20px;padding:1.5rem;text-align:center;backdrop-filter:blur(8px);transition:all 0.3s}
    .stat-card:hover{border-color:#d4af37;box-shadow:0 0 20px rgba(212,175,55,0.15);transform:translateY(-3px)}
    .stat-number{font-size:2.5rem;font-weight:700;color:#d4af37}
    .stat-label{color:#b0a080;font-size:0.9rem;margin-top:0.5rem}
    .category-section{margin-bottom:2.5rem}
    .category-title{font-size:1.5rem;font-weight:600;color:#d4af37;margin-bottom:1rem;padding-bottom:0.5rem;border-bottom:1px solid rgba(212,175,55,0.3);display:flex;align-items:center}
    .endpoint-count{display:inline-block;background:#d4af37;color:#0b0a0c;padding:4px 12px;border-radius:20px;font-size:0.9rem;font-weight:600;margin-left:10px}
    .endpoints-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:15px}
    .card{background:rgba(20,15,10,0.6);backdrop-filter:blur(8px);border:1px solid rgba(212,175,55,0.2);border-radius:15px;padding:1rem;transition:all 0.3s}
    .card:hover{border-color:#d4af37;box-shadow:0 0 20px rgba(212,175,55,0.15);transform:translateY(-2px)}
    .method{background:#ff4d4d;color:#fff;font-weight:600;padding:3px 8px;border-radius:10px;font-size:0.7rem}
    .endpoint-path{font-family:'Monaco','Menlo',monospace;font-size:0.8rem;color:#d4af37;word-break:break-all}
    .card p{color:#b0a080;font-size:0.8rem;margin-top:8px}
    .admin-link{text-align:center;margin-top:2rem;padding:1rem}
    .admin-link a{color:#d4af37;text-decoration:none;border:1px solid #d4af37;padding:10px 24px;border-radius:30px;transition:all 0.2s}
    .admin-link a:hover{background:#d4af37;color:#0b0a0c}
    .footer{text-align:center;color:#806850;margin-top:3rem;border-top:1px solid rgba(212,175,55,0.2);padding-top:2rem}
  </style>
</head>
<body>
  <canvas id="starfield"></canvas>
  <div class="container">
    <div class="header">
      <h1>🏦 CRYSN⎔VA Economy</h1>
      <div class="powered-by">⚡ REALISTIC VIRTUAL ECONOMY ENGINE ⚡</div>
      <div class="subtitle">27+ Endpoints • Persistent Storage • Realistic Mechanics</div>
      <div class="status-badge"><span class="pulse-dot"></span><span id="globalStatus">🌐 System Operational</span></div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-number" id="totalUsers">0</div>
        <div class="stat-label">👥 Total Users</div>
      </div>
      <div class="stat-card">
        <div class="stat-number" id="totalMoney">0</div>
        <div class="stat-label">💰 Money in Circulation</div>
      </div>
      <div class="stat-card">
        <div class="stat-number" id="richestUser">—</div>
        <div class="stat-label">🏆 Richest User</div>
      </div>
      <div class="stat-card">
        <div class="stat-number" id="onlineStatus">🟢</div>
        <div class="stat-label">📡 API Status</div>
      </div>
    </div>

    <div class="category-section">
      <h2 class="category-title">🏦 Core Banking <span class="endpoint-count">5</span></h2>
      <div class="endpoints-grid">
        <div class="card"><div class="method">GET</div><span class="endpoint-path">/balance</span><p>Check wallet & bank balance</p></div>
        <div class="card"><div class="method">POST</div><span class="endpoint-path">/deposit</span><p>Deposit money to bank</p></div>
        <div class="card"><div class="method">POST</div><span class="endpoint-path">/withdraw</span><p>Withdraw from bank</p></div>
        <div class="card"><div class="method">POST</div><span class="endpoint-path">/pay</span><p>Pay another user</p></div>
        <div class="card"><div class="method">POST</div><span class="endpoint-path">/gift</span><p>Gift coins to a friend</p></div>
      </div>
    </div>

    <div class="category-section">
      <h2 class="category-title">💼 Jobs & Income <span class="endpoint-count">6</span></h2>
      <div class="endpoints-grid">
        <div class="card"><div class="method">POST</div><span class="endpoint-path">/work</span><p>Work to earn coins & XP</p></div>
        <div class="card"><div class="method">POST</div><span class="endpoint-path">/fish</span><p>Go fishing for rewards</p></div>
        <div class="card"><div class="method">POST</div><span class="endpoint-path">/mine</span><p>Mine for valuable ores</p></div>
        <div class="card"><div class="method">POST</div><span class="endpoint-path">/hunt</span><p>Hunt animals for profit</p></div>
        <div class="card"><div class="method">POST</div><span class="endpoint-path">/beg</span><p>Beg for spare coins</p></div>
        <div class="card"><div class="method">POST</div><span class="endpoint-path">/daily</span><p>Claim daily reward (500 coins)</p></div>
      </div>
    </div>

    <div class="category-section">
      <h2 class="category-title">⚠️ Crime & Risk <span class="endpoint-count">4</span></h2>
      <div class="endpoints-grid">
        <div class="card"><div class="method">POST</div><span class="endpoint-path">/rob</span><p>Rob another user (risky!)</p></div>
        <div class="card"><div class="method">POST</div><span class="endpoint-path">/crime</span><p>Commit a crime</p></div>
        <div class="card"><div class="method">POST</div><span class="endpoint-path">/drugs</span><p>Deal drugs (high risk)</p></div>
        <div class="card"><div class="method">POST</div><span class="endpoint-path">/attack</span><p>Attack another player</p></div>
      </div>
    </div>

    <div class="category-section">
      <h2 class="category-title">🎮 Progression <span class="endpoint-count">7</span></h2>
      <div class="endpoints-grid">
        <div class="card"><div class="method">POST</div><span class="endpoint-path">/training</span><p>Train stats (strength/luck/int)</p></div>
        <div class="card"><div class="method">POST</div><span class="endpoint-path">/levelup</span><p>Level up your character</p></div>
        <div class="card"><div class="method">POST</div><span class="endpoint-path">/travel</span><p>Travel to unlock bonuses</p></div>
        <div class="card"><div class="method">POST</div><span class="endpoint-path">/faction</span><p>Join/leave a faction</p></div>
        <div class="card"><div class="method">POST</div><span class="endpoint-path">/loan</span><p>Borrow money (max 1000)</p></div>
        <div class="card"><div class="method">POST</div><span class="endpoint-path">/weekly</span><p>Claim weekly reward (2000)</p></div>
        <div class="card"><div class="method">GET</div><span class="endpoint-path">/profile</span><p>View full profile stats</p></div>
      </div>
    </div>

    <div class="category-section">
      <h2 class="category-title">🛍️ Shop & Inventory <span class="endpoint-count">4</span></h2>
      <div class="endpoints-grid">
        <div class="card"><div class="method">GET</div><span class="endpoint-path">/shop</span><p>View item shop</p></div>
        <div class="card"><div class="method">POST</div><span class="endpoint-path">/buy</span><p>Buy an item</p></div>
        <div class="card"><div class="method">POST</div><span class="endpoint-path">/sell</span><p>Sell an item</p></div>
        <div class="card"><div class="method">GET</div><span class="endpoint-path">/inventory</span><p>View your backpack</p></div>
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
        document.getElementById('onlineStatus').textContent = '🟢';
      } catch(e) {}
    }
    loadStats();
    const canvas = document.getElementById('starfield'), ctx = canvas.getContext('2d');
    let stars = [];
    function resize(){ canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
    window.addEventListener('resize', resize); resize();
    for (let i=0; i<150; i++) stars.push({ x: Math.random()*canvas.width, y: Math.random()*canvas.height, size: Math.random()*2+1 });
    function draw(){ ctx.fillStyle='#0b0a0c'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.fillStyle='#e0d6b0'; stars.forEach(s=>{ ctx.fillRect(s.x,s.y,s.size,s.size); }); requestAnimationFrame(draw); }
    draw();
  </script>
</body>
</html>`;

// ==================== ADMIN LOGIN PAGE ====================
const ADMIN_LOGIN_HTML = `<!DOCTYPE html>
<html><head><title>🔐 Admin Login</title>
<style>
  body{background:#0b0a0c;color:#e0d6b0;font-family:'Inter';display:flex;justify-content:center;align-items:center;height:100vh}
  .box{background:rgba(20,15,10,0.8);border:1px solid #d4af37;padding:2rem;border-radius:20px;text-align:center;width:350px}
  h2{color:#d4af37}
  input{background:#1a1410;border:1px solid #d4af37;color:#e0d6b0;padding:0.8rem;border-radius:10px;width:100%;margin:1rem 0}
  button{background:#d4af37;color:#0b0a0c;border:none;padding:0.8rem 2rem;border-radius:30px;cursor:pointer;font-weight:bold}
  #error{color:#ff4d4d;margin-top:0.5rem}
</style></head>
<body>
  <div class="box">
    <h2>🔐 Admin Login</h2>
    <input type="password" id="pwd" placeholder="Admin Password">
    <button onclick="login()">Login</button>
    <p id="error"></p>
  </div>
  <script>
    async function login(){
      const p=document.getElementById('pwd').value;
      const r=await fetch('/admin/stats',{headers:{'X-Admin-Key':p}});
      if(r.ok){localStorage.setItem('ak',p);window.location.href='/admin/dashboard';}
      else document.getElementById('error').textContent='Wrong password';
    }
  </script>
</body></html>`;

// ==================== ADMIN DASHBOARD PAGE ====================
const ADMIN_DASHBOARD_HTML = `<!DOCTYPE html>
<html><head><title>🏦 Admin Dashboard</title>
<style>
  body{background:#0b0a0c;color:#e0d6b0;font-family:'Inter';padding:1rem}
  .container{max-width:1000px;margin:0 auto}
  h1{color:#d4af37}
  .card{background:rgba(20,15,10,0.6);border:1px solid rgba(212,175,55,0.2);border-radius:15px;padding:1rem;margin:1rem 0}
  table{width:100%;border-collapse:collapse}
  th,td{padding:0.5rem;border-bottom:1px solid rgba(212,175,55,0.2);text-align:left}
  th{background:rgba(212,175,55,0.1)}
  input,button{background:#1a1410;border:1px solid #d4af37;color:#e0d6b0;padding:0.5rem;border-radius:8px;margin:0.2rem}
  button{background:#d4af37;color:#0b0a0c;cursor:pointer}
  .actions{display:flex;gap:1rem;flex-wrap:wrap;margin:1rem 0}
  #resetBtn{background:#ff4d4d}
</style>
</head>
<body>
  <div class="container">
    <h1>🏦 Admin Dashboard</h1>
    <div class="card">
      <h2>💰 Money Circulation</h2>
      <div class="actions">
        <input id="userJid" placeholder="User JID">
        <input id="amount" type="number" placeholder="Amount">
        <button onclick="addMoney()">Add Money</button>
        <button onclick="removeMoney()">Remove Money</button>
        <button id="resetBtn" onclick="resetEconomy()">💣 Reset Economy</button>
      </div>
    </div>
    <div class="card">
      <h2>👥 Users</h2>
      <table id="usersTable"><tr><th>JID</th><th>Balance</th><th>Bank</th><th>Level</th><th>Loan</th></tr></table>
    </div>
  </div>
  <script>
    const ak=localStorage.getItem('ak');if(!ak)window.location.href='/admin';
    async function api(u,m='GET',b=null){const h={'X-Admin-Key':ak};if(b)h['Content-Type']='application/json';const r=await fetch(u,{method:m,headers:h,body:b?JSON.stringify(b):undefined});return r.json()}
    async function load(){const d=await api('/admin/stats');const t=document.getElementById('usersTable');t.innerHTML='<tr><th>JID</th><th>Balance</th><th>Bank</th><th>Level</th><th>Loan</th></tr>';if(d.users)d.users.forEach(u=>{const r=t.insertRow();r.innerHTML=\`<td>\${u.jid}</td><td>\${u.balance}</td><td>\${u.bank}</td><td>\${u.level}</td><td>\${u.loan}</td>\`})}
    async function addMoney(){const j=document.getElementById('userJid').value;const a=parseInt(document.getElementById('amount').value);if(j&&a){await api('/admin/add-money','POST',{jid:j,amount:a});load()}}
    async function removeMoney(){const j=document.getElementById('userJid').value;const a=parseInt(document.getElementById('amount').value);if(j&&a){await api('/admin/remove-money','POST',{jid:j,amount:a});load()}}
    async function resetEconomy(){if(confirm('Reset ALL data? This cannot be undone!')){await api('/admin/reset','POST');load()}}
    load();
  </script>
</body></html>`;

// ==================== ROUTER ====================
const ROUTES = {
  'GET /balance':       (env, jid) => handleGetBalance(env, jid),
  'POST /deposit':      (env, jid, body) => handleDeposit(env, jid, body.amount),
  'POST /withdraw':     (env, jid, body) => handleWithdraw(env, jid, body.amount),
  'POST /pay':          (env, jid, body) => handlePay(env, jid, body.to, body.amount),
  'POST /rob':          (env, jid, body) => handleRob(env, jid, body.target),
  'POST /work':         (env, jid) => handleWork(env, jid),
  'POST /fish':         (env, jid) => handleFish(env, jid),
  'POST /daily':        (env, jid) => handleDaily(env, jid),
  'POST /weekly':       (env, jid) => handleWeekly(env, jid),
  'POST /beg':          (env, jid) => handleBeg(env, jid),
  'POST /loan':         (env, jid, body) => handleLoan(env, jid, body.amount),
  'POST /crime':        (env, jid) => handleCrime(env, jid),
  'POST /drugs':        (env, jid) => handleDrugs(env, jid),
  'POST /hunt':         (env, jid) => handleHunt(env, jid),
  'POST /mine':         (env, jid) => handleMine(env, jid),
  'POST /attack':       (env, jid, body) => handleAttack(env, jid, body.target),
  'POST /gift':         (env, jid, body) => handleGift(env, jid, body.to, body.amount),
  'POST /travel':       (env, jid, body) => handleTravel(env, jid, body.destination),
  'POST /faction':      (env, jid, body) => handleFaction(env, jid, body.action, body.faction),
  'POST /training':     (env, jid, body) => handleTraining(env, jid, body.stat),
  'POST /levelup':      (env, jid) => handleLevelUp(env, jid),
  'GET /inventory':     (env, jid) => handleInventory(env, jid),
  'GET /shop':          (env, jid) => handleShop(env, jid),
  'POST /buy':          (env, jid, body) => handleBuy(env, jid, body.item),
  'POST /sell':         (env, jid, body) => handleSell(env, jid, body.item),
  'GET /profile':       (env, jid) => handleProfile(env, jid),

  // Admin routes
  'GET /admin/stats':   async (env, req) => {
    if (req.headers.get('X-Admin-Key') !== env.ADMIN_PASSWORD) return errorResponse('Unauthorized', 401);
    return handleAdminStats(env);
  },
  'POST /admin/add-money': async (env, req) => {
    if (req.headers.get('X-Admin-Key') !== env.ADMIN_PASSWORD) return errorResponse('Unauthorized', 401);
    const body = await req.json();
    return handleAdminAddMoney(env, body.jid, body.amount);
  },
  'POST /admin/remove-money': async (env, req) => {
    if (req.headers.get('X-Admin-Key') !== env.ADMIN_PASSWORD) return errorResponse('Unauthorized', 401);
    const body = await req.json();
    return handleAdminRemoveMoney(env, body.jid, body.amount);
  },
  'POST /admin/reset': async (env, req) => {
    if (req.headers.get('X-Admin-Key') !== env.ADMIN_PASSWORD) return errorResponse('Unauthorized', 401);
    const body = await req.json();
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

    // Frontend pages
    if (method === 'GET' && (path === '/' || path === '')) {
      return new Response(LANDING_HTML, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
    }
    if (method === 'GET' && path === '/admin') {
      return new Response(ADMIN_LOGIN_HTML, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
    }
    if (method === 'GET' && path === '/admin/dashboard') {
      return new Response(ADMIN_DASHBOARD_HTML, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
    }

    const jid = request.headers.get('X-User-JID') || 'default';
    let body = {};
    if (method === 'POST') {
      try { body = await request.json(); } catch(e) {}
    }

    // Admin routes
    if (path.startsWith('/admin/')) {
      const handler = ROUTES[`${method} ${path}`];
      if (!handler) return errorResponse('Not found', 404);
      return handler(env, request);
    }

    const handler = ROUTES[`${method} ${path}`];
    if (!handler) return errorResponse('Endpoint not found', 404);

    try {
      return await handler(env, jid, body);
    } catch (err) {
      console.error(err);
      return errorResponse('Internal server error', 500);
    }
  }
};