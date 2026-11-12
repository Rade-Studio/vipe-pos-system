import { Logger } from '@nestjs/common';
import { type OnGatewayConnection, type OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { ACCESS_COOKIE, readCookie } from '../auth/cookies';
import { hasLiveSession, loadProfile } from '../auth/identity';
import { TokensService } from '../auth/tokens.service';
import { DbClient } from '../db/db-client';
import { UnitOfWork } from '../db/unit-of-work';
import type { PrintJobKind } from '../print/print.dto';
import { resolvePrinter } from '../print/printer-identity';
import type { ChangeEvent } from './change-event';

export const REALTIME_NAMESPACE = '/realtime';
export const CHANGE_EVENT = 'pos_changes';
export const RESYNC_EVENT = 'resync';
export const READY_EVENT = 'ready';
export const PRINT_JOB_EVENT = 'print_job';

export const restaurantRoom = (restaurantId: string) => `restaurant:${restaurantId}`;
export const printersRoom = (restaurantId: string) => `printers:${restaurantId}`;

/** A web session (cookie) or a printing service (`auth: {token}`). */
type SocketData = { kind: 'web'; restaurantId: string } | { kind: 'printer'; restaurantId: string; printerId: string };

/** `print_job` event body. */
export interface PrintJobEvent {
  id: string;
  kind: PrintJobKind;
  payload: Record<string, unknown>;
  createdAt: string;
}

/**
 * socket.io namespace /realtime. A socket is admitted only with a valid
 * `vipe_access` cookie whose session is live and whose user has an active
 * profile; the tenant is resolved in a unit of work (app.user_id), never
 * read from the token. Admitted sockets join `restaurant:<id>` and receive
 * `ready`, then `pos_changes` and `resync`.
 *
 * A printing service connects with `auth: {token}` instead (no cookie): the
 * token hash must resolve to a live printer (private.touch_printer, which also
 * records last_seen_at); it joins only `printers:<restaurantId>` and receives
 * `ready` and `print_job`, never `pos_changes`. A token, when present, decides
 * the identity. Anything else fails the handshake with `unauthorized`. CORS
 * comes from RealtimeIoAdapter.
 */
@WebSocketGateway({ namespace: REALTIME_NAMESPACE })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  private server?: Namespace;

  private readonly logger = new Logger('RealtimeGateway');

  constructor(
    private readonly tokens: TokensService,
    private readonly uow: UnitOfWork,
    private readonly client: DbClient,
  ) {}

  afterInit(server: Namespace): void {
    server.use((socket, next) => {
      this.authorize(socket).then(
        (data) => {
          if (!data) {
            next(new Error('unauthorized'));
            return;
          }
          socket.data = data;
          next();
        },
        (error: Error) => {
          this.logger.warn(`socket authorization failed: ${error.message}`);
          next(new Error('unauthorized'));
        },
      );
    });
  }

  async handleConnection(socket: Socket): Promise<void> {
    const data = socket.data as SocketData;
    await socket.join(data.kind === 'printer' ? printersRoom(data.restaurantId) : restaurantRoom(data.restaurantId));
    socket.emit(READY_EVENT, { restaurantId: data.restaurantId });
  }

  broadcast(restaurantId: string, event: ChangeEvent): void {
    this.server?.to(restaurantRoom(restaurantId)).emit(CHANGE_EVENT, event);
  }

  /** Every connected client refetches: changes may have been missed. */
  resyncAll(): void {
    this.server?.emit(RESYNC_EVENT);
  }

  /** A committed print job, to the restaurant's printing services only. */
  emitPrintJob(restaurantId: string, job: PrintJobEvent): void {
    this.server?.to(printersRoom(restaurantId)).emit(PRINT_JOB_EVENT, job);
  }

  /** Drop the live sockets of a revoked printer token. */
  disconnectPrinter(printerId: string): void {
    for (const socket of this.server?.sockets.values() ?? []) {
      const data = socket.data as SocketData | undefined;
      if (data?.kind === 'printer' && data.printerId === printerId) {
        socket.disconnect(true);
      }
    }
  }

  private async authorize(socket: Socket): Promise<SocketData | undefined> {
    const printerToken = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
    if (printerToken !== undefined) {
      const printer = await resolvePrinter(this.client.pool, printerToken);
      return printer && { kind: 'printer', restaurantId: printer.restaurantId, printerId: printer.id };
    }
    const restaurantId = await this.authorizeWeb(socket);
    return restaurantId ? { kind: 'web', restaurantId } : undefined;
  }

  private async authorizeWeb(socket: Socket): Promise<string | undefined> {
    const token = readCookie(socket.handshake, ACCESS_COOKIE);
    if (!token) {
      return undefined;
    }
    const auth = await this.tokens.verifyAccess(token).catch(() => undefined);
    if (!auth) {
      return undefined;
    }
    return this.uow.run(auth.userId, async (db) => {
      if (!(await hasLiveSession(db, auth.sessionId))) {
        return undefined;
      }
      return (await loadProfile(db))?.restaurantId;
    });
  }
}
