// Nodo "Preparar contexto": normaliza el webhook de Twilio y anonimiza al remitente.
// El número de teléfono NUNCA sigue viaje: solo su HMAC (mismo criterio que la tarjeta anónima).
const crypto = require('crypto');

const b = $input.first().json.body || {};
const from = b.From || ''; // ej: "whatsapp:+549299XXXXXXX"

const secret = $env.HASH_SECRET || 'cambiar-este-secreto';
const hash = crypto.createHmac('sha256', secret).update(from).digest('hex').slice(0, 32);

const numMedia = Number(b.NumMedia || 0);
const mediaType = b.MediaContentType0 || '';
const hasMedia = numMedia > 0 && mediaType.startsWith('image');

// Twilio exige Basic Auth (SID:token) para descargar el media adjunto
const twilioAuth = 'Basic ' + Buffer.from(`${$env.TWILIO_SID}:${$env.TWILIO_TOKEN}`).toString('base64');

return [{
  json: {
    hash,
    hasMedia,
    mediaUrl: hasMedia ? b.MediaUrl0 : null,
    mediaType,
    text: (b.Body || '').trim(),
    twilioAuth,
  },
}];
