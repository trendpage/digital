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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Método não permitido' }),
    };
  }

  // Pega o id do path. Com o redirect do netlify.toml, /api/check-status/UUID
  // vira /.netlify/functions/check-status/UUID. O id é a última parte.
  const pathParts = (event.path || '').split('/').filter(Boolean);
  const id = pathParts[pathParts.length - 1];

  if (!id || typeof id !== 'string' || id.length < 8 || id === 'check-status') {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'ID inválido' }),
    };
  }

  if (!MEDUSA_KEY) {
    console.error('[check-status] MEDUSAPAY_API_KEY não configurada');
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'PENDENTE' }),
    };
  }

  try {
    const r = await fetch(`${MEDUSA_BASE}/api/pagamentos/${id}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${MEDUSA_KEY}`,
      },
    });

    if (r.status === 404) {
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'PENDENTE' }),
      };
    }

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'PENDENTE' }),
      };
    }

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: mapStatus(data.status) }),
    };
  } catch (err) {
    console.error('[check-status] erro:', err.message || err);
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'PENDENTE' }),
    };
  }
};
