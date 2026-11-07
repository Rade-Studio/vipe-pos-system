# Regenerates golden_plus.json from the Python renderer in pos/ (the listener this crate replaces).
# Run from the repository root:
#   python3 desktop/core/tests/fixtures/regen.py pos desktop/core/tests/fixtures/golden.json desktop/core/tests/fixtures/golden_plus.json
# It checks every golden.json case against pos/print_renderer.py, then appends the probe_* cases.
import sys, json, datetime as _dt
pos_dir, fixture, out = sys.argv[1], sys.argv[2], sys.argv[3]
sys.path.insert(0, pos_dir)
import print_renderer as pr
doc = json.load(open(fixture))
NOW = _dt.datetime.fromisoformat(doc["now"])
class Fixed(_dt.datetime):
    @classmethod
    def now(cls, tz=None): return NOW
pr.datetime = Fixed
def gen(case):
    enc = case["encoding"]
    if case["kind"] == "invoice":
        r = pr.render_invoice(case["invoiceNumber"], case["invoice"], case["displayItems"])
        b = pr.build_invoice_bytes(case["invoiceNumber"], case["invoice"], case["displayItems"], encoding=enc)
    else:
        r = pr.render_kitchen_order(case["order"])
        b = pr.build_comanda_bytes(case["order"], encoding=enc)
    lines = [l["text"] for l in r["lines"] + r.get("footer", [])]
    return lines, b.hex()
mism = 0
for c in doc["cases"]:
    lines, hx = gen(c)
    if lines != c["lines"] or hx != c["hex"]:
        mism += 1; print("MISMATCH", c["name"], lines == c["lines"], hx == c["hex"])
print("cases", len(doc["cases"]), "mismatches", mism)
# extra independent cases
extra = []
base_inv = doc["cases"][0]
def inv_case(name, invoice, items, number="INV-x"):
    for enc in ("cp1252", "utf-8"):
        c = {"name": f"probe_{name}/{enc}", "kind": "invoice", "encoding": enc, "invoiceNumber": number, "invoice": invoice, "displayItems": items}
        c["lines"], c["hex"] = gen(c); extra.append(c)
def kit_case(name, order):
    for enc in ("cp1252", "utf-8"):
        c = {"name": f"probe_{name}/{enc}", "kind": "command", "encoding": enc, "order": order}
        c["lines"], c["hex"] = gen(c); extra.append(c)
bi = base_inv["invoice"]
inv_case("empty_items", dict(bi), [])
inv_case("long_name_float_qty", dict(bi), [{"name": "Hamburguesa doble con queso cheddar y tocineta ahumada extra", "quantity": 2.5, "price": 12345.5}, {"name": "Café ☕ Ñ", "quantity": 0, "price": 0}])
inv_case("string_number", dict(bi), base_inv["displayItems"], number="12345")
inv_case("transfer_tenders", {**bi, "paymentMethod": "multiple", "tenders": [{"methodKind": "cash", "methodName": "Efectivo", "amount": 5000}, {"methodKind": "transfer", "methodName": "Bancolombia", "amount": 6900}]}, base_inv["displayItems"])
kit_case("many_items_notes", {"invoiceNumber": "abcd1234-ef", "table": 12, "waiter": "Ana María", "items": [{"name": "Ajiaco", "quantity": 3, "comments": "sin ALCAPARRAS por favor"}, {"name": "Limonada de coco 🥥", "quantity": 1}, {"name": "x"*80, "quantity": 10}]})
kit_case("delivery_full", {"invoiceNumber": "q1", "waiter": "Luis", "items": [{"name": "Pizza", "quantity": 1}], "delivery": {"customerName": "Pérez", "phone": "300", "address": "Cra 7", "notes": "timbre dañado"}})
doc["cases"].extend(extra)
json.dump(doc, open(out, "w"), ensure_ascii=False, indent=1)
print("extra", len(extra))
