# Payphone Backend — Sisnetel

Backend seguro para pagos con Payphone. El token de API vive solo en el servidor, nunca en el APK.

## Flujo

```
App → abre /pagar?session=XYZ&monto=2500&factura=48577
     → usuario paga con tarjeta
     → Payphone redirige a sisnetel://confirmacion?id=...
     → Android abre la app con el deep link
     → App llama a /api/confirmar con id + clientTxId
     → Backend llama a N8N → N8N confirma con Payphone → activa en Mikrowisp
```

## Variables de entorno

Copia `.env.example` a `.env` y completa los valores:

```
PAYPHONE_TOKEN=...
PAYPHONE_STORE_ID=...
N8N_URL_CONFIRMAR=...
PORT=3000
```

## Instalación

```bash
npm install
npm start
```

## Rutas

| Ruta | Método | Descripción |
|------|--------|-------------|
| `/pagar` | GET | Página de pago con widget Payphone |
| `/api/confirmar` | POST | Confirma pago y activa cliente |
| `/api/estado` | GET | Consulta estado de sesión |
| `/health` | GET | Health check |
