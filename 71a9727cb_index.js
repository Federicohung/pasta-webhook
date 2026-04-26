const http = require('http');
const https = require('https');
const crypto = require('crypto');

// ─────────────────────────────────────────────────────────────────────────────
// REGLA INVIOLABLE: todos los pedidos son PREPAGADOS.
// Jamás collect. Jamás cash_on_delivery. Jamás cobro revertido.
// Este backend NO llama a MercadoPago directamente para crear pagos.
// Todo pago lo genera el ecommerce pastaalvuelo.com vía external-checkout.
// ─────────────────────────────────────────────────────────────────────────────

const VERIFY_TOKEN            = 'pasta_al_vuelo_2026';
const OPENAI_API_KEY          = process.env.OPENAI_API_KEY;
const WHATSAPP_ACCESS_TOKEN   = process.env.WHATSAPP_ACCESS_TOKEN;
const PHONE_NUMBER_ID         = process.env.PHONE_NUMBER_ID;
const MERCADOPAGO_TOKEN       = process.env.MERCADOPAGO_TOKEN; // solo para consultar estado — no crear pagos
const EXTERNAL_CHECKOUT_URL   = process.env.EXTERNAL_CHECKOUT_URL || 'https://www.pastaalvuelo.com/api/webhooks/external-checkout';
const EXTERNAL_CHECKOUT_SECRET = process.env.EXTERNAL_CHECKOUT_SECRET;

const conversaciones  = {};

// Trazabilidad local por external_order_id
// { from, nombre, delivery, subtotal, external_order_id, numero_orden, orden_id, preference_id, payment_url }
const ordenesLocales = {};

