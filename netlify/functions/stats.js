const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const STATS_PASSWORD = process.env.STATS_PASSWORD || '';

const VALID_EVENTS = ['clara', 'duvida', 'sim', 'parte', 'nao'];

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const e = params.e || '';
  const s = params.s || '';

  // Proteção simples por senha
  if (!STATS_PASSWORD || s !== STATS_PASSWORD) {
    return { statusCode: 401, body: JSON.stringify({ error: 'unauthorized' }) };
  }

  if (!VALID_EVENTS.includes(e)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'invalid event' }) };
  }

  try {
    const r = await fetch(`${UPSTASH_URL}/get/feedback:${e}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    });
    const data = await r.json();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: e, count: Number(data.result || 0) }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
