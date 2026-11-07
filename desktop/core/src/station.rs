//! Station logic of the desktop shell that does not need a window: the part of
//! the saved settings the print worker reads, job → printer routing, the bytes
//! of a job, queue titles and the updater endpoint (desktop/API-CONTRACT.md §7).

use crate::escpos::{drawer_pulse, money, printer_preamble, Encoding, RenderError, FULL_CUT};
use crate::jobs::{render_job, PrintJob};
use crate::transport::Connection;
use chrono::NaiveDateTime;
use serde::Deserialize;
use serde_json::{json, Value};

pub const DEFAULT_WEB_URL: &str = "https://vipe-staging.212.56.33.197.sslip.io";
pub const UPDATER_ENDPOINT_TEMPLATE: &str = "https://<api>/api/desktop/updates/{{target}}/{{current_version}}";
/// No update is installed within this long after a print.
pub const QUIET_MS: i64 = 10 * 60_000;

/// The printer fields the worker needs (the full record lives in the settings JSON).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Printer {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub model: String,
    pub connection: String,
    pub address: String,
    #[serde(default = "default_paper")]
    pub paper_mm: u8,
    #[serde(default = "default_encoding")]
    pub encoding: Encoding,
    #[serde(default)]
    pub has_drawer: bool,
    #[serde(default = "yes")]
    pub cut: bool,
    #[serde(default)]
    pub station_ids: Vec<String>,
}

fn default_paper() -> u8 {
    80
}
fn default_encoding() -> Encoding {
    Encoding::Cp1252
}
fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default = "default_web_url")]
    pub web_url: String,
    #[serde(default)]
    pub device_token: Option<String>,
    #[serde(default)]
    pub printers: Vec<Printer>,
    #[serde(default = "yes")]
    pub auto_update: bool,
}

fn default_web_url() -> String {
    DEFAULT_WEB_URL.into()
}

/// First-run settings (same shape as `StationSettings` in desktop/app/src/bridge/types.ts).
pub fn default_settings() -> Value {
    json!({
        "webUrl": DEFAULT_WEB_URL, "deviceId": null, "deviceToken": null, "restaurant": null, "linkedAt": null,
        "channel": "stable", "printers": [], "autostart": true, "autoUpdate": true, "soundOnFailure": true,
        "setup": {"step": "welcome", "printerIndex": 0, "maxStep": 1, "prints": null, "completed": false, "deferred": false}
    })
}

pub fn connection_of(p: &Printer) -> Connection {
    match p.connection.as_str() {
        "network" => match p.address.rsplit_once(':') {
            Some((host, port)) if port.parse::<u16>().is_ok() => Connection::Network { host: host.into(), port: port.parse().ok() },
            _ => Connection::Network { host: p.address.clone(), port: None },
        },
        "bluetooth" => Connection::Serial { port: p.address.clone(), baud: None },
        _ => Connection::Spooler { name: p.address.clone() },
    }
}

/// Printers serving the job's station. The server decides routing (L10); an
/// invoice without a station goes to the printer with the cash drawer.
pub fn printers_for_job<'a>(job: &PrintJob, printers: &'a [Printer]) -> Vec<&'a Printer> {
    match &job.station {
        Some(st) => printers.iter().filter(|p| p.station_ids.iter().any(|s| s == st)).collect(),
        None if job.kind == "invoice" => printers.iter().filter(|p| p.has_drawer).take(1).collect(),
        None => Vec::new(),
    }
}

/// Cash invoices open the drawer (legacy `paymentMethod` or a cash tender).
pub fn opens_drawer(job: &PrintJob) -> bool {
    let inv = &job.payload["invoice"];
    job.kind == "invoice"
        && (inv["paymentMethod"] == "cash"
            || inv["tenders"].as_array().is_some_and(|t| t.iter().any(|x| x["methodKind"] == "cash")))
}

/// Preamble + (drawer pulse) + ticket, without the cut when the printer has no cutter.
pub fn job_bytes(job: &PrintJob, printer: &Printer, now: NaiveDateTime) -> Result<Vec<u8>, RenderError> {
    let mut out = printer_preamble(printer.encoding);
    if printer.has_drawer && opens_drawer(job) {
        out.extend(drawer_pulse());
    }
    let mut ticket = render_job(job, printer.encoding, now)?;
    if !printer.cut && ticket.ends_with(FULL_CUT) {
        ticket.truncate(ticket.len() - FULL_CUT.len());
    }
    out.extend(ticket);
    Ok(out)
}

fn short(v: &Value) -> String {
    let s = match v {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    };
    s
}

/// Comanda numbers are job ids (uuids): the first 4 characters are enough.
fn short_id(v: &Value) -> String {
    short(v).chars().take(4).collect()
}

fn place(table: &Value, delivery: &Value) -> String {
    if delivery.is_object() {
        "Domicilio".into()
    } else if table.is_null() {
        "Mostrador".into()
    } else {
        format!("Mesa {}", short(table))
    }
}

/// (title, detail) shown in Cola and Historial.
pub fn job_summary(job: &PrintJob) -> (String, String) {
    let p = &job.payload;
    if job.kind == "invoice" {
        let inv = &p["invoice"];
        let total = money(&inv["bill"]["total"]).map(|m| format!("$ {m}")).unwrap_or_default();
        return (format!("Factura {} · {}", short(&p["invoiceNumber"]), place(&inv["table"], &inv["delivery"])), total);
    }
    let items = p["items"].as_array().map(Vec::as_slice).unwrap_or(&[]);
    let detail = items
        .iter()
        .map(|i| format!("{}× {}", i["quantity"].as_i64().unwrap_or(1), i["name"].as_str().unwrap_or("")))
        .collect::<Vec<_>>()
        .join(", ");
    let number = short_id(&p["invoiceNumber"]);
    (format!("Comanda #{number} · {}", place(&p["table"], &p["delivery"])), detail)
}

/// The template with `https://<api>` replaced by the origin of the VIPE web URL.
pub fn updater_endpoint(web_url: &str) -> Option<String> {
    let (scheme, rest) = web_url.split_once("://")?;
    if !matches!(scheme, "http" | "https") {
        return None;
    }
    let host = rest.split(['/', '?', '#']).next().filter(|h| !h.is_empty() && !h.contains(' '))?;
    Some(UPDATER_ENDPOINT_TEMPLATE.replace("https://<api>", &format!("{scheme}://{host}")))
}

/// Out of service: nothing waiting and no print in the last 10 minutes.
pub fn idle_for_update(active_jobs: i64, last_print_ms: Option<i64>, now_ms: i64) -> bool {
    active_jobs == 0 && last_print_ms.is_none_or(|t| now_ms - t >= QUIET_MS)
}
