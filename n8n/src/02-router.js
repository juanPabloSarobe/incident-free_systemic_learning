// Nodo "Router": decide qué hacer con el mensaje según el contenido y la sesión vigente.
const ctx = $('Preparar contexto').first().json;
const session = $input.first().json.session || null;
const t = (ctx.text || '').toLowerCase();

let accion;
if (ctx.hasMedia) {
  accion = 'foto';                 // Flujo A: foto de la tarjeta de papel
} else if (session && session.estado_flujo === 'awaiting_confirm'
           && /^(ok|oka|okey|s[ií]|dale|confirmo|listo|va|perfecto)\b/.test(t)) {
  accion = 'confirmar';            // el operador aprobó el resumen
} else if (session) {
  accion = 'completar';            // respuesta a una repregunta, o corrección al resumen
} else if (t.length >= 15) {
  accion = 'nueva_texto';          // Flujo B: observación 100% virtual
} else {
  accion = 'ayuda';                // saludo / mensaje corto: explicar cómo se usa
}

return [{ json: { ...ctx, session, accion } }];
