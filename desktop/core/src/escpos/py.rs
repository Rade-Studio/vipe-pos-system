//! The small slice of Python semantics pos/print_renderer.py relies on:
//! `str()` of JSON values, truthiness, `dict.get`, `round()` and `f"{n:,}"`.
//! Where Python would raise, these helpers return a `RenderError`, so a payload
//! the old listener could not print is unprintable here too.

use super::RenderError;
use serde_json::{Map, Value};

/// A Python number: JSON integers stay `int`, everything else is `float`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Num {
    Int(i64),
    Float(f64),
}

impl Num {
    pub fn of(v: &Value) -> Result<Num, RenderError> {
        match v {
            Value::Bool(b) => Ok(Num::Int(*b as i64)),
            Value::Number(n) => Ok(match n.as_i64() {
                Some(i) => Num::Int(i),
                None => Num::Float(n.as_f64().unwrap_or(f64::NAN)),
            }),
            other => Err(err(format!("not a number: {other}"))),
        }
    }

    pub fn f(self) -> f64 {
        match self {
            Num::Int(i) => i as f64,
            Num::Float(x) => x,
        }
    }

    pub fn add(self, o: Num) -> Num {
        match (self, o) {
            (Num::Int(a), Num::Int(b)) => Num::Int(a.saturating_add(b)),
            (a, b) => Num::Float(a.f() + b.f()),
        }
    }

    pub fn sub(self, o: Num) -> Num {
        match (self, o) {
            (Num::Int(a), Num::Int(b)) => Num::Int(a.saturating_sub(b)),
            (a, b) => Num::Float(a.f() - b.f()),
        }
    }

    pub fn mul(self, o: Num) -> Num {
        match (self, o) {
            (Num::Int(a), Num::Int(b)) => Num::Int(a.saturating_mul(b)),
            (a, b) => Num::Float(a.f() * b.f()),
        }
    }

    pub fn gt(self, o: Num) -> bool {
        self.f() > o.f()
    }
}

pub fn err(msg: impl Into<String>) -> RenderError {
    RenderError(msg.into())
}

/// `dict.get(key, default)`: the stored value when the key exists (even null).
pub fn get<'a>(obj: &'a Map<String, Value>, key: &str, default: &'a Value) -> &'a Value {
    obj.get(key).unwrap_or(default)
}

/// The value must be a dict, as `.get` on anything else raises in Python.
pub fn dict<'a>(v: &'a Value, what: &str) -> Result<&'a Map<String, Value>, RenderError> {
    v.as_object().ok_or_else(|| err(format!("{what} is not an object")))
}

pub fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map(|x| x != 0.0).unwrap_or(true),
        Value::String(s) => !s.is_empty(),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
    }
}

/// `x or default` followed by a string method: falsy gives `default`,
/// a truthy non-string raises in Python.
pub fn str_or<'a>(v: &'a Value, default: &'a str) -> Result<&'a str, RenderError> {
    if !truthy(v) {
        return Ok(default);
    }
    v.as_str().ok_or_else(|| err(format!("expected text, got {v}")))
}

/// A value that must be a string (Python would call a `str` method on it).
pub fn text(v: &Value) -> Result<&str, RenderError> {
    v.as_str().ok_or_else(|| err(format!("expected text, got {v}")))
}

/// `str(value)` / an f-string placeholder without a format spec.
pub fn pystr(v: &Value) -> String {
    match v {
        Value::Null => "None".into(),
        Value::Bool(true) => "True".into(),
        Value::Bool(false) => "False".into(),
        Value::String(s) => s.clone(),
        Value::Number(n) => match n.as_i64() {
            Some(i) => i.to_string(),
            None => float_repr(n.as_f64().unwrap_or(f64::NAN)),
        },
        other => other.to_string(),
    }
}

fn float_repr(x: f64) -> String {
    if x.is_finite() && x.fract() == 0.0 && x.abs() < 1e16 {
        format!("{x:.1}")
    } else {
        format!("{x}")
    }
}

/// `f"{int(round(value)):,}".replace(",", ".")` with Python's banker's rounding.
pub fn currency(n: Num) -> String {
    let int: i128 = match n {
        Num::Int(i) => i as i128,
        Num::Float(x) => x.round_ties_even() as i128,
    };
    let digits = int.unsigned_abs().to_string();
    let mut out = String::new();
    for (i, ch) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            out.push('.');
        }
        out.push(ch);
    }
    if int < 0 {
        format!("-{out}")
    } else {
        out
    }
}

/// `str.capitalize()`: first character upper, the rest lower.
pub fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars.flat_map(char::to_lowercase)).collect(),
        None => String::new(),
    }
}

/// `format(s, "<width")` / `format(s, "<width.width")`.
pub fn ljust(s: &str, width: usize) -> String {
    format!("{s:<width$}")
}

pub fn rjust(s: &str, width: usize) -> String {
    format!("{s:>width$}")
}

pub fn ljust_trunc(s: &str, width: usize) -> String {
    format!("{s:<width$.width$}")
}
