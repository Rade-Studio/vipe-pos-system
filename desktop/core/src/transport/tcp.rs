use super::{Transport, TransportError};
use std::io::Write;
use std::net::{Shutdown, TcpStream, ToSocketAddrs};
use std::time::Duration;

/// Raw TCP (port 9100, "JetDirect") network printer.
pub struct TcpTransport {
    addr: String,
    timeout: Duration,
}

impl TcpTransport {
    pub fn new(addr: &str, timeout: Duration) -> Self {
        TcpTransport { addr: addr.to_string(), timeout }
    }
}

impl Transport for TcpTransport {
    fn send(&mut self, data: &[u8]) -> Result<(), TransportError> {
        let target = self
            .addr
            .to_socket_addrs()
            .map_err(|e| TransportError::InvalidAddress(format!("{}: {e}", self.addr)))?
            .next()
            .ok_or_else(|| TransportError::InvalidAddress(self.addr.clone()))?;
        let mut stream = TcpStream::connect_timeout(&target, self.timeout)
            .map_err(|e| TransportError::Unreachable(format!("{}: {e}", self.addr)))?;
        stream.set_write_timeout(Some(self.timeout)).map_err(|e| TransportError::Io(e.to_string()))?;
        stream.write_all(data).map_err(|e| TransportError::Io(format!("{}: {e}", self.addr)))?;
        stream.flush().map_err(|e| TransportError::Io(e.to_string()))?;
        let _ = stream.shutdown(Shutdown::Write);
        Ok(())
    }

    fn describe(&self) -> String {
        self.addr.clone()
    }
}
