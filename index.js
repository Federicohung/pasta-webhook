const http = require('http');
const https = require('https');

const VERIFY_TOKEN = 'pasta_al_vuelo_2026';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const MERCADOPAGO_TOKEN = process.env.MERCADOPAGO_TOKEN;
const PEDIDOSYA_TOKEN = process.env.PEDIDOSYA_TOKEN;

const conversaciones = {};

const MARCO_PROMPT = `Eres Marco, agente vendedor oficial de Pasta Al Vuelo en WhatsApp. Atiende de forma humana, breve y comercial. Tu objetivo es tomar el pedido completo y procesarlo.

LOCALES: Zenteno 181 Santiago Centro | Providencia 202 esquina Seminario

MENU OFICIAL
CLASICAS $3.990: Mantequilla al vino blanco, Alfredo cremosa, Yakisoba vegetales, Pad Thai vegetales
PREMIUM $4.990: Pesto cremoso, Carbonara, Amatriciana, Bolonesa, Pomodoro, Yakisoba pollo, Pad Thai pollo, Aji de gallina
ESPECIALIDADES $5.990: Camarones al merken, Camarones a la mantequilla, Camarones a la carbonara, Camarones al pesto, Pollo agridulce, Pollo al pesto, Yakisoba pollo y camaron, Pad Thai pollo y camaron
COMBOS: Clasico Individual $5.290 | Premium Individual $6.190 | Especialidad Individual $6.990 | Combo para Dos $10.190 | Familiar $19.900
POSTRES: Tiramisu $2.500 | Tartufo $2.500
EXTRAS: Choclo $700 | Champinones $700 | Tocino $900 | Pollo $1.000 | Camarones $1.500 | Pasta espinaca $900 | Extra salsa $900 | Queso extra $900 | XL $2.200
BEBIDAS: Coca Cola/Zero $1.490 | Fanta $1.490 | Sprite/Zero $1.490 | Agua $1.290 | Jugos $1.690

HORARIO: Apertura 11:45 | Delivery hasta 17:45 | Retiro Zenteno hasta 18:00 | Retiro Providencia hasta 21:00

TONO: Humano, cercano, jovial, breve. Una pregunta a la vez. Maximo un emoji.

FLUJO OBLIGATORIO PASO A PASO:
1) Saluda y pregunta que quiere pedir
2) Confirma el producto elegido
3) Ofrece un extra o postre (solo una vez)
4) Pregunta si agrega algo mas
5) Pregunta: retiro en local o delivery?
6) Si DELIVERY: pedir CALLE Y NUMERO (ej: Arturo Prat 324)
7) Si DELIVERY: pedir COMUNA por separado (ej: Santiago, Providencia, etc)
8) Pedir nombre completo
9) Pedir numero de telefono
10) Mostrar resumen completo del pedido y preguntar: "Confirmas tu pedido?"
11) Cuando el cliente diga SI o confirme: responde UNICAMENTE con el JSON de abajo, SIN ningun texto antes ni despues

JSON DE CONFIRMACION (usar exactamente este formato):
{"accion":"PEDIDO_CONFIRMADO","items":[{"title":"NOMBRE_PRODUCTO","quantity":1,"unit_price":0000}],"delivery":true,"direccion":"CALLE NUMERO","comuna":"COMUNA","nombre":"NOMBRE","telefono":"TELEFONO"}

EJEMPLOS DE ITEMS:
- Pesto cremoso: {"title":"Pesto cremoso","quantity":1,"unit_price":4990}
- Carbonara: {"title":"Carbonara","quantity":1,"unit_price":4990}
- Camarones al merken: {"title":"Camarones al merken","quantity":1,"unit_price":5990}
- Combo para Dos: {"title":"Combo para Dos","quantity":1,"unit_price":10190}

REGLAS CRITICAS:
- NUNCA inventar precios fuera del menu
- NUNCA confirmar pago sin validacion real
- NUNCA atender fuera del horario
- NUNCA hacer mas de una pregunta a la vez
- Para delivery SIEMPRE pedir calle/numero Y comuna por separado
- Al confirmar: responder SOLO el JSON, absolutamente nada mas`;

function callOpenAI(historial, callback) {
  var messages = [{ role: 'system', content: MARCO_PROMPT }].concat(historial);
  var data = JSON.stringify({
    model: 'gpt-4o-mini',
    temperature: 0.2,
    max_tokens: 600,
    messages: messages
  });
  var options = {
    hostname: 'api.openai.com',
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + OPENAI_API_KEY,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    }
  };
  var req = https.request(options, function(res) {
    var body = '';
    res.on('data', function(chunk) { body += chunk; });
    res.on('end', function() {
      try {
        var parsed = JSON.parse(body);
        callback(null, parsed.choices[0].message.content);
      } catch(e) { callback(e); }
    });
  });
  req.on('error', callback);
  req.write(data);
  req.end();
}

function sendWhatsApp(to, text) {
  var payload = JSON.stringify({
    messaging_product: 'whatsapp',
    to: to,
    type: 'text',
    text: { body: text }
  });
  var options = {
    hostname: 'graph.facebook.com',
    path: '/v19.0/' + PHONE_NUMBER_ID + '/messages',
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + WHATSAPP_ACCESS_TOKEN,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };
  var req = https.request(options, function(res) {
    var body = '';
    res.on('data', function(chunk) { body += chunk; });
    res.on('end', function() { console.log('WA enviado a ' + to); });
  });
  req.on('error', function(e) { console.error('WA error:', e); });
  req.write(payload);
  req.end();
}

