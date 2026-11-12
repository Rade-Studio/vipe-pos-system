//! Line renderers ported from pos/print_renderer.py (`render_kitchen_order`,
//! `render_invoice` and their helpers). Keep them line-for-line comparable.

use super::py::{self, capitalize, currency, dict, err, get, ljust, ljust_trunc, pystr, rjust, str_or, text, Num};
use super::{format_invoice_date, Align, PrintLine, RenderError};
use chrono::NaiveDateTime;
use serde_json::{Map, Value};

const RULE: &str = "--------------------------------";

fn left(text: impl Into<String>) -> PrintLine {
    PrintLine { text: text.into(), bold: false, align: Align::Left }
}

fn center(text: impl Into<String>) -> PrintLine {
    PrintLine { text: text.into(), bold: false, align: Align::Center }
}

/// Kitchen comanda: `lines + footer` of the Python renderer.
pub fn render_kitchen_order(order: &Value, now: NaiveDateTime) -> Result<Vec<PrintLine>, RenderError> {
    let order = dict(order, "order")?;
    let na = Value::String("N/A".into());
    let empty = Value::Array(vec![]);
    let table = pystr(get(order, "table", &na));
    let waiter = pystr(get(order, "waiter", &na));
    let items = get(order, "items", &empty).as_array().ok_or_else(|| err("items is not a list"))?;
    let delivery = delivery_block(order.get("delivery"));
    let date_str = now.format("%d/%m/%Y %H:%M").to_string();
    // Comanda header: `orderNumber` and `station` are optional (old jobs print as before).
    let title = match order.get("orderNumber").filter(|v| !v.is_null()) {
        Some(number) => format!("COMANDA #{}", pystr(number)),
        None => "COMANDA".to_string(),
    };
    let station = order.get("station").and_then(Value::as_object).and_then(|s| s.get("name")).filter(|v| py::truthy(v));
    let station_lines: Vec<PrintLine> = station.map(|name| left(format!("Estaci\u{f3}n: {}", pystr(name)))).into_iter().collect();

    let mut lines = match &delivery {
        None => [
            vec![PrintLine { text: format!("{title} \u{2014} Mesa {table}"), bold: true, align: Align::Center }],
            station_lines,
            vec![left(format!("Fecha:  {date_str}")), left(format!("Mesero: {waiter}")), center(RULE)],
        ]
        .concat(),
        Some(d) => {
            let customer = d.get("customerName").filter(|v| py::truthy(v)).map(pystr).unwrap_or("N/A".into());
            [
                vec![PrintLine { text: format!("{title} \u{2014} DOMICILIO"), bold: true, align: Align::Center }],
                station_lines,
                vec![
                    left(format!("Fecha:  {date_str}")),
                    left(format!("Cliente: {customer}")),
                    left(format!("Mesero: {waiter}")),
                    center(RULE),
                ],
            ]
            .concat()
        }
    };

    let one = Value::from(1);
    for item in items {
        let item = dict(item, "item")?;
        let name = str_or(item.get("name").unwrap_or(&Value::Null), "")?.to_uppercase();
        let qty = pystr(get(item, "quantity", &one));
        let comments = str_or(item.get("comments").unwrap_or(&Value::Null), "")?.trim();
        lines.push(left(format!("{} x{qty}", ljust(&name, 30))));
        for (label, _) in modifier_rows(item)? {
            lines.push(left(format!("  {label}")));
        }
        if !comments.is_empty() {
            lines.push(left(format!("  {}", capitalize(comments))));
        }
    }

    let notes = match &delivery {
        Some(d) => str_or(d.get("notes").unwrap_or(&Value::Null), "")?.trim().to_string(),
        None => String::new(),
    };
    if !notes.is_empty() {
        lines.push(left(format!("NOTAS: {notes}")));
    }
    lines.push(center(RULE));
    lines.push(PrintLine { text: "VipePOS".into(), bold: true, align: Align::Center });
    Ok(lines)
}

