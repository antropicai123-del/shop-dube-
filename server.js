require('dotenv').config();
const express = require('express');
const path = require('path');
const { pool } = require('./lib/db');
const { round2, allocateDubePayments, customerBalance, customerSummary, dailySettlement, settlementHistory } = require('./lib/ledger');
const telegram = require('./lib/telegram');

const app = express();

// Catch errors in async routes so one bad request cannot crash the server
['get', 'post', 'put', 'delete'].forEach(m => {
  const orig = app[m].bind(app);
  app[m] = (p, ...handlers) => orig(p, ...handlers.map(h => (req, res, next) => Promise.resolve(h(req, res, next)).catch(next)));
});

// Simple password (set APP_PASSWORD in Render > Environment). Any username works.
app.use((req, res, next) => {
  const pw = process.env.APP_PASSWORD;
  if (!pw || req.path === '/healthz') return next();
  const [, b64] = (req.headers.authorization || '').split(' ');
  const given = Buffer.from(b64 || '', 'base64').toString().split(':').slice(1).join(':');
  if (given === pw) return next();
  res.set('WWW-Authenticate', 'Basic realm="Shop"').status(401).send('Password required');
});

app.get('/healthz', (req, res) => res.send('ok'));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ethiopia is UTC+3, so use that for "today"
const today = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
const positive = n => Number.isFinite(Number(n)) && Number(n) > 0;

// Settings
app.get('/api/settings', async (req, res) => {
  const rows = (await pool.query(`SELECT key, value FROM shop_settings`)).rows;
  const m = Object.fromEntries(rows.map(r => [r.key, r.value]));
  res.json({ shop_name: m.shop_name || '', shop_address: m.shop_address || '', shop_phone: m.shop_phone || '', has_telegram_token: !!m.telegram_bot_token });
});

app.put('/api/settings', async (req, res) => {
  for (const [k, v] of Object.entries(req.body || {})) {
    if (k === 'telegram_bot_token' && v === '__keep__') continue;
    await pool.query(`INSERT INTO shop_settings (key, value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [k, String(v ?? '')]);
  }
  res.json({ ok: true });
});

// Operators
app.get('/api/operators', async (req, res) => res.json((await pool.query(`SELECT * FROM operators WHERE is_active=1 ORDER BY id`)).rows));
app.post('/api/operators', async (req, res) => {
  const { name, role } = req.body;
  const r = await pool.query(`INSERT INTO operators (name, role) VALUES ($1,$2) RETURNING *`, [name, role || 'staff']);
  res.json(r.rows[0]);
});

// Customers
app.get('/api/customers', async (req, res) => {
  const q = (req.query.q || '').trim();
  let rows;
  if (q) rows = (await pool.query(`SELECT * FROM customers WHERE is_active=1 AND (name ILIKE $1 OR phone LIKE $1) ORDER BY name`, [`%${q}%`])).rows;
  else rows = (await pool.query(`SELECT * FROM customers WHERE is_active=1 ORDER BY name`)).rows;
  
  const out = [];
  for (const c of rows) out.push({ ...c, balance: await customerBalance(c.id) });
  res.json(out);
});

app.get('/api/customers/:id', async (req, res) => {
  const c = (await pool.query(`SELECT * FROM customers WHERE id=$1`, [req.params.id])).rows[0];
  if (!c) return res.status(404).json({ error: 'not found' });
  const txs = await allocateDubePayments(c.id);
  const fullTxs = [];
  for (const tx of txs) {
    const items = (await pool.query(`SELECT * FROM dube_items WHERE transaction_id=$1`, [tx.id])).rows;
    fullTxs.push({ ...tx, items });
  }
  const payments = (await pool.query(`SELECT * FROM dube_payments WHERE customer_id=$1 ORDER BY payment_date DESC`, [c.id])).rows;
  res.json({ ...c, summary: await customerSummary(c.id), transactions: fullTxs, payments });
});

app.post('/api/customers', async (req, res) => {
  const { name, phone, telegram_username, telegram_chat_id, notes } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  try {
    const r = await pool.query(`INSERT INTO customers (name, phone, telegram_username, telegram_chat_id, notes) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [name, phone || null, telegram_username || null, telegram_chat_id || null, notes || null]);
    res.json(r.rows[0]);
  } catch(e) { res.status(400).json({error: e.message}); }
});