function cotizarEnvioPedidosYa(pedido, callback) {
  var payload = JSON.stringify({
    referenceId: 'PAV-' + Date.now(),
    isTest: false,
    items: [{
      type: 'STANDARD',
      value: 5000,
      description: 'Pasta fresca',
      quantity: 1,
      volume: 1,
      weight: 0.5
    }],
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
    res.on('data', function(chunk) { body += chunk; });
    res.on('end', function() {
      try {
        var data = JSON.parse(body);
        console.log('PedidosYa respuesta:', JSON.stringify(data));
        var oferta = data.deliveryOffers && data.deliveryOffers[0];
        var precio = oferta && oferta.pricing && oferta.pricing.total;
        callback(null, precio || 2990);
      } catch(e) {
        console.error('Error PedidosYa:', e);
        callback(null, 2990);
      }
    });
  });
  req.on('error', function(e) {
    console.error('Error PedidosYa request:', e);
    callback(null, 2990);
  });
  req.write(payload);
  req.end();
}

function generarLinkMercadoPago(items, nombre, callback) {
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
    external_reference: 'PAV-' + Date.now(),
    back_urls: {
      success: 'https://www.pastalavuelo.cl/gracias',
      failure: 'https://www.pastalavuelo.cl',
      pending: 'https://www.pastalavuelo.cl/pendiente'
    },
    auto_return: 'approved'
  };
  var data = JSON.stringify(preference);
  var options = {
    hostname: 'api.mercadopago.com',
    path: '/checkout/preferences',
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + MERCADOPAGO_TOKEN,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    }
  };
  var req = https.request(options, function(res) {
    var body = '';
    res.on('data', function(chunk) { body += chunk; });
    res.on('end', function() {
      try {
        var parsed = JSON.parse(body);
        console.log('MercadoPago respuesta:', JSON.stringify(parsed));
        callback(null, parsed.init_point);
      } catch(e) {
        console.error('Error MP parse:', e);
        callback(e);
      }
    });
  });
  req.on('error', function(e) {
    console.error('Error MP request:', e);
    callback(e);
  });
  req.write(data);
  req.end();
}

function procesarPedidoConfirmado(from, pedido) {
  console.log('Pedido confirmado de ' + from + ':', JSON.stringify(pedido));

  function finalizarConEnvio(costoEnvio) {
    var items = pedido.items.slice();
    if (pedido.delivery && costoEnvio > 0) {
      items.push({ title: 'Delivery', quantity: 1, unit_price: costoEnvio });
    }
    var total = items.reduce(function(s, i) { return s + (Number(i.unit_price) * Number(i.quantity)); }, 0);

    generarLinkMercadoPago(items, pedido.nombre, function(err, link) {
      if (err || !link) {
        console.error('Error generando link MP:', err);
        sendWhatsApp(from, 'Hubo un problema tecnico con el pago. Por favor llamanos al restaurante para completar tu pedido.');
        return;
      }
      var msg = 'Listo ' + pedido.nombre + '! 😊\n\n';
      if (pedido.delivery && costoEnvio > 0) {
        msg += 'Envio: $' + costoEnvio.toLocaleString('es-CL') + '\n';
      }
      msg += 'Total: $' + total.toLocaleString('es-CL') + '\n\n';
      msg += 'Paga aqui:\n' + link;
      sendWhatsApp(from, msg);
    });
  }

  if (pedido.delivery) {
    cotizarEnvioPedidosYa(pedido, function(err, costo) {
      console.log('Costo envio:', costo);
      finalizarConEnvio(costo);
    });
  } else {
    finalizarConEnvio(0);
  }
}

var server = http.createServer(function(req, res) {
  var urlObj = new URL(req.url, 'http://' + req.headers.host);

  if (req.method === 'GET') {
    var mode = urlObj.searchParams.get('hub.mode');
    var token = urlObj.searchParams.get('hub.verify_token');
    var challenge = urlObj.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('Webhook verificado OK');
      res.writeHead(200);
      res.end(challenge);
    } else {
      res.writeHead(403);
      res.end('Forbidden');
    }
    return;
  }

  if (req.method === 'POST') {
    var body = '';
    req.on('data', function(chunk) { body += chunk; });
    req.on('end', function() {
      res.writeHead(200);
      res.end('ok');
      try {
        var parsed = JSON.parse(body);
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

        console.log('De ' + from + ': ' + texto);

        if (!conversaciones[from]) conversaciones[from] = [];
        conversaciones[from].push({ role: 'user', content: texto });
        if (conversaciones[from].length > 20) {
          conversaciones[from] = conversaciones[from].slice(-20);
        }

        callOpenAI(conversaciones[from], function(err, respuesta) {
          if (err || !respuesta) { console.error('OpenAI error:', err); return; }
          console.log('Marco raw: ' + respuesta);

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

      } catch(e) { console.error('Error POST:', e); }
    });
    return;
  }

  res.writeHead(405);
  res.end('Method not allowed');
});

var PORT = process.env.PORT || 3000;
server.listen(PORT, function() {
  console.log('Pasta Al Vuelo corriendo en puerto ' + PORT);
});
