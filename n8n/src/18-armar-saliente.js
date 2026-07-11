// Nodo "Armar respuesta saliente": el webhook ya devolvió un ACK vacío a Twilio
// (así jamás hay silencio por timeout); acá se arma el mensaje real que sale por
// la API REST. Resuelve los placeholders {{FOLIO}} y {{AVISO_RECHAZO}} con lo que
// devolvió la persistencia.
const r = $input.first().json;             // respuesta de "Persistir"
const ctx = $('Preparar contexto').first().json;

let texto = r.reply || '🙏 ¡Gracias! Recibimos tu mensaje.';
if (r.folio) texto = texto.split('{{FOLIO}}').join(r.folio);

// aviso progresivo de rechazo: nada (1º) → advertencia (2º) → pausa informada (3º)
let aviso = '';
if (r.flag) {
  const tz = $env.GENERIC_TIMEZONE || 'America/Argentina/Buenos_Aires';
  if (r.flag.bloqueado) {
    const hora = r.flag.desbloqueado_en
      ? new Date(String(r.flag.desbloqueado_en).replace(' ', 'T') + 'Z')
          .toLocaleTimeString('es-AR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false })
      : '';
    aviso = `\n\n🚫 *Pausé la recepción de tus reportes${hora ? ` hasta las ${hora}` : ' por 30 minutos'}*: los últimos mensajes no parecen observaciones de seguridad. El canal funciona bien — después de esa hora podés volver a reportar. Si esto es un error, hablá con tu supervisor de HSE.`;
  } else if (r.flag.rechazos >= 2) {
    aviso = '\n\n⚠️ Ojo: si el próximo mensaje tampoco es una observación de seguridad real, voy a pausar tus reportes por 30 minutos.';
  }
}
texto = texto.split('{{AVISO_RECHAZO}}').join(aviso);

return [{ json: {
  to: ctx.to,               // el número del operario, solo en tránsito — no se persiste
  fromBot: ctx.fromBot,     // el número del sandbox/bot
  auth: ctx.twilioAuth,
  texto,
} }];
