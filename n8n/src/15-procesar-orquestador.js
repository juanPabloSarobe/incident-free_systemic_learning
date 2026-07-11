// Nodo "Procesar orquestador": interpreta la decisión del LLM (preguntar/confirmar/rechazar),
// arma la respuesta al operario, actualiza la sesión con el historial y prepara la persistencia.
const ctx = $('Orquestador').first().json;

const CATEGORIAS = {
  1: 'Reacciones de las Personas', 2: 'Posiciones de las Personas',
  3: 'Equipos de Protección Personal', 4: 'Herramientas y Equipos',
  5: 'Procedimientos', 6: 'Orden y Aseo', 7: 'Vehicular', 8: 'Ambiente',
  9: 'Productos Químicos', 10: 'Instalaciones', 11: 'Otros',
};
const TIPO = { inseguro: 'Acto Inseguro', seguro: 'Acto Seguro', no_audita: 'No Audita' };
const SEMAFORO = { rojo: '🔴 Crítica', amarillo: '🟡 Atención', verde: '🟢 Leve' };

// --- parsear salida del LLM (tolerante a fences / respuesta inválida) ---
let out = null;
try {
  const content = $input.first().json.choices[0].message.content;
  out = JSON.parse(content.replace(/```json|```/g, '').trim());
} catch (e) { /* LLM caído o JSON inválido */ }

if (!out || !out.accion) {
  return [{ json: { persist: {
    reporter_hash: ctx.hash,
    reply: '😕 Se me complicó procesar tu mensaje. Probá de nuevo en unos segundos, o entregá la tarjeta en papel como siempre.',
  } } }];
}

// --- fusionar datos: lo previo + lo nuevo (lo nuevo pisa) ---
const datos = { ...(ctx.datosPrevios || {}), ...(out.datos || {}) };

// normalizaciones defensivas
datos.tipo = ['inseguro', 'seguro', 'no_audita'].includes(datos.tipo) ? datos.tipo : 'inseguro';
datos.severidad = Math.min(4, Math.max(1, Number(datos.severidad) || 1));
const cat = Number(datos.categoria);
datos.categoria = cat >= 1 && cat <= 11 ? cat : null;
const np = Number(datos.num_personas);
datos.num_personas = Number.isFinite(np) && np > 0 ? Math.round(np) : null;
// prioridad determinística (no se delega al LLM)
datos.prioridad = datos.tipo === 'seguro' ? 'verde'
  : datos.severidad >= 3 ? 'rojo'
  : datos.severidad === 2 ? 'amarillo' : 'verde';

// metadata de Twilio
if (ctx.twilioTimestamp) datos.timestamp_mensaje = ctx.twilioTimestamp;
if (ctx.latitud != null) datos.latitud = ctx.latitud;
if (ctx.longitud != null) datos.longitud = ctx.longitud;

// --- actualizar historial de la conversación ---
const historial = Array.isArray(ctx.historial) ? [...ctx.historial] : [];
historial.push({ role: 'user', content: ctx.text || '' });
historial.push({ role: 'assistant', content: out.mensaje || '' });
// acotar historial para no crecer indefinidamente
while (historial.length > 12) historial.shift();

let reply, session, flag = null;

if (out.accion === 'rechazar') {
  // contenido no válido: cerrar sesión, registrar el strike y avisar según reincidencia.
  // {{AVISO_RECHAZO}} se resuelve DESPUÉS de persistir, cuando la API devuelve el contador
  // (2º rechazo: advertencia; 3º: pausa de 30 min con hora). Nunca silencio.
  reply = (out.mensaje ||
    '😊 Esto no parece una observación de seguridad. Si necesitás ayuda, hablá con tu supervisor de HSE.') +
    '{{AVISO_RECHAZO}}';
  session = null;
  flag = { razon: 'contenido_dudoso' };
} else if (out.accion === 'confirmar') {
  // tenemos lo esencial: armar resumen determinístico y pedir OK
  // red de seguridad: nunca confirmar "sin categoría"
  if (!datos.categoria) datos.categoria = 11; // Otros
  // defaults acordados: nunca más blancos mudos en el export
  const tz = $env.GENERIC_TIMEZONE || 'America/Argentina/Buenos_Aires';
  const ahoraLocal = new Date().toLocaleString('sv-SE', { timeZone: tz }).slice(0, 16); // YYYY-MM-DD HH:MM
  if (!datos.fecha_obs || /^ahora$/i.test(String(datos.fecha_obs).trim())) datos.fecha_obs = ahoraLocal;
  if (!datos.servicio_obra) datos.servicio_obra = 'No indicado';
  if (!datos.acciones_correctivas) datos.acciones_correctivas = 'Sin acciones en el momento';
  const PERSONAL = { propio: 'propio', contratista: 'contratista' };
  const lineas = [
    '📋 *Resumen de tu observación*',
    `📅 Fecha: ${datos.fecha_obs}`,
    `📍 Lugar: ${datos.lugar || '(sin especificar)'}`,
    `🏗 Servicio/Obra: ${datos.servicio_obra}`,
    `🏷 Tipo: ${TIPO[datos.tipo]}`,
    datos.categoria ? `📂 Categoría: ${datos.categoria} · ${CATEGORIAS[datos.categoria]}${datos.subitem ? ` (${datos.subitem})` : ''}` : null,
    datos.num_personas ? `👥 Personas: ${datos.num_personas}${PERSONAL[datos.personal] ? ` (${PERSONAL[datos.personal]})` : ''}` : null,
    `📝 ${datos.observacion || '(sin descripción)'}`,
    `🛠 Acción inmediata: ${datos.acciones_correctivas}`,
    `🚦 Prioridad: ${SEMAFORO[datos.prioridad]}`,
    '',
    'Respondé *OK* para confirmar, o escribí lo que haya que corregir.',
  ].filter((l) => l !== null);
  reply = lineas.join('\n');
  session = { estado_flujo: 'awaiting_confirm', datos: { ...datos, _historial: historial } };
} else {
  // preguntar: seguimos recolectando
  reply = out.mensaje || '¿Me contás un poco más?';
  session = { estado_flujo: 'awaiting_orchestrator', datos: { ...datos, _historial: historial } };
}

// eco de la transcripción: el operario ve qué se entendió y puede corregir antes del OK
if (ctx.transcripcion) {
  const t = ctx.transcripcion.length > 250 ? ctx.transcripcion.slice(0, 250) + '…' : ctx.transcripcion;
  reply = `🎙️ Escuché: «${t}»\n\n${reply}`;
}

const persist = { reporter_hash: ctx.hash, session, reply };
if (flag) persist.flag = flag;
return [{ json: { persist } }];
