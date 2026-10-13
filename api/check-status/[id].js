const MEDUSA_BASE = (process.env.MEDUSAPAY_BASE_URL || 'https://api.medusapayoficial.pro/api/v1').replace(/\/+$/, '');
const MEDUSA_KEY = process.env.MEDUSAPAY_API_KEY || '';

function mapStatus(raw) {
  switch ((raw || '').toLowerCase()) {
    case 'aprovado':  return 'PAGO';
    case 'pendente':  return 'PENDENTE';
    case 'recusado':  return 'RECUSADO';
    case 'estornado': return 'ESTORNADO';
    default:          return 'PENDENTE';
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ message: 'Método não permitido' });

  const { id } = req.query;
  // MedusaPay usa UUID — sem validação numérica.
  if (!id || typeof id !== 'string' || id.length < 8) {
    return res.status(400).json({ message: 'ID inválido' });
  }

  if (!MEDUSA_KEY) {
    console.error('[check-status] MEDUSAPAY_API_KEY não configurada');
    return res.status(200).json({ status: 'PENDENTE' });
  }

  try {
    const r = await fetch(`${MEDUSA_BASE}/api/pagamentos/${id}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${MEDUSA_KEY}`,
      },
    });

    if (r.status === 404) return res.status(200).json({ status: 'PENDENTE' });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(200).json({ status: 'PENDENTE' });

    return res.status(200).json({ status: mapStatus(data.status) });
  } catch (err) {
    console.error('[check-status] erro:', err.message || err);
    return res.status(200).json({ status: 'PENDENTE' });
  }
}
