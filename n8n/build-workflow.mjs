// Genera n8n/workflow.json (importable en n8n) a partir de:
//   - n8n/src/*.js       -> el código de cada nodo Code (fuente de verdad, con highlighting)
//   - n8n/prompts/*.md   -> los prompts del LLM (se inyectan en el código al buildear)
// Uso:  node n8n/build-workflow.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const prompt = (f) => readFileSync(join(dir, 'prompts', f), 'utf8').trim();
const src = (f) => readFileSync(join(dir, 'src', f), 'utf8').trim();

const taxonomia = prompt('taxonomia.md');
const salidaJson = prompt('salida-json.md');
const conComunes = (p) => p.replaceAll('__TAXONOMIA__', taxonomia).replaceAll('__SALIDA_JSON__', salidaJson);
const promptExtraccion = conComunes(prompt('extraccion-tarjeta.md'));
const promptClasificacion = conComunes(prompt('clasificacion-texto.md'));
const promptOrquestador = prompt('orquestador.md').replaceAll('__TAXONOMIA__', taxonomia);

const code = {
  prepararContexto: src('01-preparar-contexto.js'),
  router: src('02-router.js'),
  fotoABase64: src('03-foto-a-base64.js').replace('__PROMPT_EXTRACCION__', JSON.stringify(promptExtraccion)),
  armarRespuesta: src('05-armar-respuesta.js'),
  finalizar: src('06-finalizar.js'),
  orquestador: src('14-orquestador.js').replace('__PROMPT_ORQUESTADOR__', JSON.stringify(promptOrquestador)),
  procesarOrquestador: src('15-procesar-orquestador.js'),
  procesarTranscripcion: src('16-procesar-transcripcion.js'),
  adjuntarFoto: src('17-adjuntar-foto.js'),
  armarSaliente: src('18-armar-saliente.js'),
  bloqueado: src('19-bloqueado.js'),
};

// Contexto de jerga para Whisper: mejora mucho el reconocimiento del vocabulario HSE
const WHISPER_PROMPT = 'Observación de seguridad en yacimiento petrolero. Vocabulario: EPP, casco, ' +
  'arnés, retroexcavadora, locación, near-miss, acto inseguro, tarjeta de observaciones, contratista, ' +
  'izaje, boca de pozo, batería, playa de tanques, pañol, equipo de torre, pulling.';

const codeNode = (name, jsCode, position, extra = {}) => ({
  name,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position,
  parameters: { jsCode },
  ...extra,
});

const groqNode = (name, position) => ({
  name,
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position,
  onError: 'continueRegularOutput', // si el LLM falla, "Armar respuesta" contesta con un fallback amable
  parameters: {
    method: 'POST',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    sendHeaders: true,
    headerParameters: { parameters: [
      { name: 'Authorization', value: '=Bearer {{ $env.GROQ_API_KEY }}' },
    ] },
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify($json.groqBody) }}',
    options: { timeout: 60000 },
  },
});

const switchRule = (valor) => ({
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
    conditions: [{
      leftValue: '={{ $json.accion }}',
      rightValue: valor,
      operator: { type: 'string', operation: 'equals' },
    }],
    combinator: 'and',
  },
  renameOutput: true,
  outputKey: valor,
});

