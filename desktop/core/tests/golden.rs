//! Golden fixtures generated from pos/print_renderer.py (the Python listener this
//! crate replaces). Every case must produce the exact same lines and bytes.

use chrono::NaiveDateTime;
use serde_json::Value;
use vipe_desktop_core::escpos::{
    build_comanda_bytes, build_invoice_bytes, render_invoice, render_kitchen_order, Encoding,
};

fn fixtures() -> (NaiveDateTime, Vec<Value>) {
    let raw = include_str!("fixtures/golden.json");
    let doc: Value = serde_json::from_str(raw).expect("golden.json parses");
    let now = NaiveDateTime::parse_from_str(doc["now"].as_str().unwrap(), "%Y-%m-%dT%H:%M:%S").unwrap();
    (now, doc["cases"].as_array().unwrap().clone())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn encoding(case: &Value) -> Encoding {
    Encoding::parse(case["encoding"].as_str().unwrap()).unwrap()
}

#[test]
fn every_golden_case_has_identical_lines_and_bytes() {
    let (now, cases) = fixtures();
    assert!(cases.len() >= 60, "fixture set looks truncated: {}", cases.len());
    let mut failures = Vec::new();
    for case in &cases {
        let name = case["name"].as_str().unwrap();
        let expected_lines: Vec<String> =
            case["lines"].as_array().unwrap().iter().map(|l| l.as_str().unwrap().to_string()).collect();
        let (lines, bytes) = match case["kind"].as_str().unwrap() {
            "invoice" => {
                let number = case["invoiceNumber"].as_str().unwrap();
                let lines = render_invoice(number, &case["invoice"], &case["displayItems"], now);
                let bytes = build_invoice_bytes(number, &case["invoice"], &case["displayItems"], encoding(case), now);
                (lines, bytes)
            }
            _ => (
                render_kitchen_order(&case["order"], now),
                build_comanda_bytes(&case["order"], encoding(case), now),
            ),
        };
        let lines: Vec<String> = match lines {
            Ok(l) => l.into_iter().map(|l| l.text).collect(),
            Err(e) => {
                failures.push(format!("{name}: render error {e}"));
                continue;
            }
        };
        if lines != expected_lines {
            failures.push(format!("{name}: lines differ\n  got  {lines:?}\n  want {expected_lines:?}"));
        }
        match bytes {
            Ok(b) if hex(&b) == case["hex"].as_str().unwrap() => {}
            Ok(b) => failures.push(format!("{name}: bytes differ\n  got  {}\n  want {}", hex(&b), case["hex"])),
            Err(e) => failures.push(format!("{name}: build error {e}")),
        }
    }
    assert!(failures.is_empty(), "{} golden failures:\n{}", failures.len(), failures.join("\n"));
}

#[test]
fn dine_in_invoice_matches_the_pinned_python_sha256() {
    // pos/test_print_renderer.py pins this hash; the fixture carries the same bytes.
    let (now, cases) = fixtures();
    let case = cases.iter().find(|c| c["name"] == "dine_in_tip/cp1252").unwrap();
    let bytes = build_invoice_bytes("INV-1", &case["invoice"], &case["displayItems"], Encoding::Cp1252, now).unwrap();
    assert_eq!(hex(&bytes), case["hex"].as_str().unwrap());
    assert!(bytes.ends_with(&[b'\n', b'\n', b'\n', 0x1d, 0x56, 0x00]));
}

#[test]
fn cp1252_replaces_unencodable_characters_with_question_marks() {
    use vipe_desktop_core::escpos::encode;
    assert_eq!(encode("Ñandú — €", Encoding::Cp1252), vec![0xd1, b'a', b'n', b'd', 0xfa, b' ', 0x97, b' ', 0x80]);
    assert_eq!(encode("寿🍣\u{81}", Encoding::Cp1252), b"???".to_vec());
    assert_eq!(encode("ñ", Encoding::Utf8), "ñ".as_bytes().to_vec());
}

#[test]
fn encoding_names_follow_the_python_listener() {
    assert_eq!(Encoding::parse("cp1252"), Some(Encoding::Cp1252));
    assert_eq!(Encoding::parse("utf-8"), Some(Encoding::Utf8));
    assert_eq!(Encoding::parse("latin-9"), None);
}
