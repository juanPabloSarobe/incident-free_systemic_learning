# Guion de demo (~10 minutos)

Preparación previa: `docker compose up -d`, workflow activo en n8n, webhook configurado en Twilio, tu teléfono ya unido al sandbox (`join <código>`), tablero abierto en pantalla grande ([http://localhost:3000](http://localhost:3000)).

## 1. El problema (1 min)

Mostrar una tarjeta de papel real: "Hoy esto se escribe a mano en el campo, camina hasta un buzón y espera a que alguien tenga tiempo de leerla y transcribirla. Muchas no llegan nunca."

## 2. Flujo A — la foto (3 min)

1. Completar una tarjeta a mano (o tener una lista): lugar, tipo marcado, texto de observación y acción correctiva.
2. Sacarle una foto con WhatsApp y mandarla al número del sandbox.
3. Mostrar la respuesta del bot: **leyó la letra manuscrita, marcó la categoría, asignó severidad y semáforo**.
4. Responder `OK` → llega el folio.
5. Refrescar el tablero: la observación está arriba de todo, con la foto original adjunta.

Frase clave: *"El procedimiento no cambió: la misma tarjeta, el mismo formato. Solo desapareció el buzón y la transcripción manual."*

## 3. Flujo B — sin tarjeta (2 min)

1. Mandar por texto: `vi una manguera hidráulica pelada en la boca de pozo 12, paramos y la cambiamos en el momento`
2. El bot repregunta solo lo que falta (o resume directo si está todo).
3. `OK` → folio → tablero.
4. Repetir la observación pero como **nota de voz**: el bot responde `🎙️ Escuché: «…»` con la transcripción (se puede corregir antes del OK) y sigue igual que con texto. También vale foto de la tarjeta + audio explicando qué pasó, en la misma conversación.

Frase clave: *"Si no tiene tarjeta, lapicera, o hace -5° con viento: lo dicta igual. Cero excusas para no reportar."*

## 4. Mensaje corto → ayuda (30 s)

Mandar `hola` → el bot explica las dos vías y aclara que es anónimo.

## 5. El tablero para HSE (3 min)

- KPIs: total, % actos seguros, **críticas abiertas** (el número a vigilar), tiempo desde el último reporte (si crece, la gente dejó de reportar).
- Semáforo → clic mental del gerente: "¿qué hay en rojo hoy?"
- Barras por categoría: "EPP aparece 5 veces este mes → problema sistémico, no casos sueltos."
- Barras por lugar: "playa de tanques concentra las observaciones → foco ahí."
- Cambiar el estado de una observación a `cerrada` en vivo.
- **Exportar CSV** y abrirlo en Excel: "su planilla de siempre, ya cargada."

## 6. Cierre (30 s)

- Anónimo como la tarjeta: no se guarda el número de teléfono.
- Corre entero en una Mac mini con software gratuito (n8n + Groq free tier + Twilio sandbox).
- Roadmap: notas de voz, alerta automática de rojas, detección de patrones repetidos.

## Mensajes de prueba útiles

| Mensaje | Resultado esperado |
|---|---|
| foto de tarjeta completa | resumen con categoría y semáforo |
| foto borrosa / tarjeta vacía | repregunta por lugar/observación |
| `vi a dos compañeros sin arnés arriba del tanque en batería 7` | rojo, cat. 3 (EPP) o 2 (caídas) |
| `la cuadrilla hizo el bloqueo perfecto antes de tocar la bomba` | acto seguro, verde |
| `hola` | mensaje de ayuda |
| `OK` (con resumen pendiente) | folio asignado |
| corrección en vez de OK: `el lugar era la locación 45` | resumen actualizado |
