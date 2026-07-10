// Nodo "Finalizar observación": el operador confirmó el resumen.
// El borrador de la sesión se convierte en observación definitiva (la API devuelve el folio).
const ctx = $input.first().json;
const datos = { ...((ctx.session && ctx.session.datos) || {}) };
delete datos._historial; // el historial de chat no se persiste en la observación

// Red de seguridad (cubre también el flujo foto, que no pasa por el orquestador):
// nunca guardar fecha ni servicio en blanco.
const tz = $env.GENERIC_TIMEZONE || 'America/Argentina/Buenos_Aires';
const ahoraLocal = new Date().toLocaleString('sv-SE', { timeZone: tz }).slice(0, 16);
if (!datos.fecha_obs || /^ahora$/i.test(String(datos.fecha_obs).trim())) datos.fecha_obs = ahoraLocal;
if (!datos.servicio_obra) datos.servicio_obra = 'No indicado';

return [{ json: { persist: {
  reporter_hash: ctx.hash,
  observacion: { ...datos, canal: 'whatsapp', raw_llm_json: JSON.stringify(datos) },
  session: null,
  reply: '✅ ¡Listo! Tu observación quedó registrada con el folio *{{FOLIO}}*.\n\n' +
    'El equipo de HSE ya la puede ver en el tablero. Gracias por sumar a la seguridad de todos. 👷‍♂️',
} } }];
