const { pool } = require('./db');

async function getBotToken() {
  const r = (await pool.query(`SELECT value FROM shop_settings WHERE key='telegram_bot_token'`)).rows[0];
  return (r?.value || '').trim();
}

async function sendDocument(token, chatId, buffer, filename, caption) {
  if (!token) throw new Error('Token missing');
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption) form.append('caption', caption);
  form.append('document', new Blob([buffer]), filename);
  const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: 'POST', body: form });
  const j = await res.json();
  if (!j.ok) throw new Error(j.description);
  return j.result;
}

async function getUpdates(token) {
  const r = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
  return (await r.json()).result || [];
}

module.exports = { getBotToken, sendDocument, getUpdates };
