import { Logger } from '@nestjs/common';
import { type OnGatewayConnection, type OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { ACCESS_COOKIE, readCookie } from '../auth/cookies';
import { hasLiveSession, loadProfile } from '../auth/identity';
import { TokensService } from '../auth/tokens.service';
import { UnitOfWork } from '../db/unit-of-work';
import type { ChangeEvent } from './change-event';

export const REALTIME_NAMESPACE = '/realtime';
export const CHANGE_EVENT = 'pos_changes';
export const RESYNC_EVENT = 'resync';
export const READY_EVENT = 'ready';

export const restaurantRoom = (restaurantId: string) => `restaurant:${restaurantId}`;

interface SocketData {
  restaurantId: string;
}

/**
 * socket.io namespace /realtime. A socket is admitted only with a valid
 * `vipe_access` cookie whose session is live and whose user has an active
 * profile; the tenant is resolved in a unit of work (app.user_id), never
 * read from the token. Admitted sockets join `restaurant:<id>` and receive
 * `ready`, then `pos_changes` and `resync`. Anything else fails the
 * handshake with `unauthorized`. CORS comes from RealtimeIoAdapter.
 */
@WebSocketGateway({ namespace: REALTIME_NAMESPACE })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  private server?: Namespace;

  private readonly logger = new Logger('RealtimeGateway');

  constructor(
    private readonly tokens: TokensService,
    private readonly uow: UnitOfWork,
  ) {}

  afterInit(server: Namespace): void {
    server.use((socket, next) => {
      this.authorize(socket).then(
        (restaurantId) => {
          if (!restaurantId) {
            next(new Error('unauthorized'));
            return;
          }
          (socket.data as SocketData).restaurantId = restaurantId;
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
    const { restaurantId } = socket.data as SocketData;
    await socket.join(restaurantRoom(restaurantId));
    socket.emit(READY_EVENT, { restaurantId });
  }

  broadcast(restaurantId: string, event: ChangeEvent): void {
    this.server?.to(restaurantRoom(restaurantId)).emit(CHANGE_EVENT, event);
  }

  /** Every connected client refetches: changes may have been missed. */
  resyncAll(): void {
    this.server?.emit(RESYNC_EVENT);
  }

  private async authorize(socket: Socket): Promise<string | undefined> {
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
