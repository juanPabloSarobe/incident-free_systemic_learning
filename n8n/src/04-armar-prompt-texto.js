// Nodo "Armar prompt texto": arma el pedido al LLM para el flujo virtual.
// Cubre dos casos: observación nueva por texto, y actualización de un borrador
// existente (respuesta a una repregunta o corrección del resumen).
const PROMPT_CLASIFICACION = __PROMPT_CLASIFICACION__;

const ctx = $input.first().json;

let user;
if (ctx.accion === 'completar') {
  user = `Este es el borrador actual de la observación (JSON): ${JSON.stringify(ctx.session.datos)}\n` +
    `El operador agrega o corrige: "${ctx.text}"\n` +
    `Devolvé el JSON completo actualizado, conservando los campos que no cambian.`;
} else {
  user = `Mensaje del operador: "${ctx.text}"`;
}

const groqBody = {
  model: $env.GROQ_TEXT_MODEL || 'llama-3.3-70b-versatile',
  temperature: 0.2,
  response_format: { type: 'json_object' },
  messages: [
    { role: 'system', content: PROMPT_CLASIFICACION },
    { role: 'user', content: user },
  ],
};

return [{ json: { ...ctx, groqBody } }];
