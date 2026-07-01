require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');

const app = express();

// CORS — permite peticiones desde la app (http://localhost) y cualquier origen
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PAYPHONE_TOKEN    = process.env.PAYPHONE_TOKEN;
const PAYPHONE_STORE_ID = process.env.PAYPHONE_STORE_ID;
const N8N_CONFIRMAR     = process.env.N8N_URL_CONFIRMAR;
const PORT              = process.env.PORT || 3000;

// ─── Almacén de sesiones en memoria ───────────────────────────────────────────
// session_id → { status, factura, monto, clientTxId, payphoneId, ts }
const sessions = new Map();

// Limpia sesiones de más de 30 minutos
setInterval(() => {
  const ahora = Date.now();
  for (const [id, s] of sessions) {
    if (ahora - s.ts > 30 * 60 * 1000) sessions.delete(id);
  }
}, 5 * 60 * 1000);

// ─── GET /pagar ───────────────────────────────────────────────────────────────
// App abre: https://pago.sisnetel.com/pagar?session=XYZ&monto=2500&factura=48577
app.get('/pagar', (req, res) => {
  const { session, monto, factura } = req.query;

  if (!session || !monto || !factura) {
    return res.status(400).send(paginaError('Parámetros inválidos. Vuelve a la app.'));
  }

  if (!PAYPHONE_TOKEN || !PAYPHONE_STORE_ID) {
    return res.status(500).send(paginaError('Configuración del servidor incompleta.'));
  }

  const clientTxId = `sisnetel_${Date.now()}_${Math.floor(Math.random() * 999)}`;
  const montoInt   = parseInt(monto); // en centavos
  const montoUSD   = (montoInt / 100).toFixed(2);

  // Guardar sesión
  sessions.set(session, {
    status: 'pendiente',
    factura,
    monto: montoInt,
    clientTxId,
    payphoneId: null,
    ts: Date.now(),
  });

  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <title>Pago Sisnetel</title>
  <link rel="stylesheet" href="https://cdn.payphonetodoesposible.com/box/v1.1/payphone-payment-box.css" />
  <script type="module" src="https://cdn.payphonetodoesposible.com/box/v1.1/payphone-payment-box.js" id="pp-sdk"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f0f4f8;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 28px 24px;
      max-width: 380px;
      width: 100%;
      box-shadow: 0 4px 20px rgba(0,0,0,0.08);
    }
    .logo {
      text-align: center;
      margin-bottom: 20px;
    }
    .logo-text {
      font-size: 20px;
      font-weight: 700;
      color: #1a56db;
      letter-spacing: -0.5px;
    }
    .divider {
      border: none;
      border-top: 1px solid #e5e7eb;
      margin: 16px 0;
    }
    .monto-label {
      text-align: center;
      color: #6b7280;
      font-size: 13px;
      margin-bottom: 4px;
    }
    .monto {
      text-align: center;
      font-size: 36px;
      font-weight: 700;
      color: #111827;
      margin-bottom: 6px;
    }
    .factura-badge {
      text-align: center;
      display: inline-block;
      width: 100%;
      font-size: 13px;
      color: #6b7280;
      margin-bottom: 20px;
    }
    #pp-button-container { margin-top: 8px; }
    .aviso {
      text-align: center;
      font-size: 12px;
      color: #9ca3af;
      margin-top: 16px;
    }

    /* Overlay de procesando — bloquea toda la UI */
    .overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(17, 24, 39, 0.85);
      z-index: 9999;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 20px;
      color: white;
    }
    .overlay.visible { display: flex; }
    .spinner {
      width: 52px; height: 52px;
      border: 5px solid rgba(255,255,255,0.25);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 0.9s linear infinite;
    }
    .overlay-titulo { font-size: 20px; font-weight: 600; }
    .overlay-sub { font-size: 13px; opacity: 0.7; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>

  <div class="card">
    <div class="logo">
      <div class="logo-text">🌐 Sisnetel</div>
    </div>
    <hr class="divider">
    <div class="monto-label">Total a pagar</div>
    <div class="monto">$${montoUSD}</div>
    <div class="factura-badge">Factura #${factura}</div>
    <div id="pp-button-container"></div>
    <div class="aviso">🔒 Pago seguro con Payphone</div>
  </div>

  <!-- Overlay bloqueante durante procesamiento -->
  <div class="overlay" id="overlay">
    <div class="spinner"></div>
    <div class="overlay-titulo">Procesando pago...</div>
    <div class="overlay-sub">No cierres esta ventana</div>
  </div>

  <script>
    function initPayphone() {
      var widget = new window.PPaymentButtonBox({
        token: '${PAYPHONE_TOKEN}',
        amount: ${montoInt},
        amountWithoutTax: ${montoInt},
        currency: 'USD',
        storeId: '${PAYPHONE_STORE_ID}',
        clientTransactionId: '${clientTxId}',
        reference: '${factura}',
        lang: 'es',
        responseUrl: 'https://nuevo-payphonesisnetel.u5r75b.easypanel.host/confirmacion',
        cancellationUrl: 'https://nuevo-payphonesisnetel.u5r75b.easypanel.host/cancelar',
      });
      widget.render('pp-button-container');
    }

    // type="module" carga asíncrono — esperar con window.onload
    window.addEventListener('load', function() {
      // Pequeño delay para asegurar que el módulo ES registró PPaymentButtonBox
      setTimeout(initPayphone, 300);
    });

    // El overlay se activa solo cuando Payphone redirige (via MutationObserver en el título)
    // No usamos click listener para evitar bloquear la entrada del número celular
  </script>
</body>
</html>`);
});

// ─── GET /api/estado ──────────────────────────────────────────────────────────
// App consulta tras recibir el deep link para saber si el pago fue aprobado
app.get('/api/estado', (req, res) => {
  const { session } = req.query;
  if (!session || !sessions.has(session)) {
    return res.status(404).json({ status: 'no_encontrado' });
  }
  const s = sessions.get(session);
  res.json({
    status:    s.status,
    factura:   s.factura,
    monto:     s.monto,
    payphoneId: s.payphoneId,
    clientTxId: s.clientTxId,
  });
});

// ─── POST /api/confirmar ──────────────────────────────────────────────────────
// App envía id + clientTxId recibidos del deep link para confirmar y activar
app.post('/api/confirmar', async (req, res) => {
  const { session, id, clientTxId } = req.body;

  if (!id || !clientTxId) {
    return res.status(400).json({ ok: false, error: 'Parámetros requeridos: id, clientTxId' });
  }

  try {
    // 1. Verificar transacción directamente con Payphone
    const ppRes = await fetch(
      `https://pay.payphonetodoesposible.com/api/v1/transaction?id=${Number(id)}&clientTransactionId=${clientTxId}`,
      { headers: { 'Authorization': `Bearer ${PAYPHONE_TOKEN}` } }
    );
    const ppData = await ppRes.json();
    console.log('Payphone verify:', JSON.stringify(ppData));

    const aprobado = ppData.statusCode === 3 || ppData.transactionStatus === 'Approved';

    // 2. Marcar sesión
    if (session && sessions.has(session)) {
      sessions.get(session).status = aprobado ? 'aprobado' : 'rechazado';
      sessions.get(session).payphoneId = id;
    }

    // 3. Si aprobado, notificar a N8N para activar en Mikrowisp
    if (aprobado && N8N_CONFIRMAR) {
      fetch(N8N_CONFIRMAR, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: Number(id), clientTxId, ...ppData }),
      }).catch(err => console.error('Error notificando N8N:', err));
    }

    res.json(ppData);
  } catch (err) {
    console.error('Error confirmando con Payphone:', err);
    res.status(500).json({ ok: false, error: 'Error al confirmar el pago' });
  }
});