/// Invoice ticket.
pub fn render_invoice(
    invoice_number: &str,
    invoice: &Value,
    display_items: &Value,
    now: NaiveDateTime,
) -> Result<Vec<PrintLine>, RenderError> {
    let invoice = dict(invoice, "invoice")?;
    let empty = Value::Object(Map::new());
    let business = dict(get(invoice, "businessInfo", &empty), "businessInfo")?;
    let bill = dict(get(invoice, "bill", &empty), "bill")?;
    let na = Value::String("N/A".into());
    let zero = Value::from(0);
    let mut lines = Vec::new();

    let header = [
        text(get(business, "name", &Value::String("RESTAURANTE".into())))?.to_uppercase(),
        format!("NIT: {}", pystr(get(business, "nit", &na))),
        text(get(business, "address", &na))?.to_string(),
        format!("Tel: {}", pystr(get(business, "phone", &na))),
        RULE.to_string(),
    ];
    lines.extend(header.into_iter().map(center));

    let delivery = delivery_block(invoice.get("delivery"));
    let number = Value::String(invoice_number.to_string());
    let mut info = vec![
        ("FACTURA:", pystr(get(invoice, "invoiceNumber", &number))),
        ("FECHA:", format_invoice_date(invoice.get("date"), now)),
    ];
    if delivery.is_none() {
        info.push(("MESA:", pystr(get(invoice, "table", &na))));
        info.push(("MESERO:", pystr(get(invoice, "waiter", &na))));
    }
    for (label, value) in info {
        lines.push(left(format!("{}{value}", ljust(label, 12))));
    }
    if let Some(d) = &delivery {
        lines.extend(delivery_invoice_lines(d)?);
    }

    lines.push(center(RULE));
    lines.push(left("CANT DESCRIPCION            IMPORTE"));
    let items = display_items.as_array().ok_or_else(|| err("displayItems is not a list"))?;
    let one = Value::from(1);
    let blank = Value::String(String::new());
    for item in items {
        let item = dict(item, "item")?;
        let name = text(get(item, "name", &blank))?;
        let qty = get(item, "quantity", &one);
        let price = Num::of(get(item, "price", &zero))?.mul(Num::of(qty)?);
        lines.push(left(format!("{}{}{}", ljust(&pystr(qty), 4), ljust_trunc(name, 20), rjust(&currency(price), 10))));
        // F7: the options with their unit price; the line total above already includes them.
        for (label, opt_price) in modifier_rows(item)? {
            if opt_price.gt(Num::Int(0)) {
                lines.push(left(format!("  {}{}", ljust_trunc(&label, 22), rjust(&format!("${}", currency(opt_price)), 10))));
            } else {
                lines.push(left(format!("  {label:.32}")));
            }
        }
        // S14: each discount of the line, under it.
        lines.extend(discount_rows(item.get("discounts"), false)?.into_iter().map(discount_line));
    }
    // S14: bill discounts (`invoice.discounts` without `orderItemId`) after the items.
    lines.extend(discount_rows(invoice.get("discounts"), true)?.into_iter().map(discount_line));
    lines.push(center(RULE));

    let subtotal = Num::of(get(bill, "subtotal", &zero))?;
    let tax = Num::of(get(bill, "tax", &zero))?;
    let discounts = Num::of(get(bill, "totalDiscounts", &zero))?;
    // S14 payloads carry grossSubtotal or a discounts list; older ones keep the previous totals byte for byte.
    let s14 = matches!(bill.get("grossSubtotal"), Some(Value::Number(_)))
        || invoice.get("discounts").is_some_and(Value::is_array)
        || items.iter().any(|i| i.get("discounts").is_some_and(Value::is_array));
    let discounted = s14 && discounts.gt(Num::Int(0));
    if discounted {
        // Without grossSubtotal: list price = net + discounts.
        let gross = match bill.get("grossSubtotal") {
            Some(v @ Value::Number(_)) => Num::of(v)?,
            _ => subtotal.add(discounts),
        };
        lines.push(left(format!("SUBTOTAL: {}", currency(gross))));
        lines.push(left(format!("DESCUENTOS: -{}", currency(discounts))));
        lines.push(left(format!("BASE: {}", currency(subtotal))));
    } else {
        lines.push(left(format!("SUBTOTAL: {}", currency(subtotal))));
    }
    lines.push(left(format!("IVA: {}", currency(tax))));
    if !s14 && discounts.gt(Num::Int(0)) {
        lines.push(left(format!("DESCUENTOS: -{}", currency(discounts))));
    }
    let fee = match &delivery {
        Some(d) => Num::of(&d["deliveryFee"])?,
        None => Num::Int(0),
    };
    if delivery.is_some() {
        lines.push(left(format!("DOMICILIO: {}", currency(fee))));
    }
    lines.push(left(format!("TOTAL SIN PROPINA: {}", currency(subtotal.add(tax).add(fee)))));
    lines.push(left(format!(
        "PROPINA VOLUNTARIA ({}%): {}",
        pystr(get(bill, "tipPercentage", &zero)),
        currency(Num::of(get(bill, "tip", &zero))?)
    )));
    lines.push(PrintLine {
        text: format!("TOTAL A PAGAR: {}", currency(Num::of(get(bill, "total", &zero))?)),
        bold: true,
        align: Align::Left,
    });
    lines.push(center(RULE));

    super::payment::payment_lines(invoice, &mut lines)?;

    lines.push(center(RULE));
    if discounted {
        lines.push(PrintLine { text: format!("HOY AHORRASTE ${}", currency(discounts)), bold: true, align: Align::Center });
    }
    lines.push(center("GRACIAS POR SU COMPRA!"));
    lines.push(center("VUELVA PRONTO"));
    Ok(lines)
}

