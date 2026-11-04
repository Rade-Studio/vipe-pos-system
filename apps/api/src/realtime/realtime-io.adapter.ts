import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { Server, ServerOptions } from 'socket.io';

/**
 * socket.io server with the API's CORS policy (web origin, credentials for the
 * cookie). CORS only governs HTTP long-polling; `allowRequest` also refuses a
 * WebSocket upgrade from a foreign browser Origin. Requests without Origin
 * (non-browser clients) still need the access cookie.
 */
export class RealtimeIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly webOrigin: string,
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const cors = { origin: this.webOrigin, credentials: true };
    const allowRequest: ServerOptions['allowRequest'] = (req, callback) => {
      const origin = req.headers.origin;
      callback(null, origin === undefined || origin === this.webOrigin);
    };
    return super.createIOServer(port, { ...(options as ServerOptions), cors, allowRequest });
  }
}
