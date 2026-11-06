import { Global, Module } from '@nestjs/common';
import { Clock } from './clock';

/** Global shared services: the one Clock every module injects, so a test stub of app.get(Clock) reaches them all. */
@Global()
@Module({
  providers: [Clock],
  exports: [Clock],
})
export class CommonModule {}
