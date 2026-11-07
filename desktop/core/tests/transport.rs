//! Printer transports: TCP 9100 against a local fake printer, plus the
//! connection kinds that are not available on this platform.

use std::io::Read;
use std::net::TcpListener;
use std::thread;
use std::time::Duration;
use vipe_desktop_core::transport::{open_transport, Connection, TcpTransport, Transport, TransportError};

/// A fake network printer: accepts one connection and returns what it received.
fn fake_printer() -> (String, thread::JoinHandle<Vec<u8>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap().to_string();
    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut buf = Vec::new();
        stream.read_to_end(&mut buf).unwrap();
        buf
    });
    (addr, handle)
}

#[test]
fn tcp_sends_the_exact_bytes_and_closes() {
    let (addr, printer) = fake_printer();
    let data: Vec<u8> = (0u8..=255).cycle().take(10_000).collect();
    let mut t = TcpTransport::new(&addr, Duration::from_secs(2));
    t.send(&data).unwrap();
    assert_eq!(printer.join().unwrap(), data);
}

#[test]
fn tcp_reports_an_unreachable_printer() {
    let port = {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        l.local_addr().unwrap().port()
    }; // closed again: nothing listens there now
    let mut t = TcpTransport::new(&format!("127.0.0.1:{port}"), Duration::from_millis(500));
    match t.send(b"x") {
        Err(TransportError::Unreachable(msg)) => assert!(msg.contains(&port.to_string()), "{msg}"),
        other => panic!("expected Unreachable, got {other:?}"),
    }
}

#[test]
fn tcp_rejects_an_invalid_address() {
    let mut t = TcpTransport::new("not an address", Duration::from_millis(200));
    assert!(matches!(t.send(b"x"), Err(TransportError::InvalidAddress(_))));
}

#[test]
fn open_transport_builds_a_network_printer_with_the_default_port() {
    let (addr, printer) = fake_printer();
    let (host, port) = addr.rsplit_once(':').unwrap();
    let conn = Connection::Network { host: host.into(), port: Some(port.parse().unwrap()) };
    let mut t = open_transport(&conn).unwrap();
    assert_eq!(t.describe(), addr);
    t.send(b"\x1b@hola").unwrap();
    assert_eq!(printer.join().unwrap(), b"\x1b@hola");
    let default = Connection::Network { host: "192.168.1.50".into(), port: None };
    assert_eq!(open_transport(&default).unwrap().describe(), "192.168.1.50:9100");
}

#[test]
fn serial_com_ports_are_not_supported_yet() {
    let conn = Connection::Serial { port: "COM3".into(), baud: Some(9600) };
    let mut t = open_transport(&conn).unwrap();
    assert_eq!(t.describe(), "COM3");
    assert!(matches!(t.send(b"x"), Err(TransportError::Unsupported(_))));
}

#[cfg(not(windows))]
#[test]
fn the_windows_spooler_is_only_available_on_windows() {
    let conn = Connection::Spooler { name: "EPSON TM-T20III".into() };
    assert!(matches!(open_transport(&conn), Err(TransportError::Unsupported(_))));
    assert!(vipe_desktop_core::transport::list_system_printers().is_empty());
}

#[test]
fn connections_serialize_with_a_kind_tag() {
    let conn: Connection = serde_json::from_str(r#"{"kind":"network","host":"10.0.0.9","port":9100}"#).unwrap();
    assert_eq!(conn, Connection::Network { host: "10.0.0.9".into(), port: Some(9100) });
    let usb = serde_json::to_value(Connection::Spooler { name: "Caja".into() }).unwrap();
    assert_eq!(usb, serde_json::json!({"kind": "spooler", "name": "Caja"}));
}