/// `_modifier_rows`: (label, price) per option of a line (`modifiers [{group, name, price}]`).
/// Priced: "+ name"; $0: "Group: name" unless the name starts with the group. Malformed entries print nothing.
fn modifier_rows(item: &Map<String, Value>) -> Result<Vec<(String, Num)>, RenderError> {
    let Some(Value::Array(raw)) = item.get("modifiers") else { return Ok(vec![]) };
    let or_empty = |v: Option<&Value>| v.filter(|v| py::truthy(v)).map(pystr).unwrap_or_default();
    let mut rows = Vec::new();
    for modifier in raw.iter().filter_map(Value::as_object) {
        let name = or_empty(modifier.get("name"));
        let group = or_empty(modifier.get("group")).trim().to_string();
        let price = match modifier.get("price") {
            Some(v @ Value::Number(_)) => Num::of(v)?,
            _ => Num::Int(0),
        };
        let label = if price.gt(Num::Int(0)) {
            format!("+ {name}")
        } else if name.to_lowercase().starts_with(&group.to_lowercase()) {
            name
        } else {
            format!("{group}: {name}")
        };
        rows.push((label, price));
    }
    Ok(rows)
}

/// S14: (label, amount) of a `discounts` list, summed by label in first-seen order; entries
/// without a positive numeric amount print nothing. `bill_only` keeps the ones without `orderItemId`.
fn discount_rows(raw: Option<&Value>, bill_only: bool) -> Result<Vec<(String, Num)>, RenderError> {
    let Some(Value::Array(raw)) = raw else { return Ok(vec![]) };
    let mut rows: Vec<(String, Num)> = Vec::new();
    for d in raw.iter().filter_map(Value::as_object) {
        if bill_only && d.get("orderItemId").is_some_and(py::truthy) {
            continue;
        }
        let amount = match d.get("amount") {
            Some(v @ Value::Number(_)) => Num::of(v)?,
            _ => continue,
        };
        if !amount.gt(Num::Int(0)) {
            continue;
        }
        let label = d.get("label").filter(|v| py::truthy(v)).map(pystr).unwrap_or_default();
        match rows.iter_mut().find(|(l, _)| *l == label) {
            Some(row) => row.1 = row.1.add(amount),
            None => rows.push((label, amount)),
        }
    }
    Ok(rows)
}

/// `  label  -amount` in the option-row columns (22 + 10).
fn discount_line((label, amount): (String, Num)) -> PrintLine {
    left(format!("  {}{}", ljust_trunc(&label, 22), rjust(&format!("-{}", currency(amount)), 10)))
}

/// `_delivery_block`: the `delivery` dict with a numeric (non-bool) fee, else None.
fn delivery_block(raw: Option<&Value>) -> Option<Map<String, Value>> {
    let mut block = raw?.as_object()?.clone();
    let fee_ok = matches!(block.get("deliveryFee"), Some(Value::Number(_)));
    if !fee_ok {
        block.insert("deliveryFee".into(), Value::from(0));
    }
    Some(block)
}

fn delivery_invoice_lines(d: &Map<String, Value>) -> Result<Vec<PrintLine>, RenderError> {
    let or_na = |key: &str| d.get(key).filter(|v| py::truthy(v)).map(pystr).unwrap_or("N/A".into());
    let mut rows = vec![
        format!("CLIENTE: {}", or_na("customerName")),
        format!("TEL: {}", or_na("phone")),
        format!("DIRECCION: {}", or_na("address")),
    ];
    let cod = d.get("paymentMode").and_then(Value::as_str) == Some("cash_on_delivery");
    if let (true, Some(change_for @ Value::Number(_))) = (cod, d.get("cashChangeFor")) {
        let n = Num::of(change_for)?;
        if n.gt(Num::Int(0)) {
            rows.push(format!("CAMBIO PARA: {}", currency(n)));
        }
    }
    Ok(rows.into_iter().map(left).collect())
}

