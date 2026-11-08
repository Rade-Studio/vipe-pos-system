# Impresoras en el panel de la app de escritorio

Add and configure printers inside the VIPE desktop app's Estación panel (not the first-run wizard), and let network printers be entered by IP and port.
Branch `feat/desktop-printers-inline` from `dev` after #155. Desktop app only (desktop/app, desktop/core); UI copy in Spanish, code in English. Follows the approved design design/estacion-vipe/01-panel-con-menu.html, state "agregar".

## Specs

- S1. "No me gusto el configurador de impresoras, cada vez que voy a configurar una impresora o agregar, me envias al paso a paso en vez de hacerlo ahi mismo": "Agregar impresora" and configuring an existing printer happen inside the panel's Impresoras page, never by sending the user back to the first-run wizard.
- S2. "y adicionalmente cuando es por red no me dejas colocarle la IP y el puerto, ya que uno configura eso por ip y puerto para identificarlas": a network printer is added and edited by IP and port (port defaults to 9100), and its IP and port are shown in the printer list.
- S3. The add flow follows the approved design's in-panel steps (Buscar with "Escribir IP a mano" → Nombre y papel → Prueba → Estación), and the first-run wizard's search step also offers "Escribir IP a mano".
- S4. An existing printer can be edited (name, connection address or IP and port, paper, drawer, cut, stations) and removed from the panel.
- S5. Light and dark, no overflow, targets ≥ 44 px in the app window (phase rule S6).

## Tasks

- [ ] T1. Inline add and edit flow in the panel, manual IP and port (panel, wizard search step, model helpers), tests (S1–S5). Route: worker. Commit: pending.
- [ ] T2. Windows build check and a new installer (S1–S5). Route: parent. Commit: none.

## Log

- L1 (user, 2026-11-07): "No me gusto el configurador de impresoras, cada vez que voy a configurar una impresora o agregar, me envias al paso a paso en vez de hacerlo ahi mismo, y adicionalmente cuando es por red no me dejas colocarle la IP y el puerto, ya que uno configura eso por ip y puerto para identificarlas".
- L2 (evidence, 2026-11-07): `addPrinter()` in desktop/app/src/main.tsx:70-75 saves `setup.step = 'discover'` and switches the whole window to `<Setup>`; printer rows (panel/pages/Impresoras.tsx:44-52) only offer "Abrir cajón" / "Imprimir prueba", with no edit or remove; `LocalPrinter.address` is one string "host:port, Windows printer name or COM port" (bridge/types.ts:13) that core parses (core/src/station.rs:78-87, port 9100 by default); `discover_printers` only lists Windows spooler printers, and no screen lets the user type an IP. The approved design shows an in-panel 4-step add card with "Escribir IP a mano" but never draws that form.
- L3 (decision, 2026-11-07): the IP form is a minimal overlay on the design's step 1 (fields "IP o nombre del equipo" and "Puerto", 9100 prefilled, port 1–65535, IPv4 or hostname validated); it stores `address = host:port` with `connection = network`, so the Rust core and the print queue do not change. Editing reuses the same step components on one in-panel card; removing asks for confirmation. Bluetooth (COM) entry stays as today because its transport is not implemented yet.
