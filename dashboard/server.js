import express from 'express';
import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, folio } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const MEDIA_DIR = process.env.MEDIA_DIR || '/data/media';
const SESSION_TTL_MIN = Number(process.env.SESSION_TTL_MIN || 120);

mkdirSync(MEDIA_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '25mb' })); // las fotos viajan en base64 desde n8n

app.use(express.static(join(__dirname, 'public')));
app.use('/vendor', express.static(join(__dirname, 'node_modules', 'chart.js', 'dist')));
app.use('/media', express.static(MEDIA_DIR));

app.get('/health', (_req, res) => res.json({ ok: true }));

// ---------------------------------------------------------------------------
// API para el tablero
// ---------------------------------------------------------------------------

const CATEGORIAS = Object.fromEntries(
  db.prepare('SELECT id, nombre FROM categorias').all().map((c) => [c.id, c.nombre])
);

function periodo(days) {
  const d = Number(days);
  return Number.isFinite(d) && d > 0 ? d : 30;
}

app.get('/api/kpis', (req, res) => {
  const days = periodo(req.query.days);
  const desde = `-${days} days`;
  const k = db.prepare(`
    SELECT
      COUNT(*)                                                        AS total,
      SUM(tipo = 'seguro')                                            AS seguros,
      SUM(tipo = 'inseguro')                                          AS inseguros,
      SUM(prioridad = 'rojo'     AND estado != 'cerrada')             AS rojas_abiertas,
      SUM(prioridad = 'amarillo' AND estado != 'cerrada')             AS amarillas_abiertas,
      SUM(prioridad = 'verde'    AND estado != 'cerrada')             AS verdes_abiertas,
      SUM(estado = 'cerrada')                                         AS cerradas
    FROM observaciones
    WHERE created_at >= datetime('now', ?)
  `).get(desde);

  const ultima = db.prepare(
    "SELECT CAST((julianday('now') - julianday(MAX(created_at))) * 24 AS INTEGER) AS horas FROM observaciones"
  ).get();

  res.json({
    dias: days,
    total: k.total || 0,
    seguros: k.seguros || 0,
    inseguros: k.inseguros || 0,
    pct_seguros: k.total ? Math.round(((k.seguros || 0) * 100) / k.total) : 0,
    rojas_abiertas: k.rojas_abiertas || 0,
    amarillas_abiertas: k.amarillas_abiertas || 0,
    verdes_abiertas: k.verdes_abiertas || 0,
    cerradas: k.cerradas || 0,
    horas_desde_ultima: ultima.horas
  });
});

app.get('/api/agregados', (req, res) => {
  const days = periodo(req.query.days);
  const desde = `-${days} days`;

  const porCategoria = db.prepare(`
    SELECT categoria, COUNT(*) AS n FROM observaciones
    WHERE created_at >= datetime('now', ?) AND categoria IS NOT NULL
    GROUP BY categoria ORDER BY categoria
  `).all(desde).map((r) => ({ ...r, nombre: CATEGORIAS[r.categoria] || `Categoría ${r.categoria}` }));

  const porLugar = db.prepare(`
    SELECT COALESCE(lugar, 'Sin especificar') AS lugar, COUNT(*) AS n FROM observaciones
    WHERE created_at >= datetime('now', ?)
    GROUP BY COALESCE(lugar, 'Sin especificar') ORDER BY n DESC LIMIT 10
  `).all(desde);

  const porSemana = db.prepare(`
    SELECT strftime('%Y-%W', created_at) AS semana, MIN(date(created_at)) AS inicio, COUNT(*) AS n
    FROM observaciones
    WHERE created_at >= datetime('now', '-84 days')
    GROUP BY semana ORDER BY semana
  `).all();

  res.json({ dias: days, por_categoria: porCategoria, por_lugar: porLugar, por_semana: porSemana });
});

app.get('/api/observaciones', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const filtros = [];
  const params = [];
  if (req.query.prioridad) { filtros.push('prioridad = ?'); params.push(req.query.prioridad); }
  if (req.query.estado)    { filtros.push('estado = ?');    params.push(req.query.estado); }
  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
  const rows = db.prepare(
    `SELECT * FROM observaciones ${where} ORDER BY created_at DESC LIMIT ?`
  ).all(...params, limit);
  res.json(rows.map((r) => ({ ...r, folio: folio(r.id), categoria_nombre: CATEGORIAS[r.categoria] || null })));
});

