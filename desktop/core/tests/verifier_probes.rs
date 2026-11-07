//! Probes from the independent verification of F5b (S2): restaurants without
//! stations get jobs with no station, and the F6 envelope may carry a station
//! object next to `stationId`.

use serde_json::json;
use vipe_desktop_core::jobs::PrintJob;
use vipe_desktop_core::station::{printers_for_job, Settings};

fn settings() -> Settings {
    serde_json::from_value(json!({
        "printers": [
            {"id": "usb-1", "name": "Caja", "connection": "usb", "address": "EPSON", "hasDrawer": false, "stationIds": ["st-caja"]},
            {"id": "net-1", "name": "Cocina", "connection": "network", "address": "192.168.1.40:9100", "stationIds": ["st-cocina"]},
            {"id": "net-2", "name": "Barra", "connection": "network", "address": "192.168.1.41:9100", "stationIds": []}
        ]
    }))
    .unwrap()
}

fn names(job: &PrintJob, caja: Option<&str>) -> Vec<String> {
    let s = settings();
    printers_for_job(job, &s.printers, caja).iter().map(|p| p.name.clone()).collect()
}

fn job(kind: &str, extra: serde_json::Value) -> PrintJob {
    let mut v = json!({"id": "j1", "kind": kind, "createdAt": "2026-11-07T12:00:00Z", "payload": {}});
    v.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
    serde_json::from_value(v).expect("job parses")
}

#[test]
fn p1_a_legacy_command_with_no_station_reaches_at_least_one_printer() {
    let legacy = job("command", json!({"stationId": null}));
    assert_eq!(names(&legacy, None), vec!["Caja", "Cocina", "Barra"], "no station: every active printer");
}

#[test]
fn p1_an_invoice_with_no_station_prints_on_caja_or_everywhere() {
    let inv = job("invoice", json!({"stationId": null}));
    assert_eq!(names(&inv, Some("st-caja")), vec!["Caja"]);
    assert_eq!(names(&inv, None), vec!["Caja", "Cocina", "Barra"]);
    assert_eq!(names(&inv, Some("st-sin-impresora")), vec!["Caja", "Cocina", "Barra"]);
}

#[test]
fn p1_a_job_with_a_station_still_goes_only_to_its_printers() {
    assert_eq!(names(&job("command", json!({"stationId": "st-cocina"})), None), vec!["Cocina"]);
    assert!(names(&job("command", json!({"stationId": "st-postres"})), None).is_empty());
}

#[test]
fn p2_a_null_station_and_an_f6_station_object_both_parse() {
    assert_eq!(job("command", json!({"stationId": null})).station, None);
    assert_eq!(job("command", json!({})).station, None);
    let f6 = job("command", json!({"stationId": "st-cocina", "station": {"id": "st-cocina", "name": "Cocina"}}));
    assert_eq!(f6.station.as_deref(), Some("st-cocina"));
    let only_object = job("command", json!({"station": {"id": "st-barra", "name": "Barra"}}));
    assert_eq!(only_object.station.as_deref(), Some("st-barra"));
    let f6_null = job("invoice", json!({"stationId": null, "station": null}));
    assert_eq!(f6_null.station, None);
    // Rows stored by earlier builds used `station` as a plain string.
    assert_eq!(job("command", json!({"station": "st-caja"})).station.as_deref(), Some("st-caja"));
}

#[test]
fn p2_a_job_round_trips_through_the_queue_format() {
    let j = job("command", json!({"stationId": "st-cocina", "station": {"id": "st-cocina", "name": "Cocina"}}));
    let back: PrintJob = serde_json::from_value(serde_json::to_value(&j).unwrap()).unwrap();
    assert_eq!(back, j);
}
