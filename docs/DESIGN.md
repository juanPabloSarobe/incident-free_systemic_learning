# Diseño — Tarjeta Digital HSE

## 1. El problema

En el rubro petrolero se usa la **Tarjeta de Observaciones** en papel (formulario POSS016-F1 Rev.02): toda persona que ve un incidente, un near-miss, un acto inseguro o una oportunidad de mejora debe completar una tarjeta y depositarla en un buzón. Es anónima (la firma es opcional). Un responsable de seguridad la retira, la lee, la registra y la procesa.

El circuito falla por fricción, no por diseño conceptual:

- **Para el observador**: hay que acordarse de llevar tarjeta y lapicera, escribir en el campo (frío, viento, guantes), y trasladarse hasta el buzón. Cualquier eslabón que falte, la observación se pierde.
- **Para el receptor**: el encargado de seguridad está sobrecargado; leer, transcribir y clasificar tarjetas manuscritas es trabajo lento que compite con lo urgente.
- **Consecuencia sistémica**: muchas observaciones no se reportan ("total nadie lo lee", "no le quiero sumar trabajo") → se pierden near-misses → no hay aprendizaje sistémico → los controles y procedimientos se generan recién *después* del incidente, exactamente lo que se quiere evitar.

## 2. Principio rector

**Adaptarse al procedimiento, no reemplazarlo.** La tarjeta de papel sigue existiendo y sigue valiendo. Lo que se digitaliza es el *traslado y el procesamiento*:

- Si el operador completó la tarjeta → le saca una **foto** y la manda por WhatsApp. Listo: no camina hasta el buzón, y nadie transcribe a mano.
- Si no tiene tarjeta/lapicera/ganas → **describe la observación por texto** y un chatbot le hace las consultas mínimas para que no falte información.
- El equipo HSE recibe todo **ya estructurado y clasificado** con la misma taxonomía de la tarjeta física, priorizado con un semáforo, en un tablero, y exportable a Excel (su herramienta actual).

## 3. Arquitectura

```
┌──────────┐   foto/texto   ┌────────┐  webhook POST  ┌─────────────┐
│ Operador ├───────────────►│ Twilio ├───────────────►│ cloudflared │ (túnel: la Mac mini
│ WhatsApp │◄───────────────┤ Sandbox│◄───TwiML───────┤   (tunnel)  │  no expone puertos)
└──────────┘    respuesta   └────────┘                └──────┬──────┘
                                                             ▼
                              ┌──────────────────────── n8n (Docker) ─┐
                              │  Webhook → contexto → sesión → router │
                              │     ├─ foto  → Groq visión (gratis)   │
                              │     ├─ texto → Groq texto  (gratis)   │
                              │     ├─ confirmar / completar          │
                              │     └─ ayuda                          │
                              └───────────────┬───────────────────────┘
                                              │ REST
                                              ▼
                              ┌── dashboard (Docker, :3000) ──────────┐
                              │  Express + better-sqlite3             │
                              │  /api/bot/*  (persistencia del bot)   │
                              │  /api/*      (KPIs del tablero)       │
                              │  /           (tablero Chart.js)       │
                              │  /export.csv (compatibilidad Excel)   │
                              │  SQLite + fotos en volumen /data      │
                              └───────────────────────────────────────┘
```

Decisión clave: **n8n no toca la base directamente** (no tiene nodo SQLite). El servicio `dashboard` es dueño de los datos y expone una mini-API interna (`/api/sessions/:hash`, `/api/bot/persist`). n8n orquesta; la API persiste. Esto además deja un solo lugar donde validar datos.

## 4. Flujos conversacionales

Máquina de estados por remitente (sesión con TTL de 2 h, keyed por HMAC del teléfono):

| Estado | Mensaje entrante | Acción |
|---|---|---|
| — | foto | **Flujo A**: descargar media → LLM visión extrae JSON → si falta lugar/observación repregunta (`awaiting_field`), si no resumen (`awaiting_confirm`) |
| — | texto ≥ 15 chars | **Flujo B**: LLM texto clasifica → misma lógica de faltantes/resumen |
| — | saludo / texto corto | mensaje de ayuda |
| `awaiting_field` | texto | LLM fusiona el dato nuevo con el borrador → resumen |
| `awaiting_confirm` | "OK/sí/dale/…" | INSERT definitivo → folio → agradecimiento, fin de sesión |
| `awaiting_confirm` | otro texto | se toma como corrección → LLM fusiona → nuevo resumen |

