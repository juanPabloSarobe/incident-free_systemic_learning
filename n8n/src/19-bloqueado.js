// Nodo "Mensaje bloqueado": el usuario está en pausa anti-abuso. La regla de oro:
// NUNCA silencio — se le informa el estado y hasta cuándo, sin gastar una llamada al LLM.
const ctx = $input.first().json;
const u = ctx.user || {};

const tz = $env.GENERIC_TIMEZONE || 'America/Argentina/Buenos_Aires';
const hora = u.desbloqueado_en
  ? new Date(String(u.desbloqueado_en).replace(' ', 'T') + 'Z')
      .toLocaleTimeString('es-AR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false })
  : null;

return [{ json: { persist: {
  reporter_hash: ctx.hash,
  reply: `🚫 La recepción de tus reportes está *pausada${hora ? ` hasta las ${hora}` : ' temporalmente'}* ` +
    'porque los últimos mensajes no parecían observaciones de seguridad.\n\n' +
    'El canal funciona correctamente — pasada la pausa podés volver a reportar con normalidad. ' +
    'Si creés que es un error, hablá con tu supervisor de HSE.',
} } }];
