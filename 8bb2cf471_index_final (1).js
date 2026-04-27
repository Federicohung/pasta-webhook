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
  'lo espejo': 'Lo Espejo', 'el bosque': 'El Bosque',
  'san ramon': 'San Ramón', 'san ramón': 'San Ramón',
  'la cisterna': 'La Cisterna', 'cerrillos': 'Cerrillos',
  'maipu': 'Maipú', 'maipú': 'Maipú',
  'estacion central': 'Estación Central', 'estación central': 'Estación Central', 'est central': 'Estación Central',
  'cerro navia': 'Cerro Navia', 'quinta normal': 'Quinta Normal', 'renca': 'Renca',
  'independencia': 'Independencia', 'recoleta': 'Recoleta',
  'conchali': 'Conchalí', 'conchalí': 'Conchalí',
  'huechuraba': 'Huechuraba', 'pudahuel': 'Pudahuel', 'quilicura': 'Quilicura',
  'lo barnechea': 'Lo Barnechea', 'san bernardo': 'San Bernardo',
  'puente alto': 'Puente Alto', 'la granja': 'La Granja', 'lo prado': 'Lo Prado',
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
  var p = str.split(':');
  var h = parseInt(p[0], 10), m = parseInt(p[1], 10);
  return { totalMinutos: h * 60 + m, str: (h<10?'0':'')+h+':'+(m<10?'0':'')+m };
}

var APERTURA=11*60+45, CIERRE_DELIVERY=17*60+45, CIERRE_ZENTENO=18*60, CIERRE_PROV=21*60;

function estadoHorario() {
  var tm = horaChile().totalMinutos;
  if (tm < APERTURA)                                return 'ANTES_DE_APERTURA';
  if (tm >= APERTURA && tm < CIERRE_DELIVERY)       return 'ABIERTO_DELIVERY_Y_RETIRO';
  if (tm >= CIERRE_DELIVERY && tm < CIERRE_ZENTENO) return 'SOLO_RETIRO_ZENTENO_Y_PROVIDENCIA';
  if (tm >= CIERRE_ZENTENO && tm < CIERRE_PROV)     return 'SOLO_RETIRO_PROVIDENCIA';
  return 'CERRADO_TOTAL';
}

function contextoHorario() {
  var t = horaChile(), estado = estadoHorario();
  return [
    '==================================================',
    'HORA CHILE: ' + t.str + ' | ESTADO: ' + estado,
    '',
    'ANTES_DE_APERTURA / CERRADO_TOTAL:',
    '  Tomar pedido normal. JSON con "agendado":true.',
    '  Resumen: agregar "Tu pedido entra en fila para cuando abramos a las 11:45 🍝"',
    '',
    'ABIERTO_DELIVERY_Y_RETIRO: normal. JSON con "agendado":false.',
    'SOLO_RETIRO_ZENTENO_Y_PROVIDENCIA: delivery cerrado.',
    'SOLO_RETIRO_PROVIDENCIA: solo retiro Providencia.',
    '==================================================',
  ].join('\n');
}

// ── GEOCODING ─────────────────────────────────────────────────────────────────
function geocodificarDireccion(calle, numero, comuna) {
  return new Promise(function(resolve) {
    if (!GOOGLE_MAPS_KEY) { console.warn('[GEOCODE] Sin key'); return resolve(null); }
    var query = encodeURIComponent(calle + ' ' + numero + ', ' + comuna + ', Chile');
    var url = 'https://maps.googleapis.com/maps/api/geocode/json?address=' + query + '&key=' + GOOGLE_MAPS_KEY;
    https.get(url, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try {
          var json = JSON.parse(data);
          if (json.status === 'OK' && json.results[0]) {
            var loc = json.results[0].geometry.location;
            console.log('[GEOCODE] OK lat:', loc.lat, 'lng:', loc.lng, '|', json.results[0].formatted_address);
            resolve({ lat: loc.lat, lng: loc.lng });
          } else { console.warn('[GEOCODE] Estado:', json.status); resolve(null); }
        } catch(e) { console.error('[GEOCODE] Error:', e.message); resolve(null); }
      });
    }).on('error', function(e) { console.error('[GEOCODE] Error http:', e.message); resolve(null); });
  });
}

