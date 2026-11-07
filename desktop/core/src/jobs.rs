//! Server-driven print jobs (`{id, kind, station, createdAt, payload}`), with the
//! rules of pos/print_jobs.py: what prints, what is acknowledged without
//! printing (unprintable payloads, comandas older than 12 hours) and what is
//! rejected (no id). Routing is decided by the server; `station` only says which
//! local printer serves the job.

use crate::escpos::{build_comanda_bytes, build_invoice_bytes, py_truthy, Encoding, RenderError};
use chrono::{DateTime, Duration, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Comandas older than this are acknowledged without printing.
pub const COMMAND_MAX_AGE_HOURS: i64 = 12;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintJob {
    pub id: String,
    /// `command` (comanda) or `invoice`.
    pub kind: String,
    #[serde(default)]
    pub station: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub payload: Value,
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
        other => Disposition::Skip(format!("unknown kind {other}")),
    }
}

/// The ESC/POS bytes of a job (without preamble). A render error means the
/// payload can never print and the job should be skipped.
pub fn render_job(job: &PrintJob, encoding: Encoding, now: NaiveDateTime) -> Result<Vec<u8>, RenderError> {
    match job.kind.as_str() {
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

/// `_command`: invoiceNumber, items and waiter are required (truthy).
fn command_order(payload: &Value) -> Option<Value> {
    let p = payload.as_object()?;
    let field = |k: &str| p.get(k).filter(|v| py_truthy(v)).cloned();
    Some(json!({
        "invoiceNumber": field("invoiceNumber")?,
        "table": p.get("table").cloned().unwrap_or(Value::Null),
        "waiter": field("waiter")?,
        "items": field("items")?,
        "delivery": p.get("delivery").cloned().unwrap_or(Value::Null),
    }))
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
