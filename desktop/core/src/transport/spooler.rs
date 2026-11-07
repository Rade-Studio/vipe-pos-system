//! Windows spooler in RAW mode: the ESC/POS bytes go to the printer driver
//! untouched (OpenPrinter → StartDocPrinter "RAW" → WritePrinter).

use super::{Transport, TransportError};
use std::ffi::c_void;
use windows_sys::Win32::Foundation::GetLastError;
use windows_sys::Win32::Graphics::Printing::{
    ClosePrinter, EndDocPrinter, EndPagePrinter, EnumPrintersW, OpenPrinterW, StartDocPrinterW, StartPagePrinter,
    WritePrinter, DOC_INFO_1W, PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL, PRINTER_HANDLE, PRINTER_INFO_4W,
};

pub struct SpoolerTransport {
    name: String,
}

impl SpoolerTransport {
    pub fn new(name: &str) -> Self {
        SpoolerTransport { name: name.to_string() }
    }
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn last_error(step: &str, printer: &str) -> String {
    format!("{step} failed for {printer} (error {})", unsafe { GetLastError() })
}

impl Transport for SpoolerTransport {
    fn send(&mut self, data: &[u8]) -> Result<(), TransportError> {
        let name = wide(&self.name);
        let mut doc_name = wide("VIPE");
        let mut datatype = wide("RAW");
        let mut handle: PRINTER_HANDLE = std::ptr::null_mut();
        // SAFETY: every pointer refers to a live, NUL-terminated buffer owned by
        // this frame, and the handle is closed on every path below.
        unsafe {
            if OpenPrinterW(name.as_ptr(), &mut handle, std::ptr::null()) == 0 {
                return Err(TransportError::Unreachable(last_error("OpenPrinter", &self.name)));
            }
            let doc = DOC_INFO_1W { pDocName: doc_name.as_mut_ptr(), pOutputFile: std::ptr::null_mut(), pDatatype: datatype.as_mut_ptr() };
            let result = (|| {
                if StartDocPrinterW(handle, 1, &doc) == 0 {
                    return Err(TransportError::Io(last_error("StartDocPrinter", &self.name)));
                }
                let mut written: u32 = 0;
                let ok = StartPagePrinter(handle) != 0
                    && WritePrinter(handle, data.as_ptr() as *const c_void, data.len() as u32, &mut written) != 0;
                EndPagePrinter(handle);
                EndDocPrinter(handle);
                if !ok || written as usize != data.len() {
                    return Err(TransportError::Io(last_error("WritePrinter", &self.name)));
                }
                Ok(())
            })();
            ClosePrinter(handle);
            result
        }
    }

    fn describe(&self) -> String {
        self.name.clone()
    }
}

/// Names of the printers installed in Windows.
pub fn list_printers() -> Vec<String> {
    let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
    let mut needed: u32 = 0;
    let mut count: u32 = 0;
    // SAFETY: the first call only asks for the buffer size; the second writes
    // `count` PRINTER_INFO_4W records into a buffer of `needed` bytes.
    unsafe {
        EnumPrintersW(flags, std::ptr::null(), 4, std::ptr::null_mut(), 0, &mut needed, &mut count);
        if needed == 0 {
            return Vec::new();
        }
        let mut buf = vec![0u64; (needed as usize).div_ceil(8)];
        if EnumPrintersW(flags, std::ptr::null(), 4, buf.as_mut_ptr() as *mut u8, needed, &mut needed, &mut count) == 0 {
            return Vec::new();
        }
        let infos = std::slice::from_raw_parts(buf.as_ptr() as *const PRINTER_INFO_4W, count as usize);
        infos
            .iter()
            .filter(|i| !i.pPrinterName.is_null())
            .map(|i| {
                let mut len = 0;
                while *i.pPrinterName.add(len) != 0 {
                    len += 1;
                }
                String::from_utf16_lossy(std::slice::from_raw_parts(i.pPrinterName, len))
            })
            .collect()
    }
}
