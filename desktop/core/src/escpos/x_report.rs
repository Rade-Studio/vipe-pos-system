//! "Informe X" (`x_report` jobs, odd/tasks/informe-x-termico.md S1): the
//! lines of components/printing/XReportSlip.tsx (`xReportLines`) and its
//! slip-format helpers, at 42 characters (80 mm) or 32 (58 mm). The payload is
//! `{business, cashierName, openedAt, printedAt, summary, tax?}` with the
//! summary exactly as GET /registers/summary answered; lib/print/x-report-fixture.json
//! pins the lines the web slip prints.

use super::{format_slip_date_time, lines_to_bytes, Align, Encoding, PrintLine, RenderError};
use serde_json::{Map, Value};

/// `slipChars`: ~42 characters on 80 mm paper, ~32 on 58 mm.
pub fn slip_chars(paper_mm: u8) -> usize {
    if paper_mm == 58 {
        32
    } else {
        42
    }
}

/// Whether the payload carries a summary to print.
pub fn printable(payload: &Value) -> bool {
    payload.get("summary").is_some_and(Value::is_object)
}

pub fn build_x_report_bytes(payload: &Value, encoding: Encoding, paper_mm: u8) -> Result<Vec<u8>, RenderError> {
    let mut lines = render_x_report(payload, paper_mm)?;
    // CP1252 has no U+2212 minus sign; the web slip's "−" prints as a hyphen there.
    if encoding == Encoding::Cp1252 {
        for line in &mut lines {
            line.text = line.text.replace('\u{2212}', "-");
        }
    }
    Ok(lines_to_bytes(&lines, encoding))
}

fn line(text: String, bold: bool) -> PrintLine {
    PrintLine { text, bold, align: Align::Left }
}

fn len(s: &str) -> usize {
    s.chars().count()
}

fn take(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// `padLine`: `left` and `right` on one line of `width` characters; a long left side is cut with `…`.
fn pad_line(left: &str, right: &str, width: usize) -> String {
    if right.is_empty() {
        return if len(left) > width { format!("{}\u{2026}", take(left, width.saturating_sub(1))) } else { left.to_string() };
    }
    let room = width as i64 - len(right) as i64 - 1;
    let label = if len(left) as i64 > room { format!("{}\u{2026}", take(left, (room - 1).max(0) as usize)) } else { left.to_string() };
    let gap = (width as i64 - len(&label) as i64 - len(right) as i64).max(1) as usize;
    format!("{label}{}{right}", " ".repeat(gap))
}

/// `centerLine`: left padding only.
fn center_line(text: &str, width: usize) -> String {
    let cut = if len(text) > width { take(text, width) } else { text.to_string() };
    format!("{}{cut}", " ".repeat((width - len(&cut)) / 2))
}

/// `Math.round`.
fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

/// `pesos`: `$ 1.234.567`; a negative amount reads `−$ 3.500`.
fn pesos(amount: f64) -> String {
    let digits = format!("{}", js_round(amount).abs() as u128);
    let mut out = String::new();
    for (i, ch) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            out.push('.');
        }
        out.push(ch);
    }
    format!("{}$ {out}", if amount < 0.0 { "\u{2212}" } else { "" })
}

/// `String(n)` of a JSON number.
fn js_number(v: &Value) -> String {
    match v.as_i64() {
        Some(i) => i.to_string(),
        None => match v.as_f64() {
            Some(x) if x.fract() == 0.0 && x.abs() < 1e16 => format!("{}", x as i64),
            Some(x) => format!("{x}"),
            None => String::new(),
        },
    }
}

fn number(obj: &Map<String, Value>, key: &str) -> Result<f64, RenderError> {
    obj.get(key).and_then(Value::as_f64).ok_or_else(|| RenderError(format!("summary.{key} is not a number")))
}

fn string<'a>(obj: Option<&'a Map<String, Value>>, key: &str) -> &'a str {
    obj.and_then(|o| o.get(key)).and_then(Value::as_str).unwrap_or("")
}

/// `slipDateTime` of the ISO date-time as written (its wall time); the raw text when it does not parse.
fn date_time(v: Option<&Value>) -> String {
    let raw = v.and_then(Value::as_str).unwrap_or("");
    format_slip_date_time(raw).unwrap_or_else(|| raw.to_string())
}