// ── PROMPT MARCO ──────────────────────────────────────────────────────────────
const MARCO_PROMPT = `[SYSTEM PROMPT / MARCO - PASTA AL VUELO v3.2]

Eres Marco, agente vendedor oficial de Pasta Al Vuelo en WhatsApp.
Tu funcion es atender de forma humana, premium, breve y comercial,
tomar el pedido completo y llevarlo hasta la confirmacion final.

LOCALES: Zenteno 181 Santiago Centro | Providencia 202 esquina Seminario
HORARIO: Apertura 11:45 | Delivery hasta 17:45 | Retiro Zenteno hasta 18:00 | Retiro Providencia hasta 21:00

==================================================
MENU OFICIAL
==================================================

CLASICAS $3.990: Mantequilla al vino blanco, Alfredo cremosa, Yakisoba vegetales, Pad Thai vegetales
PREMIUM $4.990: Pesto cremoso, Carbonara, Amatriciana, Bolonesa, Pomodoro, Yakisoba pollo, Pad Thai pollo, Aji de gallina
ESPECIALIDADES $5.990: Camarones al merken, Camarones a la mantequilla, Camarones a la carbonara, Camarones al pesto, Pollo agridulce, Pollo al pesto, Yakisoba pollo y camaron, Pad Thai pollo y camaron
COMBOS: Clasico Individual $5.290 | Premium Individual $6.190 | Especialidad Individual $6.990 | Combo para Dos $10.190 | Familiar $19.900
POSTRES: Tiramisu $2.500 | Tartufo $2.500
EXTRAS: Choclo $700 | Champinones $700 | Tocino $900 | Pollo $1.000 | Camarones $1.500 | Pasta espinaca $900 | Extra salsa $900 | Queso extra $900 | Agrandada $2.200
BEBIDAS: Coca Cola/Zero $1.490 | Fanta $1.490 | Sprite/Zero $1.490 | Agua $1.290 | Jugos $1.690

==================================================
FLUJO OBLIGATORIO
==================================================

1. Detectar que quiere el cliente
2. Confirmar producto + upsell breve (solo 1)
3. Preguntar si agrega algo mas
4. Retiro o delivery?
5. Si delivery: pedir direccion (calle, numero, comuna)
6. Pedir nombre y telefono juntos
7. Mostrar resumen con total SIN envio y preguntar confirmacion
8. Cuando confirme: responder SOLO el JSON (ver abajo)

REGLA CRITICA DEL ENVIO:
- Marco NO calcula ni espera el costo de envio antes de confirmar.
- En el resumen mostrar "Envio: a calcular segun zona"
- El sistema cotiza y cobra el envio junto con el pedido.

==================================================
TONO
==================================================

Humano, cercano, jovial, breve. Una pregunta a la vez. Maximo un emoji.
USA: Claro, Perfecto, Buenisimo, Te ayudo al tiro, Dale, Anotado
NO USES: Estimado, Procedera, Su requerimiento, Le informo que

==================================================
UPSELL INTELIGENTE
==================================================

Carbonara → agrandada, queso extra, bebida
Alfredo → queso extra, extra salsa, bebida
Bolonesa/Pomodoro → queso extra, extra salsa, bebida
Pesto → pollo, camarones, bebida
Yakisoba/Pad Thai → agrandada, bebida
Delivery → bebida o postre

Solo 1 upsell por plato. Si rechaza: "Dale." y avanzar. No insistir.

==================================================
RECOMENDACIONES
==================================================

cremoso → Carbonara, Alfredo, Pesto cremoso
clasico → Bolonesa, Pomodoro, Alfredo
camarones → Camarones al merken, a la mantequilla, al pesto
distinto → Yakisoba, Pad Thai, Aji de gallina
economico → clasicas o combo clasico
para dos → Combo para Dos

==================================================
FORMATO MENU COMPLETO
==================================================

Si piden menu completo, enviar en UN SOLO mensaje:

"Claro 😊 Te dejo el menu completo:

CLASICAS desde $3.990
- Mantequilla al vino blanco
- Alfredo cremosa
- Yakisoba vegetales
- Pad Thai vegetales

PREMIUM desde $4.990
- Pesto cremoso
- Carbonara
- Amatriciana
- Bolonesa
- Pomodoro
- Yakisoba pollo
- Pad Thai pollo
- Aji de gallina

ESPECIALIDADES desde $5.990
- Camarones al merken
- Camarones a la mantequilla
- Camarones a la carbonara
- Camarones al pesto
- Pollo agridulce
- Pollo al pesto
- Yakisoba pollo y camaron
- Pad Thai pollo y camaron

COMBOS
- Clasico Individual $5.290
- Premium Individual $6.190
- Especialidad Individual $6.990
- Combo para Dos $10.190
- Familiar $19.900

POSTRES: Tiramisu $2.500 | Tartufo $2.500
EXTRAS: Choclo $700 | Champinones $700 | Tocino $900 | Pollo $1.000 | Camarones $1.500 | Pasta espinaca $900 | Extra salsa $900 | Queso extra $900 | Agrandada $2.200
BEBIDAS: Coca Cola/Zero $1.490 | Fanta $1.490 | Sprite $1.490 | Agua $1.290 | Jugos $1.690

Ya tienes algo en mente? 😊"

==================================================
FORMATO RESUMEN FINAL
==================================================

"Perfecto 😊 Te resumo:

- [producto]: $[precio]
- [extra si aplica]: $[precio]
- Envio: a calcular segun zona

Total productos: $[suma sin envio]

Asi lo confirmamos?"

==================================================
HORARIO - EXCEPCIONES
==================================================

Antes 11:45: "Aun no abrimos, arrancamos a las 11:45 😊 Te anoto el pedido para tenerlo listo apenas abramos?"
Delivery despues 17:45: "El despacho ya cerro 😔 Pero podes venir a buscarlo, Providencia hasta 21:00 y Zenteno hasta 18:00."
Ambos cerrados: "Por hoy ya cerramos 😔 Manana abrimos a las 11:45."

==================================================
INSTRUCCION CRITICA - JSON DE CONFIRMACION
==================================================

Cuando el cliente confirme el pedido (diga si, dale, ok, listo, confirmo, va, etc.),
responder UNICAMENTE con este JSON, sin ningun texto antes ni despues:

{"accion":"PEDIDO_CONFIRMADO","items":[{"title":"NOMBRE","quantity":1,"unit_price":0000}],"delivery":true,"direccion_calle":"CALLE","direccion_numero":"NUMERO","direccion_comuna":"COMUNA","direccion_interior":"","nombre":"NOMBRE","telefono":"TELEFONO"}

Para retiro: "delivery":false y campos de direccion vacios.
Para delivery: "delivery":true con calle, numero y comuna completos.

SOLO el JSON. Nada mas.`;

