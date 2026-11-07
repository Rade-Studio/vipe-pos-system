//! Payment block of the invoice: the multi-tender list (`tenders`) or the
//! legacy single-label block, as in pos/print_renderer.py.

use super::py::{capitalize, currency, err, rjust, str_or, text, truthy, Num};
use super::render::left_line;
use super::{PrintLine, RenderError};
use serde_json::{Map, Value};

struct Tender<'a> {
    name: &'a Value,
    code: &'a Value,
    kind: &'a Value,
    amount: i64,
    cash_received: &'a Value,
}

/// `_normalize_tenders`: drop malformed entries (non-dict, non-int amount,
/// neither code nor name).
fn normalize(raw: Option<&Value>) -> Vec<Tender<'_>> {
    let Some(Value::Array(entries)) = raw else { return vec![] };
    let null = &Value::Null;
    entries
        .iter()
        .filter_map(|entry| {
            let e = entry.as_object()?;
            let amount = match e.get("amount") {
                Some(Value::Number(n)) => n.as_i64()?,
                _ => return None,
            };
            let code = e.get("methodCode").unwrap_or(null);
            let name = e.get("methodName").unwrap_or(null);
            if !truthy(code) && !truthy(name) {
                return None;
            }
            Some(Tender { name, code, kind: e.get("methodKind").unwrap_or(null), amount, cash_received: e.get("cashReceived").unwrap_or(null) })
        })
        .collect()
}

pub fn payment_lines(invoice: &Map<String, Value>, lines: &mut Vec<PrintLine>) -> Result<(), RenderError> {
    let tenders = normalize(invoice.get("tenders"));
    if tenders.is_empty() {
        return legacy(invoice, lines);
    }
    lines.push(left_line("FORMAS DE PAGO:".into()));
    let change_provided = matches!(invoice.get("change"), Some(v) if !v.is_null());
    // `invoice.get("change", 0)`: a stored null stays None in Python.
    let mut total_change: Option<Num> = match invoice.get("change") {
        None => Some(Num::Int(0)),
        Some(Value::Null) => None,
        Some(v) => Some(Num::of(v)?),
    };
    for t in &tenders {
        // normalized methodName = name or code or ""; then `(name or code or "").upper()`.
        let label = if truthy(t.name) { str_or(t.name, "")? } else { str_or(t.code, "")? };
        let amount = Num::Int(t.amount);
        lines.push(left_line(format!("{}  {}", label.to_uppercase(), rjust(&currency(amount), 10))));
        let kind = if truthy(t.kind) { t.kind } else { &Value::Null };
        if kind.as_str() == Some("cash") && !t.cash_received.is_null() {
            let received = Num::of(t.cash_received)?;
            if received.gt(amount) {
                let line_change = received.sub(amount);
                lines.push(left_line(format!(
                    "  RECIBIDO {} / CAMBIO {}",
                    rjust(&currency(received), 8),
                    rjust(&currency(line_change), 8)
                )));
                if !change_provided {
                    let current = total_change.ok_or_else(|| err("change is None"))?;
                    total_change = Some(current.add(line_change));
                }
            }
        }
    }
    if let Some(change) = total_change {
        if change.gt(Num::Int(0)) {
            lines.push(left_line(format!("CAMBIO: {}", currency(change))));
        }
    }
    Ok(())
}

fn legacy(invoice: &Map<String, Value>, lines: &mut Vec<PrintLine>) -> Result<(), RenderError> {
    let na = Value::String("N/A".into());
    let method = text(invoice.get("paymentMethod").unwrap_or(&na))?;
    lines.push(left_line(format!("FORMA DE PAGO: {}", payment_method_text(method))));
    let zero = Value::from(0);
    let received = Num::of(invoice.get("cashReceived").unwrap_or(&zero))?;
    if received.gt(Num::Int(0)) {
        let change = Num::of(invoice.get("cashChange").unwrap_or(&zero))?;
        lines.push(left_line(format!("RECIBIDO: {}", currency(received))));
        lines.push(left_line(format!("CAMBIO: {}", currency(change))));
    }
    Ok(())
}

/// `_payment_method_text`.
fn payment_method_text(method: &str) -> String {
    match method.to_lowercase().as_str() {
        "cash" => "Efectivo".into(),
        "transfer" => "Transferencia".into(),
        "nequi" => "Nequi".into(),
        "bancolombia" => "Bancolombia App".into(),
        _ if method.is_empty() => "N/A".into(),
        _ => capitalize(method),
    }
}
