//! Background print loop. The title bar's sync loop (src/sync.ts) fetches
//! pending jobs per desktop/API-CONTRACT.md §5 into the queue and sends the
//! acks; this loop claims due jobs, renders them with the core and writes the
//! bytes to every printer serving the job's station. Without a device token
//! (or with --demo) the mock adapter records the job as printed without
//! touching a printer.

use crate::state::{now_ms, AppState};
use std::sync::Arc;
use std::time::Duration;
use vipe_desktop_core::jobs::PrintJob;
use vipe_desktop_core::station::{connection_of, job_bytes, printers_for_job, Printer};
use vipe_desktop_core::transport::{open_transport, TransportError};

const TICK: Duration = Duration::from_millis(1000);
const PRUNE_EVERY_MS: i64 = 3600 * 1000;

pub fn spawn(state: Arc<AppState>) {
    std::thread::Builder::new()
        .name("vipe-print-worker".into())
        .spawn(move || run(state))
        .expect("print worker thread");
}

fn run(state: Arc<AppState>) {
    let mut last_prune = 0;
    loop {
        let now = now_ms();
        if now - last_prune > PRUNE_EVERY_MS {
            let _ = state.queue.lock().unwrap().prune(now);
            last_prune = now;
        }
        // Drain every due job before sleeping.
        // The lock is released before printing (a `while let` scrutinee would hold it).
        loop {
            let next = state.queue.lock().unwrap().claim_next(now_ms());
            let Ok(Some(claimed)) = next else { break };
            let result = print_job(&state, &claimed.job);
            let q = state.queue.lock().unwrap();
            let _ = match result {
                Ok(()) => q.mark_printed(&claimed.job.id, now_ms()),
                Err(e) => q.mark_failed(&claimed.job.id, &e, now_ms()).map(|_| ()),
            };
        }
        std::thread::sleep(TICK);
    }
}

/// Print one job on all its printers; the first failure fails the job.
pub fn print_job(state: &AppState, job: &PrintJob) -> Result<(), String> {
    let settings = state.settings();
    let targets = printers_for_job(job, &settings.printers);
    if targets.is_empty() {
        return Err("Ninguna impresora atiende esta estación".into());
    }
    let now = chrono::Local::now().naive_local();
    for printer in targets {
        let bytes = job_bytes(job, printer, now).map_err(|e| format!("No se pudo preparar el ticket: {}", e.0))?;
        send(state, printer, &bytes)?;
    }
    *state.last_print_ms.lock().unwrap() = Some(now_ms());
    Ok(())
}

/// Write raw bytes to a printer and keep its health for the panel and heartbeat.
pub fn send(state: &AppState, printer: &Printer, bytes: &[u8]) -> Result<(), String> {
    if state.mock_output() {
        state.set_health(&printer.id, "ready", None);
        return Ok(());
    }
    state.set_health(&printer.id, "printing", None);
    let result = open_transport(&connection_of(printer)).and_then(|mut t| t.send(bytes));
    match result {
        Ok(()) => {
            state.set_health(&printer.id, "ready", None);
            Ok(())
        }
        Err(e) => {
            let (health, text) = describe(&e);
            state.set_health(&printer.id, health, Some(text.clone()));
            Err(format!("{}: {text}", printer.name))
        }
    }
}

fn describe(e: &TransportError) -> (&'static str, String) {
    match e {
        TransportError::Unreachable(_) => ("offline", "No responde".into()),
        TransportError::InvalidAddress(a) => ("error", format!("Dirección no válida ({a})")),
        TransportError::Unsupported(_) => ("error", "Conexión no disponible todavía".into()),
        TransportError::Io(_) => ("error", "Revise papel, tapa y cable".into()),
    }
}