app.post('/api/observaciones/:id/estado', (req, res) => {
  const { estado } = req.body || {};
  if (!['nueva', 'en_revision', 'cerrada'].includes(estado)) {
    return res.status(400).json({ error: 'estado inválido' });
  }
  const r = db.prepare('UPDATE observaciones SET estado = ? WHERE id = ?').run(estado, req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'no existe' });
  res.json({ ok: true });
});

app.get('/export.csv', (_req, res) => {
  const rows = db.prepare('SELECT * FROM observaciones ORDER BY created_at DESC').all();
  const cols = [
    ['Folio', (r) => folio(r.id)],
    ['Fecha de carga', (r) => r.created_at],
    ['Fecha observación', (r) => r.fecha_obs],
    ['Servicio/Obra', (r) => r.servicio_obra],
    ['Lugar', (r) => r.lugar],
    ['Tipo', (r) => ({ inseguro: 'Acto Inseguro', seguro: 'Acto Seguro', no_audita: 'No Audita' }[r.tipo])],
    ['Personal', (r) => r.personal],
    ['N° de Personas', (r) => r.num_personas],
    ['Categoría', (r) => (r.categoria ? `${r.categoria} - ${CATEGORIAS[r.categoria]}` : '')],
    ['Sub-ítem', (r) => r.subitem],
    ['Observación / Reconocimiento', (r) => r.observacion],
    ['Acciones Correctivas Realizadas', (r) => r.acciones_correctivas],
    ['Severidad', (r) => r.severidad],
    ['Prioridad', (r) => r.prioridad],
    ['Origen', (r) => r.origen],
    ['Estado', (r) => r.estado]
  ];
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  // BOM + separador ';' para que Excel (es-AR) lo abra directo con doble clic
  const csv = '\uFEFF' +
    cols.map(([h]) => esc(h)).join(';') + '\n' +
    rows.map((r) => cols.map(([, f]) => esc(f(r))).join(';')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="observaciones_hse.csv"');
  res.send(csv);
});

// ---------------------------------------------------------------------------
// API interna para el bot (n8n)
// ---------------------------------------------------------------------------

// Devuelve la sesión conversacional vigente (o null si no existe / venció el TTL).
app.get('/api/sessions/:hash', (req, res) => {
  const s = db.prepare('SELECT * FROM sessions WHERE reporter_hash = ?').get(req.params.hash);
  if (!s) return res.json({ session: null });
  const edadMin = db.prepare(
    "SELECT (julianday('now') - julianday(?)) * 24 * 60 AS m"
  ).get(s.updated_at).m;
  if (edadMin > SESSION_TTL_MIN) {
    db.prepare('DELETE FROM sessions WHERE reporter_hash = ?').run(req.params.hash);
    return res.json({ session: null });
  }
  res.json({
    session: {
      estado_flujo: s.estado_flujo,
      datos: JSON.parse(s.datos_parciales_json),
      updated_at: s.updated_at
    }
  });
});

// Punto único de persistencia para n8n: guarda foto, observación final y/o sesión.
// body: { reporter_hash, foto_base64?, foto_mime?, observacion?, session?|null, reply? }
//  - session === null  -> borra la sesión (fin de conversación)
//  - observacion       -> INSERT final, devuelve folio
//  - reply se devuelve tal cual: permite que n8n arme el TwiML con un solo nodo
app.post('/api/bot/persist', (req, res) => {
  const { reporter_hash, foto_base64, foto_mime, observacion, session, reply } = req.body || {};
  if (!reporter_hash) return res.status(400).json({ error: 'falta reporter_hash' });

  let foto_path = null;
  if (foto_base64) {
    const ext = (foto_mime || 'image/jpeg').includes('png') ? 'png' : 'jpg';
    const name = `${randomUUID()}.${ext}`;
    writeFileSync(join(MEDIA_DIR, name), Buffer.from(foto_base64, 'base64'));
    foto_path = name;
    if (session && session.datos) session.datos.foto_path = foto_path;
  }

  let out = { ok: true, foto_path, reply: reply ?? null };

  if (observacion) {
    const o = observacion;
    const r = db.prepare(`
      INSERT INTO observaciones
        (canal, reporter_hash, servicio_obra, lugar, fecha_obs, tipo, personal, num_personas,
         categoria, subitem, observacion, acciones_correctivas, severidad, prioridad,
         origen, foto_path, raw_llm_json, timestamp_mensaje, latitud, longitud)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      o.canal || 'whatsapp', reporter_hash,
      o.servicio_obra || null, o.lugar || null, o.fecha_obs || null,
      ['inseguro', 'seguro', 'no_audita'].includes(o.tipo) ? o.tipo : 'inseguro',
      ['propio', 'contratista'].includes(o.personal) ? o.personal : null,
      Number.isFinite(Number(o.num_personas)) ? Number(o.num_personas) : null,
      o.categoria >= 1 && o.categoria <= 11 ? o.categoria : null,
      o.subitem || null,
      o.observacion || '(sin descripción)',
      o.acciones_correctivas || null,
      o.severidad >= 1 && o.severidad <= 4 ? o.severidad : null,
      ['verde', 'amarillo', 'rojo'].includes(o.prioridad) ? o.prioridad : 'verde',
      o.origen === 'foto' ? 'foto' : 'virtual',
      o.foto_path || foto_path,
      o.raw_llm_json ? String(o.raw_llm_json) : null,
      o.timestamp_mensaje || null,
      o.latitud != null ? Number(o.latitud) : null,
      o.longitud != null ? Number(o.longitud) : null
    );
    out = { ...out, id: r.lastInsertRowid, folio: folio(r.lastInsertRowid) };

    // Actualizar estadísticas del usuario (anti-abuso)
    db.prepare(`
      INSERT INTO user_stats (reporter_hash, total_reportes, reportes_validos, last_report_time)
      VALUES (?, 1, 1, datetime('now'))
      ON CONFLICT(reporter_hash) DO UPDATE SET
        total_reportes = total_reportes + 1,
        reportes_validos = reportes_validos + 1,
        last_report_time = datetime('now')
    `).run(reporter_hash);
  }

  if (session === null) {
    db.prepare('DELETE FROM sessions WHERE reporter_hash = ?').run(reporter_hash);
  } else if (session) {
    db.prepare(`
      INSERT INTO sessions (reporter_hash, estado_flujo, datos_parciales_json,
        pregunta_actual, respuestas_parciales_json, inicio_pregunta, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(reporter_hash) DO UPDATE SET
        estado_flujo = excluded.estado_flujo,
        datos_parciales_json = excluded.datos_parciales_json,
        pregunta_actual = excluded.pregunta_actual,
        respuestas_parciales_json = excluded.respuestas_parciales_json,
        inicio_pregunta = excluded.inicio_pregunta,
        updated_at = excluded.updated_at
    `).run(
      reporter_hash,
      session.estado_flujo,
      JSON.stringify(session.datos || {}),
      session.pregunta_actual || null,
      session.respuestas_parciales_json || null,
      session.inicio_pregunta || null
    );
  }

  res.json(out);
});

// ---------------------------------------------------------------------------
// API: Reportes fraudulentos (flagged)
// ---------------------------------------------------------------------------

app.post('/api/bot/flag', (req, res) => {
  const { reporter_hash, razon, observacion_id } = req.body || {};
  if (!reporter_hash) return res.status(400).json({ error: 'falta reporter_hash' });

  db.prepare(`
    INSERT INTO flagged_reports (reporter_hash, razon, observacion_id)
    VALUES (?, ?, ?)
  `).run(reporter_hash, razon || 'contenido_dudoso', observacion_id || null);

  // Incrementar contador de rechazos y bloquear si hay reincidencia
  db.prepare(`
    INSERT INTO user_stats (reporter_hash, total_reportes, reportes_rechazados, last_report_time)
    VALUES (?, 1, 1, datetime('now'))
    ON CONFLICT(reporter_hash) DO UPDATE SET
      total_reportes = total_reportes + 1,
      reportes_rechazados = reportes_rechazados + 1,
      last_report_time = datetime('now'),
      estado = CASE
        WHEN reportes_rechazados >= 2 THEN 'bloqueado_temporal'
        ELSE estado
      END,
      razon_bloqueo = CASE
        WHEN reportes_rechazados >= 2 THEN 'Múltiples reportes rechazados'
        ELSE razon_bloqueo
      END,
      desbloqueado_en = CASE
        WHEN reportes_rechazados >= 2 THEN datetime('now', '+30 minutes')
        ELSE desbloqueado_en
      END
  `).run(reporter_hash);

  res.json({ ok: true });
});

app.get('/api/flagged', (_req, res) => {
  const rows = db.prepare(`
    SELECT * FROM flagged_reports WHERE resuelto = 0 ORDER BY created_at DESC LIMIT 50
  `).all();
  res.json(rows);
});

app.post('/api/flagged/:id/resolver', (req, res) => {
  const { nota_supervisor, resuelto_por } = req.body || {};
  db.prepare(`
    UPDATE flagged_reports SET resuelto = 1, nota_supervisor = ?, resuelto_por = ? WHERE id = ?
  `).run(nota_supervisor || null, resuelto_por || 'supervisor', req.params.id);
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`[dashboard] escuchando en :${PORT}`));
