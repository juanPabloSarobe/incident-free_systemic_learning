// Nodo "Armar TwiML": la API devolvió {ok, folio?, reply} — se arma la respuesta
// que Twilio manda de vuelta al WhatsApp del operador.
const r = $input.first().json;

let text = r.reply || '🙏 ¡Gracias! Recibimos tu mensaje.';
if (r.folio) text = text.split('{{FOLIO}}').join(r.folio);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${esc(text)}</Message></Response>`;

return [{ json: { xml } }];
