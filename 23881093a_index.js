const http = require('http');
const https = require('https');

const VERIFY_TOKEN = 'pasta_al_vuelo_2026';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const MERCADOPAGO_TOKEN = process.env.MERCADOPAGO_TOKEN;
const PEDIDOSYA_TOKEN = process.env.PEDIDOSYA_TOKEN;

const conversaciones = {};
// Mapa: external_reference -> { from, nombre, delivery }
const pedidosPendientes = {};

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
5. Si delivery: pedir direccion (calle, numero y comuna)
6. Pedir nombre y telefono juntos
7. Mostrar resumen con total SIN envio y preguntar confirmacion
8. Cuando confirme: responder SOLO el JSON (ver abajo)

REGLA CRITICA DEL ENVIO:
- Marco NO calcula ni espera el costo de envio antes de confirmar.
- Marco NO dice "voy a calcular el envio" ni "un momento".
- El costo de envio lo calcula el sistema DESPUES de la confirmacion.
- En el resumen, mostrar "Envio: a calcular segun zona"
- El sistema cotiza el envio con PedidosYa e incluye ese valor en el cobro de MercadoPago.

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
debes responder UNICAMENTE con este JSON, sin ningun texto antes ni despues:

{"accion":"PEDIDO_CONFIRMADO","items":[{"title":"NOMBRE","quantity":1,"unit_price":0000}],"delivery":true,"direccion":"CALLE NUMERO","comuna":"COMUNA","nombre":"NOMBRE","telefono":"TELEFONO"}

EJEMPLOS DE ITEMS:
- {"title":"Carbonara","quantity":1,"unit_price":4990}
- {"title":"Pesto cremoso","quantity":1,"unit_price":4990}
- {"title":"Carbonara agrandada","quantity":1,"unit_price":7190}
- {"title":"Queso extra","quantity":1,"unit_price":900}
- {"title":"Coca Cola","quantity":1,"unit_price":1490}
- {"title":"Combo para Dos","quantity":1,"unit_price":10190}

Para retiro: "delivery":false, "direccion":"", "comuna":""
Para delivery: "delivery":true con direccion y comuna completas

