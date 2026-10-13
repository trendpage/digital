export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ message: 'Método não permitido' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const t = body.transaction || body.data || body;
    const id = t.id || body.id || '';
    const status = (t.status || body.status || '').toString();

    console.log(`[webhook] velana | id:${id} | status:${status}`);

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[webhook] erro:', err.message || err);
    return res.status(200).json({ received: true });
  }
}
