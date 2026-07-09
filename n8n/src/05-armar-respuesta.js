// Nodo "Armar respuesta": procesa la salida del LLM (visión o texto), normaliza,
// detecta datos faltantes y arma la respuesta al operador + el payload de persistencia.
// Recibe de "LLM visión" o de "LLM texto"; recupera el contexto del nodo que haya corrido.
let ctx;
try { ctx = $('Foto a base64').first().json; }
catch (e) { ctx = $('Armar prompt texto').first().json; }

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

// --- normalizar + prioridad determinística (el semáforo no se delega al LLM) ---
if (ctx.accion === 'completar') datos = { ...ctx.session.datos, ...datos };
datos.tipo = ['inseguro', 'seguro', 'no_audita'].includes(datos.tipo) ? datos.tipo : 'inseguro';
datos.severidad = Math.min(4, Math.max(1, Number(datos.severidad) || 1));
datos.prioridad = datos.tipo === 'seguro' ? 'verde'
  : datos.severidad >= 3 ? 'rojo'
  : datos.severidad === 2 ? 'amarillo' : 'verde';
const cat = Number(datos.categoria);
datos.categoria = cat >= 1 && cat <= 11 ? cat : null;
datos.fecha_obs = datos.fecha_obs || datos.fecha || null;
delete datos.fecha;
if (ctx.fotoB64) datos.origen = 'foto';
if (!datos.origen) datos.origen = 'virtual';

// --- ¿falta algo crítico? repreguntar SOLO eso ---
const faltan = [];
if (!datos.observacion) faltan.push('*qué observaste* (contame brevemente)');
if (!datos.lugar) faltan.push('*dónde fue* (sector / locación)');

let session, reply;
if (faltan.length) {
  session = { estado_flujo: 'awaiting_field', datos };
  reply = (ctx.fotoB64 ? '📸 Recibí tu tarjeta, ¡gracias! ' : '¡Gracias por reportar! ') +
    `Me falta un dato: ${faltan.join(' y ')}.`;
} else {
  session = { estado_flujo: 'awaiting_confirm', datos };
  const lineas = [
    '📋 *Resumen de tu observación*',
    `📍 Lugar: ${datos.lugar}`,
    datos.servicio_obra ? `🏗 Servicio/Obra: ${datos.servicio_obra}` : null,
    `🏷 Tipo: ${TIPO[datos.tipo]}`,
    datos.categoria ? `📂 Categoría: ${datos.categoria} · ${CATEGORIAS[datos.categoria]}${datos.subitem ? ` (${datos.subitem})` : ''}` : null,
    `📝 ${datos.observacion}`,
    datos.acciones_correctivas ? `🛠 Acción inmediata: ${datos.acciones_correctivas}` : '🛠 Acción inmediata: (sin registrar)',
    `🚦 Prioridad: ${SEMAFORO[datos.prioridad]}`,
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
