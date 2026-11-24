const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const SITE_URL = process.env.SITE_URL || '';

const VALID_EVENTS = ['clara', 'duvida', 'sim', 'parte', 'nao'];

exports.handler = async (event) => {
  const e = (event.queryStringParameters || {}).e || '';

  // Valida evento — evita spam/lixo no contador
  if (!VALID_EVENTS.includes(e)) {
    return {
      statusCode: 302,
      headers: { Location: `${SITE_URL}/obrigado.html` },
      body: '',
    };
  }

  // Incrementa contador no Upstash Redis
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    try {
      await fetch(`${UPSTASH_URL}/incr/feedback:${e}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
      });
      // Também guarda timestamp pra análise temporal (opcional)
      await fetch(`${UPSTASH_URL}/lpush/feedback_log:${e}/${Date.now()}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
      });
    } catch (err) {
      console.error('[track] erro redis:', err.message || err);
      // não bloqueia redirect — UX primeiro
    }
  }

  return {
    statusCode: 302,
    headers: { Location: `${SITE_URL}/obrigado.html?e=${e}` },
    body: '',
  };
};