Diseño de la conversación:

- **Máximo esfuerzo cognitivo pedido al operador: una repregunta.** Solo se consideran críticos `observacion` y `lugar`; todo lo demás (categoría, severidad, sub-ítem) lo infiere el LLM y se puede corregir después desde el tablero.
- **Siempre se confirma antes de guardar** (el resumen legible es también el feedback de "te entendí").
- **El semáforo no se delega al LLM**: el LLM estima `severidad` (1-4, potencial de daño), y la prioridad se calcula determinística en código (`≥3 → rojo`, `2 → amarillo`, `1 o acto seguro → verde`). Así el criterio es auditable y ajustable sin tocar prompts.
- Si el LLM falla, el bot responde un fallback amable que recuerda que la tarjeta de papel sigue valiendo (el circuito viejo es el plan B — nunca se pierde la observación por culpa de la demo).

## 5. IA

- **Proveedor**: Groq free tier (API compatible con OpenAI — cambiar de proveedor es cambiar URL y modelo en `.env`).
  - Visión: `meta-llama/llama-4-scout-17b-16e-instruct` (lee la tarjeta manuscrita).
  - Texto: `llama-3.3-70b-versatile` (clasificación y fusión de borradores).
- **Prompts** (en `n8n/prompts/`, fuente única inyectada al workflow por el build):
  - La **taxonomía POSS016-F1 completa** (11 categorías con sub-ítems) va embebida en ambos prompts: el modelo clasifica contra el mismo vocabulario que la tarjeta física.
  - Salida forzada a JSON (`response_format: json_object` + parser tolerante a fences).
  - Instrucción explícita de **no inventar**: campo ausente ⇒ `null` (dispara la repregunta).
- El JSON crudo del LLM se guarda en `raw_llm_json` para auditar clasificaciones erradas y mejorar prompts con casos reales.

## 5 bis. Regla de oro conversacional: NUNCA silencio

Un bot de seguridad que no contesta se lee como "el sistema está roto" — y la gente deja de reportar. Dos defensas:

- **Respuesta asíncrona**: Twilio corta el webhook a los 15 s, pero el LLM puede tardar más. El webhook devuelve un ACK vacío al instante y la respuesta real sale como mensaje nuevo por la API REST de Twilio (`Messages.json`). La latencia del LLM ya no puede causar silencio. El número del operario se usa solo en tránsito para el envío; sigue sin persistirse.
- **Todo camino termina en un mensaje**: los nodos HTTP degradan con `onError: continue` y los lectores de binarios tienen fallback ("no pude descargar la foto, ¿la reenviás?").

**Anti-abuso con aviso explícito** (3 strikes / 30 min): cada `rechazar` del orquestador registra un strike (`flagged_reports` + `user_stats`). El 2º rechazo advierte ("si el próximo tampoco es una observación real, pauso 30 minutos"); el 3º pausa e **informa hasta qué hora**; durante la pausa toda entrada recibe el aviso de estado (sin gastar LLM) y al vencer se desbloquea solo. El orquestador además recibe los antecedentes ("N rechazos recientes") para rechazar directo sin re-entrevistar al que está jugando. La cola `/api/flagged` queda para revisión del supervisor.

## 6. Anonimato

Requisito heredado de la tarjeta (firma opcional, cultura de no-castigo):

- El `From` de Twilio **nunca se persiste**. Se deriva `reporter_hash = HMAC-SHA256(telefono, HASH_SECRET)` truncado, solo para hilvanar la conversación multi-turno y deduplicar.
- Sin `HASH_SECRET` no hay forma práctica de revertir el hash al número.
- Consideración honesta: Twilio (y los logs de ejecución de n8n) sí ven el número — igual que el buzón físico "ve" la letra del que escribe. Para la demo es equivalente al statu quo; en producción: retención corta de ejecuciones en n8n y data-retention policy en Twilio.

## 7. Modelo de datos

Ver `db/schema.sql`. Lo no obvio:

