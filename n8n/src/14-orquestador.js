// Nodo "Orquestador": el cerebro conversacional. En cada mensaje arma el pedido al LLM
// incluyendo el historial de la charla y los datos ya recolectados, para que el modelo
// decida de forma natural si preguntar, confirmar o rechazar. Reemplaza la lógica rígida.
const PROMPT_ORQUESTADOR = __PROMPT_ORQUESTADOR__;

// Leer del Router (ya trae la sesión cargada); Preparar contexto corre antes de la sesión.
const ctx = $('Router').first().json;
const session = ctx.session || null;

// Recuperar datos acumulados e historial de la sesión (si existe)
const datosPrevios = (session && session.datos) ? { ...session.datos } : {};
const historial = Array.isArray(datosPrevios._historial) ? datosPrevios._historial : [];

// No mandamos el historial interno como "dato" al modelo
const datosLimpios = { ...datosPrevios };
delete datosLimpios._historial;

// Contexto del estado actual para el system prompt
const systemContent = PROMPT_ORQUESTADOR +
  `\n\n## Datos ya recolectados hasta ahora\n` +
  JSON.stringify(datosLimpios, null, 2);

// Armar los mensajes: system + historial + mensaje actual
const messages = [{ role: 'system', content: systemContent }];
for (const turno of historial) {
  if (turno && turno.role && turno.content) {
    messages.push({ role: turno.role, content: turno.content });
  }
}
messages.push({ role: 'user', content: ctx.text || '' });

const groqBody = {
  model: $env.GROQ_TEXT_MODEL || 'llama-3.3-70b-versatile',
  temperature: 0.3,
  response_format: { type: 'json_object' },
  messages,
};

return [{ json: { ...ctx, session, datosPrevios: datosLimpios, historial, groqBody } }];
