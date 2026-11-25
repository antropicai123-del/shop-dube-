const { pool } = require('./db');
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

async function allocateDubePayments(customerId) {
  const txs = (await pool.query(`SELECT id, transaction_date, notes, total_amount FROM dube_transactions WHERE customer_id=$1 AND is_void=0 ORDER BY transaction_date ASC, id ASC`, [customerId])).rows;
  const pays = (await pool.query(`SELECT transaction_id, amount FROM dube_payments WHERE customer_id=$1 AND is_void=0`, [customerId])).rows;

  const direct = {};
  let poolAmt = 0;
  for (const p of pays) {
    if (p.transaction_id) direct[p.transaction_id] = (direct[p.transaction_id] || 0) + Number(p.amount);
    else poolAmt += Number(p.amount);
  }

  return txs.map(tx => {
    const dPaid = direct[tx.id] || 0;
    const oweAfter = Math.max(0, Number(tx.total_amount) - dPaid);
    const applied = Math.min(oweAfter, poolAmt);
    poolAmt -= applied;
    const paid = dPaid + applied;
    const remaining = round2(Math.max(0, Number(tx.total_amount) - paid));
    const status = remaining < 0.01 ? 'settled' : (paid > 0.01 ? 'partial' : 'unpaid');
    return { id: tx.id, transaction_date: tx.transaction_date, notes: tx.notes, total_amount: round2(tx.total_amount), paid: round2(paid), remaining, status };
  });
}

async function customerBalance(id) {
  const txs = await allocateDubePayments(id);
  return round2(txs.reduce((s, t) => s + t.remaining, 0));
}

async function customerSummary(id) {
  const credit = (await pool.query(`SELECT COALESCE(SUM(total_amount),0) t FROM dube_transactions WHERE customer_id=$1 AND is_void=0`, [id])).rows[0].t;
  const paid = (await pool.query(`SELECT COALESCE(SUM(amount),0) t FROM dube_payments WHERE customer_id=$1 AND is_void=0`, [id])).rows[0].t;
  return { totalCredit: round2(credit), totalPaid: round2(paid), balance: round2(Math.max(0, credit - paid)) };
}

async function dailySettlement(dateStr) {
  const bal = (await pool.query(`SELECT COALESCE(SUM(amount),0) t FROM balitina_sales WHERE is_void=0 AND sale_date=$1`, [dateStr])).rows[0].t;
  const wechi = (await pool.query(`SELECT COALESCE(SUM(amount),0) t FROM household_expenses WHERE is_void=0 AND expense_date=$1`, [dateStr])).rows[0].t;
  const net = round2(bal - wechi);
  const status = net > 0.01 ? 'keri' : net < -0.01 ? 'alebat' : 'balanced';
  return { date: dateStr, balitina: round2(bal), wechi: round2(wechi), net, status };
}

async function settlementHistory() {
  const dates = (await pool.query(`
    SELECT d FROM (
      SELECT DISTINCT sale_date d FROM balitina_sales WHERE is_void=0
      UNION
      SELECT DISTINCT expense_date d FROM household_expenses WHERE is_void=0
    ) sub ORDER BY d ASC
  `)).rows.map(r => r.d);

  let cumulative = 0;
  const rows = [];
  for (const d of dates) {
    const s = await dailySettlement(d);
    cumulative = round2(cumulative + s.net);
    rows.push({ ...s, cumulative });
  }
  return { rows, cumulative };
}

module.exports = { round2, allocateDubePayments, customerBalance, customerSummary, dailySettlement, settlementHistory };
