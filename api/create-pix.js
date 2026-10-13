import crypto from 'crypto';

const MEDUSA_BASE = (process.env.MEDUSAPAY_BASE_URL || 'https://api.medusapayoficial.pro/api/v1').replace(/\/+$/, '');
const MEDUSA_KEY = process.env.MEDUSAPAY_API_KEY || '';

function normalizeGuia(raw) {
  const g = (raw || 'TIRAR').toUpperCase();
  const isBlog = g.indexOf('BLOG') !== -1;
  const isRegularizar = g === 'REGULARIZAR' || g === 'REGULARIZAR_BLOG' || g.indexOf('_2') !== -1;
  if (isRegularizar) return isBlog ? 'REGULARIZAR_BLOG' : 'REGULARIZAR';
  return isBlog ? 'TIRAR_BLOG' : 'TIRAR';
}

// FONTE ÚNICA DE PREÇO deste site (em centavos).
const products = {
  TIRAR:            { title: 'Digital Guia Informa', amount: 3981 },
  REGULARIZAR:      { title: 'Digital Guia Informa', amount: 3981 },
  TIRAR_BLOG:       { title: 'Digital Guia Informa', amount: 3991 },
  REGULARIZAR_BLOG: { title: 'Digital Guia Informa', amount: 3991 },
};

function formatBRL(cents) {
  return 'R$ ' + (cents / 100).toFixed(2).replace('.', ',');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ─── GET: devolve só o preço (o checkout consome isto pra exibir) ───
  if (req.method === 'GET') {
    const g = normalizeGuia(req.query.guia);
    const prod = products[g] || products.TIRAR;
    return res.status(200).json({ guia: g, amount: prod.amount, price: formatBRL(prod.amount) });
  }

  if (req.method !== 'POST') return res.status(405).json({ message: 'Método não permitido' });

  const { guia, customer } = req.body || {};

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
  if (errs.length) return res.status(422).json({ message: 'Dados inválidos: ' + errs.join(', ') });

  if (!MEDUSA_KEY) {
    console.error('[create-pix] MEDUSAPAY_API_KEY não configurada');
    return res.status(500).json({ message: 'Gateway não configurado' });
  }

  // MedusaPay usa amount em REAIS (float), não centavos.
  const amountBRL = Number((prod.amount / 100).toFixed(2));

  // Descrição curta e inequívoca (princípio de MED: soft descriptor claro).
  const produto = `${prod.title} | ${normalizedGuia}`.slice(0, 200);

  // Idempotency: evita cobrança duplicada em retentativa server-side.
  // (Duplo-clique no front ainda gera 2 requests — mitigar depois passando um UUID do cliente.)
  const idempotencyKey = crypto.randomUUID();

  const body = {
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
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      // 502 = todos adquirentes falharam | 503 = sem adquirente ativo | outros
      console.error('[create-pix] erro medusa:', r.status, JSON.stringify(data).slice(0, 400));
      return res.status(400).json({ message: data.message || 'Erro ao gerar PIX' });
    }

    const pixCode = data?.pixCopiaECola;
    const saleId = data?.venda?.id;
    const qrCodeBase64 = data?.pixQrCode || null; // já vem como "data:image/png;base64,..."

    if (!pixCode || !saleId) {
      console.error('[create-pix] resposta incompleta:', JSON.stringify(data).slice(0, 400));
      return res.status(500).json({ message: 'PIX não retornado pelo gateway' });
    }

    const checkoutUrl = process.env.CHECKOUT_URL || req.headers.referer || process.env.SITE_URL || '';

    try {
      await scheduleRecovery({ saleId: String(saleId), customer: { name, phone }, checkoutUrl });
    } catch (e) {
      console.error('[create-pix] falha na recuperação (PIX segue ok):', e.message || e);
    }

    // Contrato preservado: frontend consome data.saleId, data.pix.key, data.pix.qrCodeBase64, data.amount, data.price.
    return res.status(200).json({
      saleId: String(saleId),
      amount: prod.amount,
      price: formatBRL(prod.amount),
      pix: { key: pixCode, qrCodeBase64 },
    });
  } catch (err) {
    console.error('[create-pix] fetch error:', err.message || err);
    return res.status(500).json({ message: 'Erro interno. Tente novamente.' });
  }
}

async function scheduleRecovery({ saleId, customer, checkoutUrl }) {
  const QSTASH_TOKEN = process.env.QSTASH_TOKEN;
  const SITE_URL = process.env.SITE_URL;
  const SECRET = process.env.RECOVERY_SECRET;
  const DELAY = process.env.RECOVERY_DELAY || '2m';
  const QSTASH_BASE = (process.env.QSTASH_URL || 'https://qstash.upstash.io').replace(/\/$/, '');

  if (!QSTASH_TOKEN || !SITE_URL || !customer?.phone) {
    console.warn('[create-pix] QStash não agendado — falta token, SITE_URL ou telefone');
    return;
  }

  const destination = `${SITE_URL}/api/recovery`;
  const payload = { saleId, phone: customer.phone, name: customer.name || '', checkout: checkoutUrl || SITE_URL };

  const qres = await fetch(`${QSTASH_BASE}/v2/publish/${destination}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${QSTASH_TOKEN}`,
      'Content-Type': 'application/json',
      'Upstash-Delay': DELAY,
      'Upstash-Retries': '0',
      'Upstash-Deduplication-Id': `recovery-${saleId}`,
      ...(SECRET ? { 'Upstash-Forward-X-Recovery-Key': SECRET } : {}),
    },
    body: JSON.stringify(payload),
  });

  if (qres.ok) console.log(`[create-pix] QStash agendado | sale:${saleId} | delay:${DELAY}`);
  else console.error(`[create-pix] QStash FALHOU | sale:${saleId} | http:${qres.status}`);
}
