// Nodo "Procesar transcripción": toma la salida de Whisper (Groq) y decide:
//  - transcripción vacía o error → respuesta de fallback directa (la conversación sigue viva)
//  - transcripción OK → el texto entra al Orquestador como si el operario lo hubiera escrito
// Si el audio venía con texto (caption), se concatenan.
const ctx = $('Router').first().json;
const resp = $input.first().json;

const transcripcion = (resp && typeof resp.text === 'string') ? resp.text.trim() : '';

if (!transcripcion) {
  return [{ json: { entendido: 'no', persist: {
    reporter_hash: ctx.hash,
    reply: '🎙️😕 No pude entender el audio. ¿Podés reenviarlo (más cerca del micrófono) o escribirlo en un mensaje?',
  } } }];
}

const caption = (ctx.text || '').trim();
const texto = caption ? `${caption}\n${transcripcion}` : transcripcion;

return [{ json: { ...ctx, text: texto, transcripcion, entendido: 'si' } }];
