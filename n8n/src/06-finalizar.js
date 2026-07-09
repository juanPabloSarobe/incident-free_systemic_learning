// Nodo "Finalizar observación": el operador confirmó el resumen.
// El borrador de la sesión se convierte en observación definitiva (la API devuelve el folio).
const ctx = $input.first().json;
const datos = (ctx.session && ctx.session.datos) || {};

return [{ json: { persist: {
  reporter_hash: ctx.hash,
  observacion: { ...datos, canal: 'whatsapp', raw_llm_json: JSON.stringify(datos) },
  session: null,
  reply: '✅ ¡Listo! Tu observación quedó registrada con el folio *{{FOLIO}}*.\n\n' +
    'El equipo de HSE ya la puede ver en el tablero. Gracias por sumar a la seguridad de todos. 👷‍♂️',
} } }];