const nodes = [
  {
    name: 'Webhook Twilio',
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    position: [0, 300],
    webhookId: 'hse-tarjeta-digital-whatsapp',
    parameters: { httpMethod: 'POST', path: 'whatsapp', responseMode: 'responseNode', options: {} },
  },
  {
    // Twilio corta a los 15 s: se responde un ACK vacío al instante y la respuesta
    // real sale después por la API REST ("Enviar por WhatsApp"). Nunca más silencio
    // porque el LLM tardó.
    name: 'ACK a Twilio',
    type: 'n8n-nodes-base.respondToWebhook',
    typeVersion: 1.1,
    position: [180, 300],
    parameters: {
      respondWith: 'text',
      responseBody: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      options: { responseHeaders: { entries: [{ name: 'Content-Type', value: 'text/xml' }] } },
    },
  },
  codeNode('Preparar contexto', code.prepararContexto, [360, 300]),
  {
    name: 'Traer sesión',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [400, 300],
    onError: 'continueRegularOutput', // si la API temporalmente falla, seguir sin sesión
    parameters: { method: 'GET', url: '={{ $env.API_URL }}/api/sessions/{{ $json.hash }}', options: {} },
  },
  codeNode('Router', code.router, [600, 300]),
  {
    name: 'Switch Acción',
    type: 'n8n-nodes-base.switch',
    typeVersion: 3.2,
    position: [800, 300],
    parameters: {
      rules: { values: ['foto', 'audio', 'confirmar', 'adjuntar_foto', 'bloqueado'].map(switchRule) },
      options: { fallbackOutput: 'extra' }, // 6.ª salida: orquestador (todo el resto)
    },
  },
  codeNode('Mensaje bloqueado', code.bloqueado, [1000, 990]),
  // --- Flujo A: foto de la tarjeta ---
  {
    name: 'Descargar foto',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [1000, 0],
    onError: 'continueRegularOutput', // sin binario, "Foto a base64" degrada con aviso
    parameters: {
      method: 'GET',
      url: '={{ $json.mediaUrl }}',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Authorization', value: '={{ $json.twilioAuth }}' }] },
      options: { response: { response: { responseFormat: 'file' } } },
    },
  },
  codeNode('Foto a base64', code.fotoABase64, [1200, 0]),
  groqNode('LLM visión', [1400, 0]),
  codeNode('Armar respuesta', code.armarRespuesta, [1600, 0]),
  // --- Flujo C: nota de voz → Whisper → orquestador ---
  {
    name: 'Descargar audio',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [1000, 150],
    onError: 'continueRegularOutput', // Whisper fallará y "Procesar transcripción" avisa
    parameters: {
      method: 'GET',
      url: '={{ $json.mediaUrl }}',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Authorization', value: '={{ $json.twilioAuth }}' }] },
      options: { response: { response: { responseFormat: 'file' } } },
    },
  },
  {
    name: 'Transcribir audio',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [1200, 150],
    onError: 'continueRegularOutput', // si Whisper falla, "Procesar transcripción" responde el fallback
    parameters: {
      method: 'POST',
      url: 'https://api.groq.com/openai/v1/audio/transcriptions',
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'Authorization', value: '=Bearer {{ $env.GROQ_API_KEY }}' },
      ] },
      sendBody: true,
      contentType: 'multipart-form-data',
      bodyParameters: { parameters: [
        { parameterType: 'formBinaryData', name: 'file', inputDataFieldName: 'data' },
        { name: 'model', value: "={{ $env.GROQ_WHISPER_MODEL || 'whisper-large-v3' }}" },
        { name: 'language', value: 'es' },
        { name: 'response_format', value: 'json' },
        { name: 'prompt', value: WHISPER_PROMPT },
      ] },
      options: { timeout: 90000 },
    },
  },
  codeNode('Procesar transcripción', code.procesarTranscripcion, [1400, 150]),
  // --- adjuntos de evidencia post-folio ---
  {
    name: 'Descargar adjunto',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [1000, 840],
    onError: 'continueRegularOutput', // "Adjuntar foto" avisa si no hay binario
    parameters: {
      method: 'GET',
      url: '={{ $json.mediaUrl }}',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Authorization', value: '={{ $json.twilioAuth }}' }] },
      options: { response: { response: { responseFormat: 'file' } } },
    },
  },
  codeNode('Adjuntar foto', code.adjuntarFoto, [1200, 840]),
  {
    name: '¿Se entendió?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2,
    position: [1600, 150],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{
          leftValue: '={{ $json.entendido }}',
          rightValue: 'si',
          operator: { type: 'string', operation: 'equals' },
        }],
        combinator: 'and',
      },
      options: {},
    },
  },
  // --- Flujo B: Orquestador conversacional (LLM decide preguntar/confirmar/rechazar) ---
  codeNode('Orquestador', code.orquestador, [1000, 300]),
  groqNode('LLM orquestador', [1200, 300]),
  codeNode('Procesar orquestador', code.procesarOrquestador, [1400, 300]),
  // --- confirmación ---
  codeNode('Finalizar observación', code.finalizar, [1000, 520]),
  // --- persistencia única + respuesta a Twilio ---
  {
    name: 'Persistir',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [1850, 300],
    onError: 'continueRegularOutput',
    parameters: {
      method: 'POST',
      url: '={{ $env.API_URL }}/api/bot/persist',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.persist) }}',
      options: { timeout: 30000 },
    },
  },
  codeNode('Armar respuesta saliente', code.armarSaliente, [2050, 300]),
  {
    name: 'Enviar por WhatsApp',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [2250, 300],
    onError: 'continueRegularOutput',
    parameters: {
      method: 'POST',
      url: "=https://api.twilio.com/2010-04-01/Accounts/{{ $env.TWILIO_SID }}/Messages.json",
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Authorization', value: '={{ $json.auth }}' }] },
      sendBody: true,
      contentType: 'form-urlencoded',
      bodyParameters: { parameters: [
        { name: 'From', value: '={{ $json.fromBot }}' },
        { name: 'To', value: '={{ $json.to }}' },
        { name: 'Body', value: '={{ $json.texto }}' },
      ] },
      options: { timeout: 30000 },
    },
  },
].map((n, i) => ({ id: `nodo-${String(i + 1).padStart(2, '0')}`, ...n }));

