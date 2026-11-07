// Bridge to the Rust side (src-tauri/src/commands.rs). Command names and
// argument names must match the #[tauri::command] functions.
import { invoke } from '@tauri-apps/api/core';
import type { Bridge } from './types';

export const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function createTauriBridge(): Bridge {
  return {
    kind: 'tauri',
    loadSettings: () => invoke('load_settings'),
    saveSettings: (settings) => invoke('save_settings', { settings }),
    discoverPrinters: () => invoke('discover_printers'),
    testPrint: (printer, restaurant) => invoke('test_print', { printer, restaurant }),
    openDrawer: (printer) => invoke('open_drawer', { printer }),
    status: () => invoke('station_status'),
    enqueueJobs: (jobs) => invoke('enqueue_jobs', { jobs }),
    takeAcks: () => invoke('take_acks'),
    markAcked: (id) => invoke('mark_acked', { id }),
    retryJob: (id) => invoke('retry_job', { id }),
    cancelJob: (id) => invoke('cancel_job', { id }),
    reprint: (id) => invoke('reprint_job', { id }),
    setAutostart: (enabled) => invoke('set_autostart', { enabled }),
    updateTray: (items, tooltip) => invoke('update_tray', { items, tooltip }),
    openPanel: (page) => invoke('open_panel', { page: page ?? null }),
    showVipe: () => invoke('show_vipe'),
  };
}

/** True when the app was started with --demo (mock API, no real printing). */
export const isDemoMode = () => invoke<boolean>('demo_mode');