// ─── GET /confirmacion ────────────────────────────────────────────────────────
// Payphone redirige aquí tras el pago → actualizamos sesión y redirigimos a la app
app.get('/confirmacion', async (req, res) => {
  const { id, clientTransactionId } = req.query;
  if (!id || !clientTransactionId) {
    return res.send(paginaError('Parámetros de confirmación inválidos.'));
  }

  // Buscar sesión por clientTxId y marcarla como aprobada
  for (const [, s] of sessions) {
    if (s.clientTxId === clientTransactionId) {
      s.status    = 'aprobado';
      s.payphoneId = id;
      break;
    }
  }

  // Verificar con Payphone y notificar N8N en background
  try {
    const ppRes = await fetch(
      `https://pay.payphonetodoesposible.com/api/v1/transaction?id=${Number(id)}&clientTransactionId=${clientTransactionId}`,
      { headers: { 'Authorization': `Bearer ${PAYPHONE_TOKEN}` } }
    );
    const ppData = await ppRes.json();
    const aprobado = ppData.statusCode === 3 || ppData.transactionStatus === 'Approved';
    if (aprobado && N8N_CONFIRMAR) {
      fetch(N8N_CONFIRMAR, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: Number(id), clientTxId: clientTransactionId, ...ppData }),
      }).catch(() => {});
    }
  } catch (e) { console.error('Error verificando en /confirmacion:', e); }
  const deepLink   = `sisnetel://confirmacion?id=${id}&clientTransactionId=${clientTransactionId}`;
  const intentLink = `intent://confirmacion?id=${id}&clientTransactionId=${clientTransactionId}#Intent;scheme=sisnetel;package=com.sisnetel.app;end`;
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Redirigiendo...</title>
</head>
<body style="font-family:sans-serif;text-align:center;padding:40px;background:#f0f4f8;">
  <p style="font-size:18px;">✅ Pago procesado.<br>Volviendo a la aplicación...</p>
  <script>
    // intent:// funciona en Chrome Custom Tab (Android)
    try {
      window.location.href = '${intentLink}';
    } catch(e) {
      window.location.href = '${deepLink}';
    }
    // Fallback con delay
    setTimeout(function() {
      try { window.location.href = '${intentLink}'; } catch(e) {}
      setTimeout(function() { window.location.href = '${deepLink}'; }, 500);
    }, 800);
  </script>
</body>
</html>`);
});

// ─── GET /cancelar ────────────────────────────────────────────────────────────
app.get('/cancelar', (req, res) => {
  const intentLink = `intent://cancelar#Intent;scheme=sisnetel;package=com.sisnetel.app;end`;
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Pago cancelado</title>
</head>
<body style="font-family:sans-serif;text-align:center;padding:40px;background:#f0f4f8;">
  <p style="font-size:18px;">❌ Pago cancelado.<br>Volviendo a la aplicación...</p>
  <script>
    try { window.location.href = '${intentLink}'; } catch(e) {}
    setTimeout(function() {
      try { window.location.href = '${intentLink}'; } catch(e) {}
      setTimeout(function() { window.location.href = 'sisnetel://cancelar'; }, 500);
    }, 800);
  </script>
</body>
</html>`);
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`✅ Payphone backend corriendo en puerto ${PORT}`);
});
