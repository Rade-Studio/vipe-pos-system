import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { DbClient } from '../db/db-client';
import { type DesktopDevice, resolveDevice } from './desktop-identity';

export interface DesktopRequest extends Request {
  desktopDevice?: DesktopDevice;
}

/**
 * Desktop app routes (marked @Public(), so no cookie and no unit of work):
 * `Authorization: Bearer vdt_…` must resolve to a live device, else 401
 * `device_unauthorized` (missing, unknown, a staff cookie or a printer
 * token) or `device_revoked`. The restaurant comes from the device row.
 */
@Injectable()
export class DesktopDeviceGuard implements CanActivate {
  constructor(private readonly client: DbClient) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<DesktopRequest>();
    const match = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '');
    req.desktopDevice = await resolveDevice(this.client.pool, match?.[1]);
    return true;
  }
}
