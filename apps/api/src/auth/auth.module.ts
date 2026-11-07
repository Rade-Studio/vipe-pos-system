import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ENV, type Env } from '../config/env';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { PasswordsService } from './passwords.service';
import { PinsService } from './pins.service';
import { SupervisorAuthorizationsService } from './supervisor-authorizations.service';
import { TokensService } from './tokens.service';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordsService,
    PinsService,
    SupervisorAuthorizationsService,
    { provide: TokensService, useFactory: (env: Env) => new TokensService(env), inject: [ENV] },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [TokensService, PasswordsService, PinsService, SupervisorAuthorizationsService],
})
export class AuthModule {}
