//! Shared native state: the settings JSON (same shape as `StationSettings` in
//! src/bridge/types.ts), the SQLite print queue and per-printer health.

use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use vipe_desktop_core::queue::{Queue, RetryPolicy};
use vipe_desktop_core::station::{default_settings, Settings};

#[derive(Debug, Clone, Serialize)]
pub struct PrinterState {
    pub id: String,
    pub health: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub struct AppState {
    pub dir: PathBuf,
    /// Started with `--demo`: mock API, no bytes reach a printer.
    pub demo: bool,
    pub settings: Mutex<Value>,
    pub queue: Mutex<Queue>,
    pub health: Mutex<HashMap<String, PrinterState>>,
    pub last_print_ms: Mutex<Option<i64>>,
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

impl AppState {
    pub fn open(dir: PathBuf, demo: bool) -> Result<Self, String> {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let settings = std::fs::read_to_string(dir.join("settings.json"))
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .map(merge_defaults)
            .unwrap_or_else(default_settings);
        let queue = Queue::open(&dir.join("queue.sqlite"), RetryPolicy::default()).map_err(|e| e.to_string())?;
        Ok(AppState {
            dir,
            demo,
            settings: Mutex::new(settings),
            queue: Mutex::new(queue),
            health: Mutex::new(HashMap::new()),
            last_print_ms: Mutex::new(None),
        })
    }

    pub fn settings_json(&self) -> Value {
        self.settings.lock().unwrap().clone()
    }

    /// The typed part the worker reads; falls back to defaults on a bad file.
    pub fn settings(&self) -> Settings {
        serde_json::from_value(self.settings_json())
            .unwrap_or_else(|_| serde_json::from_value(default_settings()).expect("default settings"))
    }

    pub fn save_settings(&self, next: Value) -> Result<(), String> {
        let text = serde_json::to_string_pretty(&next).map_err(|e| e.to_string())?;
        let tmp = self.dir.join("settings.json.tmp");
        std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, self.dir.join("settings.json")).map_err(|e| e.to_string())?;
        *self.settings.lock().unwrap() = next;
        Ok(())
    }

    /// Without a device token there is no server: jobs go to the mock adapter.
    pub fn mock_output(&self) -> bool {
        self.demo || self.settings().device_token.is_none()
    }

    pub fn set_health(&self, id: &str, health: &'static str, error: Option<String>) {
        let state = PrinterState { id: id.into(), health, error };
        self.health.lock().unwrap().insert(id.into(), state);
    }
}

/// Saved settings from an older version keep their values; new keys get defaults.
fn merge_defaults(saved: Value) -> Value {
    let mut out = default_settings();
    if let (Some(base), Value::Object(saved)) = (out.as_object_mut(), saved) {
        for (k, v) in saved {
            base.insert(k, v);
        }
    }
    out
}
