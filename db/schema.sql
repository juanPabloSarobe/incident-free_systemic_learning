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
                         CHECK (estado IN ('nueva','en_revision','cerrada')),
    raw_llm_json         TEXT                                 -- respuesta cruda del LLM, para auditoría
);

CREATE INDEX IF NOT EXISTS idx_obs_created   ON observaciones (created_at);
CREATE INDEX IF NOT EXISTS idx_obs_prioridad ON observaciones (prioridad, estado);
CREATE INDEX IF NOT EXISTS idx_obs_lugar     ON observaciones (lugar);

-- Estado conversacional del bot (multi-turno). TTL manejado por la API (updated_at).
CREATE TABLE IF NOT EXISTS sessions (
    reporter_hash        TEXT PRIMARY KEY,
    estado_flujo         TEXT NOT NULL,        -- awaiting_confirm | awaiting_field
    datos_parciales_json TEXT NOT NULL,        -- borrador de la observación
    updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Taxonomía de la tarjeta física, para joins legibles en tablero y export
CREATE TABLE IF NOT EXISTS categorias (
    id     INTEGER PRIMARY KEY,
    nombre TEXT NOT NULL
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