const main = (name, outputIndex = 0) => ({ node: name, type: 'main', index: 0, _out: outputIndex });
const connect = (pairs) => Object.fromEntries(pairs.map(([from, tos]) => {
  const byOutput = [];
  for (const t of tos) {
    const out = t._out || 0;
    byOutput[out] = byOutput[out] || [];
    byOutput[out].push({ node: t.node, type: 'main', index: 0 });
  }
  for (let i = 0; i < byOutput.length; i++) byOutput[i] = byOutput[i] || [];
  return [from, { main: byOutput }];
}));

const connections = connect([
  ['Webhook Twilio', [main('ACK a Twilio')]],
  ['ACK a Twilio', [main('Preparar contexto')]],
  ['Preparar contexto', [main('Traer sesión')]],
  ['Traer sesión', [main('Router')]],
  ['Router', [main('Switch Acción')]],
  ['Switch Acción', [
    { ...main('Descargar foto'), _out: 0 },        // foto
    { ...main('Descargar audio'), _out: 1 },       // audio
    { ...main('Finalizar observación'), _out: 2 }, // confirmar
    { ...main('Descargar adjunto'), _out: 3 },     // adjuntar_foto (evidencia post-folio)
    { ...main('Mensaje bloqueado'), _out: 4 },     // bloqueado (pausa anti-abuso, con aviso)
    { ...main('Orquestador'), _out: 5 },           // fallback: orquestador (todo el resto)
  ]],
  ['Mensaje bloqueado', [main('Persistir')]],
  ['Descargar adjunto', [main('Adjuntar foto')]],
  ['Adjuntar foto', [main('Persistir')]],
  ['Descargar foto', [main('Foto a base64')]],
  ['Foto a base64', [main('LLM visión')]],
  ['LLM visión', [main('Armar respuesta')]],
  // Flujo audio: transcribir y derivar al orquestador (o fallback si no se entendió)
  ['Descargar audio', [main('Transcribir audio')]],
  ['Transcribir audio', [main('Procesar transcripción')]],
  ['Procesar transcripción', [main('¿Se entendió?')]],
  ['¿Se entendió?', [
    { ...main('Orquestador'), _out: 0 },           // true: sigue la conversación normal
    { ...main('Persistir'), _out: 1 },             // false: fallback directo al operario
  ]],
  // Flujo Orquestador conversacional
  ['Orquestador', [main('LLM orquestador')]],
  ['LLM orquestador', [main('Procesar orquestador')]],
  ['Procesar orquestador', [main('Persistir')]],
  ['Armar respuesta', [main('Persistir')]],
  ['Finalizar observación', [main('Persistir')]],
  ['Persistir', [main('Armar respuesta saliente')]],
  ['Armar respuesta saliente', [main('Enviar por WhatsApp')]],
]);

const workflow = {
  id: 'hse-tarjeta-digital-whatsapp',
  name: 'HSE Tarjeta Digital — WhatsApp',
  nodes,
  connections,
  settings: { executionOrder: 'v1' },
  active: false,
  pinData: {},
};

const out = join(dir, 'workflow.json');
writeFileSync(out, JSON.stringify(workflow, null, 2) + '\n');
console.log(`OK -> ${out} (${nodes.length} nodos)`);
