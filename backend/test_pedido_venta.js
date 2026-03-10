// Centum ERP - POST /PedidosVenta - Working example
// CONFIRMED WORKING: Creates PedidoVenta (Sales Order) in Centum ERP
//
// Endpoint: POST {BASE_URL}/PedidosVenta
// Returns: 201 with { IdPedidoVenta, NumeroDocumento, ... }
//
// Required header fields:
//   Cliente: { IdCliente: number }
//   FechaDocumento: string (YYYY-MM-DD)
//   FechaEntrega: string (YYYY-MM-DD)
//   CondicionVenta: { IdCondicionVenta: number }
//   ListaPrecio: { IdListaPrecio: number }
//   Vendedor: { IdVendedor: number }
//   TurnoEntrega: { IdTurnoEntrega: number } -- only 8782 (NORMAL) is active
//
// Required item fields (array key: PedidoVentaArticulos):
//   IdArticulo: number
//   Codigo: string
//   Nombre: string
//   Cantidad: number
//   Precio: number (unit price, net)
//   CategoriaImpuestoIVA: { IdCategoriaImpuestoIVA: number, Tasa: number }
//   Descuento1: number (0 for no discount)
//   Descuento2: number
//   Descuento3: number
//   DescuentoPromocion: number
//
// Optional fields: Transporte, MonedaVenta, Bonificacion, SeccionSucursal,
//   Observacion, Nota, Rubro, UnidadNivel1, CostoReposicion

require("dotenv").config();
const crypto = require("crypto");

const BASE_URL = process.env.CENTUM_BASE_URL;
const API_KEY = process.env.CENTUM_API_KEY;
const CONSUMER_ID = process.env.CENTUM_CONSUMER_ID || "2";

function generateAccessToken(key) {
  const now = new Date();
  const d = now.getUTCFullYear()+"-"+String(now.getUTCMonth()+1).padStart(2,"0")+"-"+String(now.getUTCDate()).padStart(2,"0")+"T"+String(now.getUTCHours()).padStart(2,"0")+":"+String(now.getUTCMinutes()).padStart(2,"0")+":"+String(now.getUTCSeconds()).padStart(2,"0");
  const uuid = crypto.randomUUID().replace(/-/g,"").toLowerCase();
  const hash = crypto.createHash("sha1").update(d+" "+uuid+" "+key,"utf8").digest("hex").toUpperCase();
  return d+" "+uuid+" "+hash;
}

function getHeaders() {
  return {
    "Content-Type": "application/json",
    CentumSuiteConsumidorApiPublicaId: CONSUMER_ID,
    CentumSuiteAccessToken: generateAccessToken(API_KEY),
  };
}

async function crearPedidoVenta() {
  const body = {
    Cliente: { IdCliente: 2 },
    FechaDocumento: "2026-03-01",
    FechaEntrega: "2026-03-02",
    CondicionVenta: { IdCondicionVenta: 14 },
    ListaPrecio: { IdListaPrecio: 1 },
    Vendedor: { IdVendedor: 2 },
    TurnoEntrega: { IdTurnoEntrega: 8782 },
    PedidoVentaArticulos: [{
      IdArticulo: 6155,
      Codigo: "06154",
      Nombre: "ACEITE DE OLIVA V.E. ORIGINAL",
      Cantidad: 1,
      Precio: 32726.87,
      CategoriaImpuestoIVA: { IdCategoriaImpuestoIVA: 4, Tasa: 21 },
      Descuento1: 0,
      Descuento2: 0,
      Descuento3: 0,
      DescuentoPromocion: 0
    }]
  };

  console.log("Creating PedidoVenta...");
  console.log("Body:", JSON.stringify(body, null, 2));

  const res = await fetch(BASE_URL + "/PedidosVenta", {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(body),
  });

  const text = await res.text();
  console.log("[" + res.status + "]", text.slice(0, 3000));
}

crearPedidoVenta().catch(console.error);