pub(super) fn left_line(text: String) -> PrintLine {
    left(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn now() -> NaiveDateTime {
        chrono::NaiveDate::from_ymd_opt(2026, 11, 13).unwrap().and_hms_opt(20, 36, 0).unwrap()
    }

    fn texts(lines: &[PrintLine]) -> Vec<String> {
        lines.iter().map(|l| l.text.clone()).collect()
    }

    fn invoice(bill: Value, discounts: Option<Value>) -> Value {
        let mut inv = json!({"businessInfo": {"name": "Casa"}, "bill": bill, "table": 7, "waiter": "Andrés", "paymentMethod": "cash"});
        if let Some(d) = discounts {
            inv["discounts"] = d;
        }
        inv
    }

    #[test]
    fn prints_line_and_bill_discounts_totals_and_savings() {
        let inv = invoice(
            json!({"subtotal": 24000, "grossSubtotal": 62000, "tax": 0, "tip": 0, "tipPercentage": 0, "total": 24000, "totalDiscounts": 38000}),
            Some(json!([
                {"label": "Happy hour 2x1", "amount": 24000, "orderItemId": "m-1"},
                {"label": "Cortesía cumpleaños", "amount": 14000, "orderItemId": null}
            ])),
        );
        let items = json!([
            {"name": "Mojito", "quantity": 2, "price": 24000, "discounts": [{"label": "Happy hour 2x1", "amount": 24000}]},
            {"name": "Tres leches", "quantity": 1, "price": 14000}
        ]);
        let t = texts(&render_invoice("FE-1", &inv, &items, now()).unwrap());
        let mojito = t.iter().position(|l| l.contains("Mojito")).unwrap();
        assert_eq!(t[mojito + 1], "  Happy hour 2x1           -24.000");
        let leches = t.iter().position(|l| l.contains("Tres leches")).unwrap();
        assert_eq!(t[leches + 1], "  Cortesía cumpleaños      -14.000");
        assert_eq!(t[leches + 2], RULE);
        let at = t.iter().position(|l| l == "SUBTOTAL: 62.000").unwrap();
        assert_eq!(t[at..at + 4], ["SUBTOTAL: 62.000", "DESCUENTOS: -38.000", "BASE: 24.000", "IVA: 0"]);
        assert_eq!(t[t.len() - 3..], ["HOY AHORRASTE $38.000", "GRACIAS POR SU COMPRA!", "VUELVA PRONTO"]);
        assert!(t.iter().all(|l| l.chars().count() <= 48));
    }

    #[test]
    fn gross_falls_back_to_net_plus_discounts() {
        let inv = invoice(
            json!({"subtotal": 10000, "tax": 0, "tip": 0, "tipPercentage": 0, "total": 10000, "totalDiscounts": 2000}),
            Some(json!([{"label": "Cortesía", "amount": 2000}])),
        );
        let t = texts(&render_invoice("FE-2", &inv, &json!([{"name": "Sopa", "quantity": 1, "price": 12000}]), now()).unwrap());
        assert!(t.contains(&"SUBTOTAL: 12.000".to_string()));
        assert!(t.contains(&"HOY AHORRASTE $2.000".to_string()));
    }

    #[test]
    fn old_payload_without_discount_fields_keeps_the_previous_totals() {
        let inv = invoice(json!({"subtotal": 10000, "tax": 0, "tip": 0, "tipPercentage": 0, "total": 10000, "totalDiscounts": 2000}), None);
        let t = texts(&render_invoice("FE-2", &inv, &json!([{"name": "Sopa", "quantity": 1, "price": 12000}]), now()).unwrap());
        let at = t.iter().position(|l| l == "SUBTOTAL: 10.000").unwrap();
        assert_eq!(t[at..at + 3], ["SUBTOTAL: 10.000", "IVA: 0", "DESCUENTOS: -2.000"]);
        assert!(!t.iter().any(|l| l.contains("BASE") || l.contains("AHORRASTE")));
    }

    #[test]
    fn no_discounts_keeps_the_previous_totals() {
        let inv = invoice(json!({"subtotal": 10000, "tax": 0, "tip": 0, "tipPercentage": 0, "total": 10000, "totalDiscounts": 0}), Some(json!([])));
        let t = texts(&render_invoice("FE-3", &inv, &json!([{"name": "Sopa", "quantity": 1, "price": 10000}]), now()).unwrap());
        assert!(t.contains(&"SUBTOTAL: 10.000".to_string()));
        assert!(!t.iter().any(|l| l.contains("DESCUENTOS") || l.contains("BASE") || l.contains("AHORRASTE")));
    }

    #[test]
    fn kitchen_ticket_has_no_prices_or_discounts() {
        let order = json!({"table": 7, "waiter": "Andrés", "items": [
            {"name": "Mojito", "quantity": 2, "price": 24000, "promotionName": "Happy hour 2x1",
             "discounts": [{"label": "Happy hour 2x1", "amount": 24000}]}
        ]});
        let t = texts(&render_kitchen_order(&order, now()).unwrap()).join("\n");
        assert!(t.contains("MOJITO"));
        assert!(!t.contains("24.000") && !t.contains("Happy hour") && !t.contains('$'));
    }
}
