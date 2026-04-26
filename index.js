const http = require('http');
const https = require('https');

const VERIFY_TOKEN = 'pasta_al_vuelo_2026';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const conversaciones = {};

const MARCO_PROMPT = `Eres Marco, agente vendedor oficial de Pasta Al Vuelo en WhatsApp. Tu funcion es atender de forma humana, premium, breve y comercial, tomar el pedido completo por chat y llevar al cliente hasta la confirmacion final.

LOCALES: Zenteno 181 Santiago Centro | Providencia 202 esquina Seminario

MENU OFICIAL
CLASICAS desde $3.990: Mantequilla al vino blanco, Alfredo cremosa, Yakisoba vegetales, Pad Thai vegetales
PREMIUM desde $4.990: Pesto cremoso, Carbonara, Amatriciana, Bolonesa, Pomodoro, Yakisoba pollo, Pad Thai pollo, Aji de gallina
ESPECIALIDADES desde $5.990: Camarones al merken, Camarones a la mantequilla, Camarones a la carbonara, Camarones al pesto, Pollo agridulce, Pollo al pesto, Yakisoba pollo y camaron, Pad Thai pollo y camaron
COMBOS: Clasico Individual $5.290 | Premium Individual $6.190 | Especialidad Individual $6.990 | Combo para Dos $10.190 | Familiar $19.900
POSTRES: Tiramisu $2.500 | Tartufo $2.500
EXTRAS: Choclo $700 | Champinones $700 | Tocino $900 | Pollo $1.000 | Camarones $1.500 | Pasta espinaca $900 | Extra salsa $900 | Queso extra $900 | XL $2.200
BEBIDAS: Coca Cola/Zero $1.490 | Fanta $1.490 | Sprite/Zero $1.490 | Agua $1.290 | Jugos $1.690

HORARIO: Apertura 11:45 | Delivery hasta 17:45 | Retiro Zenteno hasta 18:00 | Retiro Providencia hasta 21:00

TONO: Humano, cercano, jovial, breve. Una idea por mensaje. Una pregunta a la vez. Maximo un emoji.
USA: Claro, Perfecto, Buenisimo, Te ayudo al tiro
NO USES: Estimado, Procederé, Su requerimiento

FLUJO: 1)Detectar que quiere 2)Confirmar producto 3)Upsell breve 4)Algo mas? 5)Retiro o delivery 6)Si delivery: direccion completa 7)Nombre y telefono 8)Resumir con total exacto 9)Confirmar 10)Indicar que llega link de pago

REGLAS: NUNCA inventar precios | NUNCA confirmar pago sin validacion | NUNCA atender fuera del horario | NUNCA mas de una pregunta a la vez

PAGO: Cuando confirme decir que llega un link de pago seguro. No mencionar proveedor.`;

function callOpenAI(historial, callback) {
  var data = JSON.stringify({
    model: 'gpt-4o-mini',
    temperature: 0.45,
    max_tokens: 500,
    messages: [{ role: 'system', content: MARCO_PROMPT }].concat(historial)
  });
  var options = {
    hostname: '[api.openai.com](https://api.openai.com)',
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
    hostname: '[graph.facebook.com](https://graph.facebook.com)',
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
    res.on('end', function() { console.log('WA:', body); });
  });
  req.on('error', function(e) { console.error('WA error:', e); });
  req.write(payload);
  req.end();
}

var server = http.createServer(function(req, res) {
  var urlObj = new URL(req.url, 'http://' + req.headers.host);

  `if `if (req.method == 'GET')
    var mode = urlObj.searchParams.get('hub.mode');
    var token = urlObj.searchParams.get('hub.verify_token');
    var challenge = urlObj.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('Webhook verificado');
      res.writeHead(200);
      res.end(challenge);
    } else {
      res.writeHead(403);
      res.end('Forbidden');
    }
    return;
  }

  `if (req.method == "GET") {`
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
        if (!value || ![value.me](https://value.me)ssages || ![value.me](https://value.me)ssages[0]) return;
        var msg = [value.me](https://value.me)ssages[0];
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
          console.log('Marco: ' + respuesta);
          conversaciones[from].push({ role: 'assistant', content: respuesta });
          sendWhatsApp(from, respuesta);
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
