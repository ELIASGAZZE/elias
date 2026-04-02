import json

with open(r"C:\Users\Elias\.claude\projects\C--Users-Elias\69516fc2-8301-45df-ada9-98ce3fa697bf\tool-results\mcp-claude_ai_padano_srl-pos_listar_ventas-1774612429222.txt", "r", encoding="utf-8") as f:
    data = json.load(f)

text = data[0]["text"]
result = json.loads(text)
ventas = result if isinstance(result, list) else result.get("ventas", result.get("data", []))

print(f"Total ventas 26/03: {len(ventas)}")

no_sync = [v for v in ventas if not v.get("centum_sync")]
print(f"Ventas sin sincronizar a Centum: {len(no_sync)}")
print()
for v in no_sync:
    nv = v.get("numero_venta", "?")
    ca = v.get("created_at", "")[:19]
    t = v.get("total", 0)
    nc = (v.get("nombre_cliente") or "?")[:35]
    err = (v.get("centum_error") or "")[:70]
    print(f"  #{nv} | {ca} | ${t:,.0f} | {nc} | {err}")
