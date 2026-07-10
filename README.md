# Tarjeta Digital HSE 🦺

Demo de fin de semana: digitalización de la **Tarjeta de Observaciones** de seguridad (near-misses, actos inseguros y reconocimientos) para el rubro petrolero, **sin cambiar el procedimiento existente**: el operador le saca una foto a su tarjeta de papel (o directamente la dicta por escrito) y la manda por **WhatsApp**. Un bot la interpreta con IA, la guarda estructurada y el equipo de HSE la ve **semi-procesada** en un tablero de comando con semáforo de prioridades.

> El diseño completo (problema, flujos, decisiones, roadmap) está en [`docs/DESIGN.md`](docs/DESIGN.md). El guion para mostrar la demo está en [`docs/demo-script.md`](docs/demo-script.md).

## Arquitectura

```
Operador (WhatsApp) ──► Twilio Sandbox ──► cloudflared ──► n8n ──► LLM visión (Groq, free tier)
                                                             │
                                                             ▼
                                            API + SQLite + Tablero (puerto 3000)
```

Tres contenedores (`docker-compose.yml`): **n8n** (orquestación del bot), **dashboard** (API + SQLite + tablero web) y **cloudflared** (túnel público para que Twilio alcance a n8n en la Mac mini).

Si querés que el tablero sea visible desde Internet, también se levanta `cloudflared-dashboard`, que publica el HTML del dashboard en una URL temporal para compartirla con cualquiera.

**Anonimato:** igual que la tarjeta de papel. El número de teléfono nunca se persiste — solo un HMAC para hilvanar la conversación multi-turno.

## Setup en la Mac mini (~30 min la primera vez)

### 1. Credenciales

- **Twilio**: crear cuenta gratis en [twilio.com](https://www.twilio.com). En la consola: *Messaging → Try it out → Send a WhatsApp message* activa el **WhatsApp Sandbox**. Anotá el **Account SID** y el **Auth Token** (Console → Account Info).
- **Groq**: crear cuenta gratis en [console.groq.com](https://console.groq.com) y generar una API key (free tier, alcanza de sobra para la demo).

### 2. Configuración

```bash
cp .env.example .env
# editar .env: TWILIO_SID, TWILIO_TOKEN, GROQ_API_KEY, HASH_SECRET
docker compose up -d --build
```

### 3. Túnel público

```bash
docker compose logs cloudflared 2>&1 | grep trycloudflare
# → https://algo-random.trycloudflare.com
```

Copiá esa URL en `.env` como `PUBLIC_URL` y recreá n8n para que registre bien sus webhooks:

```bash
docker compose up -d --force-recreate n8n
```

> La URL del quick tunnel de cloudflared **cambia en cada reinicio** del contenedor: si reiniciás, repetí este paso y el 5. (Para una URL fija: túnel con nombre de Cloudflare o ngrok con dominio reservado — ver roadmap en DESIGN.md.)

### 4. Importar el workflow en n8n

1. Abrir [http://localhost:5678](http://localhost:5678) y crear el usuario local (primera vez).
2. *Workflows → Import from file* → elegir [`n8n/workflow.json`](n8n/workflow.json).
3. Abrir el workflow y activarlo (toggle **Active**).

El workflow se genera desde código legible: los prompts viven en [`n8n/prompts/`](n8n/prompts/) y la lógica de cada nodo en [`n8n/src/`](n8n/src/). Si tocás algo, regenerá e importá de nuevo:

```bash
node n8n/build-workflow.mjs
```

### 5. Conectar Twilio al webhook

En la consola de Twilio: *Messaging → Try it out → Send a WhatsApp message → pestaña Sandbox settings*. En **"When a message comes in"** pegar:

```
https://<tu-url>.trycloudflare.com/webhook/whatsapp
```

método `POST`, y guardar.

### 6. Probar

1. Desde tu WhatsApp, mandá `join <código-del-sandbox>` al número del sandbox (el código aparece en la misma pantalla de Twilio). Una sola vez por teléfono.
2. Mandá `hola` → el bot te explica cómo se usa.
3. Mandá una **foto de una tarjeta de observaciones** completa → el bot devuelve el resumen interpretado → respondé `OK` → folio asignado.
4. Mandá una **nota de voz** contando qué viste, dónde y qué se hizo → el bot responde `🎙️ Escuché: «…»` con la transcripción y sigue la conversación igual que con texto.
5. Abrí el tablero: [http://localhost:3000](http://localhost:3000) — la observación ya está, clasificada y priorizada.

## Tablero

[http://localhost:3000](http://localhost:3000) — sin login (es una demo):

- KPIs del período (7/30/90 días): total, % actos seguros, críticas abiertas, tiempo desde el último reporte.
- Semáforo de prioridades abiertas (🔴/🟡/🟢).
- Barras por categoría de la tarjeta (las 11 de POSS016-F1) y por lugar/sector.
- Tendencia semanal, tabla de últimas observaciones (con foto y cambio de estado) y **export a CSV** que abre directo en Excel.

Para publicarlo fuera de la red local, levantá el túnel del dashboard y copiá la URL que imprime el contenedor:

```bash
docker compose logs cloudflared-dashboard 2>&1 | grep trycloudflare
```

Esa URL la puede abrir cualquier persona mientras el contenedor esté corriendo.

Arranca con datos de demostración (`SEED_DEMO=true` en `.env`; poné `false` y borrá el volumen `hse_data` para empezar en limpio).

## Desarrollo local (sin Docker)

```bash
cd dashboard && npm install
DB_PATH=/tmp/hse.db SCHEMA_PATH=../db/schema.sql SEED_PATH=../db/seed.sql SEED_DEMO=true node server.js
# tablero en http://localhost:3000
```

La lógica de los nodos de n8n se puede probar sin n8n con el arnés descrito en `docs/DESIGN.md` (§ Verificación).

## Estructura

```
docker-compose.yml        # n8n + dashboard + cloudflared
db/schema.sql             # esquema SQLite (+ seed.sql de demo)
n8n/build-workflow.mjs    # genera workflow.json desde src/ y prompts/
n8n/src/*.js              # lógica de cada nodo Code, legible y testeable
n8n/prompts/*.md          # prompts del LLM (taxonomía POSS016-F1)
dashboard/                # Express + better-sqlite3 + Chart.js
docs/DESIGN.md            # diseño completo y roadmap
docs/demo-script.md       # guion de la demo
```
