//! Station logic of the desktop shell that does not need a window: the part of
//! the saved settings the print worker reads, job → printer routing, the bytes
//! of a job, queue titles and the updater endpoint (desktop/API-CONTRACT.md §7).

use crate::escpos::{drawer_pulse, money, printer_preamble, Encoding, RenderError, FULL_CUT};
use crate::jobs::{render_job_on, PrintJob};
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
    /// The id of the Caja station (`fixed` in GET /api/desktop/stations), when known.
    #[serde(default)]
    pub caja_station_id: Option<String>,
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

/// Printers serving the job's station. The server decides routing (L10). A job
/// without a station (restaurants without stations) prints on every printer,
/// except an invoice, which prints on the Caja printers (`caja_station`) or on
/// every printer when none serves Caja; an Informe X (`x_report`) goes like an invoice.
pub fn printers_for_job<'a>(job: &PrintJob, printers: &'a [Printer], caja_station: Option<&str>) -> Vec<&'a Printer> {
    let serving = |st: &str| printers.iter().filter(|p| p.station_ids.iter().any(|s| s == st)).collect::<Vec<_>>();
    match &job.station {
        Some(st) => serving(st),
        None => {
            let caja = caja_station.filter(|_| matches!(job.kind.as_str(), "invoice" | "x_report")).map(serving).unwrap_or_default();
            if caja.is_empty() { printers.iter().collect() } else { caja }
        }
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
    let mut ticket = render_job_on(job, printer.encoding, printer.paper_mm, now)?;
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

fn place(table: &Value, delivery: &Value, takeaway: &Value) -> String {
    if delivery.is_object() {
        "Domicilio".into()
    } else if let Some(name) = takeaway["customerName"].as_str() {
        format!("Para llevar \u{b7} {name}")
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
        return (format!("Factura {} · {}", short(&p["invoiceNumber"]), place(&inv["table"], &inv["delivery"], &inv["takeaway"])), total);
    }
    if job.kind == "x_report" {
        let cashier = p["cashierName"].as_str().unwrap_or("\u{2014}");
        return ("Informe X \u{b7} parcial".into(), format!("Cajero {cashier}"));
    }
    let items = p["items"].as_array().map(Vec::as_slice).unwrap_or(&[]);
    let detail = items
        .iter()
        .map(|i| format!("{}× {}", i["quantity"].as_i64().unwrap_or(1), i["name"].as_str().unwrap_or("")))
        .collect::<Vec<_>>()
        .join(", ");
    let number = short_id(&p["invoiceNumber"]);
    (format!("Comanda #{number} · {}", place(&p["table"], &p["delivery"], &p["takeaway"])), detail)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn printer(id: &str, paper_mm: u8, station_ids: &[&str]) -> Printer {
        Printer { id: id.into(), name: id.into(), model: String::new(), connection: "spooler".into(), address: id.into(), paper_mm,
            encoding: Encoding::Utf8, has_drawer: true, cut: true, station_ids: station_ids.iter().map(|s| s.to_string()).collect() }
    }

    #[test]
    fn an_x_report_goes_to_caja_like_an_invoice_prints_on_its_paper_and_never_opens_the_drawer() {
        let fixture: Value = serde_json::from_str(include_str!("../../../lib/print/x-report-fixture.json")).unwrap();
        let job = PrintJob { id: "x".into(), kind: "x_report".into(), station: None, created_at: None, payload: fixture["payload"].clone() };
        let printers = [printer("cocina", 80, &["prep"]), printer("caja", 58, &["caja"])];
        let chosen: Vec<&str> = printers_for_job(&job, &printers, Some("caja")).iter().map(|p| p.id.as_str()).collect();
        assert_eq!(chosen, ["caja"]);
        let command = PrintJob { kind: "command".into(), ..job.clone() };
        assert_eq!(printers_for_job(&command, &printers, Some("caja")).len(), 2);
        assert!(!opens_drawer(&job));
        let now = chrono::NaiveDate::from_ymd_opt(2026, 11, 10).unwrap().and_hms_opt(13, 30, 0).unwrap();
        let bytes = job_bytes(&job, &printers[1], now).unwrap();
        let mut expected = printer_preamble(Encoding::Utf8);
        expected.extend(crate::escpos::build_x_report_bytes(&job.payload, Encoding::Utf8, 58).unwrap());
        assert_eq!(bytes, expected);
        assert_eq!(job_summary(&job), ("Informe X \u{b7} parcial".to_string(), "Cajero Camilo Henao".to_string()));
    }

    #[test]
    fn a_takeaway_comanda_is_summarised_with_the_customer() {
        let job = PrintJob { id: "j".into(), kind: "command".into(), station: None, created_at: None,
            payload: json!({"invoiceNumber": "abcd9", "table": null, "takeaway": {"customerName": "Laura", "label": "PARA LLEVAR \u{b7} Laura"}, "items": []}) };
        assert_eq!(job_summary(&job).0, "Comanda #abcd \u{b7} Para llevar \u{b7} Laura");
    }
}
