import { Global, Module } from '@nestjs/common';
import { ENV, parseEnv } from './env';

/** Global module exposing the validated environment under the ENV token. */
@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => parseEnv(process.env) }],
  exports: [ENV],
})
export class EnvModule {}
