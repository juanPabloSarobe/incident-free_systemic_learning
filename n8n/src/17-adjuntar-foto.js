// Nodo "Adjuntar foto": la observación ya tiene folio y el operario mandó una foto
// dentro de la ventana de adjuntos. Se agrega como evidencia y se renueva la ventana.
const ctx = $('Router').first().json;
const info = (ctx.session && ctx.session.datos) || {};

let buf = null;
try { buf = await this.helpers.getBinaryDataBuffer(0, 'data'); } catch (e) { /* descarga fallida */ }
if (!buf) {
  return [{ json: { persist: {
    reporter_hash: ctx.hash,
    session: { estado_flujo: 'awaiting_photos', datos: info }, // la ventana sigue abierta
    reply: '😕 No pude descargar esa foto. ¿La reenviás?',
  } } }];
}
const n = (Number(info.fotos_count) || 0) + 1;

return [{ json: { persist: {
  reporter_hash: ctx.hash,
  foto_base64: buf.toString('base64'),
  foto_mime: ctx.mediaType || 'image/jpeg',
  foto_para: info.observacion_id,
  session: { estado_flujo: 'awaiting_photos', datos: { ...info, fotos_count: n } },
  reply: `📎 Foto ${n} agregada al folio *${info.folio || ''}*. Mandá más si querés, o seguí con lo tuyo. 👍`,
} } }];
