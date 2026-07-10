// Nodo "Router": decide el camino mínimo. Toda la inteligencia conversacional vive
// en el Orquestador (LLM). Acá solo separamos 3 caminos: foto, confirmación explícita
// de un resumen pendiente, o el orquestador (todo el resto: saludos, texto, correcciones).
const ctx = $('Preparar contexto').first().json;
const session = $input.first().json.session || null;
const t = (ctx.text || '').toLowerCase().trim();

const esConfirmacion = /^(ok|oka|okey|si|sí|dale|confirmo|listo|va|perfecto|correcto)\b/.test(t);

let accion;
if (ctx.hasMedia) {
  accion = 'foto';                                   // Flujo A: foto de la tarjeta de papel
} else if (session && session.estado_flujo === 'awaiting_confirm' && esConfirmacion) {
  accion = 'confirmar';                              // el operario aprobó el resumen
} else {
  accion = 'orquestador';                            // TODO lo demás lo maneja el LLM
}

return [{ json: { ...ctx, session, accion } }];