/// `xReportLines` of the payload at the paper width.
pub fn render_x_report(payload: &Value, paper_mm: u8) -> Result<Vec<PrintLine>, RenderError> {
    let width = slip_chars(paper_mm);
    let p = payload.as_object().ok_or_else(|| RenderError("x_report payload is not an object".into()))?;
    let summary = p.get("summary").and_then(Value::as_object).ok_or_else(|| RenderError("x_report without summary".into()))?;
    let business = p.get("business").and_then(Value::as_object);
    let row = |left: &str, right: &str, bold: bool| line(pad_line(left, right, width), bold);
    let rule = || line("-".repeat(width), false);

    let mut lines = vec![line(center_line(&string(business, "name").to_uppercase(), width), true)];
    let nit = string(business, "nit");
    if !nit.is_empty() {
        lines.push(line(center_line(&format!("NIT {nit}"), width), false));
    }
    let address = string(business, "address");
    if !address.is_empty() {
        lines.push(line(center_line(address, width), false));
    }
    lines.push(rule());
    lines.push(line(center_line("INFORME X", width), true));
    lines.push(line(center_line("Parcial \u{b7} No reinicia contadores", width), false));
    lines.push(rule());
    let cashier = p.get("cashierName").and_then(Value::as_str).unwrap_or("\u{2014}");
    lines.push(row("Cajero", cashier, false));
    lines.push(row("Abierto", &date_time(p.get("openedAt")), false));
    lines.push(row("Impreso", &date_time(p.get("printedAt")), false));
    lines.push(rule());
    lines.push(line("Ventas por m\u{e9}todo".into(), true));

    let methods = summary.get("methods").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]);
    let mut cash_sales = 0.0;
    for method in methods.iter().filter_map(Value::as_object) {
        let total = number(method, "total")?;
        if method.get("kind").and_then(Value::as_str) == Some("cash") {
            cash_sales += total;
        }
        if total > 0.0 || method.get("isActive").and_then(Value::as_bool) == Some(true) {
            let name = method.get("name").and_then(Value::as_str).unwrap_or("");
            let count = js_number(method.get("tendersCount").unwrap_or(&Value::Null));
            lines.push(row(&format!("{name} ({count})"), &pesos(total), false));
        }
    }
    let sales = number(summary, "totalSales")?;
    lines.push(row("Ventas", &pesos(sales), true));
    if let Some(tax) = p.get("tax").and_then(Value::as_object) {
        let rate_value = tax.get("rate").cloned().unwrap_or(Value::Null);
        let rate = rate_value.as_f64().ok_or_else(|| RenderError("tax.rate is not a number".into()))?;
        let base = js_round(sales * 100.0 / (100.0 + rate));
        let kind = tax.get("type").and_then(Value::as_str).unwrap_or("INC");
        lines.push(row("Base", &pesos(base), false));
        lines.push(row(&format!("{kind} ({} %)", js_number(&rate_value).replacen('.', ",", 1)), &pesos(sales - base), false));
    }
    lines.push(row("Tiquetes", &js_number(summary.get("paymentsCount").unwrap_or(&Value::Null)), false));
    lines.push(rule());
    lines.push(line("Efectivo en caja".into(), true));
    lines.push(row("Fondo de caja", &pesos(number(summary, "initialCash")?), false));
    lines.push(row("+ Ventas en efectivo", &pesos(cash_sales), false));
    let change = number(summary, "totalChange")?;
    if change > 0.0 {
        lines.push(row("\u{2212} Cambio entregado", &pesos(change), false));
    }
    lines.push(row("+ Entradas", &pesos(number(summary, "cashDeposits")?), false));
    lines.push(row("\u{2212} Salidas", &pesos(number(summary, "cashWithdrawals")?), false));
    lines.push(row("Esperado ahora", &pesos(number(summary, "expectedCash")?), true));
    lines.push(rule());
    lines.push(row("Propinas (aparte)", &pesos(number(summary, "totalTips")?), false));
    lines.push(line("No son ingreso del restaurante.".into(), false));
    lines.push(rule());
    lines.push(line(center_line("Este informe no cierra el turno.", width), false));
    Ok(lines)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const FIXTURE: &str = include_str!("../../../../lib/print/x-report-fixture.json");

    fn fixture() -> Value {
        serde_json::from_str(FIXTURE).unwrap()
    }

    fn pairs(lines: &[PrintLine]) -> Vec<(String, bool)> {
        lines.iter().map(|l| (l.text.clone(), l.bold)).collect()
    }

    fn expected(paper: &str) -> Vec<(String, bool)> {
        fixture()["lines"][paper]
            .as_array()
            .unwrap()
            .iter()
            .map(|l| (l["text"].as_str().unwrap().to_string(), l["bold"].as_bool().unwrap()))
            .collect()
    }

    #[test]
    fn prints_the_web_slip_lines_at_80_and_58_mm() {
        let payload = fixture()["payload"].clone();
        assert_eq!(pairs(&render_x_report(&payload, 80).unwrap()), expected("80"));
        assert_eq!(pairs(&render_x_report(&payload, 58).unwrap()), expected("58"));
    }

    #[test]
    fn without_tax_or_change_or_cashier_it_drops_those_lines() {
        let mut payload = fixture()["payload"].clone();
        payload.as_object_mut().unwrap().remove("tax");
        payload["summary"]["totalChange"] = json!(0);
        payload["cashierName"] = Value::Null;
        let t: Vec<String> = render_x_report(&payload, 80).unwrap().into_iter().map(|l| l.text).collect();
        assert!(!t.iter().any(|l| l.starts_with("Base") || l.starts_with("INC") || l.contains("Cambio entregado")));
        assert!(t.contains(&pad_line("Cajero", "\u{2014}", 42)));
    }

    #[test]
    fn bytes_are_left_aligned_bold_where_the_slip_is_and_cp1252_prints_the_minus_as_a_hyphen() {
        let payload = fixture()["payload"].clone();
        let cp = build_x_report_bytes(&payload, Encoding::Cp1252, 80).unwrap();
        assert!(cp.starts_with(b"\x1b\x45\x01\x1b\x61\x00           LA FONDA DE MARIANA\n\x1b\x45\x00"));
        assert!(cp.windows(18).any(|w| w == b"- Cambio entregado"));
        assert!(cp.ends_with(b"     Este informe no cierra el turno.\n\n\n\n\x1d\x56\x00"));
        let utf8 = build_x_report_bytes(&payload, Encoding::Utf8, 80).unwrap();
        assert!(String::from_utf8_lossy(&utf8).contains("\u{2212} Salidas"));
    }

    #[test]
    fn a_payload_without_summary_is_not_printable() {
        assert!(!printable(&json!({"business": {}})));
        assert!(render_x_report(&json!({"business": {}}), 80).is_err());
        assert!(printable(&fixture()["payload"]));
    }
}
