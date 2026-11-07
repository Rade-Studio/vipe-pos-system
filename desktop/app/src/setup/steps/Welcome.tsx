import { Clock, Home, Printer, RefreshCw } from 'lucide-react';
import type { StepContext } from '../Setup';
import { Acts, NextButton } from './common';

export const APP_VERSION = '0.1.0';

export function Welcome({ ctx }: { ctx: StepContext }) {
  return (
    <section className="step">
      <p className="eyebrow">VIPE {APP_VERSION} instalado</p>
      <h1>Bienvenido a VIPE en este computador</h1>
      <p className="lead">
        Aquí abres la caja o la administración de VIPE, según quien inicie sesión, y este computador imprime facturas y
        comandas y abre el cajón sin diálogos. Configurarlo toma unos 5 minutos.
      </p>
      <ul className="feats">
        <li className="card">
          <Home aria-hidden />
          <b>La misma VIPE</b>
          <small>Caja, administración o cocina con tu usuario de siempre.</small>
        </li>
        <li className="card">
          <Printer aria-hidden />
          <b>Impresión directa</b>
          <small>USB, red o Bluetooth; papel de 58 u 80 mm.</small>
        </li>
        <li className="card">
          <RefreshCw aria-hidden />
          <b>Se actualiza solo</b>
          <small>Siempre fuera del servicio: al reiniciar o al cierre.</small>
        </li>
      </ul>
      <p className="note">
        <Clock aria-hidden />
        Ten a mano otro equipo con VIPE abierto como administrador: lo necesitas en el paso 2 para generar el código.
      </p>
      <Acts>
        <NextButton label="Empezar" onClick={() => void ctx.next()} />
      </Acts>
    </section>
  );
}
