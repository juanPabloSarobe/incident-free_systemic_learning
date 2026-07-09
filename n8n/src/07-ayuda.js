// Nodo "Mensaje de ayuda": saludo o mensaje demasiado corto para ser una observación.
const ctx = $input.first().json;

return [{ json: { persist: {
  reporter_hash: ctx.hash,
  reply: '👷 *Tarjeta Digital HSE*\n\n' +
    'Registrá tu observación de seguridad sin moverte del lugar:\n\n' +
    '📸 Mandá una *foto* de tu tarjeta de observaciones completa, o\n' +
    '✍️ *Contame directamente* qué viste: qué pasó, dónde, y qué se hizo en el momento.\n\n' +
    '🔒 Es anónimo: no guardamos tu número de teléfono.',
} } }];