// ── COTIZAR ENVÍO ─────────────────────────────────────────────────────────────
function cotizarEnvio(lat, lng) {
  return new Promise(function(resolve) {
    var body = JSON.stringify({ destination: { lat: lat, lng: lng } });
    var options = {
      hostname: 'www.pastaalvuelo.com', path: '/api/shipping/estimate', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    var req = https.request(options, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try {
          var json = JSON.parse(data);
          if (json.success && json.shippingCost) {
            console.log('[ENVIO] $' + json.shippingCost + ' | ' + json.distanceKm + 'km | withinCoverage:' + json.withinCoverage);
            resolve({
              shippingCost: json.shippingCost, distanceKm: json.distanceKm,
              withinCoverage: json.withinCoverage,
              deliveryOfferId: json.selectedOffer ? json.selectedOffer.deliveryOfferId : null,
              shippingEstimateId: json.shippingEstimateId || null
            });
          } else { console.warn('[ENVIO] Sin costo:', JSON.stringify(json)); resolve(null); }
        } catch(e) { console.error('[ENVIO] Error:', e.message); resolve(null); }
      });
    });
    req.on('error', function(e) { console.error('[ENVIO] Error http:', e.message); resolve(null); });
    req.write(body);
    req.end();
  });
}

// ── WHATSAPP: mensaje simple ──────────────────────────────────────────────────
function enviarMensaje(to, texto) {
  return new Promise(function(resolve, reject) {
    var body = JSON.stringify({ messaging_product:'whatsapp', to:to, type:'text', text:{body:texto} });
    var options = {
      hostname: 'graph.facebook.com', path: '/v18.0/' + PHONE_NUMBER_ID + '/messages', method: 'POST',
      headers: { 'Content-Type':'application/json', 'Authorization':'Bearer '+WHATSAPP_ACCESS_TOKEN, 'Content-Length':Buffer.byteLength(body) }
    };
    var req = https.request(options, function(res) {
      var data=''; res.on('data',function(c){data+=c;}); res.on('end',function(){resolve(data);});
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

// ── WHATSAPP: botón CTA nativo ────────────────────────────────────────────────
function enviarBotonPago(to, textoBody, labelBoton, url) {
  return new Promise(function(resolve) {
    var body = JSON.stringify({
      messaging_product: 'whatsapp', to: to, type: 'interactive',
      interactive: {
        type: 'cta_url',
        body: { text: textoBody },
        action: { name: 'cta_url', parameters: { display_text: labelBoton, url: url } }
      }
    });
    var options = {
      hostname: 'graph.facebook.com', path: '/v18.0/' + PHONE_NUMBER_ID + '/messages', method: 'POST',
      headers: { 'Content-Type':'application/json', 'Authorization':'Bearer '+WHATSAPP_ACCESS_TOKEN, 'Content-Length':Buffer.byteLength(body) }
    };
    var req = https.request(options, function(res) {
      var data=''; res.on('data',function(c){data+=c;}); res.on('end',function(){
        try {
          var json = JSON.parse(data);
          if (json.error) {
            console.warn('[CTA] Fallback texto. Error:', json.error.message);
            enviarMensaje(to, textoBody + '\n\n' + url).then(resolve).catch(resolve);
          } else { console.log('[CTA] Botón enviado OK'); resolve(data); }
        } catch(e) { enviarMensaje(to, textoBody+'\n\n'+url).then(resolve).catch(resolve); }
      });
    });
    req.on('error', function() { enviarMensaje(to, textoBody+'\n\n'+url).then(resolve).catch(resolve); });
    req.write(body); req.end();
  });
}

// ── ECOMMERCE ─────────────────────────────────────────────────────────────────
function llamarExternalCheckout(payload) {
  return new Promise(function(resolve, reject) {
    var body = JSON.stringify(payload);
    var urlObj = new URL(EXTERNAL_CHECKOUT_URL);
    var options = {
      hostname: urlObj.hostname, path: urlObj.pathname, method: 'POST',
      headers: { 'Content-Type':'application/json', 'x-webhook-secret':EXTERNAL_CHECKOUT_SECRET, 'x-source':'whatsapp-marco', 'Content-Length':Buffer.byteLength(body) }
    };
    var req = https.request(options, function(res) {
      var data=''; res.on('data',function(c){data+=c;}); res.on('end',function(){
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

// ── COTIZAR Y MOSTRAR RESUMEN AL CLIENTE ──────────────────────────────────────
// Se llama cuando Marco emite PEDIDO_LISTO_PARA_COTIZAR.
// 1. Geocodifica la dirección
// 2. Cotiza el envío
// 3. Envía resumen al cliente con costo real
// 4. Guarda el costo en la conversación para cuando el cliente confirme
async function cotizarYMostrarResumen(pedido, from) {
  var conv = conversaciones[from];
  if (!conv) return;

  var subtotal = pedido.items.reduce(function(acc, i) {
    return acc + (Number(i.unit_price) * Number(i.quantity));
  }, 0);

  var shippingCost = 0;
  var shippingEstimateId = null;
  var deliveryOfferId = null;
  var fueraDeCobertura = false;

  if (pedido.delivery && pedido.direccion_calle && pedido.direccion_numero) {
    var comunaGeo = normalizarComuna(pedido.direccion_comuna || 'Santiago');
    console.log('[RESUMEN] Geocodificando para resumen:', pedido.direccion_calle, pedido.direccion_numero, comunaGeo);

    var coords = await geocodificarDireccion(pedido.direccion_calle, pedido.direccion_numero, comunaGeo);
    if (coords) {
      var cotizacion = await cotizarEnvio(coords.lat, coords.lng);
      if (cotizacion && cotizacion.withinCoverage) {
        shippingCost = cotizacion.shippingCost;
        shippingEstimateId = cotizacion.shippingEstimateId;
        deliveryOfferId = cotizacion.deliveryOfferId;
        console.log('[RESUMEN] Costo envío cotizado: $' + shippingCost);
      } else {
        fueraDeCobertura = true;
        console.warn('[RESUMEN] Fuera de cobertura o sin cotización');
      }
    } else {
      // Geocoding falló → costo fijo
      shippingCost = 2990;
      console.warn('[RESUMEN] Geocoding falló → costo fijo $2.990');
    }
  }

  if (fueraDeCobertura) {
    await enviarMensaje(from,
      'Lo siento 😕 tu dirección queda fuera de nuestra zona de delivery por ahora.\n' +
      '¿Preferirías pasar a buscarla? Zenteno 181 o Providencia 202 😊'
    );
    return;
  }

  var total = subtotal + shippingCost;

  // Guardar datos cotizados en la conversación para el paso de confirmación
  conv.pedidoPendiente = {
    pedido: pedido,
    shippingCost: shippingCost,
    shippingEstimateId: shippingEstimateId,
    deliveryOfferId: deliveryOfferId,
    subtotal: subtotal,
    total: total
  };
  conv.esperandoConfirmacion = true;

  // Armar resumen con costos reales
  var lineas = pedido.items.map(function(i) {
    return '• ' + i.title + ' x' + i.quantity + ': $' + (Number(i.unit_price) * Number(i.quantity)).toLocaleString('es-CL');
  });

  var resumen = 'Perfecto 😊 Te confirmo el resumen:\n\n';
  resumen += lineas.join('\n') + '\n';

  if (pedido.delivery) {
    resumen += '• Envío a ' + (pedido.direccion_calle + ' ' + pedido.direccion_numero + ', ' + normalizarComuna(pedido.direccion_comuna || '')) + ': $' + shippingCost.toLocaleString('es-CL') + '\n';
  } else {
    resumen += '• Retiro en local (sin costo de envío)\n';
  }

  resumen += '\n*Total: $' + total.toLocaleString('es-CL') + '*';

  if (pedido.agendado) {
    resumen += '\n\nTu pedido entra en fila para cuando abramos a las 11:45 🍝';
  }

  resumen += '\n\n¿Confirmamos?';

  await enviarMensaje(from, resumen);
}

// ── CONFIRMAR PEDIDO Y COBRAR ─────────────────────────────────────────────────
// Se llama cuando el cliente dice sí/dale/ok después del resumen con costos reales.
async function confirmarYCobrar(from) {
  var conv = conversaciones[from];
  if (!conv || !conv.pedidoPendiente) return false;

  var datos = conv.pedidoPendiente;
  var pedido = datos.pedido;
  conv.pedidoPendiente = null;
  conv.esperandoConfirmacion = false;

  try {
    // Solo productos — el envío va en shipping_cost, NO como ítem adicional.
    // El ecommerce (create-preference) lo agrega desde shipping_cost para evitar doble cobro.
    var itemsCheckout = pedido.items.slice();

    var payload = {
      external_order_id: 'WA-' + from + '-' + Date.now(),
      cliente_nombre: pedido.nombre || 'Cliente WhatsApp',
      cliente_email: '',
      cliente_telefono: from,
      metodo_entrega: pedido.delivery ? 'delivery' : 'retiro',
      direccion_calle: pedido.direccion_calle || '',
      direccion_numero: pedido.direccion_numero || '',
      direccion_comuna: normalizarComuna(pedido.direccion_comuna || ''),
      direccion_interior: pedido.direccion_interior || '',
      horario_entrega: 'Lo antes posible',
      items: itemsCheckout,
      subtotal: datos.subtotal,
      shipping_cost: datos.shippingCost,
      shipping_provider: pedido.delivery ? 'PEDIDOSYA' : null,
      total: datos.total,
      notas: pedido.agendado ? 'PEDIDO AGENDADO - entra en fila para apertura' : '',
      source: 'whatsapp_marco',
      pago_modalidad: 'prepagado_online',
      collect: false,
      cash_on_delivery: false,
      pedidosya_estimate_id: datos.shippingEstimateId,
      pedidosya_offer_id: datos.deliveryOfferId
    };

    console.log('[COBRO] total:$' + datos.total + ' envío:$' + datos.shippingCost);
    var resultado = await llamarExternalCheckout(payload);

    if (resultado.success && resultado.payment_url) {
      var nombre = pedido.nombre ? pedido.nombre.split(' ')[0] : '';
      var textoBoton = (nombre ? nombre + ', t' : 'T') + 'u pedido está confirmado 🍝\n' +
        'Toca el botón para pagar de forma segura 🔒';

      await enviarBotonPago(from, textoBoton, 'Pagar ahora', resultado.payment_url);
      console.log('[COBRO] ✅ Botón enviado. Orden:', resultado.numero_orden);
    } else {
      console.error('[COBRO] Error ecommerce:', JSON.stringify(resultado));
      await enviarMensaje(from,
        'Hubo un problema técnico generando el link 😅\nLlámanos al +56 9 3271 4990 y lo solucionamos.'
      );
    }
  } catch(err) {
    console.error('[COBRO] Error:', err.message);
    await enviarMensaje(from, 'Tuvimos un problema técnico 😅 Llámanos al +56 9 3271 4990.');
  }
  return true;
}

// ── PROMPT MARCO v3.9 ─────────────────────────────────────────────────────────
const MARCO_PROMPT_BASE = `[SYSTEM PROMPT / MARCO - PASTA AL VUELO v3.9]

Eres Marco, agente vendedor oficial de Pasta Al Vuelo en WhatsApp.
Atiende de forma humana, premium, breve y comercial.
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
FLUJO DE VENTA — 8 PASOS
==================================================

1. Detectar qué quiere el cliente
2. Confirmar producto + upsell breve (solo 1 intento)
3. Preguntar si agrega algo más
4. Retiro o delivery (según estado horario)
5. Si delivery: pedir calle, número y COMUNA
6. Pedir nombre y teléfono
7. Emitir JSON PEDIDO_LISTO_PARA_COTIZAR — el sistema calculará el costo de envío
   y enviará al cliente el resumen REAL con todos los precios
8. Cuando el cliente confirme el resumen → emitir JSON PEDIDO_CONFIRMADO

IMPORTANTE — DOS JSONS DISTINTOS:
- Paso 7 (recopilar datos): PEDIDO_LISTO_PARA_COTIZAR
- Paso 8 (cliente confirma el resumen con precios): PEDIDO_CONFIRMADO
- Entre paso 7 y 8 el SISTEMA envía el resumen — Marco no lo hace manualmente

==================================================
REGLA — DIRECCIÓN Y COMUNA
==================================================

"Santiago" es ciudad Y es una de sus 52 comunas (el centro histórico).

PEDIR COMUNA si el cliente da solo "Santiago" sin dirección → preguntar:
  "¿En qué comuna? Ej: Santiago Centro, Providencia, Las Condes, Ñuñoa..."

NO PEDIR COMUNA si:
- Ya dio una comuna específica (Providencia, Las Condes, Ñuñoa, San Miguel, etc.)
- Ya dio calle + número + "Santiago" → usar "Santiago" en el JSON. El sistema geocodifica.
- Dijo "Santiago Centro", "el centro", "stgo" → válido, usar "Santiago".

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
JSON PASO 7 — PEDIDO_LISTO_PARA_COTIZAR
==================================================

Cuando tengas productos, dirección completa, nombre y teléfono:
Responder ÚNICAMENTE con este JSON (sin texto antes ni después):

{"accion":"PEDIDO_LISTO_PARA_COTIZAR","items":[{"title":"Carbonara","quantity":1,"unit_price":4990},{"title":"Queso extra","quantity":1,"unit_price":900}],"delivery":true,"direccion_calle":"Avenida Italia","direccion_numero":"123","direccion_comuna":"Providencia","direccion_interior":"","nombre":"Ana","telefono":"56912345678","agendado":false}

==================================================
JSON PASO 8 — PEDIDO_CONFIRMADO
==================================================

Cuando el cliente confirme el resumen (sí, dale, ok, listo, va, etc.):
Responder ÚNICAMENTE con este JSON (sin texto antes ni después):

{"accion":"PEDIDO_CONFIRMADO"}

REGLAS CRÍTICAS DE LOS JSONS:
- "delivery": true=delivery, false=retiro
- "agendado": true si cerrado/antes apertura, false si abierto
- Si retiro: dejar campos dirección vacíos
- unit_price: SIEMPRE el precio real del menú (número entero). NUNCA 0.

PRECIOS (unit_price exacto a usar):
Clásicas=3990 | Premium=4990 | Especialidades=5990
Combos: Clásico=5290 | Premium=6190 | Especialidad=6990 | Para Dos=10190 | Familiar=19900
Postres: Tiramisú=2500 | Tartufo=2500
Extras: Choclo=700 | Champiñones=700 | Tocino=900 | Pollo=1000 | Camarones=1500
  Pasta espinaca=900 | Extra salsa=900 | Queso extra=900 | Agrandada=2200
Bebidas: Coca Cola/Zero=1490 | Fanta=1490 | Sprite/Zero=1490 | Agua=1290 | Jugos=1690
- "direccion_comuna": lo que dijo el cliente. "Santiago"/"stgo"→"Santiago"
- NUNCA texto antes ni después

==================================================
REGLAS ABSOLUTAS
==================================================

1. Nunca inventar precios
2. Nunca decir "pago confirmado"
3. Nunca aceptar contra entrega ni efectivo
4. Máximo 2-3 líneas por mensaje
5. Una pregunta a la vez
6. NO emitir el resumen manualmente — el sistema lo hace con costos reales
`;

function buildSystemPrompt() {
  return MARCO_PROMPT_BASE.replace('{{CONTEXTO_HORARIO}}', contextoHorario());
}

// ── OPENAI ────────────────────────────────────────────────────────────────────
function llamarOpenAI(mensajes) {
  return new Promise(function(resolve, reject) {
    var body = JSON.stringify({ model:'gpt-4o-mini', messages:mensajes, temperature:0.4, max_tokens:500 });
    var options = {
      hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+OPENAI_API_KEY, 'Content-Length':Buffer.byteLength(body) }
    };
    var req = https.request(options, function(res) {
      var data=''; res.on('data',function(c){data+=c;}); res.on('end',function(){
        try {
          var json = JSON.parse(data);
          if (json.choices && json.choices[0]) resolve(json.choices[0].message.content.trim());
          else reject(new Error('Sin choices: '+data));
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

// ── PROCESAR MENSAJE ENTRANTE ─────────────────────────────────────────────────
async function procesarMensaje(from, texto) {
  if (!conversaciones[from]) {
    conversaciones[from] = { mensajes:[], ultimaActividad:Date.now(), esperandoConfirmacion:false, pedidoPendiente:null };
  }
  var conv = conversaciones[from];
  conv.ultimaActividad = Date.now();

  // ── Si hay un resumen pendiente esperando confirmación ────────────────────
  // Detectar si el cliente dice sí/dale/ok antes de llamar a OpenAI
  if (conv.esperandoConfirmacion && conv.pedidoPendiente) {
    var textoNorm = texto.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    var confirmaciones = ['si','sí','dale','ok','listo','va','yes','confirmo','confirmado','claro','perfecto','buenísimo','buenisimo','venga','vamos','eso','de acuerdo'];
    var esConfirmacion = confirmaciones.some(function(c) { return textoNorm === c || textoNorm.startsWith(c+' ') || textoNorm.endsWith(' '+c); });
    if (esConfirmacion) {
      await confirmarYCobrar(from);
      conv.mensajes.push({ role:'user', content:texto });
      conv.mensajes.push({ role:'assistant', content:'[SISTEMA: pedido confirmado y enviado a cobro]' });
      return;
    }
  }

  conv.mensajes.push({ role:'user', content:texto });

  var mensajesOpenAI = [{ role:'system', content:buildSystemPrompt() }].concat(conv.mensajes.slice(-20));

  try {
    var respuesta = await llamarOpenAI(mensajesOpenAI);
    console.log('[MARCO]', respuesta.substring(0, 150));
    conv.mensajes.push({ role:'assistant', content:respuesta });

    // ── Detectar JSON PEDIDO_LISTO_PARA_COTIZAR ───────────────────────────
    var matchCotizar = respuesta.match(/\{[\s\S]*"accion"\s*:\s*"PEDIDO_LISTO_PARA_COTIZAR"[\s\S]*\}/);
    if (matchCotizar) {
      try {
        var pedido = JSON.parse(matchCotizar[0]);
        if (pedido.direccion_comuna) pedido.direccion_comuna = normalizarComuna(pedido.direccion_comuna);
        // Validar que ningún ítem tenga precio cero
        var itemSinPrecio = pedido.items.find(function(i) { return !i.unit_price || Number(i.unit_price) === 0; });
        if (itemSinPrecio) {
          console.error('[MARCO] Ítem sin precio detectado:', JSON.stringify(itemSinPrecio));
          // Pedir a OpenAI que corrija el JSON con el precio real
          conv.mensajes.push({ role:'user', content:'[SISTEMA: ERROR - el ítem "'+itemSinPrecio.title+'" tiene unit_price:0. Debes emitir nuevamente el JSON PEDIDO_LISTO_PARA_COTIZAR con el precio correcto según el menú. La Pomodoro cuesta $4.990, la Carbonara $4.990, etc.]' });
          var msgsCorreccion = [{ role:'system', content:buildSystemPrompt() }].concat(conv.mensajes.slice(-20));
          try {
            var correccion = await llamarOpenAI(msgsCorreccion);
            conv.mensajes.push({ role:'assistant', content:correccion });
            var mCotizar2 = correccion.match(/\{[\s\S]*"accion"\s*:\s*"PEDIDO_LISTO_PARA_COTIZAR"[\s\S]*\}/);
            if (mCotizar2) {
              var pedido2 = JSON.parse(mCotizar2[0]);
              var itemSinPrecio2 = pedido2.items.find(function(i) { return !i.unit_price || Number(i.unit_price) === 0; });
              if (!itemSinPrecio2) {
                if (pedido2.direccion_comuna) pedido2.direccion_comuna = normalizarComuna(pedido2.direccion_comuna);
                await cotizarYMostrarResumen(pedido2, from);
                return;
              }
            }
          } catch(e) { console.error('[MARCO] Error corrección precio:', e.message); }
          await enviarMensaje(from, 'Hubo un error calculando el precio. ¿Puedes repetir tu pedido?');
          return;
        }

        if (pedido.delivery && (!pedido.direccion_calle || !pedido.direccion_numero)) {
          await enviarMensaje(from, '¿Cuál es la dirección exacta (calle y número)? 😊');
          return;
        }
        if (pedido.delivery && !pedido.direccion_comuna) {
          await enviarMensaje(from, '¿En qué comuna es la entrega? Ej: Santiago Centro, Providencia, Las Condes... 😊');
          return;
        }
        // Cotizar y mostrar resumen con costos reales
        await cotizarYMostrarResumen(pedido, from);
        return;
      } catch(e) {
        console.error('[MARCO] JSON COTIZAR inválido:', e.message);
        await enviarMensaje(from, 'Hubo un problema. ¿Podemos intentarlo de nuevo?');
        return;
      }
    }

    // ── Detectar JSON PEDIDO_CONFIRMADO ───────────────────────────────────
    var matchConfirmado = respuesta.match(/\{[\s\S]*"accion"\s*:\s*"PEDIDO_CONFIRMADO"[\s\S]*\}/);
    if (matchConfirmado) {
      if (conv.pedidoPendiente) {
        await confirmarYCobrar(from);
      } else {
        await enviarMensaje(from, 'Parece que no tengo tu pedido guardado. ¿Podrías repetirme qué querías pedir?');
      }
      return;
    }

    // Respuesta normal
    await enviarMensaje(from, respuesta);
  } catch(err) {
    console.error('[MARCO] Error OpenAI:', err.message);
    await enviarMensaje(from, 'Tuve un problema técnico. ¿Puedes repetir tu mensaje?');
  }
}

// Limpiar conversaciones inactivas
setInterval(function() {
  var ahora = Date.now(), limite = 2*60*60*1000;
  Object.keys(conversaciones).forEach(function(key) {
    if (ahora - conversaciones[key].ultimaActividad > limite) delete conversaciones[key];
  });
}, 30*60*1000);

// ── SERVIDOR HTTP ─────────────────────────────────────────────────────────────
var server = http.createServer(function(req, res) {
  if (req.method === 'GET') {
    var url = new URL(req.url, 'http://localhost');
    if (url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === VERIFY_TOKEN) {
      res.writeHead(200); res.end(url.searchParams.get('hub.challenge'));
    } else { res.writeHead(403); res.end('Forbidden'); }
    return;
  }
  if (req.method === 'POST') {
    var chunks = [];
    req.on('data', function(c) { chunks.push(c); });
    req.on('end', function() {
      res.writeHead(200); res.end('OK');
      try {
        var body = JSON.parse(Buffer.concat(chunks).toString());
        if (body.object !== 'whatsapp_business_account') return;
        var messages = body.entry && body.entry[0] && body.entry[0].changes && body.entry[0].changes[0] && body.entry[0].changes[0].value && body.entry[0].changes[0].value.messages;
        if (!messages || !messages[0] || messages[0].type !== 'text') return;
        var msg = messages[0];
        console.log('[MSG]', msg.from, ':', msg.text.body);

        // ── Forward al CRM ────────────────────────────────────────────────
        var CRM_WEBHOOK = process.env.CRM_WEBHOOK_URL || 'https://digiactiva-chile.preview.emergentagent.com/api/whatsapp/webhook?ws=7d2cecb6-8a79-4b3c-89df-d5253a47ef7e';
        if (CRM_WEBHOOK) {
          fetch(CRM_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          }).catch(function(e) { console.error('[CRM] Error forward:', e.message); });
        }
        // ─────────────────────────────────────────────────────────────────

        procesarMensaje(msg.from, msg.text.body).catch(function(e) { console.error('[MSG] Error:', e.message); });
      } catch(e) { console.error('[WEBHOOK] Error:', e.message); }
    });
    return;
  }
  res.writeHead(405); res.end('Method Not Allowed');
});

var PORT = process.env.PORT || 3000;
server.listen(PORT, function() {
  console.log('Pasta Al Vuelo v3.9 | Puerto', PORT);
  console.log('Geocoding:', GOOGLE_MAPS_KEY ? 'ACTIVO ✅' : 'SIN KEY ⚠️');
  console.log('Ecommerce:', EXTERNAL_CHECKOUT_URL);
});
