const http = require('http');
const https = require('https');

// ─────────────────────────────────────────────────────────────────────────────
// REGLA INVIOLABLE: todos los pedidos son PREPAGADOS.
// Jamás collect. Jamás cash_on_delivery. Jamás cobro revertido.
// ─────────────────────────────────────────────────────────────────────────────

const VERIFY_TOKEN             = 'pasta_al_vuelo_2026';
const OPENAI_API_KEY           = process.env.OPENAI_API_KEY;
const WHATSAPP_ACCESS_TOKEN    = process.env.WHATSAPP_ACCESS_TOKEN;
const PHONE_NUMBER_ID          = process.env.PHONE_NUMBER_ID;
const EXTERNAL_CHECKOUT_URL    = process.env.EXTERNAL_CHECKOUT_URL || 'https://www.pastaalvuelo.com/api/webhooks/external-checkout';
const EXTERNAL_CHECKOUT_SECRET = process.env.EXTERNAL_CHECKOUT_SECRET;
const GOOGLE_MAPS_KEY          = process.env.GOOGLE_MAPS_KEY;

const conversaciones = {};

// ── NORMALIZACIÓN DE COMUNAS ──────────────────────────────────────────────────
const MAPA_COMUNAS = {
  'santiago': 'Santiago', 'stgo': 'Santiago', 'stgo centro': 'Santiago',
  'santiago centro': 'Santiago', 'centro': 'Santiago', 'casco historico': 'Santiago',
  'providencia': 'Providencia', 'provi': 'Providencia',
  'nunoa': 'Ñuñoa', 'ñunoa': 'Ñuñoa',
  'las condes': 'Las Condes', 'lascondes': 'Las Condes',
  'vitacura': 'Vitacura',
  'la reina': 'La Reina', 'lareina': 'La Reina',
  'macul': 'Macul',
  'penalolen': 'Peñalolén', 'peñalolen': 'Peñalolén',
  'la florida': 'La Florida', 'laflorida': 'La Florida',
  'san miguel': 'San Miguel', 'sanmiguel': 'San Miguel',
  'pac': 'Pedro Aguirre Cerda', 'pedro aguirre cerda': 'Pedro Aguirre Cerda',
  'lo espejo': 'Lo Espejo',
  'el bosque': 'El Bosque',
  'san ramon': 'San Ramón', 'san ramón': 'San Ramón',
  'la cisterna': 'La Cisterna',
  'cerrillos': 'Cerrillos',
  'maipu': 'Maipú', 'maipú': 'Maipú',
  'estacion central': 'Estación Central', 'estación central': 'Estación Central', 'est central': 'Estación Central',
  'cerro navia': 'Cerro Navia',
  'quinta normal': 'Quinta Normal',
  'renca': 'Renca',
  'independencia': 'Independencia',
  'recoleta': 'Recoleta',
  'conchali': 'Conchalí', 'conchalí': 'Conchalí',
  'huechuraba': 'Huechuraba',
  'pudahuel': 'Pudahuel',
  'quilicura': 'Quilicura',
  'lo barnechea': 'Lo Barnechea',
  'san bernardo': 'San Bernardo',
  'puente alto': 'Puente Alto',
  'la granja': 'La Granja',
  'lo prado': 'Lo Prado',
};

function normalizarComuna(raw) {
  if (!raw) return '';
  var clave = raw.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (var key in MAPA_COMUNAS) {
    var keyNorm = key.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (keyNorm === clave) return MAPA_COMUNAS[key];
  }
  return raw.trim().replace(/\b\w/g, function(l) { return l.toUpperCase(); });
}

