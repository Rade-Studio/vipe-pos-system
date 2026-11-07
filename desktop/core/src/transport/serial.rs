use super::{Transport, TransportError};

/// Serial / Bluetooth (SPP) printer on a COM port. Placeholder: the settings
/// can be stored, printing answers `Unsupported` until the serial driver lands.
pub struct SerialTransport {
    port: String,
    #[allow(dead_code)]
    baud: u32,
}

impl SerialTransport {
    pub fn new(port: &str, baud: Option<u32>) -> Self {
        SerialTransport { port: port.to_string(), baud: baud.unwrap_or(9600) }
    }
}

impl Transport for SerialTransport {
    fn send(&mut self, _data: &[u8]) -> Result<(), TransportError> {
        Err(TransportError::Unsupported(format!("serial port {} (Bluetooth printing is not available yet)", self.port)))
    }

    fn describe(&self) -> String {
        self.port.clone()
    }
}
