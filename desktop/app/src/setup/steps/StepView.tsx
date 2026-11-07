import type { StepContext } from '../Setup';
import { Connect } from './Connect';
import { Details } from './Details';
import { Discover } from './Discover';
import { Done } from './Done';
import { Prints } from './Prints';
import { StationStep } from './StationStep';
import { Startup } from './Startup';
import { TestPrint } from './TestPrint';
import { Welcome } from './Welcome';

export function StepView({ ctx }: { ctx: StepContext }) {
  const { step, printerIndex } = ctx.settings.setup;
  switch (step) {
    case 'welcome':
      return <Welcome ctx={ctx} />;
    case 'connect':
      return <Connect ctx={ctx} />;
    case 'prints':
      return <Prints ctx={ctx} />;
    case 'discover':
      return <Discover ctx={ctx} />;
    case 'details':
      return <Details key={printerIndex} ctx={ctx} />;
    case 'test':
      return <TestPrint key={printerIndex} ctx={ctx} />;
    case 'station':
      return <StationStep key={printerIndex} ctx={ctx} />;
    case 'startup':
      return <Startup ctx={ctx} />;
    case 'done':
      return <Done ctx={ctx} />;
  }
}

/** The printer edited in steps 5-7 and a setter for it. */
export function usePrinter(ctx: StepContext) {
  const { printers, setup } = ctx.settings;
  const printer = printers[setup.printerIndex];
  const set = (patch: Partial<typeof printer>) =>
    ctx.update({ printers: printers.map((p, i) => (i === setup.printerIndex ? { ...p, ...patch } : p)) });
  return { printer, set, index: setup.printerIndex, total: printers.length };
}