SOLO el JSON. Nada mas. Sin saludos. Sin texto adicional.`;

// ── OPENAI ────────────────────────────────────────────────────────────────────
function callOpenAI(historial, callback) {
  var messages = [{ role: 'system', content: MARCO_PROMPT }].concat(historial);
  var data = JSON.stringify({ model: 'gpt-4o-mini', temperature: 0.2, max_tokens: 800, messages: messages });
  var options = {
    hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST',
    headers: { 'Authorization': 'Bearer ' + OPENAI_API_KEY, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
  };
  var req = https.request(options, function(res) {
    var body = '';
    res.on('data', function(c) { body += c; });
    res.on('end', function() {
      try { callback(null, JSON.parse(body).choices[0].message.content); }
      catch(e) { callback(e); }
    });
  });
  req.on('error', callback);
  req.write(data);
  req.end();
}

// ── WHATSAPP ──────────────────────────────────────────────────────────────────
function sendWhatsApp(to, text) {
  var payload = JSON.stringify({ messaging_product: 'whatsapp', to: to, type: 'text', text: { body: text } });
  var options = {
    hostname: 'graph.facebook.com', path: '/v19.0/' + PHONE_NUMBER_ID + '/messages', method: 'POST',
    headers: { 'Authorization': 'Bearer ' + WHATSAPP_ACCESS_TOKEN, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
  };
  var req = https.request(options, function(res) {
    var body = '';
    res.on('data', function(c) { body += c; });
    res.on('end', function() { console.log('WA enviado a ' + to); });
  });
  req.on('error', function(e) { console.error('WA error:', e); });
  req.write(payload);
  req.end();
}

// ── PEDIDOSYA: SOLO COTIZAR ───────────────────────────────────────────────────
// Llama a /estimates para obtener el costo del envio SIN crear el despacho.
// El despacho real lo crea el cajero desde el panel.
function cotizarEnvioPedidosYa(pedido, callback) {
  var payload = JSON.stringify({
    referenceId: 'PAV-EST-' + Date.now(),
    isTest: false,
    items: [{ type: 'STANDARD', value: 5000, description: 'Pasta fresca', quantity: 1, volume: 1, weight: 0.5 }],
    waypoints: [
      {
        type: 'PICK_UP',
        addressStreet: 'Zenteno 181',
        city: 'Santiago',
        phone: '+56912345678',
        name: 'Pasta Al Vuelo',
        instructions: 'Retiro en restaurante'
      },
      {
        type: 'DROP_OFF',
        addressStreet: pedido.direccion,
        city: pedido.comuna || 'Santiago',
        phone: pedido.telefono || '+56900000000',
        name: pedido.nombre || 'Cliente',
        instructions: ''
      }
    ]
  });
  var options = {
    hostname: 'courier-api.pedidosya.com',
    path: '/v3/shippings/estimates',
    method: 'POST',
    headers: {
      'Authorization': PEDIDOSYA_TOKEN,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };
  var req = https.request(options, function(res) {
    var body = '';
    res.on('data', function(c) { body += c; });
    res.on('end', function() {
      try {
        var data = JSON.parse(body);
        console.log('PedidosYa cotizacion raw:', JSON.stringify(data));

        // Intentar extraer el precio de distintos formatos de respuesta
        var precio = null;
        if (data.deliveryOffers && data.deliveryOffers[0]) {
          var oferta = data.deliveryOffers[0];
          precio = (oferta.pricing && oferta.pricing.total) ||
                   (oferta.price && oferta.price.total) ||
                   oferta.total || null;
        } else if (data.price) {
          precio = data.price.total || data.price;
        } else if (data.total) {
          precio = data.total;
        }

        if (!precio || isNaN(Number(precio))) {
          console.log('PedidosYa: precio no encontrado, usando fallback 2990');
          precio = 2990;
        }

        console.log('Costo envio PedidosYa:', precio);
        callback(null, Number(precio));
      } catch(e) {
        console.error('Error parseando cotizacion PY:', e);
        callback(null, 2990);
      }
    });
  });
  req.on('error', function(e) {
    console.error('Error request PY:', e);
    callback(null, 2990);
  });
  req.write(payload);
  req.end();
}

// ── MERCADO PAGO: GENERAR LINK ────────────────────────────────────────────────
// Items ya incluyen el costo de envio como item separado.
// El cliente paga productos + envio en un solo cobro. No hay cobro adicional de PedidosYa.
function generarLinkMercadoPago(items, externalRef, callback) {
  var renderUrl = (process.env.RENDER_URL || '').replace(/\/$/, '');
  var preference = {
    items: items.map(function(i) {
      return {
        title: i.title,
        quantity: Number(i.quantity) || 1,
        unit_price: Number(i.unit_price),
        currency_id: 'CLP'
      };
    }),
    statement_descriptor: 'Pasta Al Vuelo',
    external_reference: externalRef,
    notification_url: renderUrl + '/mp-webhook',
    back_urls: {
      success: 'https://www.pastalavuelo.cl/gracias',
      failure: 'https://www.pastalavuelo.cl',
      pending: 'https://www.pastalavuelo.cl/pendiente'
    },
    auto_return: 'approved'
  };
  var data = JSON.stringify(preference);
  var options = {
    hostname: 'api.mercadopago.com', path: '/checkout/preferences', method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + MERCADOPAGO_TOKEN,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    }
  };
  var req = https.request(options, function(res) {
    var body = '';
    res.on('data', function(c) { body += c; });
    res.on('end', function() {
      try {
        var parsed = JSON.parse(body);
        console.log('MP preference creada:', parsed.id, parsed.init_point);
        callback(null, parsed.init_point);
      } catch(e) { callback(e); }
    });
  });
  req.on('error', callback);
  req.write(data);
  req.end();
}

// ── MERCADO PAGO: CONSULTAR PAGO ──────────────────────────────────────────────
function consultarPagoMP(paymentId, callback) {
  var options = {
    hostname: 'api.mercadopago.com', path: '/v1/payments/' + paymentId, method: 'GET',
    headers: { 'Authorization': 'Bearer ' + MERCADOPAGO_TOKEN }
  };
  var req = https.request(options, function(res) {
    var body = '';
    res.on('data', function(c) { body += c; });
    res.on('end', function() {
      try { callback(null, JSON.parse(body)); }
      catch(e) { callback(e); }
    });
  });
  req.on('error', callback);
  req.end();
}

// ── PROCESAR PEDIDO CONFIRMADO ────────────────────────────────────────────────
// Flujo: cotizar envio PY → armar items con envio → generar link MP → mandar al cliente
function procesarPedidoConfirmado(from, pedido) {
  console.log('Procesando pedido confirmado de', from, JSON.stringify(pedido));
  var externalRef = 'PAV-' + Date.now();

  function generarCobro(costoEnvio) {
    // Armar items: productos + envio (si delivery)
    var items = pedido.items.map(function(i) {
      return { title: i.title, quantity: Number(i.quantity) || 1, unit_price: Number(i.unit_price) };
    });

    if (pedido.delivery && costoEnvio > 0) {
      items.push({ title: 'Envio a domicilio', quantity: 1, unit_price: costoEnvio });
    }

    var totalProductos = pedido.items.reduce(function(s, i) {
      return s + (Number(i.unit_price) * (Number(i.quantity) || 1));
    }, 0);
    var total = totalProductos + (pedido.delivery ? costoEnvio : 0);

    // Guardar para cuando llegue confirmacion de pago
    pedidosPendientes[externalRef] = {
      from: from,
      nombre: pedido.nombre,
      total: total,
      delivery: pedido.delivery,
      costoEnvio: costoEnvio
    };

    generarLinkMercadoPago(items, externalRef, function(err, link) {
      if (err || !link) {
        console.error('Error generando link MP:', err);
        sendWhatsApp(from, 'Hubo un problema tecnico con el pago. Por favor llamanos al restaurante.');
        return;
      }

      // Mensaje al cliente con desglose claro
      var msg = 'Perfecto ' + pedido.nombre + '! 😊 Te mando el link para pagar:\n\n';
      if (pedido.delivery && costoEnvio > 0) {
        msg += 'Productos: $' + totalProductos.toLocaleString('es-CL') + '\n';
        msg += 'Envio: $' + costoEnvio.toLocaleString('es-CL') + '\n';
        msg += 'Total: $' + total.toLocaleString('es-CL') + '\n\n';
      } else {
        msg += 'Total: $' + total.toLocaleString('es-CL') + '\n\n';
      }
      msg += link;
      sendWhatsApp(from, msg);
    });
  }

  if (pedido.delivery) {
    // Solo cotizar, NO crear el envio en PedidosYa
    cotizarEnvioPedidosYa(pedido, function(err, costo) {
      if (err) {
        console.error('Error cotizando PY:', err);
        costo = 2990; // fallback
      }
      generarCobro(costo);
    });
  } else {
    // Retiro: sin envio
    generarCobro(0);
  }
}

// ── WEBHOOK MERCADO PAGO ──────────────────────────────────────────────────────
function manejarWebhookMP(body) {
  try {
    var data = JSON.parse(body);
    console.log('MP webhook:', JSON.stringify(data));

    var topic = data.topic || data.type;
    var resourceId = null;

    if (topic === 'payment' || topic === 'payment.updated') {
      if (data.data && data.data.id) {
        resourceId = String(data.data.id);
      } else if (data.resource) {
        var match = String(data.resource).match(/(\d+)$/);
        if (match) resourceId = match[1];
      }

      if (!resourceId) { console.log('MP webhook: no se encontro payment ID'); return; }

      consultarPagoMP(resourceId, function(err, pago) {
        if (err) { console.error('Error consultando pago MP:', err); return; }
        console.log('Pago', resourceId, '- status:', pago.status, '- ref:', pago.external_reference);

        if (pago.status !== 'approved') { return; }

        var ref = pago.external_reference;
        var pendiente = pedidosPendientes[ref];
        if (!pendiente) { console.log('No se encontro pedido pendiente para ref:', ref); return; }

        // Confirmar al cliente por WhatsApp
        var msg = 'Pago recibido ' + pendiente.nombre + '! 🎉\n\n';
        msg += 'Tu pedido ya esta en preparacion.\n';
        if (pendiente.delivery) {
          msg += 'En cuanto este listo, el repartidor sale hacia tu direccion 🛵';
        } else {
          msg += 'Puedes pasar a retirarlo en aprox. 20 minutos 😊';
        }
        sendWhatsApp(pendiente.from, msg);

        delete pedidosPendientes[ref];
      });
    }
  } catch(e) {
    console.error('Error procesando webhook MP:', e);
  }
}

// ── SERVIDOR ──────────────────────────────────────────────────────────────────
var server = http.createServer(function(req, res) {
  var urlObj = new URL(req.url, 'http://' + req.headers.host);
  var pathname = urlObj.pathname;

  // GET / → verificacion webhook WhatsApp
  if (req.method === 'GET') {
    var mode = urlObj.searchParams.get('hub.mode');
    var token = urlObj.searchParams.get('hub.verify_token');
    var challenge = urlObj.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('Webhook WA verificado OK');
      res.writeHead(200);
      res.end(challenge);
    } else {
      res.writeHead(403);
      res.end('Forbidden');
    }
    return;
  }

  if (req.method === 'POST') {

    // POST /mp-webhook → notificacion de pago de Mercado Pago
    if (pathname === '/mp-webhook') {
      var mpBody = '';
      req.on('data', function(c) { mpBody += c; });
      req.on('end', function() {
        res.writeHead(200);
        res.end('ok');
        manejarWebhookMP(mpBody);
      });
      return;
    }

    // POST / → mensajes entrantes de WhatsApp
    var waBody = '';
    req.on('data', function(c) { waBody += c; });
    req.on('end', function() {
      res.writeHead(200);
      res.end('ok');
      try {
        var parsed = JSON.parse(waBody);
        var entry = parsed.entry;
        if (!entry || !entry[0]) return;
        var changes = entry[0].changes;
        if (!changes || !changes[0]) return;
        var value = changes[0].value;
        if (!value || !value.messages || !value.messages[0]) return;
        var msg = value.messages[0];
        var from = msg.from;
        var texto = msg.type === 'text' ? msg.text.body : null;
        if (!texto) return;

        console.log('WA de ' + from + ': ' + texto);

        if (!conversaciones[from]) conversaciones[from] = [];
        conversaciones[from].push({ role: 'user', content: texto });
        if (conversaciones[from].length > 30) conversaciones[from] = conversaciones[from].slice(-30);

        callOpenAI(conversaciones[from], function(err, respuesta) {
          if (err || !respuesta) { console.error('OpenAI error:', err); return; }
          console.log('Marco (' + from + '):', respuesta.substring(0, 120));

          var trimmed = respuesta.trim();
          if (trimmed.startsWith('{') && trimmed.includes('PEDIDO_CONFIRMADO')) {
            try {
              var pedido = JSON.parse(trimmed);
              conversaciones[from].push({ role: 'assistant', content: respuesta });
              procesarPedidoConfirmado(from, pedido);
            } catch(e) {
              console.error('Error parseando JSON pedido:', e);
              conversaciones[from].push({ role: 'assistant', content: respuesta });
              sendWhatsApp(from, respuesta);
            }
          } else {
            conversaciones[from].push({ role: 'assistant', content: respuesta });
            sendWhatsApp(from, respuesta);
          }
        });
      } catch(e) { console.error('Error POST WA:', e); }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

var PORT = process.env.PORT || 3000;
server.listen(PORT, function() {
  console.log('Pasta Al Vuelo Marco v3.2 en puerto ' + PORT);
});