// ── HORA CHILE ────────────────────────────────────────────────────────────────
function horaChile() {
  var ahora = new Date();
  var str = ahora.toLocaleString('es-CL', {
    timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false
  });
  var partes = str.split(':');
  var h = parseInt(partes[0], 10);
  var m = parseInt(partes[1], 10);
  return {
    totalMinutos: h * 60 + m,
    str: (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m
  };
}

// ── ESTADO HORARIO ────────────────────────────────────────────────────────────
var APERTURA        = 11 * 60 + 45;
var CIERRE_DELIVERY = 17 * 60 + 45;
var CIERRE_ZENTENO  = 18 * 60 + 0;
var CIERRE_PROV     = 21 * 60 + 0;

function estadoHorario() {
  var tm = horaChile().totalMinutos;
  if (tm < APERTURA)                                return 'ANTES_DE_APERTURA';
  if (tm >= APERTURA && tm < CIERRE_DELIVERY)       return 'ABIERTO_DELIVERY_Y_RETIRO';
  if (tm >= CIERRE_DELIVERY && tm < CIERRE_ZENTENO) return 'SOLO_RETIRO_ZENTENO_Y_PROVIDENCIA';
  if (tm >= CIERRE_ZENTENO && tm < CIERRE_PROV)     return 'SOLO_RETIRO_PROVIDENCIA';
  return 'CERRADO_TOTAL';
}

function contextoHorario() {
  var t = horaChile();
  var estado = estadoHorario();
  return [
    '==================================================',
    'HORA ACTUAL EN CHILE: ' + t.str,
    'ESTADO ACTUAL: ' + estado,
    '',
    'ANTES_DE_APERTURA o CERRADO_TOTAL:',
    '  - Tomar pedido igual. Resumen: "Tu pedido entra en fila para cuando abramos 😊"',
    '  - JSON con "agendado":true.',
    '',
    'ABIERTO_DELIVERY_Y_RETIRO:',
    '  - Normal. JSON con "agendado":false.',
    '',
    'SOLO_RETIRO_ZENTENO_Y_PROVIDENCIA:',
    '  - Delivery cerrado. Solo retiro Zenteno y Providencia.',
    '',
    'SOLO_RETIRO_PROVIDENCIA:',
    '  - Solo retiro Providencia.',
    '==================================================',
  ].join('\n');
}

// ── GEOCODING ─────────────────────────────────────────────────────────────────
function geocodificarDireccion(calle, numero, comuna) {
  return new Promise(function(resolve) {
    if (!GOOGLE_MAPS_KEY) return resolve(null);
    var query = encodeURIComponent(calle + ' ' + numero + ', ' + comuna + ', Chile');
    var url = 'https://maps.googleapis.com/maps/api/geocode/json?address=' + query + '&key=' + GOOGLE_MAPS_KEY;
    https.get(url, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try {
          var json = JSON.parse(data);
          if (json.status === 'OK' && json.results.length > 0) {
            var loc = json.results[0].geometry.location;
            console.log('[GEOCODE]', loc.lat, loc.lng, json.results[0].formatted_address);
            resolve({ lat: loc.lat, lng: loc.lng });
          } else {
            console.warn('[GEOCODE] Sin resultado:', json.status);
            resolve(null);
          }
        } catch(e) { resolve(null); }
      });
    }).on('error', function() { resolve(null); });
  });
}

// ── COTIZAR ENVÍO ─────────────────────────────────────────────────────────────
function cotizarEnvio(lat, lng) {
  return new Promise(function(resolve) {
    var body = JSON.stringify({ destination: { lat: lat, lng: lng } });
    var options = {
      hostname: 'www.pastaalvuelo.com',
      path: '/api/shipping/estimate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    var req = https.request(options, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try {
          var json = JSON.parse(data);
          if (json.success && json.shippingCost) {
            console.log('[ENVIO] $' + json.shippingCost + ' | ' + json.distanceKm + 'km');
            resolve({
              shippingCost: json.shippingCost,
              distanceKm: json.distanceKm,
              withinCoverage: json.withinCoverage,
              deliveryOfferId: json.selectedOffer ? json.selectedOffer.deliveryOfferId : null,
              shippingEstimateId: json.shippingEstimateId || null
            });
          } else {
            console.warn('[ENVIO] Sin cotización:', JSON.stringify(json));
            resolve(null);
          }
        } catch(e) { resolve(null); }
      });
    });
    req.on('error', function() { resolve(null); });
    req.write(body);
    req.end();
  });
}

