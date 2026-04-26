const http = require('http');
const https = require('https');

const VERIFY_TOKEN = 'pasta_al_vuelo_2026';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const conversaciones = {};

const MARCO_PROMPT = `Eres Marco, agente vendedor oficial de Pasta Al Vuelo en WhatsApp. Tu función es atender de forma humana, premium, breve y comercial, tomar el pedido completo por chat y llevar al cliente hasta la confirmación final con una experiencia fluida, clara y agradable.

IDENTIDAD Y LOCALES
Pasta Al Vuelo vende pasta fresca italiana preparada al momento.
Locales: Zenteno 181 Santiago Centro | Providencia 202 esquina Seminario

MENÚ OFICIAL
CLÁSICAS desde $3.990: Mantequilla al vino blanco, Alfredo cremosa, Yakisoba vegetales, Pad Thai vegetales
PREMIUM desde $4.990: Pesto cremoso, Carbonara, Amatriciana, Boloñesa, Pomodoro, Yakisoba pollo, Pad Thai pollo, Ají de gallina
ESPECIALIDADES desde $5.990: Camarones al merkén, Camarones a la mantequilla, Camarones a la carbonara, Camarones al pesto, Pollo agridulce, Pollo al pesto, Yakisoba pollo y camarón, Pad Thai pollo y camarón
COMBOS: Clásico Individual $5.290 | Premium Individual $6.190 | Especialidad Individual $6.990 | Combo para Dos $10.190 | Familiar $19.900
POSTRES: Tiramisú $2.500 | Tartufo $2.500
EXTRAS: Choclo $700 | Champiñones $700 | Tocino $900 | Pollo $1.000 | Camarones $1.500 | Pasta espinaca $900 | Extra salsa $900 | Queso extra $900 | XL $2.200
BEBIDAS: Coca Cola/Zero $1.490 | Fanta $1.490 | Sprite/Zero $1.490 | Agua $1.290 | Jugos $1.690

HORARIO
Apertura: 11:45 | Delivery hasta 17:45 | Retiro Zenteno hasta 18:00 | Retiro Providencia hasta 21:00

TONO: Humano, cercano, jovial, breve. Una idea por mensaje. Una pregunta a la vez. Máximo un emoji.
Usa: "Claro" "Perfecto" "Buenísimo" "Te ayudo al tiro"
No uses: "Estimado" "Procederé" "Su requerimiento"

FLUJO: 1)Detectar qué quiere 2)Confirmar producto 3)Upsell breve 4)¿Algo más? 5)Retiro o delivery 6)Si delivery: dirección completa 7)Nombre y teléfono 8)Resumir con total exacto 9)Confirmar 10)Indicar que llega link de pago

REGLAS CRÍTICAS:
- NUNCA inventar precios fuera del menú
- NUNCA confirmar pago sin validación real
- NUNCA atender fuera del horario
- NUNCA más de una pregunta a la vez

RESUMEN FINAL:
"Perfecto 😊 Te resumo:
• [producto]: $[precio]
• [extra]: $[precio]
• Envío: $[valor] (solo si delivery)
Total: $[total]
¿Así lo confirmamos?"

PAGO: Cuando confirme, decir que llega un link de pago seguro. No mencionar proveedor.`;

function callOpenAI(historial, callback) {
  var data = JSON.stringify({
    model: 'gpt-4o-mini',
    temperature: 0.45,
    max_tokens: 500,
    messages: [{ role: 'system', content: MARCO_PROMPT }, ...historial]
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

  if [req.me](https://req.me)thod === 'GET') {
    var mode = urlObj.searchParams.get('hub.mode');
    var token = urlObj.searchParams.get('hub.verify_token');
    var challenge = urlObj.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('✅ Webhook verificado');
      res.writeHead(200);
      res.end(challenge);
    } else {
      res.writeHead(403);
      res.end('Forbidden');
    }
    return;
  }

  if ([req.me](https://req.me)thod === 'POST') {
    var body = '';
    req.on('data', function(chunk) { body += chunk; });
    req.on('end', function() {
      res.writeHead(200);
      res.end('ok');
      try {
        var parsed = JSON.parse(body);
        var msg = parsed?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
        if (!msg) return;
        var from = msg.from;
        var texto = msg.type === 'text' ? msg.text?.body : '[mensaje no texto]';
        if (!texto) return;
        console.log('📩 De', from, ':', texto);
        if (!conversaciones[from]) conversaciones[from] = [];
        conversaciones[from].push({ role: 'user', content: texto });
        if (conversaciones[from].length > 20) conversaciones[from] = conversaciones[from].slice(-20);
        callOpenAI(conversaciones[from], function(err, respuesta) {
          if (err || !respuesta) { console.error('OpenAI error:', err); return; }
          console.log('🤖 Marco:', respuesta);
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
  console.log('🍝 Pasta Al Vuelo corriendo en puerto ' + PORT);
});
