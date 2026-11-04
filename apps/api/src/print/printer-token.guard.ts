import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { DbClient } from '../db/db-client';
import { type Printer, resolvePrinter } from './printer-identity';

export interface PrinterRequest extends Request {
  printer?: Printer;
}

/**
 * Printing-service routes (marked @Public(), so no cookie and no unit of
 * work): `Authorization: Bearer <printer token>` must resolve to a live,
 * not revoked printer, else 401. The restaurant comes from the token row.
 */
@Injectable()
export class PrinterTokenGuard implements CanActivate {
  constructor(private readonly client: DbClient) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<PrinterRequest>();
    const match = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '');
    const printer = match ? await resolvePrinter(this.client.pool, match[1]) : undefined;
    if (!printer) {
      throw new UnauthorizedException('Printer token required');
    }
    req.printer = printer;
    return true;
  }
}
