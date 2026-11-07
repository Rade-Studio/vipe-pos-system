//! ESC/POS byte streams for kitchen comandas and invoices, ported from
//! pos/print_renderer.py and pos/print_encoder.py. The golden fixtures in
//! tests/fixtures/golden.json were produced by the Python code and must match
//! byte for byte.

mod payment;
mod py;
mod render;

use chrono::{NaiveDate, NaiveDateTime, NaiveTime};
use serde_json::Value;

pub use py::truthy as py_truthy;
pub use render::{render_invoice, render_kitchen_order};

/// Text encoding sent to the printer (`print_encoder.py`): CP1252 is the safe
/// default for Spanish text on legacy firmware; UTF-8 when the printer supports it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Encoding {
    #[serde(rename = "cp1252")]
    Cp1252,
    #[serde(rename = "utf-8")]
    Utf8,
}

impl Encoding {
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "cp1252" => Some(Encoding::Cp1252),
            "utf-8" => Some(Encoding::Utf8),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Align {
    Left,
    Center,
    Right,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrintLine {
    pub text: String,
    pub bold: bool,
    pub align: Align,
}

/// A payload the renderer cannot turn into bytes (the Python code would raise).
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{0}")]
pub struct RenderError(pub String);

pub fn build_comanda_bytes(order: &Value, encoding: Encoding, now: NaiveDateTime) -> Result<Vec<u8>, RenderError> {
    Ok(lines_to_bytes(&render_kitchen_order(order, now)?, encoding))
}

pub fn build_invoice_bytes(
    invoice_number: &str,
    invoice: &Value,
    display_items: &Value,
    encoding: Encoding,
    now: NaiveDateTime,
) -> Result<Vec<u8>, RenderError> {
    Ok(lines_to_bytes(&render_invoice(invoice_number, invoice, display_items, now)?, encoding))
}

/// Bold, alignment, text and newline per line, then three feeds and a full cut.
pub fn lines_to_bytes(lines: &[PrintLine], encoding: Encoding) -> Vec<u8> {
    let mut out = Vec::new();
    for line in lines {
        if line.bold {
            out.extend_from_slice(b"\x1b\x45\x01");
        }
        out.extend_from_slice(match line.align {
            Align::Left => b"\x1b\x61\x00",
            Align::Center => b"\x1b\x61\x01",
            Align::Right => b"\x1b\x61\x02",
        });
        out.extend(encode(&line.text, encoding));
        out.push(b'\n');
        if line.bold {
            out.extend_from_slice(b"\x1b\x45\x00");
        }
    }
    out.extend_from_slice(b"\n\n\n");
    out.extend_from_slice(FULL_CUT);
    out
}

/// GS V 0.
pub const FULL_CUT: &[u8] = b"\x1d\x56\x00";

/// `text.encode(encoding, errors="replace")`.
pub fn encode(text: &str, encoding: Encoding) -> Vec<u8> {
    match encoding {
        Encoding::Utf8 => text.as_bytes().to_vec(),
        Encoding::Cp1252 => text.chars().map(cp1252_byte).collect(),
    }
}

fn cp1252_byte(c: char) -> u8 {
    const HIGH: [(char, u8); 27] = [
        ('\u{20AC}', 0x80), ('\u{201A}', 0x82), ('\u{0192}', 0x83), ('\u{201E}', 0x84), ('\u{2026}', 0x85),
        ('\u{2020}', 0x86), ('\u{2021}', 0x87), ('\u{02C6}', 0x88), ('\u{2030}', 0x89), ('\u{0160}', 0x8A),
        ('\u{2039}', 0x8B), ('\u{0152}', 0x8C), ('\u{017D}', 0x8E), ('\u{2018}', 0x91), ('\u{2019}', 0x92),
        ('\u{201C}', 0x93), ('\u{201D}', 0x94), ('\u{2022}', 0x95), ('\u{2013}', 0x96), ('\u{2014}', 0x97),
        ('\u{02DC}', 0x98), ('\u{2122}', 0x99), ('\u{0161}', 0x9A), ('\u{203A}', 0x9B), ('\u{0153}', 0x9C),
        ('\u{017E}', 0x9E), ('\u{0178}', 0x9F),
    ];
    let code = c as u32;
    if code < 0x80 || (0xA0..=0xFF).contains(&code) {
        return code as u8;
    }
    HIGH.iter().find(|(ch, _)| *ch == c).map(|(_, b)| *b).unwrap_or(b'?')
}

/// ESC p 0 25 250: pulse the cash-drawer kick-out connector (pin 2).
pub fn drawer_pulse() -> Vec<u8> {
    vec![0x1b, 0x70, 0x00, 0x19, 0xfa]
}

/// Sent before every job: ESC @ (initialise) and, for CP1252, ESC t 16 (WPC1252
/// code table). The Python listener negotiated the same through python-escpos.
pub fn printer_preamble(encoding: Encoding) -> Vec<u8> {
    match encoding {
        Encoding::Cp1252 => vec![0x1b, 0x40, 0x1b, 0x74, 16],
        Encoding::Utf8 => vec![0x1b, 0x40],
    }
}

/// `_format_invoice_date`: `datetime.fromisoformat(value)` shown as
/// dd/mm/yyyy hh:mm:ss in the value's own wall time; anything else is `now`.
pub(crate) fn format_invoice_date(value: Option<&Value>, now: NaiveDateTime) -> String {
    let parsed = value.and_then(Value::as_str).and_then(parse_iso);
    parsed.unwrap_or(now).format("%d/%m/%Y %H:%M:%S").to_string()
}

fn parse_iso(s: &str) -> Option<NaiveDateTime> {
    if s.len() < 10 || !s.is_char_boundary(10) {
        return None;
    }
    let date = NaiveDate::parse_from_str(&s[..10], "%Y-%m-%d").ok()?;
    let rest = &s[10..];
    if rest.is_empty() {
        return Some(date.and_time(NaiveTime::MIN));
    }
    let rest = rest.strip_prefix('T').or_else(|| rest.strip_prefix(' '))?;
    // Drop a trailing offset (Z or ±HH:MM[:SS]); Python keeps the wall time.
    let time = match rest.find(|c| c == 'Z' || c == '+' || c == '-') {
        Some(i) => {
            let offset = &rest[i..];
            let ok = offset == "Z" || (offset.len() >= 6 && offset[1..].chars().all(|c| c.is_ascii_digit() || c == ':'));
            if !ok {
                return None;
            }
            &rest[..i]
        }
        None => rest,
    };
    let (hms, frac) = match time.split_once('.') {
        Some((h, f)) if !f.is_empty() && f.chars().all(|c| c.is_ascii_digit()) => (h, Some(f)),
        Some(_) => return None,
        None => (time, None),
    };
    let t = NaiveTime::parse_from_str(hms, "%H:%M:%S").or_else(|_| NaiveTime::parse_from_str(hms, "%H:%M")).ok()?;
    let micros: u32 = match frac {
        Some(f) => format!("{:0<6}", &f[..f.len().min(6)]).parse().ok()?,
        None => 0,
    };
    Some(date.and_time(t) + chrono::Duration::microseconds(micros as i64))
}
