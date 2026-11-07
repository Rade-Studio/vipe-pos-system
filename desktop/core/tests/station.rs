//! Station logic used by the Tauri shell: settings subset, job → printer
//! routing, job bytes, queue titles and the updater endpoint.

use serde_json::json;
use vipe_desktop_core::escpos::{drawer_pulse, FULL_CUT};
use vipe_desktop_core::jobs::PrintJob;
use vipe_desktop_core::station::{
    connection_of, default_settings, idle_for_update, job_bytes, job_summary, printers_for_job, updater_endpoint, Settings,
    UPDATER_ENDPOINT_TEMPLATE,
};
use vipe_desktop_core::transport::Connection;

fn settings() -> Settings {
    serde_json::from_value(json!({
        "webUrl": "https://vipe.example.com/caja",
        "deviceToken": "vdt_x",
        "printers": [
            {"id": "usb-1", "name": "Caja", "model": "TM-T20", "connection": "usb", "address": "EPSON TM-T20III Receipt",
             "paperMm": 80, "encoding": "cp1252", "hasDrawer": true, "cut": true, "stationIds": ["st-caja"], "extra": 1},
            {"id": "net-1", "name": "Cocina", "model": "XP-80", "connection": "network", "address": "192.168.1.40:9100",
             "paperMm": 80, "encoding": "utf-8", "hasDrawer": false, "cut": false, "stationIds": ["st-cocina", "st-barra"]}
        ],
        "setup": {"step": "done"}
    }))
    .unwrap()
}

fn job(kind: &str, station: Option<&str>, payload: serde_json::Value) -> PrintJob {
    PrintJob { id: "j1".into(), kind: kind.into(), station: station.map(Into::into), created_at: None, payload }
}

fn comanda() -> PrintJob {
    job("command", Some("st-barra"), json!({"invoiceNumber": "6f1c2a8e-4b1d", "table": 4, "waiter": "Ana",
        "items": [{"name": "Limonada", "quantity": 2}, {"name": "Café", "quantity": 1}]}))
}

#[test]
fn connections_follow_the_printer_kind() {
    let s = settings();
    assert_eq!(connection_of(&s.printers[0]), Connection::Spooler { name: "EPSON TM-T20III Receipt".into() });
    assert_eq!(connection_of(&s.printers[1]), Connection::Network { host: "192.168.1.40".into(), port: Some(9100) });
}

#[test]
fn a_job_goes_to_the_printers_of_its_station() {
    let s = settings();
    let names = |j: &PrintJob| printers_for_job(j, &s.printers, Some("st-caja")).iter().map(|p| p.name.clone()).collect::<Vec<_>>();
    assert_eq!(names(&comanda()), vec!["Cocina"]);
    assert_eq!(names(&job("invoice", Some("st-caja"), json!({}))), vec!["Caja"]);
    assert!(names(&job("command", Some("st-postres"), json!({}))).is_empty());
    // An invoice without a station prints on the Caja printers.
    assert_eq!(names(&job("invoice", None, json!({}))), vec!["Caja"]);
}

#[test]
fn job_bytes_add_the_preamble_and_respect_the_cutter() {
    let s = settings();
    let now = chrono::NaiveDate::from_ymd_opt(2026, 11, 7).unwrap().and_hms_opt(12, 0, 0).unwrap();
    let bytes = job_bytes(&comanda(), &s.printers[1], now).unwrap();
    assert!(bytes.starts_with(&[0x1b, 0x40]));
    assert!(!bytes.ends_with(FULL_CUT), "no cutter: no cut command");
    assert!(String::from_utf8_lossy(&bytes).contains("LIMONADA"));

    let cash = job("invoice", Some("st-caja"), json!({"invoiceNumber": "FE-1", "invoice": {"paymentMethod": "cash"}, "displayItems": []}));
    let bytes = job_bytes(&cash, &s.printers[0], now).unwrap();
    assert!(bytes.ends_with(FULL_CUT));
    assert!(bytes.windows(5).any(|w| w == drawer_pulse().as_slice()), "cash invoice opens the drawer");

    let card = job("invoice", Some("st-caja"), json!({"invoiceNumber": "FE-2", "invoice": {"paymentMethod": "nequi"}, "displayItems": []}));
    assert!(!job_bytes(&card, &s.printers[0], now).unwrap().windows(5).any(|w| w == drawer_pulse().as_slice()));
}

#[test]
fn queue_titles_read_like_the_design() {
    assert_eq!(job_summary(&comanda()), ("Comanda #6f1c · Mesa 4".to_string(), "2× Limonada, 1× Café".to_string()));
    let delivery = job("command", None, json!({"invoiceNumber": "abcd9", "delivery": {"customerName": "Luis"}, "items": [{"name": "Sancocho"}]}));
    assert_eq!(job_summary(&delivery).0, "Comanda #abcd · Domicilio");
    let invoice = job("invoice", None, json!({"invoiceNumber": "FE-2040", "invoice": {"table": 3, "bill": {"total": 86400}}}));
    assert_eq!(job_summary(&invoice), ("Factura FE-2040 · Mesa 3".to_string(), "$ 86.400".to_string()));
}

#[test]
fn the_updater_endpoint_uses_the_vipe_origin() {
    assert_eq!(
        UPDATER_ENDPOINT_TEMPLATE,
        "https://<api>/api/desktop/updates/{{target}}/{{current_version}}"
    );
    assert_eq!(
        updater_endpoint("https://vipe.example.com/caja?x=1").as_deref(),
        Some("https://vipe.example.com/api/desktop/updates/{{target}}/{{current_version}}")
    );
    assert_eq!(
        updater_endpoint("http://localhost:3000").as_deref(),
        Some("http://localhost:3000/api/desktop/updates/{{target}}/{{current_version}}")
    );
    assert_eq!(updater_endpoint("not a url"), None);
}

#[test]
fn updates_install_only_out_of_service() {
    let ten_min = 10 * 60_000;
    assert!(idle_for_update(0, None, 1_000_000));
    assert!(!idle_for_update(1, None, 1_000_000), "jobs waiting");
    assert!(!idle_for_update(0, Some(1_000_000 - ten_min + 1), 1_000_000), "printed in the last 10 minutes");
    assert!(idle_for_update(0, Some(1_000_000 - ten_min), 1_000_000));
}

#[test]
fn default_settings_match_the_first_run_shape() {
    let d = default_settings();
    assert_eq!(d["webUrl"], "https://vipe-staging.212.56.33.197.sslip.io");
    assert_eq!(d["setup"]["step"], "welcome");
    assert_eq!(d["setup"]["maxStep"], 1);
    assert_eq!(d["printers"], json!([]));
    let parsed: Settings = serde_json::from_value(d).unwrap();
    assert!(parsed.device_token.is_none());
}
