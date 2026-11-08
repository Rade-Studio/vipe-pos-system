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
    }
    lines.push(center(RULE));

    let subtotal = Num::of(get(bill, "subtotal", &zero))?;
    let tax = Num::of(get(bill, "tax", &zero))?;
    lines.push(left(format!("SUBTOTAL: {}", currency(subtotal))));
    lines.push(left(format!("IVA: {}", currency(tax))));
    let discounts = Num::of(get(bill, "totalDiscounts", &zero))?;
    if discounts.gt(Num::Int(0)) {
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
    lines.push(center("GRACIAS POR SU COMPRA!"));
    lines.push(center("VUELVA PRONTO"));
    Ok(lines)
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
