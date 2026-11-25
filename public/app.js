let ME = null;
let CUSTOMERS = [], ITEMS = [];
let currentDay = new Date().toISOString().slice(0,10);

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const money = n => (Number(n)||0).toFixed(2);
const esc = s => (s ?? '').toString().replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statusClass = st => st === 'keri' ? 'keri' : st === 'alebat' ? 'alebat' : 'balanced';

async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers||{}) }});
  if (!r.ok) throw new Error((await r.json().catch(()=>({}))).error || 'Request failed');
  return r.json();
}

async function initOperator() {
  const users = await api('/api/operators');
  const saved = Number(localStorage.getItem('operator_id'));
  ME = users.find(u => u.id === saved) || users[0];
  if (ME) $('#operator-chip').textContent = `👤 ${ME.name}`;
  $('#operator-chip').onclick = () => pickOperator(users);
}

function pickOperator(users) {
  openModal(`
    <h3>Who is recording?</h3>
    <div class="list">${users.map(u => `<div class="row-item" data-pick="${u.id}"><div class="left"><div class="name">${esc(u.name)}</div></div>${ME && ME.id === u.id ? '<span class="badge settled">current</span>' : ''}</div>`).join('')}</div>
    <div class="actions"><button class="btn" data-close>Close</button></div>
  `);
  $$('[data-pick]').forEach(el => el.onclick = () => {
    ME = users.find(x => x.id === Number(el.dataset.pick));
    localStorage.setItem('operator_id', ME.id);
    $('#operator-chip').textContent = `👤 ${ME.name}`;
    closeModal();
  });
}

$$('.tab').forEach(btn => btn.onclick = () => switchTab(btn.dataset.tab));
function switchTab(name) {
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab-panel').forEach(p => p.classList.remove('active'));
  $(`#tab-${name}`)?.classList.add('active');
  if (name === 'dashboard') loadDashboard();
  if (name === 'dube') loadCustomers();
  if (name === 'new-dube') initDubeForm();
  if (name === 'daily') loadDaily(currentDay);
  if (name === 'items') loadItems();
  if (name === 'settings') loadSettings();
}

async function loadDashboard() {
  const d = await api('/api/dashboard');
  $('#kpi-dube').textContent = `${money(d.dube.totalOutstanding)} ብር`;
  $('#kpi-debtors').textContent = `${d.dube.debtors} debtors`;
  $('#kpi-balitina').textContent = `${money(d.today.balitina)} ብር`;
  $('#kpi-wechi').textContent = `${money(d.today.wechi)} ብር`;
  
  $('#kpi-today-net-card').className = `kpi ${statusClass(d.today.status)}`;
  $('#kpi-today-net').textContent = `${d.today.net >= 0 ? '+' : ''}${money(d.today.net)} ብር`;
  $('#kpi-today-status').textContent = d.today.status.toUpperCase();

  $('#kpi-cum-card').className = `kpi full ${statusClass(d.cumulativeStatus)}`;
  $('#kpi-cumulative').textContent = `${d.cumulative >= 0 ? '+' : ''}${money(d.cumulative)} ብር`;

  const list = await api('/api/customers');
  const open = list.filter(c => c.balance > 0.01).sort((a,b) => b.balance - a.balance);
  $('#dash-debtors').innerHTML = open.length ? open.map(c => `
    <div class="row-item" data-open-cust="${c.id}">
      <div class="left"><div class="name">${esc(c.name)}</div></div>
      <div class="right"><strong>${money(c.balance)} ብር</strong></div>
    </div>
  `).join('') : `<div class="empty">No open dube balances 🎉</div>`;
  $$('[data-open-cust]').forEach(el => el.onclick = () => openCustomer(Number(el.dataset.openCust)));
}

document.body.addEventListener('click', e => {
  const a = e.target.closest('[data-act]');
  if (!a) return;
  if (a.dataset.act === 'new-dube') switchTab('new-dube');
  if (a.dataset.act === 'record-payment') openPaymentPicker();
  if (a.dataset.act === 'add-balitina') openAddBalitina();
  if (a.dataset.act === 'add-expense') openAddExpense();
  if (a.dataset.act === 'manage-items') switchTab('items');
});

