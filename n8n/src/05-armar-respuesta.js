// Nodo "Armar respuesta": procesa la salida del LLM de visión (flujo foto), normaliza,
// detecta datos faltantes y arma la respuesta al operador + el payload de persistencia.
const ctx = $('Foto a base64').first().json;

const CATEGORIAS = {
  1: 'Reacciones de las Personas', 2: 'Posiciones de las Personas',
  3: 'Equipos de Protección Personal', 4: 'Herramientas y Equipos',
  5: 'Procedimientos', 6: 'Orden y Aseo', 7: 'Vehicular', 8: 'Ambiente',
  9: 'Productos Químicos', 10: 'Instalaciones', 11: 'Otros',
};
const TIPO = { inseguro: 'Acto Inseguro', seguro: 'Acto Seguro', no_audita: 'No Audita' };
const SEMAFORO = { rojo: '🔴 Crítica', amarillo: '🟡 Atención', verde: '🟢 Leve' };

// --- parsear la salida del LLM (tolerante a fences de markdown) ---
let datos = null;
try {
  const content = $input.first().json.choices[0].message.content;
  datos = JSON.parse(content.replace(/```json|```/g, '').trim());
} catch (e) { /* LLM caído o respuesta inválida */ }

if (!datos) {
  return [{ json: { persist: {
    reporter_hash: ctx.hash,
    reply: '😕 No pude procesar tu mensaje en este momento. Probá de nuevo en unos minutos, o entregá la tarjeta en papel como siempre.',
  } } }];
}

// --- Legibilidad / confianza de la lectura de la foto ---
const legible = datos.tarjeta_legible !== false;
const confianza = typeof datos.confianza === 'number' ? datos.confianza : 1;
const dudas = Array.isArray(datos.dudas) ? datos.dudas.filter(Boolean) : [];

// Si la tarjeta está en blanco, no es una tarjeta o es ilegible: pedir reenvío o texto.
if (!legible || confianza < 0.35) {
  const motivo = dudas.length ? ` (${dudas.slice(0, 2).join('; ')})` : '';
  return [{ json: { persist: {
    reporter_hash: ctx.hash,
    session: null,
    reply: '📸 No pude leer bien la tarjeta' + motivo + '.\n\n' +
      'Probá sacarle una foto más nítida, con buena luz y sin sombras/suciedad, o *contame por texto* qué observaste y dónde.',
  } } }];
}

// --- ¿Ya había un borrador (ej. mandó el frente y ahora el dorso)? Consolidar ---
// Lo ya cargado gana; la foto nueva solo completa los campos vacíos.
const previos = (ctx.session && ctx.session.datos) || null;
if (previos) {
  for (const [k, v] of Object.entries(previos)) {
    if (k === '_historial') continue;
    if ((datos[k] == null || datos[k] === '') && v != null) datos[k] = v;
  }
  if (previos._historial) datos._historial = previos._historial;
}

// --- Integrar metadata de Twilio ---
if (ctx.twilioTimestamp) datos.timestamp_mensaje = ctx.twilioTimestamp;
if (ctx.latitud) datos.latitud = ctx.latitud;
if (ctx.longitud) datos.longitud = ctx.longitud;

// --- normalizar + prioridad determinística (el semáforo no se delega al LLM) ---
datos.tipo = ['inseguro', 'seguro', 'no_audita'].includes(datos.tipo) ? datos.tipo : 'inseguro';
datos.severidad = Math.min(4, Math.max(1, Number(datos.severidad) || 1));
datos.prioridad = datos.tipo === 'seguro' ? 'verde'
  : datos.severidad >= 3 ? 'rojo'
  : datos.severidad === 2 ? 'amarillo' : 'verde';
const cat = Number(datos.categoria);
datos.categoria = cat >= 1 && cat <= 11 ? cat : null;
datos.fecha_obs = datos.fecha_obs || datos.fecha || null;
delete datos.fecha;
datos.origen = 'foto';
// no persistir campos auxiliares de lectura
delete datos.tarjeta_legible;
delete datos.confianza;
delete datos.dudas;

// --- ¿falta algo crítico? repreguntar; el orquestador continúa la charla ---
const faltan = [];
if (!datos.observacion) faltan.push('*qué observaste* (contame brevemente)');
if (!datos.lugar) faltan.push('*dónde fue* (sector / locación)');

let session, reply;
if (faltan.length) {
  // dejamos el borrador en sesión: si el operario responde por texto, lo toma el orquestador
  session = { estado_flujo: 'awaiting_orchestrator', datos: { ...datos, _historial: [] } };
  reply = '📸 Recibí tu tarjeta, ¡gracias! Me falta un dato: ' + faltan.join(' y ') + '.';
} else {
  session = { estado_flujo: 'awaiting_confirm', datos };
  const lineas = [
    '📋 *Resumen de tu observación*',
    datos.fecha_obs ? `📅 Fecha: ${datos.fecha_obs}` : '📅 Fecha: (sin fecha en la tarjeta — se usa la de carga)',
    `📍 Lugar: ${datos.lugar}`,
    datos.servicio_obra ? `🏗 Servicio/Obra: ${datos.servicio_obra}` : null,
    `🏷 Tipo: ${TIPO[datos.tipo]}`,
    datos.categoria ? `📂 Categoría: ${datos.categoria} · ${CATEGORIAS[datos.categoria]}${datos.subitem ? ` (${datos.subitem})` : ''}` : null,
    `📝 ${datos.observacion}`,
    datos.acciones_correctivas ? `🛠 Acción inmediata: ${datos.acciones_correctivas}` : '🛠 Acción inmediata: (sin registrar)',
    `🚦 Prioridad: ${SEMAFORO[datos.prioridad]}`,
    // si el modelo tuvo dudas al leer, las mostramos para que el operario las verifique
    dudas.length ? '' : null,
    dudas.length ? `⚠️ Verificá esto que no leí con certeza: ${dudas.slice(0, 3).join('; ')}` : null,
    '',
    'Respondé *OK* para confirmar, o escribí lo que haya que corregir.',
  ].filter((l) => l !== null);
  reply = lineas.join('\n');
}

const persist = { reporter_hash: ctx.hash, session, reply };
if (ctx.fotoB64) {          // la foto se guarda una sola vez, al extraer
  persist.foto_base64 = ctx.fotoB64;
  persist.foto_mime = ctx.mediaType || 'image/jpeg';
}

return [{ json: { persist } }];
