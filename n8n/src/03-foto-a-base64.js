// Nodo "Foto a base64": toma el binario descargado de Twilio y arma el pedido
// al LLM de visión (Groq, API compatible con OpenAI) con el prompt de extracción.
const PROMPT_EXTRACCION = __PROMPT_EXTRACCION__;

const buf = await this.helpers.getBinaryDataBuffer(0, 'data');
const ctx = $('Router').first().json;
const fotoB64 = buf.toString('base64');

const groqBody = {
  model: $env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct',
  temperature: 0.2,
  response_format: { type: 'json_object' },
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: PROMPT_EXTRACCION },
      { type: 'image_url', image_url: { url: `data:${ctx.mediaType || 'image/jpeg'};base64,${fotoB64}` } },
    ],
  }],
};

return [{ json: { ...ctx, fotoB64, groqBody } }];