async function loadCustomers() {
  CUSTOMERS = await api('/api/customers');
  $('#customer-list').innerHTML = CUSTOMERS.length ? CUSTOMERS.map(c => `
    <div class="row-item" data-id="${c.id}">
      <div class="left"><div class="name">${esc(c.name)}</div></div>
      <div class="right"><span class="badge ${c.balance > 0.01 ? 'unpaid' : 'settled'}">${money(c.balance)} ብር</span></div>
    </div>`).join('') : `<div class="empty">No customers yet.</div>`;
  $$('[data-id]').forEach(el => el.onclick = () => openCustomer(Number(el.dataset.id)));
}

$('#add-customer-btn')?.addEventListener('click', () => {
  openModal(`<h3>New Customer</h3><label class="field"><span>Name *</span><input id="c-name" class="input" autofocus></label><div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="c-save">Save</button></div>`);
  $('#c-save').onclick = async () => {
    await api('/api/customers', { method: 'POST', body: JSON.stringify({ name: $('#c-name').value }) });
    closeModal(); loadCustomers();
  };
});

async function openCustomer(id) {
  const c = await api(`/api/customers/${id}`);
  const txHtml = c.transactions.length ? c.transactions.map(tx => `
    <div class="tx-card" style="background:#fff;padding:1rem;border-radius:8px;margin-bottom:.5rem;border:1px solid #ddd">
      <strong>#${tx.id} · ${new Date(tx.transaction_date).toLocaleDateString()}</strong> <span class="badge ${tx.status}">${tx.status}</span>
      <div style="font-size:.9rem;margin:.5rem 0">${tx.items.map(i => `<div>${esc(i.item_name)}: ${i.quantity} x ${money(i.unit_price)} = ${money(i.line_total)}</div>`).join('')}</div>
      <div>Remaining: <strong>${money(tx.remaining)}</strong></div>
    </div>`).join('') : 'No dube entries.';

  openModal(`
    <h3>${esc(c.name)}</h3>
    <div class="kpi" style="margin-bottom:1rem"><div class="kpi-label">Balance</div><div class="kpi-value">${money(c.summary.balance)} ብር</div></div>
    <div class="row"><button class="btn primary" id="btn-pay">💵 Payment</button><button class="btn" id="btn-add">＋ New Dube</button></div>
    <h3 class="h2">Dube Entries</h3>${txHtml}
    <div class="actions"><button class="btn" data-close>Close</button></div>
  `);
  $('#btn-pay').onclick = () => openPaymentModal(c);
  $('#btn-add').onclick = () => { closeModal(); switchTab('new-dube'); setTimeout(()=>$('#dube-customer').value=c.id,100); };
}

function openPaymentModal(c) {
  openModal(`<h3>Payment — ${esc(c.name)}</h3><label class="field"><span>Amount (ብር)</span><input id="p-amount" class="input" type="number" value="${money(c.summary.balance)}"></label><div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="p-save">Save</button></div>`);
  $('#p-save').onclick = async () => {
    await api('/api/dube-payments', { method: 'POST', body: JSON.stringify({ customer_id: c.id, amount: Number($('#p-amount').value), operator_id: ME?.id }) });
    closeModal(); loadCustomers(); loadDashboard();
  };
}

function openPaymentPicker() {
  api('/api/customers').then(list => {
    const debt = list.filter(c => c.balance > 0.01);
    openModal(`<h3>Record Payment</h3><label class="field"><span>Customer</span><select id="pp-cust" class="input">${debt.map(c=>`<option value="${c.id}">${esc(c.name)} (${money(c.balance)})</option>`).join('')}</select></label><div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="pp-next">Next</button></div>`);
    $('#pp-next').onclick = () => { const c = debt.find(x=>x.id===Number($('#pp-cust').value)); closeModal(); openPaymentModal(c); };
  });
}

