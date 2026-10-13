const MEDUSA_BASE = (process.env.MEDUSAPAY_BASE_URL || 'https://api.medusapayoficial.pro/api/v1').replace(/\/+$/, '');
const MEDUSA_KEY = process.env.MEDUSAPAY_API_KEY || '';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Método não permitido' });

  const expected = process.env.RECOVERY_SECRET;
  if (expected && req.headers['x-recovery-key'] !== expected) {
    console.warn('[recovery] chave inválida — requisição ignorada');
    return res.status(401).json({ message: 'Não autorizado' });
  }

  try {
    const { saleId, phone, name, checkout } = req.body || {};
    if (!saleId || !phone) {
      console.warn('[recovery] payload incompleto:', { saleId, temFone: !!phone });
      return res.status(200).json({ skipped: 'payload incompleto' });
    }

    // Consulta status na MedusaPay
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

    // MedusaPay: pendente | aprovado | recusado | estornado
    if (status === 'aprovado') {
      console.log(`[recovery] ${saleId} já pago — sem disparo`);
      return res.status(200).json({ skipped: 'pago' });
    }
    if (['recusado', 'estornado'].includes(status)) {
      console.log(`[recovery] ${saleId} status ${status} — sem disparo`);
      return res.status(200).json({ skipped: status });
    }

    // Ainda pendente → dispara pix_notpaid
    const url = process.env.INTEGRAX_AUTOMATION_URL;
    if (!url) {
      console.error('[recovery] INTEGRAX_AUTOMATION_URL não configurada');
      return res.status(200).json({ error: 'sem url integrax' });
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
    const ixData = await ix.json().catch(() => ({}));
    console.log(`[recovery] pix_notpaid disparado | sale:${saleId} | http:${ix.status} | resp:${JSON.stringify(ixData).slice(0, 200)}`);
    return res.status(200).json({ sent: ix.ok });
  } catch (err) {
    console.error('[recovery] erro:', err.message || err);
    return res.status(200).json({ error: true });
  }
}