// ── OPENAI ────────────────────────────────────────────────────────────────────
function callOpenAI(historial, callback) {
  var messages = [{ role: 'system', content: MARCO_PROMPT }].concat(historial);
  var body = JSON.stringify({ model: 'gpt-4o-mini', temperature: 0.2, max_tokens: 800, messages: messages });
  var options = {
    hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST',
    headers: { 'Authorization': 'Bearer ' + OPENAI_API_KEY, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  };
  var req = https.request(options, function(res) {
    var resp = '';
    res.on('data', function(c) { resp += c; });
    res.on('end', function() {
      try { callback(null, JSON.parse(resp).choices[0].message.content); }
      catch(e) { callback(e); }
    });
  });
  req.on('error', callback);
  req.write(body);
  req.end();
}

// ── WHATSAPP ──────────────────────────────────────────────────────────────────
function sendWhatsApp(to, text) {
  var body = JSON.stringify({ messaging_product: 'whatsapp', to: to, type: 'text', text: { body: text } });
  var options = {
    hostname: 'graph.facebook.com', path: '/v19.0/' + PHONE_NUMBER_ID + '/messages', method: 'POST',
    headers: { 'Authorization': 'Bearer ' + WHATSAPP_ACCESS_TOKEN, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  };
  var req = https.request(options, function(res) {
    res.on('data', function() {});
    res.on('end', function() { console.log('[WA] enviado a', to); });
  });
  req.on('error', function(e) { console.error('[WA] error:', e.message); });
  req.write(body);
  req.end();
}

// ── GENERAR external_order_id ESTABLE ────────────────────────────────────────
// Mismo telefono + mismo pedido dentro del mismo minuto → mismo ID.
// Esto hace que los reintentos no dupliquen órdenes.
function generarExternalOrderId(telefono, items, ts) {
  var base = telefono + '|' + JSON.stringify(items) + '|' + Math.floor((ts || Date.now()) / 60000);
  return 'WA-' + crypto.createHash('md5').update(base).digest('hex').substring(0, 12).toUpperCase();
}

// ── ENVIAR AL WEBHOOK EXTERNAL-CHECKOUT (con reintentos) ─────────────────────
function enviarAlWebhookExterno(payload, intento, callback) {
  intento = intento || 0;
  var MAX = 3;
  var body = JSON.stringify(payload);
  var urlParsed = new URL(EXTERNAL_CHECKOUT_URL);

  console.log('[CHECKOUT] intento ' + (intento + 1) + '/' + MAX + ' | external_order_id:', payload.external_order_id);
  console.log('[CHECKOUT] payload:', body);

  var options = {
    hostname: urlParsed.hostname,
    path: urlParsed.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'x-webhook-secret': EXTERNAL_CHECKOUT_SECRET,
      'x-source': 'whatsapp-marco'
    },
    timeout: 15000
  };

  var req = https.request(options, function(res) {
    var resp = '';
    res.on('data', function(c) { resp += c; });
    res.on('end', function() {
      console.log('[CHECKOUT] HTTP', res.statusCode, '| resp:', resp.substring(0, 400));
      try {
        var data = JSON.parse(resp);

        // Orden duplicada — reutilizar link existente
        if (data.duplicated === true && data.payment_url) {
          console.log('[CHECKOUT] duplicado, reutilizando orden:', data.numero_orden);
          return callback(null, data);
        }

        // Éxito
        if (data.success && data.payment_url) {
          return callback(null, data);
        }

        // Error — reintentar
        if (intento < MAX - 1) {
          console.log('[CHECKOUT] error en respuesta, reintentando...');
          return setTimeout(function() { enviarAlWebhookExterno(payload, intento + 1, callback); }, 2000);
        }
        callback(new Error('checkout fallido: ' + resp.substring(0, 200)));
      } catch(e) {
        if (intento < MAX - 1) {
          return setTimeout(function() { enviarAlWebhookExterno(payload, intento + 1, callback); }, 2000);
        }
        callback(new Error('parse error: ' + e.message));
      }
    });
  });

  req.on('timeout', function() {
    req.destroy();
    if (intento < MAX - 1) {
      console.log('[CHECKOUT] timeout, reintentando...');
      return setTimeout(function() { enviarAlWebhookExterno(payload, intento + 1, callback); }, 2000);
    }
    callback(new Error('timeout tras ' + MAX + ' intentos'));
  });

  req.on('error', function(e) {
    console.error('[CHECKOUT] error:', e.message);
    if (intento < MAX - 1) {
      return setTimeout(function() { enviarAlWebhookExterno(payload, intento + 1, callback); }, 2000);
    }
    callback(e);
  });

  req.write(body);
  req.end();
}

// ── PROCESAR PEDIDO CONFIRMADO ────────────────────────────────────────────────
function procesarPedidoConfirmado(from, pedido) {
  console.log('[PEDIDO] confirmado de', from, JSON.stringify(pedido));

  var ts = Date.now();
  var externalOrderId = generarExternalOrderId(pedido.telefono || from, pedido.items, ts);

  var subtotal = pedido.items.reduce(function(s, i) {
    return s + (Math.round(Number(i.unit_price)) * (Number(i.quantity) || 1));
  }, 0);

  // Payload para external-checkout
  // REGLA INVIOLABLE: collect=false, cash_on_delivery=false, pago_modalidad=prepagado_online
  var payload = {
    external_order_id:    externalOrderId,
    cliente_nombre:       pedido.nombre || '',
    cliente_email:        '',              // WA no tiene email — el ecommerce hace fallback
    cliente_telefono:     pedido.telefono || from,
    metodo_entrega:       pedido.delivery ? 'delivery' : 'retiro',
    direccion_entrega:    pedido.delivery
      ? [pedido.direccion_calle, pedido.direccion_numero, pedido.direccion_comuna].filter(Boolean).join(', ')
      : '',
    direccion_calle:      pedido.direccion_calle    || '',
    direccion_numero:     pedido.direccion_numero   || '',
    direccion_comuna:     pedido.direccion_comuna   || '',
    direccion_interior:   pedido.direccion_interior || '',
    direccion_referencia: '',
    horario_entrega:      'Lo antes posible',
    items: pedido.items.map(function(i) {
      return {
        producto_id: String(i.title).toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
        nombre:      i.title,
        cantidad:    Number(i.quantity) || 1,
        precio:      Math.round(Number(i.unit_price)),
        extras:      []
      };
    }),
    subtotal:              subtotal,
    shipping_cost:         0,              // el ecommerce cotiza el envio con su PedidosYa
    shipping_provider:     pedido.delivery ? 'PEDIDOSYA' : null,
    shipping_estimate_id:  null,
    total:                 subtotal,       // el ecommerce agrega el envio al total
    notas:                 '',
    source:                'whatsapp_marco',
    // Flags inviolables — prepago siempre
    pago_modalidad:        'prepagado_online',
    collect:               false,
    cash_on_delivery:      false,
    cobro_revertido:       false
  };

  enviarAlWebhookExterno(payload, 0, function(err, data) {
    if (err || !data || !data.payment_url) {
      console.error('[PEDIDO] error:', err && err.message);
      sendWhatsApp(from, 'Tuve un problema tecnico generando el link de pago 😔 Por favor llamanos al restaurante para completar tu pedido.');
      return;
    }

    // Guardar trazabilidad local
    ordenesLocales[externalOrderId] = {
      from:             from,
      nombre:           pedido.nombre,
      delivery:         pedido.delivery,
      subtotal:         subtotal,
      external_order_id: externalOrderId,
      numero_orden:     data.numero_orden     || null,
      orden_id:         data.orden_id         || null,
      preference_id:    data.preference_id    || null,
      payment_url:      data.payment_url,
      created_at:       new Date().toISOString()
    };

    console.log('[PEDIDO] trazabilidad guardada:', JSON.stringify(ordenesLocales[externalOrderId]));

    // Mandar link al cliente
    var msg = 'Perfecto ' + (pedido.nombre || '') + '! 😊\n\nTe mando el link para pagar:\n' + data.payment_url;
    sendWhatsApp(from, msg);
  });
}

// ── WEBHOOK MERCADO PAGO → avisar al cliente por WA ──────────────────────────
// El webhook que actualiza la orden en el ecommerce es pastaalvuelo.com/api/webhooks/mercadopago
// Este endpoint SOLO manda la confirmacion al cliente por WhatsApp.
function manejarWebhookMP(rawBody) {
  try {
    var data = JSON.parse(rawBody);
    console.log('[MP-WH] recibido:', JSON.stringify(data));

    var topic = data.topic || data.type;
    if (topic !== 'payment' && topic !== 'payment.updated') return;

    var resourceId = null;
    if (data.data && data.data.id) {
      resourceId = String(data.data.id);
    } else if (data.resource) {
      var m = String(data.resource).match(/(\d+)$/);
      if (m) resourceId = m[1];
    }
    if (!resourceId) { console.log('[MP-WH] sin payment ID'); return; }

    consultarPagoMP(resourceId, function(err, pago) {
      if (err) { console.error('[MP-WH] error consultando:', err.message); return; }
      console.log('[MP-WH] pago', resourceId, '| status:', pago.status, '| ref:', pago.external_reference);
      if (pago.status !== 'approved') return;

      // Buscar en trazabilidad local por numero_orden (= external_reference de MP)
      var pendiente = null;
      var keys = Object.keys(ordenesLocales);
      for (var i = 0; i < keys.length; i++) {
        var o = ordenesLocales[keys[i]];
        if (o.numero_orden === pago.external_reference) { pendiente = o; break; }
      }

      if (!pendiente) {
        console.log('[MP-WH] orden local no encontrada para ref:', pago.external_reference);
        return;
      }

      var msg = 'Pago recibido ' + (pendiente.nombre || '') + '! 🎉\n\nTu pedido ya esta en preparacion.\n';
      msg += pendiente.delivery
        ? 'En cuanto este listo, el repartidor sale hacia tu direccion 🛵'
        : 'Puedes pasar a retirarlo en aprox. 20 minutos 😊';

      sendWhatsApp(pendiente.from, msg);
      delete ordenesLocales[pendiente.external_order_id];
    });
  } catch(e) {
    console.error('[MP-WH] error:', e.message);
  }
}

// ── MERCADO PAGO: CONSULTAR ESTADO (solo lectura) ─────────────────────────────
function consultarPagoMP(paymentId, callback) {
  var options = {
    hostname: 'api.mercadopago.com', path: '/v1/payments/' + paymentId, method: 'GET',
    headers: { 'Authorization': 'Bearer ' + MERCADOPAGO_TOKEN }
  };
  var req = https.request(options, function(res) {
    var resp = '';
    res.on('data', function(c) { resp += c; });
    res.on('end', function() {
      try { callback(null, JSON.parse(resp)); }
      catch(e) { callback(e); }
    });
  });
  req.on('error', callback);
  req.end();
}

// ── SERVIDOR ──────────────────────────────────────────────────────────────────
var server = http.createServer(function(req, res) {
  var urlObj = new URL(req.url, 'http://' + req.headers.host);
  var pathname = urlObj.pathname;

  // GET → verificacion WhatsApp
  if (req.method === 'GET') {
    var mode      = urlObj.searchParams.get('hub.mode');
    var token     = urlObj.searchParams.get('hub.verify_token');
    var challenge = urlObj.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('[WA] webhook verificado OK');
      res.writeHead(200); res.end(challenge);
    } else {
      res.writeHead(403); res.end('Forbidden');
    }
    return;
  }

  if (req.method === 'POST') {
    var rawBody = '';
    req.on('data', function(c) { rawBody += c; });
    req.on('end', function() {
      res.writeHead(200); res.end('ok');

      if (pathname === '/mp-webhook') {
        manejarWebhookMP(rawBody);
        return;
      }

      // Mensajes WhatsApp entrantes
      try {
        var parsed = JSON.parse(rawBody);
        var entry = parsed.entry;
        if (!entry || !entry[0]) return;
        var changes = entry[0].changes;
        if (!changes || !changes[0]) return;
        var value = changes[0].value;
        if (!value || !value.messages || !value.messages[0]) return;
        var msg   = value.messages[0];
        var from  = msg.from;
        var texto = msg.type === 'text' ? msg.text.body : null;
        if (!texto) return;

        console.log('[WA] de', from + ':', texto);

        if (!conversaciones[from]) conversaciones[from] = [];
        conversaciones[from].push({ role: 'user', content: texto });
        if (conversaciones[from].length > 30) conversaciones[from] = conversaciones[from].slice(-30);

        callOpenAI(conversaciones[from], function(err, respuesta) {
          if (err || !respuesta) { console.error('[AI] error:', err && err.message); return; }
          console.log('[AI] Marco:', respuesta.substring(0, 120));

          var trimmed = respuesta.trim();
          conversaciones[from].push({ role: 'assistant', content: respuesta });

          if (trimmed.startsWith('{') && trimmed.includes('PEDIDO_CONFIRMADO')) {
            try {
              var pedido = JSON.parse(trimmed);
              procesarPedidoConfirmado(from, pedido);
            } catch(e) {
              console.error('[AI] JSON parse error:', e.message);
              sendWhatsApp(from, 'Disculpa, tuve un problema interno. Podes repetir la confirmacion?');
            }
          } else {
            sendWhatsApp(from, respuesta);
          }
        });
      } catch(e) { console.error('[WA] error procesando:', e.message); }
    });
    return;
  }

  res.writeHead(404); res.end('Not found');
});

var PORT = process.env.PORT || 3000;
server.listen(PORT, function() {
  console.log('[SERVER] Pasta Al Vuelo Marco v3.2 | puerto', PORT);
  console.log('[SERVER] EXTERNAL_CHECKOUT_URL   :', EXTERNAL_CHECKOUT_URL);
  console.log('[SERVER] EXTERNAL_CHECKOUT_SECRET:', EXTERNAL_CHECKOUT_SECRET ? 'OK' : '⚠️  FALTA');
  console.log('[SERVER] MERCADOPAGO_TOKEN        :', MERCADOPAGO_TOKEN        ? 'OK (solo lectura)' : '⚠️  FALTA');
  console.log('[SERVER] OPENAI_API_KEY           :', OPENAI_API_KEY           ? 'OK' : '⚠️  FALTA');
  console.log('[SERVER] WHATSAPP_ACCESS_TOKEN    :', WHATSAPP_ACCESS_TOKEN    ? 'OK' : '⚠️  FALTA');
  console.log('[SERVER] PHONE_NUMBER_ID          :', PHONE_NUMBER_ID          ? 'OK' : '⚠️  FALTA');
  console.log('[SERVER] POLITICA: prepagado_online | collect=false | cash_on_delivery=false');
});