async function initDubeForm() {
  ITEMS = await api('/api/items');
  const cs = await api('/api/customers');
  $('#dube-customer').innerHTML = cs.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  $('#dube-items').innerHTML = '';
  addLine();
}
function addLine() {
  const row = document.createElement('div'); row.className = 'item-row';
  row.innerHTML = `<select class="input line-item">${ITEMS.map(i => `<option value="${i.id}">${esc(i.name)}</option>`).join('')}</select><input class="input line-qty" type="number" value="1"><input class="input line-price" type="number" value="0"><div class="item-sub">0.00</div><button class="btn danger del">×</button>`;
  $('#dube-items').appendChild(row);
  const sel = row.querySelector('.line-item'), qty = row.querySelector('.line-qty'), price = row.querySelector('.line-price');
  sel.onchange = () => { const it = ITEMS.find(x=>x.id===Number(sel.value)); if(it) price.value = it.default_price; recalc(); };
  qty.oninput = recalc; price.oninput = recalc; row.querySelector('.del').onclick = () => { row.remove(); recalc(); };
  function recalc() { row.querySelector('.item-sub').textContent = money(qty.value * price.value); let t=0; $$('#dube-items .item-row').forEach(r=>t+=r.querySelector('.line-qty').value*r.querySelector('.line-price').value); $('#dube-total').textContent = money(t); }
  recalc(); sel.onchange();
}
$('#add-line')?.addEventListener('click', addLine);
$('#save-dube')?.addEventListener('click', async () => {
  const items = []; $$('#dube-items .item-row').forEach(row => { const it = ITEMS.find(x=>x.id===Number(row.querySelector('.line-item').value)); const q=Number(row.querySelector('.line-qty').value); if(it && q>0) items.push({item_name:it.name, unit:it.unit, quantity:q, unit_price:Number(row.querySelector('.line-price').value)}); });
  await api('/api/dube', { method: 'POST', body: JSON.stringify({ customer_id: Number($('#dube-customer').value), items, operator_id: ME?.id }) });
  alert('Saved!'); initDubeForm();
});

async function loadItems() {
  ITEMS = await api('/api/items');
  $('#item-list').innerHTML = ITEMS.map(it => `<div class="row-item static"><div class="left"><div class="name">${esc(it.name)}</div><div class="meta">per ${esc(it.unit)}</div></div><div class="right"><strong>${money(it.default_price)}</strong></div></div>`).join('');
}
$('#add-item-btn')?.addEventListener('click', () => {
  openModal(`<h3>New Item</h3><input id="i-name" class="input" placeholder="Name" style="margin-bottom:.5rem"><input id="i-unit" class="input" placeholder="Unit (pcs/kg)" style="margin-bottom:.5rem"><input id="i-price" class="input" type="number" placeholder="Price" style="margin-bottom:.5rem"><div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="i-save">Save</button></div>`);
  $('#i-save').onclick = async () => { await api('/api/items', { method: 'POST', body: JSON.stringify({ name: $('#i-name').value, unit: $('#i-unit').value, default_price: Number($('#i-price').value) }) }); closeModal(); loadItems(); };
});

async function loadDaily(date) {
  const s = await api(`/api/settlement/${date}`);
  $('#day-balitina').textContent = money(s.balitina);
  $('#day-wechi').textContent = money(s.wechi);
  $('#day-net').textContent = money(s.net);
  $('#day-status').textContent = s.status.toUpperCase();
}
function openAddBalitina() {
  openModal(`<h3>Balitina Sale</h3><input id="b-amount" class="input" type="number" placeholder="Amount" style="margin-bottom:.5rem"><div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="b-save">Save</button></div>`);
  $('#b-save').onclick = async () => { await api('/api/balitina', { method: 'POST', body: JSON.stringify({ amount: Number($('#b-amount').value) }) }); closeModal(); loadDashboard(); };
}
function openAddExpense() {
  openModal(`<h3>Yebet Wechi</h3><input id="x-amount" class="input" type="number" placeholder="Amount" style="margin-bottom:.5rem"><input id="x-desc" class="input" placeholder="Desc" style="margin-bottom:.5rem"><div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="x-save">Save</button></div>`);
  $('#x-save').onclick = async () => { await api('/api/expenses', { method: 'POST', body: JSON.stringify({ amount: Number($('#x-amount').value), description: $('#x-desc').value }) }); closeModal(); loadDashboard(); };
}

function openModal(html) { $('#modal').innerHTML = html; $('#modal-backdrop').hidden = false; $$('#modal [data-close]').forEach(b => b.onclick = closeModal); }
function closeModal() { $('#modal-backdrop').hidden = true; $('#modal').innerHTML = ''; }
$('#modal-backdrop')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });

(async () => { try { await initOperator(); await loadDashboard(); } catch(e) { console.error(e); } })();
