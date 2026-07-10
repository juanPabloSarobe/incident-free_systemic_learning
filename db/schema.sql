-- Tarjeta Digital HSE — esquema SQLite
-- Taxonomía basada en la Tarjeta de Observaciones POSS016-F1 Rev.02

CREATE TABLE IF NOT EXISTS observaciones (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,   -- folio = OBS-<id con ceros>
    created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
    canal                TEXT    NOT NULL DEFAULT 'whatsapp', -- whatsapp | telegram | manual
    reporter_hash        TEXT,                                -- HMAC-SHA256 del teléfono, NUNCA el número real
    servicio_obra        TEXT,
    lugar                TEXT,                                -- sector / locación en el campo
    fecha_obs            TEXT,                                -- fecha de la observación (puede diferir del alta)
    tipo                 TEXT    NOT NULL DEFAULT 'inseguro'
                         CHECK (tipo IN ('inseguro','seguro','no_audita')),
    personal             TEXT    CHECK (personal IN ('propio','contratista') OR personal IS NULL),
    num_personas         INTEGER,
    categoria            INTEGER CHECK (categoria BETWEEN 1 AND 11),
    subitem              TEXT,                                -- letra del sub-ítem de la tarjeta (a-h)
    observacion          TEXT    NOT NULL,                    -- texto libre: qué se observó
    acciones_correctivas TEXT,                                -- qué se hizo en el momento
    severidad            INTEGER CHECK (severidad BETWEEN 1 AND 4),  -- 1 leve … 4 crítica/near-miss
    prioridad            TEXT    NOT NULL DEFAULT 'verde'
                         CHECK (prioridad IN ('verde','amarillo','rojo')),
    origen               TEXT    NOT NULL DEFAULT 'virtual'
                         CHECK (origen IN ('foto','virtual','seed')),
    foto_path            TEXT,
    estado               TEXT    NOT NULL DEFAULT 'nueva'
                         CHECK (estado IN ('nueva','en_revision','cerrada','PENDIENTE','RECHAZADA')),
    raw_llm_json         TEXT,                                -- respuesta cruda del LLM, para auditoría
    timestamp_mensaje    TEXT,                                -- timestamp original de Twilio (Unix)
    latitud              REAL,                                -- GPS si el usuario lo compartió
    longitud             REAL                                 -- GPS si el usuario lo compartió
);

CREATE INDEX IF NOT EXISTS idx_obs_created   ON observaciones (created_at);
CREATE INDEX IF NOT EXISTS idx_obs_prioridad ON observaciones (prioridad, estado);
CREATE INDEX IF NOT EXISTS idx_obs_lugar     ON observaciones (lugar);

-- Estado conversacional del bot (multi-turno). TTL manejado por la API (updated_at).
CREATE TABLE IF NOT EXISTS sessions (
    reporter_hash        TEXT PRIMARY KEY,
    estado_flujo         TEXT NOT NULL,        -- awaiting_confirm | awaiting_field | awaiting_response
    datos_parciales_json TEXT NOT NULL,        -- borrador de la observación
    pregunta_actual      TEXT,                 -- qué campo estamos pidiendo (observacion, lugar, servicio_obra, acciones_correctivas)
    respuestas_parciales_json TEXT,            -- {"observacion": "...", "lugar": "..."}
    inicio_pregunta      TEXT,                 -- timestamp de cuando se hizo la última pregunta
    intentos_fallidos    INTEGER DEFAULT 0,   -- contador de rechazos para anti-abuso
    updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Taxonomía de la tarjeta física, para joins legibles en tablero y export
CREATE TABLE IF NOT EXISTS categorias (
    id     INTEGER PRIMARY KEY,
    nombre TEXT NOT NULL
);

-- Servicios y obras activos (para sugerencias de autocompletado)
CREATE TABLE IF NOT EXISTS servicios_obras (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT UNIQUE NOT NULL,
    estado TEXT DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo'))
);

-- Estadísticas por usuario para anti-abuso
CREATE TABLE IF NOT EXISTS user_stats (
    reporter_hash          TEXT PRIMARY KEY,
    total_reportes         INTEGER DEFAULT 0,
    reportes_validos       INTEGER DEFAULT 0,
    reportes_rechazados    INTEGER DEFAULT 0,
    timeouts_completados   INTEGER DEFAULT 0,
    last_report_time       TEXT,
    estado                 TEXT DEFAULT 'activo' CHECK (estado IN ('activo', 'bloqueado_temporal', 'bajo_revision')),
    razon_bloqueo          TEXT,
    desbloqueado_en        TEXT
);

-- Cola de reportes que necesitan revisión manual
CREATE TABLE IF NOT EXISTS flagged_reports (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_hash       TEXT,
    razon               TEXT,  -- 'contenido_dudoso' | 'score_bajo' | 'user_bloqueado'
    observacion_id      INTEGER,
    created_at          TEXT DEFAULT (datetime('now')),
    resuelto            INTEGER DEFAULT 0,
    resuelto_por        TEXT,
    nota_supervisor     TEXT
);

INSERT OR IGNORE INTO categorias (id, nombre) VALUES
    (1,  'Reacciones de las Personas'),
    (2,  'Posiciones de las Personas'),
    (3,  'Equipos de Protección Personal'),
    (4,  'Herramientas y Equipos'),
    (5,  'Procedimientos'),
    (6,  'Orden y Aseo'),
    (7,  'Vehicular'),
    (8,  'Ambiente'),
    (9,  'Productos Químicos'),
    (10, 'Instalaciones'),
    (11, 'Otros');

-- Pre-cargar servicios/obras de ejemplo
INSERT OR IGNORE INTO servicios_obras (nombre) VALUES
    ('Perforación Pozo A'),
    ('Extracción Campo Centro'),
    ('Mantenimiento Plataforma'),
    ('Logística Base'),
    ('Otros');
