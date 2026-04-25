const http = require('http');
const https = require('https');

const VERIFY_TOKEN = 'pasta_al_vuelo_2026';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const conversaciones = {};

const MARCO_PROMPT = `Eres Marco, agente vendedor oficial de Pasta Al Vuelo en WhatsApp. Atiendes de forma humana, breve y comercial. Tu meta es tomar pedidos y cerrarlos.

LOCALES: Zenteno 181 Santiago Centro | Providencia 202 esquina Seminario
HORARIO: Apertura 11:45 | Delivery hasta 17:45 | Retiro Zenteno hasta 18:00 | Retiro Providencia hasta 21:00

MENU:
CLASICAS desde $3.990: Mantequilla al vino blanco, Alfredo cremosa, Yakisoba vegetales, Pad Thai vegetales
PREMIUM desde $4.990: Pesto cremoso, Carbonara, Amatriciana, Boloñesa, Pomodoro, Yakisoba pollo, Pad Thai pollo, Aji de gallina
ESPECIALIDADES desde $5.990: Camarones al merken/mantequilla/carbonara/pesto, Pollo agridulce/pesto, Yakisoba y Pad Thai pollo+camaron
COMBOS: Clasico $5.290 | Premium $6.190 | Especialidad $6.990 | Para Dos $10.190 | Familiar $19.900
POSTRES: Tiramisu $2.500 | Tartufo $2.500
EXTRAS: Choclo $700 | Champinones $700 | Tocino $900 | Pollo $1.000 | Camarones $1.500 | Espinaca $900 | Salsa $900 | Queso $900 | XL $2.200
BEBIDAS: Coca Cola/Zero $1.490 | Fanta $1.490 | Sprite/Zero $1.490 | Agua $1.290 | Jugos $1.690

TONO: humano, cercano, breve. Una pregunta a la vez. Maximo 1 emoji por mensaje.
FLUJO: recomendar, upsell, modalidad, direccion si delivery, nombre, resumir, confirmar, link de pago`;

function callOpenAI(messages, callback) {
  var data = JSON.stringify({ model: 'gpt-4o-mini', temperature: 0.45, max_tokens: 500, messages: messages });
  var options = {
    hostname: '[api.openai.com](https://api.openai.com)', path: '/v1/chat/completions', method: 'POST',
    headers: { 'Authorization': 'Bearer ' + OPENAI_API_KEY, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
  };
  var req = https.request(options, function(res) {
    var body = '';
    res.on('data', function(chunk) { body += chunk; });
    res.on('end', function() { callback(null, JSON.parse(body)); });
  });
  req.on('error', callback);
  req.write(data);
  req.end();
}

function sendWhatsApp(to, text) {
  var payload = JSON.stringify({ messaging_product: 'whatsapp', to: to, type: 'text', text: { body: text } });
  var options = {
    hostname: '[graph.facebook.com](https://graph.facebook.com)', path: '/v19.0/' + WHATSAPP_PHONE_NUMBER_ID + '/messages', method: 'POST',
    headers: { 'Authorization': 'Bearer ' + WHATSAPP_ACCESS_TOKEN, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
  };
  var req = https.request(options, function(res) { res.on('data', function() {}); });
  req.on('error', function(e) { console.error(e); });
  req.write(payload);
  req.end();
}

var server = http.createServer(function(req, res) {
  var urlObj = new URL(req.url, 'http://' + req.headers.host);
  if ([req.me](https://req.me)thod === 'GET') {
    var mode = urlObj.searchParams.get('hub.mode');
    var token = urlObj.searchParams.get('hub.verify_token');
    var challenge = urlObj.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token === VERIFY_TOKEN) { res.writeHead(200); res.end(challenge); }
    else { res.writeHead(403); res.end('Forbidden'); }
    return;
  }
  if ([req.me](https://req.me)thod === 'POST') {
    var body = '';
    req.on('data', function(chunk) { body += chunk; });
    req.on('end', function() {
      try {
        var parsed = JSON.parse(body);
        var msg = parsed && parsed.entry && parsed.entry[0] && parsed.entry[0].changes && parsed.entry[0].changes[0] && parsed.entry[0].changes[0].value && parsed.entry[0].changes[0].[value.me](https://value.me)ssages && parsed.entry[0].changes[0].[value.me](https://value.me)ssages[0];
        if (!msg) { res.writeHead(200); res.end('ok'); return; }
        var from = msg.from;
        var texto = msg.type === 'text' ? msg.text && msg.text.body : null;
        if (!texto) { res.writeHead(200); res.end('ok'); return; }
        if (!conversaciones[from]) conversaciones[from] = [];
        conversaciones[from].push({ role: 'user', content: texto });
        if (conversaciones[from].length > 20) conversaciones[from] = conversaciones[from].slice(-20);
        var messages = [{ role: 'system', content: MARCO_PROMPT }].concat(conversaciones[from]);
        callOpenAI(messages, function(err, data) {
          if (err) { console.error(err); return; }
          var respuesta = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
          if (!respuesta) return;
          conversaciones[from].push({ role: 'assistant', content: respuesta });
          sendWhatsApp(from, respuesta);
        });
        res.writeHead(200); res.end('ok');
      } catch(e) { console.error(e); res.writeHead(200); res.end('ok'); }
    });
    return;
  }
  res.writeHead(405); res.end('Method not allowed');
});

var PORT = process.env.PORT || 3000;
server.listen(PORT, function() { console.log('Webhook corriendo en puerto ' + PORT); });