// Items
app.get('/api/items', async (req, res) => res.json((await pool.query(`SELECT * FROM items WHERE is_active=1 ORDER BY name`)).rows));
app.post('/api/items', async (req, res) => {
  const { name, unit, default_price } = req.body;
  const r = await pool.query(`INSERT INTO items (name, unit, default_price) VALUES ($1,$2,$3) RETURNING *`, [name, unit, default_price]);
  res.json(r.rows[0]);
});

// Dube
app.post('/api/dube', async (req, res) => {
  const { customer_id, notes, items, operator_id } = req.body;
  if (!customer_id || !Array.isArray(items) || !items.length || !items.every(it => it.item_name && positive(it.quantity) && positive(it.unit_price)))
    return res.status(400).json({ error: 'Choose a customer and add at least one item with quantity and price' });
  const total = round2(items.reduce((s, it) => s + it.quantity * it.unit_price, 0));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tx = (await client.query(`INSERT INTO dube_transactions (customer_id, notes, total_amount, operator_id) VALUES ($1,$2,$3,$4) RETURNING id`, [customer_id, notes || null, total, operator_id || null])).rows[0];
    for (const it of items) {
      await client.query(`INSERT INTO dube_items (transaction_id, item_name, unit, quantity, unit_price, line_total) VALUES ($1,$2,$3,$4,$5,$6)`, [tx.id, it.item_name, it.unit || null, it.quantity, it.unit_price, round2(it.quantity * it.unit_price)]);
    }
    await client.query('COMMIT');
    res.json({ id: tx.id, total_amount: total });
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
});

// Payments
app.post('/api/dube-payments', async (req, res) => {
  const { customer_id, amount, payment_method, operator_id } = req.body;
  if (!customer_id || !positive(amount)) return res.status(400).json({ error: 'Amount must be more than 0' });
  await pool.query(`INSERT INTO dube_payments (customer_id, amount, payment_method, operator_id) VALUES ($1,$2,$3,$4)`, [customer_id, amount, payment_method || 'cash', operator_id || null]);
  res.json({ ok: true });
});

// Balitina & Expenses
app.get('/api/balitina', async (req, res) => {
  const { from, to } = req.query;
  const rows = (await pool.query(`SELECT * FROM balitina_sales WHERE is_void=0 AND sale_date >= $1 AND sale_date <= $2 ORDER BY sale_date DESC`, [from || '1970-01-01', to || '2100-01-01'])).rows;
  res.json(rows);
});
app.post('/api/balitina', async (req, res) => {
  const { amount, sale_date } = req.body;
  if (!positive(amount)) return res.status(400).json({ error: 'Amount must be more than 0' });
  await pool.query(`INSERT INTO balitina_sales (sale_date, amount) VALUES (COALESCE($1, CURRENT_DATE), $2)`, [sale_date, amount]);
  res.json({ ok: true });
});
app.get('/api/expenses', async (req, res) => {
  const { from, to } = req.query;
  const rows = (await pool.query(`SELECT * FROM household_expenses WHERE is_void=0 AND expense_date >= $1 AND expense_date <= $2 ORDER BY expense_date DESC`, [from || '1970-01-01', to || '2100-01-01'])).rows;
  res.json(rows);
});
app.post('/api/expenses', async (req, res) => {
  const { amount, description, expense_date } = req.body;
  if (!positive(amount)) return res.status(400).json({ error: 'Amount must be more than 0' });
  await pool.query(`INSERT INTO household_expenses (expense_date, amount, description) VALUES (COALESCE($1, CURRENT_DATE), $2, $3)`, [expense_date, amount, description]);
  res.json({ ok: true });
});

// Daily settlement (the Daily tab calls this)
app.get('/api/settlement/:date', async (req, res) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) return res.status(400).json({ error: 'Bad date' });
  res.json(await dailySettlement(req.params.date));
});

// Dashboard
app.get('/api/dashboard', async (req, res) => {
  const cs = (await pool.query(`SELECT id FROM customers WHERE is_active=1`)).rows;
  let totalOutstanding = 0, debtors = 0;
  for (const c of cs) {
    const b = await customerBalance(c.id);
    if (b > 0.01) { debtors++; totalOutstanding += b; }
  }
  const todaySettle = await dailySettlement(today());
  const { cumulative } = await settlementHistory();
  res.json({ dube: { totalOutstanding: round2(totalOutstanding), debtors }, today: todaySettle, cumulative, cumulativeStatus: cumulative > 0.01 ? 'keri' : cumulative < -0.01 ? 'alebat' : 'balanced' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

const PORT = process.env.PORT || 3000;
const schema = require('fs').readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
pool.query(schema)
  .then(() => app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`)))
  .catch(e => { console.error('Database setup failed:', e.message); process.exit(1); });