- `observaciones.origen` distingue `foto` / `virtual` / `seed` — KPI interesante en sí mismo (¿cuánto reporte entra por cada canal?).
- `estado` (`nueva → en_revision → cerrada`) da el mini-workflow de gestión para HSE sin construir un sistema de tickets.
- `sessions` es efímera (TTL en la API); la conversación no queda archivada, solo el resultado.
- Folio legible `OBS-0001`: es la referencia que el operador recibe y que HSE usa para hablar del caso.

## 8. Tablero (sin login — demo)

Diseñado para el gerente/supervisor de HSE que entra 2 minutos por día:

- **Fila de KPIs**: total del período, % actos seguros (proxy de cultura positiva), críticas abiertas (el número que tiene que estar en 0), tiempo desde la última observación (proxy de participación: si sube, la gente dejó de reportar).
- **Semáforo** de abiertas por prioridad, con ícono + etiqueta (no solo color).
- **Barras por categoría** (detecta patrones sistémicos: "otra vez EPP") **y por lugar** (detecta sectores calientes).
- **Tendencia semanal** (¿el canal se usa cada vez más o murió?).
- **Tabla operativa**: últimas observaciones con foto original, cambio de estado inline y export CSV con las columnas de la tarjeta.

## 9. Qué se aprende con este proyecto (objetivos secundarios)

- **Twilio**: webhook entrante de WhatsApp, descarga de media con Basic Auth, respuesta TwiML.
- **n8n**: webhook → router → ramas → convergencia; workflow generado desde código versionable (`n8n/src/` + `build-workflow.mjs`) en lugar de editado a mano en la UI.

## 10. Verificación

1. **Lógica del bot sin n8n**: los nodos Code se ejecutan con un arnés que simula `$input/$env/$('Nodo')` (casos: foto→resumen→confirmar→folio; texto→repregunta→completar; LLM caído; saludo). Está en el historial del desarrollo y es re-creable: cada archivo de `n8n/src/` es una función pura de sus entradas.
2. **API + tablero**: `docker compose up` → tablero en :3000 con seed; simular el bot con `curl` contra `/api/bot/persist` y `/api/sessions/:hash`.
3. **End-to-end real**: mandar la foto de una tarjeta real por WhatsApp → resumen correcto → `OK` → folio → aparece en el tablero con la foto. Mandar "vi una manguera hidráulica pelada en boca de pozo 12, la cambiamos" → repregunta o resumen → confirmar.
4. **Anonimato**: `sqlite3 hse.db "SELECT DISTINCT reporter_hash FROM observaciones"` — no debe haber ningún número de teléfono.

## 11. Roadmap (después de la demo)

Corto plazo:
- ~~**Audio → texto**~~ ✅ implementado: nota de voz de WhatsApp → Whisper en Groq (`whisper-large-v3`, free tier, con prompt de jerga petrolera) → eco `🎙️ Escuché: «…»` → mismo flujo del orquestador que un mensaje de texto. En el campo, con guantes, hablar gana por goleada.
- ✅ **Fotos de evidencia**: tras el folio se abre una ventana de 10 min (renovable con cada foto, cerrada por cualquier texto) para adjuntar fotos de lo observado — tabla `fotos`, visibles en el tablero y contadas en el CSV. La tarjeta es transitoria: el registro fotográfico de la condición insegura vale por sí mismo. Bonus: frente y dorso de la tarjeta en la misma conversación se consolidan en un solo reporte.
- **Alerta de rojas**: cuando entra una prioridad `rojo`, n8n avisa al canal del equipo HSE (WhatsApp/Telegram/mail).
- URL fija del túnel (Cloudflare named tunnel) para no reconfigurar Twilio en cada reinicio.

Mediano plazo:
- Salir del sandbox: número de WhatsApp Business verificado en Twilio.
- Login simple del tablero + acciones correctivas con responsable y vencimiento (cerrar el ciclo de mejora).
- Detección de repetición: "3.ª observación de EPP en playa de tanques este mes" → sugerencia automática de acción sistémica. Este es el corazón del *aprendizaje sistémico*: pasar de observaciones sueltas a patrones.
- Migrar SQLite → Postgres si crece el volumen o hay escrituras concurrentes.
