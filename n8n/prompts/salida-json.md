Respondé ÚNICAMENTE con un objeto JSON válido (sin texto adicional, sin markdown) con esta forma exacta:
{
  "servicio_obra": "string o null",
  "lugar": "string o null (sector/locación donde se observó)",
  "fecha": "YYYY-MM-DD o null",
  "tipo": "inseguro" | "seguro" | "no_audita",
  "personal": "propio" | "contratista" | null,
  "num_personas": number | null,
  "categoria": number 1-11 | null,
  "subitem": "letra del sub-ítem (a-h) o null",
  "observacion": "string o null (qué se observó, redactado claro)",
  "acciones_correctivas": "string o null (qué se hizo en el momento)",
  "severidad": number 1-4
}
Criterio de severidad (potencial de daño, no el daño ocurrido):
1 = leve / buena práctica; 2 = moderada; 3 = seria (podía causar lesión); 4 = crítica / near-miss (podía causar lesión grave o fatalidad).
Si el mensaje describe un acto SEGURO o reconocimiento, tipo="seguro" y severidad=1.
No inventes datos: si algo no está en la entrada, usá null.

Si estás leyendo una FOTO de una tarjeta, agregá además estos campos:
  "tarjeta_legible": true | false,   // false si está en blanco, no es una tarjeta, o es ilegible
  "confianza": number 0.0-1.0,        // qué tan seguro estás de la lectura global
  "dudas": ["string"]                 // lista de marcas/campos ambiguos, dobles, débiles, incompletos o inferidos; [] si no hay
Sé honesto con "confianza" y "dudas": es mejor marcar una duda que adivinar.
