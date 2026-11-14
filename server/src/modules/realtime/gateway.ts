import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { pool } from '../../db/pool';

export const EVENTS_CHANNEL = 'dsa_events'; // NOTIFY channel written by the triggers in migration 005

/** Events clients may receive (see /docs/websocket-events.md). Anything else on the channel is dropped. */
export const EVENT_NAMES = new Set([
  'submission:queued',
  'submission:running',
  'submission:finished',
  'leaderboard:updated',
  'daily:new',
]);

/** `userId` set → only that user's sockets; unset → everyone. */
export interface RealtimeEvent {
  event: string;
  userId?: string;
  data: unknown;
}

export interface EventSource {
  /** Starts delivering events; resolves to an unsubscribe function. */
  subscribe(onEvent: (e: RealtimeEvent) => void): Promise<() => Promise<void>>;
}

/** One LISTEN connection per API instance. Every instance gets every event, so no Socket.IO adapter is needed. */
export class PostgresEventSource implements EventSource {
  async subscribe(onEvent: (e: RealtimeEvent) => void) {
    const client = await pool.connect();
    // shortcut: no reconnect if this connection drops; clients still have REST polling. Add one before multi-day uptime matters.
    client.on('error', (err) => console.error('[realtime] LISTEN connection error', err));
    client.on('notification', (msg) => {
      if (msg.channel !== EVENTS_CHANNEL || !msg.payload) return;
      try {
        onEvent(JSON.parse(msg.payload));
      } catch {
        // malformed payload: ignore rather than crash the gateway
      }
    });
    await client.query(`LISTEN ${EVENTS_CHANNEL}`);
    return async () => {
      await client.query(`UNLISTEN ${EVENTS_CHANNEL}`).catch(() => {});
      client.release();
    };
  }
}

/**
 * Socket.IO on the API's HTTP server. Clients connect with `io(url, { auth: { token: accessToken } })`;
 * each socket joins room `user:<id>`.
 */
export function attachRealtime(
  app: FastifyInstance,
  source: EventSource,
  origin: string[] | boolean = true
) {
  // Same allow-list as REST CORS (app.ts). The JWT in the handshake, not a cookie, is what authenticates.
  const io = new Server(app.server, { cors: { origin } });

  io.use((socket, next) => {
    try {
      const { sub } = app.jwt.verify<{ sub: string }>(String(socket.handshake.auth?.token ?? ''));
      if (typeof sub !== 'string' || !sub) throw new Error('no subject');
      socket.data.userId = sub;
      next();
    } catch {
      next(new Error('UNAUTHORIZED')); // client sees connect_error with this message
    }
  });
  io.on('connection', (socket) => void socket.join(`user:${socket.data.userId}`));

  // Fastify runs these hooks once per plugin context, so both are guarded to act only once.
  let subscription: Promise<() => Promise<void>> | undefined;
  app.addHook('onReady', async () => {
    subscription ??= source.subscribe(({ event, userId, data }) => {
      if (!EVENT_NAMES.has(event)) return;
      if (userId) io.to(`user:${userId}`).emit(event, data);
      else io.emit(event, data);
    });
    await subscription;
  });
  // Before the HTTP server closes: open sockets would otherwise keep it from shutting down.
  app.addHook('preClose', async () => {
    const current = subscription;
    subscription = undefined;
    if (!current) return;
    io.disconnectSockets(true);
    io.engine.close();
    await (
      await current
    )();
  });
  return io;
}
