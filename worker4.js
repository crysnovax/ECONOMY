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
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#060a08;min-height:100vh;font-family:'Inter',system-ui,sans-serif;color:#e2f5e8;overflow-x:hidden;position:relative}
    
    /* Animated background */
    .bg-animation{position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none}
    .bg-circle{position:absolute;border-radius:50%;background:radial-gradient(circle,rgba(16,185,129,0.08),transparent 70%);animation:floatCircle 20s infinite ease-in-out}
    .bg-circle:nth-child(1){width:600px;height:600px;top:-200px;left:-100px;animation-delay:0s}
    .bg-circle:nth-child(2){width:500px;height:500px;bottom:-150px;right:-150px;animation-delay:-7s}
    .bg-circle:nth-child(3){width:400px;height:400px;top:50%;left:50%;transform:translate(-50%,-50%);animation-delay:-14s}
    
    @keyframes floatCircle{0%,100%{transform:translate(0,0) scale(1)}25%{transform:translate(40px,-30px) scale(1.05)}50%{transform:translate(-20px,50px) scale(0.95)}75%{transform:translate(-50px,-20px) scale(1.02)}}
    
    /* Grid pattern overlay */
    .grid-overlay{position:fixed;top:0;left:0;width:100%;height:100%;z-index:1;pointer-events:none;opacity:0.03;background-image:linear-gradient(rgba(16,185,129,0.3) 1px,transparent 1px),linear-gradient(90deg,rgba(16,185,129,0.3) 1px,transparent 1px);background-size:60px 60px}
    
    .container{max-width:1300px;margin:0 auto;position:relative;z-index:2;padding:2rem 1.5rem}
    
    /* Header */
    .header{text-align:center;margin-bottom:3.5rem;position:relative}
    .header::before{content:'';position:absolute;top:-50px;left:50%;transform:translateX(-50%);width:300px;height:300px;background:radial-gradient(circle,rgba(16,185,129,0.06),transparent 70%);border-radius:50%;pointer-events:none}
    .logo-icon{font-size:5rem;display:block;margin-bottom:1rem;animation:bounceIn 0.8s cubic-bezier(0.68,-0.55,0.265,1.55)}
    @keyframes bounceIn{0%{opacity:0;transform:scale(0.3)}50%{opacity:1;transform:scale(1.08)}70%{transform:scale(0.95)}100%{transform:scale(1)}}
    h1{font-size:4rem;font-weight:900;background:linear-gradient(135deg,#10b981 0%,#34d399 30%,#6ee7b7 60%,#10b981 100%);background-size:200% 200%;-webkit-background-clip:text;-webkit-text-fill-color:transparent;animation:shimmer 3s ease-in-out infinite;margin-bottom:0.8rem;letter-spacing:-0.02em}
    @keyframes shimmer{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}
    .subtitle{font-size:1.3rem;color:#6aa886;margin-bottom:1.5rem;font-weight:400;letter-spacing:0.02em}
    .powered-badge{display:inline-block;background:linear-gradient(135deg,rgba(16,185,129,0.15),rgba(52,211,153,0.1));border:1px solid rgba(16,185,129,0.3);padding:10px 28px;border-radius:50px;font-size:0.95rem;font-weight:500;letter-spacing:0.04em;backdrop-filter:blur(10px);margin-bottom:1.2rem;animation:fadeInUp 0.6s ease-out}
    @keyframes fadeInUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
    .status-pill{display:inline-flex;align-items:center;gap:10px;background:rgba(10,30,15,0.7);border:1px solid rgba(16,185,129,0.3);padding:10px 26px;border-radius:50px;font-size:0.95rem;backdrop-filter:blur(10px);animation:fadeInUp 0.6s ease-out 0.2s both}
    .pulse-dot{width:14px;height:14px;background:#10b981;border-radius:50%;position:relative}
    .pulse-dot::after{content:'';position:absolute;top:-4px;left:-4px;width:22px;height:22px;background:rgba(16,185,129,0.3);border-radius:50%;animation:pulse 2s infinite}
    @keyframes pulse{0%{transform:scale(1);opacity:1}100%{transform:scale(2.5);opacity:0}}
    
    /* Stats */
    .stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px;margin-bottom:3rem}
    .stat-card{background:linear-gradient(145deg,rgba(10,30,18,0.8),rgba(8,25,15,0.9));border:1px solid rgba(16,185,129,0.2);border-radius:24px;padding:2rem 1.5rem;text-align:center;backdrop-filter:blur(15px);transition:all 0.4s cubic-bezier(0.175,0.885,0.32,1.275);position:relative;overflow:hidden;cursor:default}
    .stat-card::before{content:'';position:absolute;top:0;left:-100%;width:100%;height:100%;background:linear-gradient(90deg,transparent,rgba(16,185,129,0.05),transparent);transition:left 0.6s ease}
    .stat-card:hover::before{left:100%}
    .stat-card:hover{transform:translateY(-6px);box-shadow:0 20px 50px rgba(16,185,129,0.12),0 0 80px rgba(16,185,129,0.05);border-color:rgba(16,185,129,0.5)}
    .stat-icon{font-size:2.5rem;margin-bottom:0.8rem;display:block;animation:fadeInUp 0.5s ease-out}
    .stat-number{font-size:2.8rem;font-weight:800;background:linear-gradient(135deg,#10b981,#34d399);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:0.4rem}
    .stat-label{color:#6aa886;font-size:0.95rem;font-weight:500;letter-spacing:0.03em;text-transform:uppercase}
    
    /* Sections */
    .section{margin-bottom:3rem;animation:fadeInUp 0.6s ease-out}
    .section-title{font-size:1.6rem;font-weight:700;color:#10b981;margin-bottom:1.2rem;padding-bottom:0.6rem;border-bottom:2px solid rgba(16,185,129,0.2);display:flex;align-items:center;gap:12px;letter-spacing:-0.01em}
    .badge{display:inline-flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#10b981,#059669);color:#060a08;padding:4px 14px;border-radius:20px;font-size:0.8rem;font-weight:700;min-width:32px}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
    .card{background:linear-gradient(145deg,rgba(10,28,18,0.7),rgba(8,22,15,0.8));border:1px solid rgba(16,185,129,0.15);border-radius:18px;padding:1.3rem;transition:all 0.35s cubic-bezier(0.175,0.885,0.32,1.275);cursor:pointer;backdrop-filter:blur(10px);position:relative;overflow:hidden}
    .card:hover{transform:translateY(-4px);box-shadow:0 15px 40px rgba(16,185,129,0.1),0 0 60px rgba(16,185,129,0.03);border-color:rgba(16,185,129,0.45)}
    .card::after{content:'';position:absolute;bottom:0;left:0;width:0;height:2px;background:linear-gradient(90deg,#10b981,#34d399);transition:width 0.4s ease}
    .card:hover::after{width:100%}
    .method-tag{display:inline-block;background:linear-gradient(135deg,#10b981,#059669);color:#060a08;font-weight:700;padding:3px 10px;border-radius:8px;font-size:0.7rem;margin-right:10px;letter-spacing:0.04em}
    .path-text{font-family:'SF Mono','Fira Code','Monaco',monospace;color:#34d399;font-size:0.9rem;font-weight:500}
    .desc-text{color:#7aa891;font-size:0.85rem;margin-top:8px;line-height:1.5}
    
    /* Admin link */
    .admin-section{text-align:center;margin:3rem 0 2rem}
    .admin-btn{display:inline-flex;align-items:center;gap:10px;color:#10b981;text-decoration:none;border:1px solid rgba(16,185,129,0.3);padding:14px 32px;border-radius:50px;font-weight:600;font-size:1rem;transition:all 0.4s cubic-bezier(0.175,0.885,0.32,1.275);background:rgba(16,185,129,0.05);backdrop-filter:blur(10px);letter-spacing:0.02em}
    .admin-btn:hover{background:linear-gradient(135deg,#10b981,#059669);color:#060a08;border-color:#10b981;transform:translateY(-3px);box-shadow:0 15px 40px rgba(16,185,129,0.25)}
    
    /* Footer */
    .footer{text-align:center;color:#4a7a5a;margin-top:3rem;padding-top:2.5rem;border-top:1px solid rgba(16,185,129,0.1);font-size:0.9rem;letter-spacing:0.03em}
    
    /* Responsive */
    @media (max-width:768px){h1{font-size:2.5rem}.stat-number{font-size:2rem}.container{padding:1rem}}
  </style>
</head>
<body>
  <div class="bg-animation">
    <div class="bg-circle"></div>
    <div class="bg-circle"></div>
    <div class="bg-circle"></div>
  </div>
  <div class="grid-overlay"></div>
  
  <div class="container">
    <div class="header">
      <span class="logo-icon">🏦</span>
      <h1>CRYSN⎔VA Economy</h1>
      <div class="powered-badge">💰 REALISTIC VIRTUAL ECONOMY ENGINE</div>
      <div class="subtitle">30+ Endpoints • Phone-Based Storage • Bank-Safe System</div>
      <div class="status-pill"><span class="pulse-dot"></span>🌐 All Systems Operational</div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <span class="stat-icon">👥</span>
        <div class="stat-number" id="totalUsers">—</div>
        <div class="stat-label">Total Users</div>
      </div>
      <div class="stat-card">
        <span class="stat-icon">💰</span>
        <div class="stat-number" id="totalMoney">—</div>
        <div class="stat-label">In Circulation</div>
      </div>
      <div class="stat-card">
        <span class="stat-icon">🏆</span>
        <div class="stat-number" id="richestUser">—</div>
        <div class="stat-label">Richest Player</div>
      </div>
      <div class="stat-card">
        <span class="stat-icon">📡</span>
        <div class="stat-number" style="font-size:2rem">🟢 Online</div>
        <div class="stat-label">API Status</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">🏦 Core Banking <span class="badge">5</span></div>
      <div class="grid">
        <div class="card"><span class="method-tag">GET</span><span class="path-text">/balance</span><div class="desc-text">Check wallet & bank balance</div></div>
        <div class="card"><span class="method-tag">POST</span><span class="path-text">/activate</span><div class="desc-text">Activate new account</div></div>
        <div class="card"><span class="method-tag">POST</span><span class="path-text">/deposit</span><div class="desc-text">Deposit to bank (safe from robbery)</div></div>
        <div class="card"><span class="method-tag">POST</span><span class="path-text">/withdraw</span><div class="desc-text">Withdraw from bank</div></div>
        <div class="card"><span class="method-tag">POST</span><span class="path-text">/loan</span><div class="desc-text">Get a loan (max 1,000 coins)</div></div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">💸 Transfers <span class="badge">4</span></div>
      <div class="grid">
        <div class="card"><span class="method-tag">POST</span><span class="path-text">/pay</span><div class="desc-text">Send money by phone number</div></div>
        <div class="card"><span class="method-tag">POST</span><span class="path-text">/rob</span><div class="desc-text">Rob someone (wallet only)</div></div>
        <div class="card"><span class="method-tag">POST</span><span class="path-text">/attack</span><div class="desc-text">Attack another player</div></div>
        <div class="card"><span class="method-tag">POST</span><span class="path-text">/gift</span><div class="desc-text">Send a gift</div></div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">💼 Jobs & Income <span class="badge">7</span></div>
      <div class="grid">
        <div class="card"><span class="method-tag">POST</span><span class="path-text">/work</span><div class="desc-text">Work for coins & XP</div></div>
        <div class="card"><span class="method-tag">POST</span><span class="path-text">/fish</span><div class="desc-text">Go fishing</div></div>
        <div class="card"><span class="method-tag">POST</span><span class="path-text">/mine</span><div class="desc-text">Mine for ores</div></div>
        <div class="card"><span class="method-tag">POST</span><span class="path-text">/hunt</span><div class="desc-text">Hunt animals</div></div>
        <div class="card"><span class="method-tag">POST</span><span class="path-text">/beg</span><div class="desc-text">Beg for coins</div></div>
        <div class="card"><span class="method-tag">POST</span><span class="path-text">/daily</span><div class="desc-text">Daily reward (500 coins)</div></div>
        <div class="card"><span class="method-tag">POST</span><span class="path-text">/weekly</span><div class="desc-text">Weekly bonus (2,000 coins)</div></div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">⚠️ Crime & Risk <span class="badge">2</span></div>
      <div class="grid">
        <div class="card"><span class="method-tag">POST</span><span class="path-text">/crime</span><div class="desc-text">Commit a crime (risky)</div></div>
        <div class="card"><span class="method-tag">POST</span><span class="path-text">/drugs</span><div class="desc-text">Deal drugs (high risk)</div></div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">🎮 Progression <span class="badge">6</span></div>
      <div class="grid">
        <div class="card"><span class="method-tag">POST</span><span class="path-text">/training</span><div class="desc-text">Train your stats</div></div>
        <div class="card"><span class="method-tag">POST</span><span class="path-text">/levelup</span><div class="desc-text">Level up character</div></div>
        <div class="card"><span class="method-tag">POST</span><span class="path-text">/travel</span><div class="desc-text">Travel to locations</div></div>
        <div class="card"><span class="method-tag">POST</span><span class="path-text">/faction</span><div class="desc-text">Join/leave factions</div></div>
        <div class="card"><span class="method-tag">GET</span><span class="path-text">/profile</span><div class="desc-text">View full profile</div></div>
        <div class="card"><span class="method-tag">GET</span><span class="path-text">/inventory</span><div class="desc-text">View your backpack</div></div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">🛍️ Shop & Trading <span class="badge">3</span></div>
      <div class="grid">
        <div class="card"><span class="method-tag">GET</span><span class="path-text">/shop</span><div class="desc-text">View item shop</div></div>
        <div class="card"><span class="method-tag">POST</span><span class="path-text">/buy</span><div class="desc-text">Buy an item</div></div>
        <div class="card"><span class="method-tag">POST</span><span class="path-text">/sell</span><div class="desc-text">Sell an item</div></div>
      </div>
    </div>

    <div class="admin-section">
      <a href="/admin" class="admin-btn">🔐 Admin Dashboard</a>
    </div>
    
    <div class="footer">🏦 CRYSN⚉VA Economy • Realistic Virtual Economy Engine • © 2026</div>
  </div>

  <script>
    async function loadStats(){
      try{
        const r=await fetch('/admin/stats');
        const d=await r.json();
        document.getElementById('totalUsers').textContent=(d.totalUsers||0).toLocaleString();
        document.getElementById('totalMoney').textContent=(d.totalMoneyInCirculation||0).toLocaleString()+'c';
        document.getElementById('richestUser').textContent=d.richestUser?d.richestUser.total.toLocaleString()+'c':'—';
      }catch(e){}
    }
    loadStats();
  </script>
</body>
</html>`;
const ADMIN_LOGIN_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🔐 Admin Login</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#060a08;min-height:100vh;font-family:'Inter',system-ui,sans-serif;display:flex;justify-content:center;align-items:center;position:relative;overflow:hidden}
    
    .bg-animation{position:fixed;top:0;left:0;width:100%;height:100%;z-index:0}
    .bg-circle{position:absolute;border-radius:50%;background:radial-gradient(circle,rgba(16,185,129,0.06),transparent 70%);animation:float 15s infinite ease-in-out}
    .bg-circle:nth-child(1){width:500px;height:500px;top:-150px;left:-100px;animation-delay:0s}
    .bg-circle:nth-child(2){width:400px;height:400px;bottom:-100px;right:-100px;animation-delay:-5s}
    @keyframes float{0%,100%{transform:translate(0,0)}50%{transform:translate(30px,-30px)}}
    
    .login-container{position:relative;z-index:1;width:420px;animation:fadeInUp 0.6s ease-out}
    @keyframes fadeInUp{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}}
    
    .login-box{background:linear-gradient(145deg,rgba(10,30,18,0.9),rgba(8,22,14,0.95));border:1px solid rgba(16,185,129,0.25);border-radius:28px;padding:3rem 2.5rem;text-align:center;backdrop-filter:blur(20px);box-shadow:0 30px 80px rgba(0,0,0,0.5),0 0 120px rgba(16,185,129,0.06)}
    
    .lock-icon{font-size:4rem;display:block;margin-bottom:1.5rem;animation:bounceIn 0.8s cubic-bezier(0.68,-0.55,0.265,1.55)}
    @keyframes bounceIn{0%{opacity:0;transform:scale(0.3)}50%{opacity:1;transform:scale(1.08)}70%{transform:scale(0.95)}100%{transform:scale(1)}}
    
    h2{font-size:1.8rem;font-weight:700;background:linear-gradient(135deg,#10b981,#34d399);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:0.5rem}
    .subtitle{color:#6aa886;font-size:0.9rem;margin-bottom:2rem}
    
    .input-group{position:relative;margin-bottom:1.5rem}
    .input-group input{width:100%;background:rgba(10,26,16,0.8);border:1px solid rgba(16,185,129,0.3);color:#e2f5e8;padding:1rem 1.2rem;border-radius:14px;font-size:1rem;transition:all 0.3s ease;outline:none;font-family:'Inter',sans-serif}
    .input-group input:focus{border-color:#10b981;box-shadow:0 0 0 4px rgba(16,185,129,0.1),0 0 30px rgba(16,185,129,0.08)}
    .input-group input::placeholder{color:#4a7a5a}
    
    .login-btn{width:100%;background:linear-gradient(135deg,#10b981,#059669);color:#060a08;border:none;padding:1rem;border-radius:14px;font-size:1.05rem;font-weight:700;cursor:pointer;transition:all 0.3s ease;letter-spacing:0.02em}
    .login-btn:hover{transform:translateY(-2px);box-shadow:0 15px 40px rgba(16,185,129,0.3)}
    .login-btn:active{transform:scale(0.98)}
    
    .error-msg{color:#ef4444;font-size:0.9rem;margin-top:1rem;min-height:24px;transition:all 0.3s ease}
    
    .back-link{display:block;margin-top:1.5rem;color:#4a7a5a;text-decoration:none;font-size:0.9rem;transition:color 0.3s}
    .back-link:hover{color:#10b981}
  </style>
</head>
<body>
  <div class="bg-animation">
    <div class="bg-circle"></div>
    <div class="bg-circle"></div>
  </div>
  
  <div class="login-container">
    <div class="login-box">
      <span class="lock-icon">🔐</span>
      <h2>Admin Access</h2>
      <p class="subtitle">Enter your credentials to continue</p>
      
      <div class="input-group">
        <input type="password" id="pwd" placeholder="Enter admin password" autofocus autocomplete="off">
      </div>
      
      <button class="login-btn" onclick="login()">Authenticate →</button>
      <p class="error-msg" id="error"></p>
    </div>
    <a href="/" class="back-link">← Back to API</a>
  </div>

  <script>
    async function login(){
      const pwd=document.getElementById('pwd').value;
      if(!pwd){document.getElementById('error').textContent='Please enter password';return}
      document.getElementById('error').textContent='Verifying...';
      document.querySelector('.login-btn').textContent='Authenticating...';
      try{
        const r=await fetch('/admin/stats',{headers:{'X-Admin-Key':pwd}});
        if(r.ok){localStorage.setItem('adminKey',pwd);window.location.href='/admin/dashboard'}
        else{document.getElementById('error').textContent='❌ Invalid password';document.querySelector('.login-btn').textContent='Authenticate →'}
      }catch(e){document.getElementById('error').textContent='Connection error';document.querySelector('.login-btn').textContent='Authenticate →'}
    }
    document.getElementById('pwd').addEventListener('keypress',function(e){if(e.key==='Enter')login()});
  </script>
</body>
</html>`;
const ADMIN_DASHBOARD_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🏦 Admin Dashboard</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#060a08;min-height:100vh;font-family:'Inter',system-ui,sans-serif;color:#e2f5e8;padding:1.5rem;position:relative}
    
    .bg-animation{position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none}
    .bg-circle{position:absolute;border-radius:50%;background:radial-gradient(circle,rgba(16,185,129,0.04),transparent 70%);animation:float 20s infinite ease-in-out}
    .bg-circle:nth-child(1){width:600px;height:600px;top:-200px;right:-100px}
    .bg-circle:nth-child(2){width:500px;height:500px;bottom:-150px;left:-150px;animation-delay:-8s}
    @keyframes float{0%,100%{transform:translate(0,0)}50%{transform:translate(-20px,20px)}}
    
    .container{max-width:1200px;margin:0 auto;position:relative;z-index:1}
    
    .header{display:flex;justify-content:space-between;align-items:center;margin-bottom:2rem;flex-wrap:wrap;gap:1rem}
    h1{font-size:2.2rem;font-weight:800;background:linear-gradient(135deg,#10b981,#34d399);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .logout-btn{background:transparent;border:1px solid rgba(239,68,68,0.4);color:#fca5a5;padding:0.6rem 1.5rem;border-radius:12px;cursor:pointer;font-weight:600;font-size:0.9rem;transition:all 0.3s}
    .logout-btn:hover{background:rgba(239,68,68,0.15);border-color:#ef4444}
    
    .card{background:linear-gradient(145deg,rgba(10,28,18,0.8),rgba(8,22,14,0.9));border:1px solid rgba(16,185,129,0.2);border-radius:22px;padding:1.8rem;margin-bottom:1.5rem;backdrop-filter:blur(15px);animation:fadeInUp 0.5s ease-out}
    @keyframes fadeInUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
    
    h2{color:#10b981;font-size:1.3rem;font-weight:700;margin-bottom:1.2rem}
    
    .actions{display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-bottom:1rem}
    input{background:rgba(10,26,16,0.8);border:1px solid rgba(16,185,129,0.3);color:#e2f5e8;padding:0.8rem 1.1rem;border-radius:12px;font-size:0.95rem;min-width:220px;transition:all 0.3s;outline:none;font-family:'Inter',sans-serif}
    input:focus{border-color:#10b981;box-shadow:0 0 0 3px rgba(16,185,129,0.1)}
    input::placeholder{color:#4a7a5a}
    
    .btn{background:linear-gradient(135deg,#10b981,#059669);color:#060a08;border:none;padding:0.8rem 1.6rem;border-radius:12px;cursor:pointer;font-weight:700;font-size:0.9rem;transition:all 0.3s;letter-spacing:0.02em}
    .btn:hover{transform:translateY(-2px);box-shadow:0 10px 30px rgba(16,185,129,0.25)}
    .btn:active{transform:scale(0.98)}
    .btn-danger{background:linear-gradient(135deg,#ef4444,#dc2626)}
    .btn-danger:hover{box-shadow:0 10px 30px rgba(239,68,68,0.25)}
    
    .status-msg{padding:0.8rem 1.2rem;border-radius:12px;font-size:0.9rem;margin-top:1rem;display:none;animation:fadeIn 0.3s}
    @keyframes fadeIn{from{opacity:0}to{opacity:1}}
    .success{background:rgba(16,185,129,0.15);color:#6ee7b7;border:1px solid rgba(16,185,129,0.3);display:block}
    .error{background:rgba(239,68,68,0.15);color:#fca5a5;border:1px solid rgba(239,68,68,0.3);display:block}
    
    .hint{font-size:0.82rem;color:#6aa886;margin-top:0.6rem}
    
    table{width:100%;border-collapse:collapse;font-size:0.92rem;border-radius:16px;overflow:hidden}
    thead{background:rgba(16,185,129,0.08)}
    th{color:#10b981;font-weight:700;padding:1rem 0.8rem;text-align:left;font-size:0.85rem;letter-spacing:0.04em;text-transform:uppercase}
    td{padding:0.9rem 0.8rem;border-bottom:1px solid rgba(16,185,129,0.08);transition:background 0.2s}
    tbody tr:hover{background:rgba(16,185,129,0.04)}
    tbody tr:last-child td{border-bottom:none}
    
    .empty-state{text-align:center;padding:3rem;color:#4a7a5a}
    .empty-icon{font-size:3rem;display:block;margin-bottom:1rem}
    
    @media (max-width:768px){.actions{flex-direction:column}input{width:100%}}
  </style>
</head>
<body>
  <div class="bg-animation">
    <div class="bg-circle"></div>
    <div class="bg-circle"></div>
  </div>
  
  <div class="container">
    <div class="header">
      <h1>🏦 Admin Dashboard</h1>
      <button class="logout-btn" onclick="logout()">🚪 Logout</button>
    </div>

    <div class="card" style="animation-delay:0.1s">
      <h2>💰 Manage Money Circulation</h2>
      <div class="actions">
        <input id="phoneInput" placeholder="Phone number (e.g. 2348077528901)" autocomplete="off">
        <input id="amountInput" type="number" placeholder="Amount" min="1" autocomplete="off">
        <button class="btn" onclick="addMoney()">➕ Add Money</button>
        <button class="btn" onclick="removeMoney()">➖ Remove Money</button>
        <button class="btn btn-danger" onclick="resetEconomy()">💣 Reset All</button>
      </div>
      <p class="hint">💡 Enter phone number and amount, then click Add or Remove. Bank money reflected instantly.</p>
      <div id="statusMsg" class="status-msg"></div>
    </div>

    <div class="card" style="animation-delay:0.2s">
      <h2>👥 All Users</h2>
      <div style="overflow-x:auto">
        <table>
          <thead><tr><th>Phone</th><th>💰 Wallet</th><th>🏦 Bank</th><th>💎 Total</th><th>⭐ Level</th><th>💳 Loan</th></tr></thead>
          <tbody id="usersTableBody"><tr><td colspan="6"><div class="empty-state"><span class="empty-icon">📊</span>Loading users...</div></td></tr></tbody>
        </table>
      </div>
    </div>
  </div>

  <script>
    const ak=localStorage.getItem('adminKey');
    if(!ak)window.location.href='/admin';

    function logout(){localStorage.removeItem('adminKey');window.location.href='/admin'}

    async function apiCall(path,method='GET',body=null){
      const headers={'X-Admin-Key':ak};
      if(body)headers['Content-Type']='application/json';
      const r=await fetch(path,{method,headers,body:body?JSON.stringify(body):undefined});
      return r.json();
    }

    function showStatus(msg,type){
      const el=document.getElementById('statusMsg');
      el.textContent=msg;el.className='status-msg '+type;
      setTimeout(()=>{el.textContent='';el.className='status-msg'},4000);
    }

    async function loadUsers(){
      try{
        const d=await apiCall('/admin/stats');
        const t=document.getElementById('usersTableBody');
        if(!d.users||!d.users.length){t.innerHTML='<tr><td colspan="6"><div class="empty-state"><span class="empty-icon">👻</span>No users yet</div></td></tr>';return}
        t.innerHTML=d.users.map(u=>{
          const total=(u.balance||0)+(u.bank||0);
          return '<tr><td><strong>'+u.phone+'</strong></td><td>💰 '+(u.balance||0).toLocaleString()+'</td><td>🏦 '+(u.bank||0).toLocaleString()+'</td><td>💎 '+total.toLocaleString()+'</td><td>⭐ '+(u.level||1)+'</td><td>'+(u.loan?'💳 '+u.loan.toLocaleString():'—')+'</td></tr>';
        }).join('');
      }catch(e){showStatus('Failed to load users','error')}
    }

    async function addMoney(){
      const phone=document.getElementById('phoneInput').value.trim();
      const amount=parseInt(document.getElementById('amountInput').value);
      if(!phone){showStatus('❌ Enter phone number','error');return}
      if(!amount||amount<=0){showStatus('❌ Enter valid amount','error');return}
      try{
        await apiCall('/admin/add-money','POST',{phone,amount});
        showStatus('✅ Added '+amount.toLocaleString()+' coins to '+phone,'success');
        document.getElementById('phoneInput').value='';document.getElementById('amountInput').value='';
        loadUsers();
      }catch(e){showStatus('❌ Failed to add money','error')}
    }

    async function removeMoney(){
      const phone=document.getElementById('phoneInput').value.trim();
      const amount=parseInt(document.getElementById('amountInput').value);
      if(!phone){showStatus('❌ Enter phone number','error');return}
      if(!amount||amount<=0){showStatus('❌ Enter valid amount','error');return}
      try{
        await apiCall('/admin/remove-money','POST',{phone,amount});
        showStatus('✅ Removed '+amount.toLocaleString()+' coins from '+phone,'success');
        document.getElementById('phoneInput').value='';document.getElementById('amountInput').value='';
        loadUsers();
      }catch(e){showStatus('❌ Failed to remove money','error')}
    }

    async function resetEconomy(){
      if(!confirm('⚠️ DELETE ALL economy data? This cannot be undone!'))return;
      if(!confirm('FINAL WARNING: Are you absolutely sure?'))return;
      try{await apiCall('/admin/reset','POST');showStatus('✅ Economy completely reset','success');loadUsers()}catch(e){showStatus('❌ Reset failed','error')}
    }

    document.getElementById('amountInput').addEventListener('keypress',function(e){if(e.key==='Enter')addMoney()});
    loadUsers();
    setInterval(loadUsers,30000);
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