// Nodo "Router": decide el camino mínimo. Toda la inteligencia conversacional vive
// en el Orquestador (LLM). Caminos: foto (tarjeta), adjuntar_foto (evidencia post-folio),
// audio, confirmación explícita de un resumen pendiente, u orquestador (todo el resto).
const ctx = $('Preparar contexto').first().json;
let session = $input.first().json.session || null;
const user = $input.first().json.user || { estado: 'activo', rechazos: 0 };
const t = (ctx.text || '').toLowerCase().trim();

const esConfirmacion = /^(ok|oka|okey|si|sí|dale|confirmo|listo|va|perfecto|correcto)\b/.test(t);

// Ventana de adjuntos post-folio: vigente hasta 10 min después de la última actividad.
// Cada foto adjuntada la renueva; cualquier texto/audio la cierra (empieza charla nueva).
const VENTANA_FOTOS_MIN = 10;
let ventanaFotos = false;
if (session && session.estado_flujo === 'awaiting_photos') {
  const upd = new Date(String(session.updated_at || '').replace(' ', 'T') + 'Z').getTime();
  ventanaFotos = Number.isFinite(upd) && (Date.now() - upd) / 60000 <= VENTANA_FOTOS_MIN;
  if (!ctx.hasMedia || !ventanaFotos) session = null; // texto/audio o ventana vencida: conversación nueva
}

let accion;
if (user.estado === 'bloqueado_temporal') {
  accion = 'bloqueado';                              // pausa anti-abuso: SIEMPRE se avisa, nunca silencio
} else if (ctx.hasMedia && ventanaFotos) {
  accion = 'adjuntar_foto';                          // evidencia para el folio recién registrado
} else if (ctx.hasMedia) {
  accion = 'foto';                                   // Flujo A: foto de la tarjeta de papel
} else if (ctx.hasAudio) {
  accion = 'audio';                                  // Flujo C: nota de voz → Whisper → orquestador
} else if (session && session.estado_flujo === 'awaiting_confirm' && esConfirmacion) {
  accion = 'confirmar';                              // el operario aprobó el resumen
} else {
  accion = 'orquestador';                            // TODO lo demás lo maneja el LLM
}

return [{ json: { ...ctx, session, user, accion } }];
