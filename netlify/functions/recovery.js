const MEDUSA_BASE = (process.env.MEDUSAPAY_BASE_URL || 'https://api.medusapayoficial.pro/api/v1').replace(/\/+$/, '');
const MEDUSA_KEY = process.env.MEDUSAPAY_API_KEY || '';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ message: 'Método não permitido' }) };
  }

  const expected = process.env.RECOVERY_SECRET;
  if (expected && event.headers['x-recovery-key'] !== expected) {
    console.warn('[recovery] chave inválida — requisição ignorada');
    return { statusCode: 401, body: JSON.stringify({ message: 'Não autorizado' }) };
  }

  try {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }
    const { saleId, phone, name, checkout } = body;

    if (!saleId || !phone) {
      return { statusCode: 200, body: JSON.stringify({ skipped: 'payload incompleto' }) };
    }

    let status = 'pendente';
    if (MEDUSA_KEY) {
      try {
        const r = await fetch(`${MEDUSA_BASE}/api/pagamentos/${saleId}`, {
          headers: { Accept: 'application/json', Authorization: `Bearer ${MEDUSA_KEY}` },
        });
        const data = await r.json().catch(() => ({}));
        status = (data?.status || 'pendente').toLowerCase();
      } catch (e) {
        console.warn('[recovery] erro ao consultar status, assumindo pendente:', e.message || e);
      }
    }

    if (status === 'aprovado') return { statusCode: 200, body: JSON.stringify({ skipped: 'pago' }) };
    if (['recusado', 'estornado'].includes(status)) return { statusCode: 200, body: JSON.stringify({ skipped: status }) };

    const url = process.env.INTEGRAX_AUTOMATION_URL;
    if (!url) {
      return { statusCode: 200, body: JSON.stringify({ error: 'sem url integrax' }) };
    }

    const ix = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'pix_notpaid',
        phone: phone || '',
        name: name || '',
        checkout: checkout || process.env.CHECKOUT_URL || process.env.SITE_URL || '',
      }),
    });
    return { statusCode: 200, body: JSON.stringify({ sent: ix.ok }) };
  } catch (err) {
    console.error('[recovery] erro:', err.message || err);
    return { statusCode: 200, body: JSON.stringify({ error: true }) };
  }
};
