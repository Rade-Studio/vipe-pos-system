//! Server-driven print jobs (`{id, kind, stationId, createdAt, payload}`), with the
//! rules of pos/print_jobs.py: what prints, what is acknowledged without
//! printing (unprintable payloads, comandas older than 12 hours) and what is
//! rejected (no id). Routing is decided by the server; `stationId` only says which
//! local printer serves the job, and `null` (restaurants without stations) means
//! every printer.

use crate::escpos::{build_comanda_bytes, build_invoice_bytes, build_x_report_bytes, py_truthy, x_report_printable, Encoding, RenderError};
use chrono::{DateTime, Duration, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Comandas older than this are acknowledged without printing.
pub const COMMAND_MAX_AGE_HOURS: i64 = 12;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", from = "WireJob")]
pub struct PrintJob {
    pub id: String,
    /// `command` (comanda), `invoice` or `x_report` (Informe X).
    pub kind: String,
    /// The station id; `None` for jobs of restaurants without stations.
    #[serde(rename = "stationId")]
    pub station: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub payload: Value,
}

/// The envelope as received: `stationId` (string or null) and, from F6, an
/// optional `station` object `{id, name}`. Rows stored by earlier builds carry
/// `station` as a plain string.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WireJob {
    id: String,
    kind: String,
    #[serde(default)]
    station_id: Option<String>,
    #[serde(default)]
    station: Value,
    #[serde(default)]
    created_at: Option<String>,
    #[serde(default)]
    payload: Value,
}