// ── ENVIAR MENSAJE SIMPLE ─────────────────────────────────────────────────────
function enviarMensaje(to, texto) {
  return new Promise(function(resolve, reject) {
    var body = JSON.stringify({
      messaging_product: 'whatsapp',
      to: to,
      type: 'text',
      text: { body: texto }
    });
    var options = {
      hostname: 'graph.facebook.com',
      path: '/v18.0/' + PHONE_NUMBER_ID + '/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + WHATSAPP_ACCESS_TOKEN,
        'Content-Length': Buffer.byteLength(body)
      }
    };
    var req = https.request(options, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() { resolve(data); });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── ENVIAR BOTÓN CTA (URL Button nativo de WhatsApp) ──────────────────────────
// Usa interactive > cta_url — disponible en Cloud API v17+.
// Si la API devuelve error (canal no soporta), hace fallback a texto plano.
function enviarBotonPago(to, textoHeader, textoBody, labelBoton, url) {
  return new Promise(function(resolve) {
    var body = JSON.stringify({
      messaging_product: 'whatsapp',
      to: to,
      type: 'interactive',
      interactive: {
        type: 'cta_url',
        body: { text: textoBody },
        action: {
          name: 'cta_url',
          parameters: {
            display_text: labelBoton,
            url: url
          }
        }
      }
    });
    var options = {
      hostname: 'graph.facebook.com',
      path: '/v18.0/' + PHONE_NUMBER_ID + '/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + WHATSAPP_ACCESS_TOKEN,
        'Content-Length': Buffer.byteLength(body)
      }
    };
    var req = https.request(options, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try {
          var json = JSON.parse(data);
          if (json.error) {
            // Fallback: texto plano con el link
            console.warn('[CTA] Botón no soportado, usando fallback texto. Error:', json.error.message);
            enviarMensaje(to, textoBody + '\n\n' + url).then(resolve).catch(resolve);
          } else {
            console.log('[CTA] Botón enviado OK');
            resolve(data);
          }
        } catch(e) {
          enviarMensaje(to, textoBody + '\n\n' + url).then(resolve).catch(resolve);
        }
      });
    });
    req.on('error', function() {
      // Fallback si falla la request completa
      enviarMensaje(to, textoBody + '\n\n' + url).then(resolve).catch(resolve);
    });
    req.write(body);
    req.end();
  });
}

