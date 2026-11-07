//! How bytes reach a printer: TCP 9100 (network), the Windows spooler in RAW
//! mode (USB printers installed in Windows) and serial COM ports (Bluetooth
//! printers; not implemented yet).

mod serial;
#[cfg(windows)]
mod spooler;
mod tcp;

pub use serial::SerialTransport;
#[cfg(windows)]
pub use spooler::SpoolerTransport;
pub use tcp::TcpTransport;

use std::time::Duration;

pub const DEFAULT_TCP_PORT: u16 = 9100;
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum TransportError {
    /// The printer did not answer (off, unplugged, wrong address).
    #[error("printer unreachable: {0}")]
    Unreachable(String),
    #[error("invalid printer address: {0}")]
    InvalidAddress(String),
    #[error("not supported: {0}")]
    Unsupported(String),
    /// Connected but the write failed (paper, cover, cable).
    #[error("printer i/o: {0}")]
    Io(String),
}

pub trait Transport: Send {
    fn send(&mut self, data: &[u8]) -> Result<(), TransportError>;
    fn describe(&self) -> String;
}

/// A printer connection as stored in the station settings.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Connection {
    Network {
        host: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        port: Option<u16>,
    },
    /// A printer installed in Windows (usually USB), written in RAW mode.
    Spooler { name: String },
    /// A COM port (Bluetooth SPP or serial).
    Serial {
        port: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        baud: Option<u32>,
    },
}

pub fn open_transport(conn: &Connection) -> Result<Box<dyn Transport>, TransportError> {
    match conn {
        Connection::Network { host, port } => {
            let addr = format!("{host}:{}", port.unwrap_or(DEFAULT_TCP_PORT));
            Ok(Box::new(TcpTransport::new(&addr, DEFAULT_TIMEOUT)))
        }
        #[cfg(windows)]
        Connection::Spooler { name } => Ok(Box::new(SpoolerTransport::new(name))),
        #[cfg(not(windows))]
        Connection::Spooler { name } => Err(TransportError::Unsupported(format!("Windows printer {name}"))),
        Connection::Serial { port, baud } => Ok(Box::new(SerialTransport::new(port, *baud))),
    }
}

/// Printers installed in Windows (local and connections). Empty elsewhere.
pub fn list_system_printers() -> Vec<String> {
    #[cfg(windows)]
    {
        spooler::list_printers()
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}