impl From<WireJob> for PrintJob {
    fn from(w: WireJob) -> Self {
        let from_station = match &w.station {
            Value::String(s) => Some(s.clone()),
            Value::Object(o) => o.get("id").and_then(Value::as_str).map(str::to_string),
            _ => None,
        };
        PrintJob { id: w.id, kind: w.kind, station: w.station_id.or(from_station), created_at: w.created_at, payload: w.payload }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Disposition {
    /// Queue it and print it.
    Print,
    /// Acknowledge without printing (it will never print).
    Skip(String),
    /// Ignore without acknowledging.
    Reject(String),
}

pub fn classify(job: &PrintJob, now: DateTime<Utc>) -> Disposition {
    if job.id.is_empty() {
        return Disposition::Reject("print job without id".into());
    }
    match job.kind.as_str() {
        "command" => {
            if command_order(&job.payload).is_none() {
                return Disposition::Skip("unprintable command".into());
            }
            if older_than(job.created_at.as_deref(), now, Duration::hours(COMMAND_MAX_AGE_HOURS)) {
                return Disposition::Skip(format!("command older than {COMMAND_MAX_AGE_HOURS} h"));
            }
            Disposition::Print
        }
        "invoice" => {
            if invoice_parts(&job.payload).is_none() {
                return Disposition::Skip("unprintable invoice".into());
            }
            Disposition::Print
        }
        "x_report" => {
            if !x_report_printable(&job.payload) {
                return Disposition::Skip("unprintable x_report".into());
            }
            Disposition::Print
        }
        other => Disposition::Skip(format!("unknown kind {other}")),
    }
}

/// The ESC/POS bytes of a job (without preamble). A render error means the
/// payload can never print and the job should be skipped. An `x_report`
/// renders at 80 mm here; `render_job_on` takes the printer's paper.
pub fn render_job(job: &PrintJob, encoding: Encoding, now: NaiveDateTime) -> Result<Vec<u8>, RenderError> {
    render_job_on(job, encoding, 80, now)
}

/// `render_job` on paper of `paper_mm` (58 or 80); only the `x_report` lines depend on it.
pub fn render_job_on(job: &PrintJob, encoding: Encoding, paper_mm: u8, now: NaiveDateTime) -> Result<Vec<u8>, RenderError> {
    match job.kind.as_str() {
        "x_report" => build_x_report_bytes(&job.payload, encoding, paper_mm),
        "command" => {
            let order = command_order(&job.payload).ok_or_else(|| RenderError("unprintable command".into()))?;
            build_comanda_bytes(&order, encoding, now)
        }
        "invoice" => {
            let (number, invoice, items) =
                invoice_parts(&job.payload).ok_or_else(|| RenderError("unprintable invoice".into()))?;
            build_invoice_bytes(&number, &invoice, &items, encoding, now)
        }
        other => Err(RenderError(format!("unknown kind {other}"))),
    }
}

/// `_command`: invoiceNumber, items and waiter are required (truthy); orderNumber, station and takeaway pass through.
fn command_order(payload: &Value) -> Option<Value> {
    let p = payload.as_object()?;
    let field = |k: &str| p.get(k).filter(|v| py_truthy(v)).cloned();
    let mut order = json!({
        "invoiceNumber": field("invoiceNumber")?,
        "table": p.get("table").cloned().unwrap_or(Value::Null),
        "waiter": field("waiter")?,
        "items": field("items")?,
        "delivery": p.get("delivery").cloned().unwrap_or(Value::Null),
    });
    // Comanda header (orderNumber, station, takeaway): passed through only when present.
    for key in ["orderNumber", "station", "takeaway"] {
        if let Some(value) = p.get(key).filter(|v| !v.is_null()) {
            order[key] = value.clone();
        }
    }
    Some(order)
}

/// `_invoice`: invoiceNumber required; invoice and displayItems default empty.
fn invoice_parts(payload: &Value) -> Option<(String, Value, Value)> {
    let p = payload.as_object()?;
    let number = p.get("invoiceNumber").filter(|v| py_truthy(v))?;
    let number = match number {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    };
    let invoice = p.get("invoice").filter(|v| py_truthy(v)).cloned().unwrap_or(json!({}));
    let items = p.get("displayItems").filter(|v| py_truthy(v)).cloned().unwrap_or(json!([]));
    Some((number, invoice, items))
}

fn older_than(created_at: Option<&str>, now: DateTime<Utc>, age: Duration) -> bool {
    let Some(raw) = created_at else { return false };
    let parsed = DateTime::parse_from_rfc3339(raw)
        .map(|d| d.with_timezone(&Utc))
        .or_else(|_| NaiveDateTime::parse_from_str(raw, "%Y-%m-%dT%H:%M:%S%.f").map(|n| n.and_utc()));
    match parsed {
        Ok(created) => now - created > age,
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn x_report(payload: Value) -> PrintJob {
        PrintJob { id: "x".into(), kind: "x_report".into(), station: None, created_at: Some("2026-01-01T00:00:00Z".into()), payload }
    }

    #[test]
    fn an_x_report_prints_at_any_age_on_the_printer_paper_and_one_without_summary_is_skipped() {
        let fixture: Value = serde_json::from_str(include_str!("../../../lib/print/x-report-fixture.json")).unwrap();
        let job = x_report(fixture["payload"].clone());
        assert_eq!(classify(&job, Utc::now()), Disposition::Print);
        let now = chrono::NaiveDate::from_ymd_opt(2026, 11, 10).unwrap().and_hms_opt(13, 30, 0).unwrap();
        let wide = render_job(&job, Encoding::Utf8, now).unwrap();
        assert_eq!(wide, build_x_report_bytes(&job.payload, Encoding::Utf8, 80).unwrap());
        let narrow = render_job_on(&job, Encoding::Utf8, 58, now).unwrap();
        assert_eq!(narrow, build_x_report_bytes(&job.payload, Encoding::Utf8, 58).unwrap());
        assert_ne!(wide, narrow);
        let empty = x_report(json!({"business": {"name": "Casa"}}));
        assert_eq!(classify(&empty, Utc::now()), Disposition::Skip("unprintable x_report".into()));
    }

    #[test]
    fn a_takeaway_command_passes_the_takeaway_block() {
        let takeaway = json!({"customerName": "Laura", "label": "PARA LLEVAR \u{b7} Laura"});
        let order = command_order(&json!({"invoiceNumber": "j", "waiter": "Ana", "items": [{"name": "Sopa"}], "takeaway": takeaway})).unwrap();
        assert_eq!(order["takeaway"], takeaway);
        let old = command_order(&json!({"invoiceNumber": "j", "waiter": "Ana", "items": [{"name": "Sopa"}]})).unwrap();
        assert!(old.get("takeaway").is_none());
    }
}
