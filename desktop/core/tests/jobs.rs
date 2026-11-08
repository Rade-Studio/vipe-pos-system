//! Job rules ported from pos/print_jobs.py: which payloads print, which are
//! acknowledged without printing, and the cash-drawer pulse.

use chrono::{DateTime, Duration, NaiveDateTime, Utc};
use serde_json::json;
use vipe_desktop_core::escpos::{drawer_pulse, printer_preamble, Encoding};
use vipe_desktop_core::jobs::{classify, render_job, Disposition, PrintJob};

fn now() -> DateTime<Utc> {
    Utc::now()
}

fn local() -> NaiveDateTime {
    now().naive_local()
}

fn command(created_at: Option<String>) -> PrintJob {
    PrintJob {
        id: "6f1c2a8e-4b1d-4c55-9a0e-2f7e3c9d1a01".into(),
        kind: "command".into(),
        station: Some("cocina".into()),
        created_at,
        payload: json!({
            "invoiceNumber": "6f1c2a8e-4b1d-4c55-9a0e-2f7e3c9d1a01",
            "items": [{"name": "Ajiaco", "quantity": 2, "comments": "sin alcaparras"}],
            "waiter": "Mesero Dev",
            "table": 4
        }),
    }
}

#[test]
fn a_fresh_command_prints() {
    let job = command(Some((now() - Duration::minutes(5)).to_rfc3339()));
    assert_eq!(classify(&job, now()), Disposition::Print);
    let bytes = render_job(&job, Encoding::Cp1252, local()).unwrap();
    let text = String::from_utf8_lossy(&bytes);
    assert!(text.contains("AJIACO"), "{text}");
    assert!(text.contains("  Sin alcaparras"), "{text}");
}

#[test]
fn a_command_older_than_twelve_hours_is_acknowledged_without_printing() {
    let job = command(Some((now() - Duration::hours(13)).to_rfc3339()));
    assert_eq!(classify(&job, now()), Disposition::Skip("command older than 12 h".into()));
    // Exactly at the edge it still prints (Python compares with `>`).
    let edge = command(Some((now() - Duration::hours(12) + Duration::seconds(5)).to_rfc3339()));
    assert_eq!(classify(&edge, now()), Disposition::Print);
}

#[test]
fn an_old_invoice_still_prints() {
    let mut job = command(Some((now() - Duration::days(3)).to_rfc3339()));
    job.kind = "invoice".into();
    job.payload = json!({"invoiceNumber": "F-0001", "invoice": {}, "displayItems": []});
    assert_eq!(classify(&job, now()), Disposition::Print);
    assert!(render_job(&job, Encoding::Cp1252, local()).is_ok());
}

#[test]
fn unparseable_created_at_is_not_treated_as_old() {
    let job = command(Some("yesterday".into()));
    assert_eq!(classify(&job, now()), Disposition::Print);
    assert_eq!(classify(&command(None), now()), Disposition::Print);
}

#[test]
fn unprintable_payloads_are_skipped() {
    let mut no_waiter = command(None);
    no_waiter.payload["waiter"] = json!("");
    assert_eq!(classify(&no_waiter, now()), Disposition::Skip("unprintable command".into()));

    let mut no_items = command(None);
    no_items.payload["items"] = json!([]);
    assert_eq!(classify(&no_items, now()), Disposition::Skip("unprintable command".into()));

    let mut unknown = command(None);
    unknown.kind = "label".into();
    assert_eq!(classify(&unknown, now()), Disposition::Skip("unknown kind label".into()));

    let mut invoice = command(None);
    invoice.kind = "invoice".into();
    invoice.payload = json!({"invoice": {}});
    assert_eq!(classify(&invoice, now()), Disposition::Skip("unprintable invoice".into()));
}

#[test]
fn an_empty_id_is_rejected() {
    let mut job = command(None);
    job.id = String::new();
    assert_eq!(classify(&job, now()), Disposition::Reject("print job without id".into()));
}

#[test]
fn drawer_pulse_is_esc_p_on_pin_2() {
    assert_eq!(drawer_pulse(), vec![0x1b, 0x70, 0x00, 0x19, 0xfa]);
}

#[test]
fn preamble_initialises_and_selects_the_code_page() {
    assert_eq!(printer_preamble(Encoding::Cp1252), vec![0x1b, 0x40, 0x1b, 0x74, 16]);
    assert_eq!(printer_preamble(Encoding::Utf8), vec![0x1b, 0x40]);
}

/// A stored job with orderNumber and station prints the pos/ bytes (golden_plus probe_header_number_station).
#[test]
fn a_command_with_order_number_and_station_prints_the_python_bytes() {
    let doc: serde_json::Value = serde_json::from_str(include_str!("fixtures/golden_plus.json")).unwrap();
    let at = NaiveDateTime::parse_from_str(doc["now"].as_str().unwrap(), "%Y-%m-%dT%H:%M:%S").unwrap();
    for (name, encoding) in [("probe_header_number_station/cp1252", Encoding::Cp1252), ("probe_header_number_station/utf-8", Encoding::Utf8)] {
        let case = doc["cases"].as_array().unwrap().iter().find(|c| c["name"] == name).unwrap();
        assert_eq!(case["lines"][0], "COMANDA #130 \u{2014} Mesa 1");
        assert_eq!(case["lines"][1], "Estaci\u{f3}n: Cocina");
        let job = PrintJob { id: "job-1".into(), kind: "command".into(), station: None, created_at: None, payload: case["order"].clone() };
        let bytes = render_job(&job, encoding, at).unwrap();
        let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(hex, case["hex"].as_str().unwrap(), "{name}");
    }
}
