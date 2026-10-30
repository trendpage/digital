const crypto = require('crypto');

const MEDUSA_BASE = (process.env.MEDUSAPAY_BASE_URL || 'https://api.medusapayoficial.pro/api/v1').replace(/\/+$/, '');
const MEDUSA_KEY = process.env.MEDUSAPAY_API_KEY || '';

function normalizeGuia(raw) {
  const g = (raw || 'TIRAR').toUpperCase();
  const isBlog = g.indexOf('BLOG') !== -1;
  const isRegularizar = g === 'REGULARIZAR' || g === 'REGULARIZAR_BLOG' || g.indexOf('_2') !== -1;
  if (isRegularizar) return isBlog ? 'REGULARIZAR_BLOG' : 'REGULARIZAR';
  return isBlog ? 'TIRAR_BLOG' : 'TIRAR';
}

const products = {
  TIRAR:            { title: 'Produto Digital', amount: 3982 },
  REGULARIZAR:      { title: 'Produto Digital', amount: 3982 },
  TIRAR_BLOG:       { title: 'Produto Digital', amount: 3992 },
  REGULARIZAR_BLOG: { title: 'Produto Digital', amount: 3992 },
};

function formatBRL(cents) {
  return 'R$ ' + (cents / 100).toFixed(2).replace('.', ',');
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  // GET: devolve preço
  if (event.httpMethod === 'GET') {
    const g = normalizeGuia((event.queryStringParameters || {}).guia);
    const prod = products[g] || products.TIRAR;
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ guia: g, amount: prod.amount, price: formatBRL(prod.amount) }),
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Método não permitido' }),
    };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }
  const { guia, customer } = body;

  const normalizedGuia = normalizeGuia(guia);
  const prod = products[normalizedGuia] || products.TIRAR;

  const name = (customer?.name || '').trim();
  const email = (customer?.email || '').trim();
  const cpf = String(customer?.cpf || '').replace(/\D/g, '');
  const phone = String(customer?.phone || '').replace(/\D/g, '');

  const errs = [];
  if (name.length < 2) errs.push('name');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errs.push('email');
  if (cpf.length !== 11) errs.push('cpf');
  if (phone.length < 10 || phone.length > 11) errs.push('phone');
  if (errs.length) {
    return {
      statusCode: 422,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Dados inválidos: ' + errs.join(', ') }),
    };
  }

  if (!MEDUSA_KEY) {
    console.error('[create-pix] MEDUSAPAY_API_KEY não configurada');
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Gateway não configurado' }),
    };
  }

  const amountBRL = Number((prod.amount / 100).toFixed(2));
  const produto = `${prod.title} | ${normalizedGuia}`.slice(0, 200);
  const idempotencyKey = crypto.randomUUID();

  const payload = {
    clienteNome: name,
    clienteEmail: email,
    clienteCpf: cpf,
    valor: amountBRL,
    metodo: 'PIX',
    produto,
    idempotencyKey,
  };

  try {
    const r = await fetch(`${MEDUSA_BASE}/api/pagamentos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${MEDUSA_KEY}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      console.error('[create-pix] erro medusa:', r.status, JSON.stringify(data).slice(0, 400));
      return {
        statusCode: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: data.message || 'Erro ao gerar PIX' }),
      };
    }

    const pixCode = data?.pixCopiaECola;
    const saleId = data?.venda?.id;
    const qrCodeBase64 = data?.pixQrCode || null;

    if (!pixCode || !saleId) {
      console.error('[create-pix] resposta incompleta:', JSON.stringify(data).slice(0, 400));
      return {
        statusCode: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'PIX não retornado pelo gateway' }),
      };
    }

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        saleId: String(saleId),
        amount: prod.amount,
        price: formatBRL(prod.amount),
        pix: { key: pixCode, qrCodeBase64 },
      }),
    };
  } catch (err) {
    console.error('[create-pix] fetch error:', err.message || err);
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Erro interno. Tente novamente.' }),
    };
  }
};
