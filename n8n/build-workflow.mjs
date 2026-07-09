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

const code = {
  prepararContexto: src('01-preparar-contexto.js'),
  router: src('02-router.js'),
  fotoABase64: src('03-foto-a-base64.js').replace('__PROMPT_EXTRACCION__', JSON.stringify(promptExtraccion)),
  armarPromptTexto: src('04-armar-prompt-texto.js').replace('__PROMPT_CLASIFICACION__', JSON.stringify(promptClasificacion)),
  armarRespuesta: src('05-armar-respuesta.js'),
  finalizar: src('06-finalizar.js'),
  ayuda: src('07-ayuda.js'),
  armarTwiml: src('08-armar-twiml.js'),
};

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
  codeNode('Preparar contexto', code.prepararContexto, [200, 300]),
  {
    name: 'Traer sesión',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [400, 300],
    parameters: { method: 'GET', url: '={{ $env.API_URL }}/api/sessions/{{ $json.hash }}', options: {} },
  },
  codeNode('Router', code.router, [600, 300]),
  {
    name: 'Switch Acción',
    type: 'n8n-nodes-base.switch',
    typeVersion: 3.2,
    position: [800, 300],
    parameters: {
      rules: { values: ['foto', 'nueva_texto', 'completar', 'confirmar'].map(switchRule) },
      options: { fallbackOutput: 'extra' }, // 5.ª salida: ayuda
    },
  },
  // --- Flujo A: foto de la tarjeta ---
  {
    name: 'Descargar foto',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [1000, 0],
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
  // --- Flujo B: texto (nuevo o completar borrador) ---
  codeNode('Armar prompt texto', code.armarPromptTexto, [1000, 300]),
  groqNode('LLM texto', [1200, 300]),
  // --- convergencia de A y B ---
  codeNode('Armar respuesta', code.armarRespuesta, [1600, 150]),
  // --- confirmación y ayuda ---
  codeNode('Finalizar observación', code.finalizar, [1000, 520]),
  codeNode('Mensaje de ayuda', code.ayuda, [1000, 680]),
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
  codeNode('Armar TwiML', code.armarTwiml, [2050, 300]),
  {
    name: 'Responder a Twilio',
    type: 'n8n-nodes-base.respondToWebhook',
    typeVersion: 1.1,
    position: [2250, 300],
    parameters: {
      respondWith: 'text',
      responseBody: '={{ $json.xml }}',
      options: { responseHeaders: { entries: [{ name: 'Content-Type', value: 'text/xml' }] } },
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
  ['Webhook Twilio', [main('Preparar contexto')]],
  ['Preparar contexto', [main('Traer sesión')]],
  ['Traer sesión', [main('Router')]],
  ['Router', [main('Switch Acción')]],
  ['Switch Acción', [
    { ...main('Descargar foto'), _out: 0 },        // foto
    { ...main('Armar prompt texto'), _out: 1 },    // nueva_texto
    { ...main('Armar prompt texto'), _out: 2 },    // completar
    { ...main('Finalizar observación'), _out: 3 }, // confirmar
    { ...main('Mensaje de ayuda'), _out: 4 },      // fallback: ayuda
  ]],
  ['Descargar foto', [main('Foto a base64')]],
  ['Foto a base64', [main('LLM visión')]],
  ['LLM visión', [main('Armar respuesta')]],
  ['Armar prompt texto', [main('LLM texto')]],
  ['LLM texto', [main('Armar respuesta')]],
  ['Armar respuesta', [main('Persistir')]],
  ['Finalizar observación', [main('Persistir')]],
  ['Mensaje de ayuda', [main('Persistir')]],
  ['Persistir', [main('Armar TwiML')]],
  ['Armar TwiML', [main('Responder a Twilio')]],
]);

const workflow = {
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