// ── ECOMMERCE ─────────────────────────────────────────────────────────────────
function llamarExternalCheckout(payload) {
  return new Promise(function(resolve, reject) {
    var body = JSON.stringify(payload);
    var urlObj = new URL(EXTERNAL_CHECKOUT_URL);
    var options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': EXTERNAL_CHECKOUT_SECRET,
        'x-source': 'whatsapp-marco',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    var req = https.request(options, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── PROCESAR PEDIDO ───────────────────────────────────────────────────────────
async function procesarPedidoConfirmado(pedido, fromNumber) {
  try {
    var isDelivery = pedido.delivery === true;
    var subtotal = pedido.items.reduce(function(acc, i) {
      return acc + (Number(i.unit_price) * Number(i.quantity));
    }, 0);
    var shippingCost = 0;
    var shippingEstimateId = null;
    var deliveryOfferId = null;

    // Normalizar comuna
    if (pedido.direccion_comuna) {
      var raw = pedido.direccion_comuna;
      pedido.direccion_comuna = normalizarComuna(raw);
      if (raw !== pedido.direccion_comuna) {
        console.log('[COMUNA] "' + raw + '" → "' + pedido.direccion_comuna + '"');
      }
    }

    // Geocoding + cotización
    if (isDelivery && pedido.direccion_calle && pedido.direccion_numero) {
      var comunaGeo = pedido.direccion_comuna || 'Santiago';
      console.log('[PEDIDO] Geocodificando:', pedido.direccion_calle, pedido.direccion_numero, comunaGeo);

      var coords = await geocodificarDireccion(pedido.direccion_calle, pedido.direccion_numero, comunaGeo);
      if (coords) {
        var cotizacion = await cotizarEnvio(coords.lat, coords.lng);
        if (cotizacion && cotizacion.withinCoverage) {
          shippingCost = cotizacion.shippingCost;
          shippingEstimateId = cotizacion.shippingEstimateId;
          deliveryOfferId = cotizacion.deliveryOfferId;
        } else {
          console.warn('[PEDIDO] Fuera de cobertura');
          await enviarMensaje(fromNumber,
            'Lo siento 😕 tu dirección queda fuera de nuestra zona de delivery.\n' +
            '¿Prefieres pasar a buscarla? Zenteno 181 o Providencia 202 😊'
          );
          return;
        }
      } else {
        console.warn('[PEDIDO] Geocoding falló → costo fijo $2.990');
        shippingCost = 2990;
      }
    }

    var total = subtotal + shippingCost;
    var externalOrderId = 'WA-' + fromNumber + '-' + Date.now();
    var itemsCheckout = pedido.items.slice();
    if (isDelivery && shippingCost > 0) {
      itemsCheckout.push({ title: 'Envío a domicilio', quantity: 1, unit_price: shippingCost });
    }

    var payload = {
      external_order_id: externalOrderId,
      cliente_nombre: pedido.nombre || 'Cliente WhatsApp',
      cliente_email: '',
      cliente_telefono: fromNumber,
      metodo_entrega: isDelivery ? 'delivery' : 'retiro',
      direccion_calle: pedido.direccion_calle || '',
      direccion_numero: pedido.direccion_numero || '',
      direccion_comuna: pedido.direccion_comuna || '',
      direccion_interior: pedido.direccion_interior || '',
      horario_entrega: 'Lo antes posible',
      items: itemsCheckout,
      subtotal: subtotal,
      shipping_cost: shippingCost,
      shipping_provider: isDelivery ? 'PEDIDOSYA' : null,
      total: total,
      notas: pedido.agendado ? 'PEDIDO AGENDADO - entra en fila para apertura' : '',
      source: 'whatsapp_marco',
      pago_modalidad: 'prepagado_online',
      collect: false,
      cash_on_delivery: false,
      pedidosya_estimate_id: shippingEstimateId,
      pedidosya_offer_id: deliveryOfferId
    };

    console.log('[PEDIDO] subtotal:$' + subtotal + ' envío:$' + shippingCost + ' total:$' + total);
    var resultado = await llamarExternalCheckout(payload);

    if (resultado.success && resultado.payment_url) {
      // ── Mensaje resumen antes del botón ──────────────────────────────────
      var nombre = pedido.nombre ? pedido.nombre.split(' ')[0] : '';
      var lineaEntrega = isDelivery
        ? (shippingCost > 0
            ? 'Envío: $' + shippingCost.toLocaleString('es-CL') + ' · Total: $' + total.toLocaleString('es-CL')
            : 'Total: $' + total.toLocaleString('es-CL'))
        : 'Total: $' + total.toLocaleString('es-CL') + ' (retiro en local)';

      var textoResumen = (nombre ? nombre + ', p' : 'P') + 'edido recibido 🍝\n' +
        lineaEntrega + '\n' +
        (pedido.agendado
          ? 'Queda en fila para cuando abramos a las 11:45.'
          : 'Listo en ~20 min una vez confirmado el pago.');

      // ── Texto del cuerpo del botón ────────────────────────────────────────
      var textoBoton = 'Tu pedido está listo. Toca el botón para pagar de forma segura 🔒';

      // Primero enviar el resumen, luego el botón
      await enviarMensaje(fromNumber, textoResumen);
      await enviarBotonPago(
        fromNumber,
        'Pasta Al Vuelo',
        textoBoton,
        'Pagar ahora',
        resultado.payment_url
      );

      console.log('[PEDIDO] ✅ Botón pago enviado. Orden:', resultado.numero_orden);
    } else {
      console.error('[PEDIDO] Error ecommerce:', JSON.stringify(resultado));
      await enviarMensaje(fromNumber,
        'Hubo un problema técnico generando el link 😅\nLlámanos al +56 9 3271 4990 y lo solucionamos al tiro.'
      );
    }
  } catch(err) {
    console.error('[PEDIDO] Error:', err.message);
    await enviarMensaje(fromNumber,
      'Tuvimos un problema técnico 😅 Llámanos al +56 9 3271 4990 y lo resolvemos.'
    );
  }
}

// ── PROMPT MARCO v3.8 ─────────────────────────────────────────────────────────
const MARCO_PROMPT_BASE = `[SYSTEM PROMPT / MARCO - PASTA AL VUELO v3.8]

Eres Marco, agente vendedor oficial de Pasta Al Vuelo en WhatsApp.
Atiende de forma humana, premium, breve y comercial.
Toma el pedido completo y llévalo hasta la confirmacion final.
NUNCA rechaces un pedido — siempre puede entrar en fila.

LOCALES: Zenteno 181 Santiago Centro | Providencia 202 esquina Seminario

{{CONTEXTO_HORARIO}}

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

1. Detectar qué quiere el cliente
2. Confirmar producto + upsell breve (solo 1 intento)
3. Preguntar si agrega algo más
4. Retiro o delivery (según estado horario)
5. Si delivery: pedir calle, número y COMUNA
6. Pedir nombre y teléfono
7. Mostrar resumen y pedir confirmación
8. Al confirmar: emitir SOLO el JSON

==================================================
REGLA CRITICA — DIRECCIÓN Y COMUNA
==================================================

IMPORTANTE: "Santiago" es al mismo tiempo el nombre de la CIUDAD y de una COMUNA específica (el centro histórico, donde está el restaurante).
La Región Metropolitana tiene 52 comunas: Santiago, Providencia, Ñuñoa, Las Condes, Vitacura, San Miguel, Recoleta, Maipú, La Florida, Puente Alto, etc.

CUÁNDO PEDIR LA COMUNA:
- Si el cliente dice solo "Santiago" o "stgo" SIN dar calle ni número → pregunta:
  "¿En qué comuna queda tu dirección? Por ejemplo: Santiago Centro, Providencia, Las Condes, Ñuñoa..."
- Si el cliente dice "vivo en Santiago" sin más → igual pregunta la comuna.

CUÁNDO NO PEDIR LA COMUNA:
- Si ya dio una comuna específica (Providencia, Ñuñoa, Las Condes, San Miguel, Recoleta, Maipú, etc.) → NO preguntar.
- Si ya dio calle + número + cualquier referencia a Santiago → NO preguntar. Usar "Santiago" en el JSON.
  Ejemplo: "Arturo Prat 324, Santiago" → comuna = "Santiago". Listo.
- Si dijo "Santiago Centro", "el centro", "stgo centro" → comuna válida, usar "Santiago".

NUNCA volver a preguntar la comuna si ya la tienes. Una sola vez.

REGLA DEL ENVÍO:
- En el resumen poner siempre: "Envío: se calcula según tu dirección (se suma al total)"
- Marco NO conoce el costo de envío — el sistema lo calcula automáticamente.

==================================================
TONO
==================================================

Humano, cercano, jovial, breve. Una pregunta a la vez. Máximo un emoji.
USA: Claro, Perfecto, Buenísimo, Te ayudo al tiro, Dale, Anotado
NO USES: Estimado, Procederá, Su requerimiento

==================================================
UPSELL
==================================================

Carbonara → agrandada, queso extra, bebida
Alfredo → queso extra, extra salsa, bebida
Bolonesa/Pomodoro → queso extra, bebida
Pesto → pollo, camarones, bebida
Yakisoba/Pad Thai → agrandada, bebida
Delivery → bebida o postre

Solo 1 intento. Si rechaza: "Dale." y avanzar.

==================================================
FORMATO RESUMEN
==================================================

"Perfecto 😊 Te resumo:
- [producto]: $[precio]
- Envío: se calcula según tu dirección (se suma al total)
Total productos: $[subtotal]
Confirmamos?"

Si está cerrado/antes de apertura, agregar:
"Tu pedido entra en fila para cuando abramos a las 11:45 🍝"

==================================================
JSON DE CONFIRMACIÓN
==================================================

Cuando el cliente confirme (sí, dale, ok, listo, va, etc.),
responder ÚNICAMENTE con este JSON, sin ningún texto antes ni después:

{"accion":"PEDIDO_CONFIRMADO","items":[{"title":"NOMBRE","quantity":1,"unit_price":0}],"delivery":true,"direccion_calle":"CALLE","direccion_numero":"NUMERO","direccion_comuna":"COMUNA","direccion_interior":"","nombre":"NOMBRE","telefono":"TELEFONO","agendado":false}

REGLAS DEL JSON:
- "delivery": true si es delivery, false si es retiro
- "agendado": false si abierto, true si cerrado/antes apertura
- Si retiro: dejar campos de dirección vacíos
- "direccion_comuna": poner lo que dijo el cliente. Si dijo "Santiago" o "stgo" → "Santiago".
- NUNCA texto antes ni después del JSON

==================================================
REGLAS ABSOLUTAS
==================================================

1. Nunca inventar precios
2. Nunca decir "pago confirmado"
3. Nunca aceptar contra entrega ni efectivo
4. Máximo 2-3 líneas por mensaje
5. Una pregunta a la vez
`;

function buildSystemPrompt() {
  return MARCO_PROMPT_BASE.replace('{{CONTEXTO_HORARIO}}', contextoHorario());
}

// ── OPENAI ────────────────────────────────────────────────────────────────────
function llamarOpenAI(mensajes) {
  return new Promise(function(resolve, reject) {
    var body = JSON.stringify({
      model: 'gpt-4o-mini',
      messages: mensajes,
      temperature: 0.4,
      max_tokens: 500
    });
    var options = {
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + OPENAI_API_KEY,
        'Content-Length': Buffer.byteLength(body)
      }
    };
    var req = https.request(options, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try {
          var json = JSON.parse(data);
          if (json.choices && json.choices[0]) {
            resolve(json.choices[0].message.content.trim());
          } else {
            reject(new Error('Sin choices: ' + data));
          }
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── PROCESAR MENSAJE ENTRANTE ─────────────────────────────────────────────────
async function procesarMensaje(from, texto) {
  if (!conversaciones[from]) {
    conversaciones[from] = { mensajes: [], ultimaActividad: Date.now() };
  }
  var conv = conversaciones[from];
  conv.ultimaActividad = Date.now();
  conv.mensajes.push({ role: 'user', content: texto });

  var mensajesOpenAI = [{ role: 'system', content: buildSystemPrompt() }]
    .concat(conv.mensajes.slice(-20));

  try {
    var respuesta = await llamarOpenAI(mensajesOpenAI);
    console.log('[MARCO]', respuesta.substring(0, 120));
    conv.mensajes.push({ role: 'assistant', content: respuesta });

    // Detectar JSON de pedido confirmado
    var jsonMatch = respuesta.match(/\{[\s\S]*"accion"\s*:\s*"PEDIDO_CONFIRMADO"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        var pedido = JSON.parse(jsonMatch[0]);

        // Normalizar comuna
        if (pedido.direccion_comuna) {
          pedido.direccion_comuna = normalizarComuna(pedido.direccion_comuna);
        }

        // Validar datos mínimos para delivery
        if (pedido.delivery) {
          if (!pedido.direccion_calle || !pedido.direccion_numero) {
            await enviarMensaje(from, '¿Cuál es la dirección exacta (calle y número)? 😊');
            return;
          }
          if (!pedido.direccion_comuna) {
            await enviarMensaje(from, '¿En qué comuna es la entrega? Por ejemplo: Santiago Centro, Providencia, Las Condes... 😊');
            return;
          }
        }

        procesarPedidoConfirmado(pedido, from).catch(function(e) {
          console.error('[MARCO] Error background:', e.message);
        });
        return;
      } catch(e) {
        console.error('[MARCO] JSON inválido:', e.message);
        await enviarMensaje(from, 'Hubo un problema con tu pedido. ¿Podemos intentarlo de nuevo?');
        return;
      }
    }

    await enviarMensaje(from, respuesta);
  } catch(err) {
    console.error('[MARCO] Error OpenAI:', err.message);
    await enviarMensaje(from, 'Tuve un problema técnico. ¿Puedes repetir tu mensaje?');
  }
}

// Limpiar conversaciones inactivas cada 30 min
setInterval(function() {
  var ahora = Date.now();
  var limite = 2 * 60 * 60 * 1000;
  Object.keys(conversaciones).forEach(function(key) {
    if (ahora - conversaciones[key].ultimaActividad > limite) {
      delete conversaciones[key];
    }
  });
}, 30 * 60 * 1000);

// ── SERVIDOR HTTP ─────────────────────────────────────────────────────────────
var server = http.createServer(function(req, res) {
  if (req.method === 'GET') {
    var url = new URL(req.url, 'http://localhost');
    if (url.searchParams.get('hub.mode') === 'subscribe' &&
        url.searchParams.get('hub.verify_token') === VERIFY_TOKEN) {
      res.writeHead(200);
      res.end(url.searchParams.get('hub.challenge'));
    } else {
      res.writeHead(403);
      res.end('Forbidden');
    }
    return;
  }

  if (req.method === 'POST') {
    var chunks = [];
    req.on('data', function(c) { chunks.push(c); });
    req.on('end', function() {
      res.writeHead(200);
      res.end('OK');
      try {
        var body = JSON.parse(Buffer.concat(chunks).toString());
        if (body.object !== 'whatsapp_business_account') return;
        var messages = body.entry &&
          body.entry[0] &&
          body.entry[0].changes &&
          body.entry[0].changes[0] &&
          body.entry[0].changes[0].value &&
          body.entry[0].changes[0].value.messages;
        if (!messages || !messages[0] || messages[0].type !== 'text') return;
        var msg = messages[0];
        console.log('[MSG]', msg.from, ':', msg.text.body);
        procesarMensaje(msg.from, msg.text.body).catch(function(e) {
          console.error('[MSG] Error:', e.message);
        });
      } catch(e) {
        console.error('[WEBHOOK] Error:', e.message);
      }
    });
    return;
  }

  res.writeHead(405);
  res.end('Method Not Allowed');
});

var PORT = process.env.PORT || 3000;
server.listen(PORT, function() {
  console.log('Pasta Al Vuelo v3.8 | Puerto', PORT);
  console.log('Geocoding:', GOOGLE_MAPS_KEY ? 'ACTIVO' : 'SIN KEY');
  console.log('Ecommerce:', EXTERNAL_CHECKOUT_URL);
});
