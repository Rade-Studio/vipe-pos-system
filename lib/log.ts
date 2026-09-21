/**
 * Thin logging wrapper that gates all output on NODE_ENV !== 'production'.
 * Replaces all bare console.* calls across components/, lib/, and store/.
 */

type LogLevel = 'info' | 'warn' | 'error'

function logImpl(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'production') return

  const fn = console[level] ?? console.log
  fn(`[${level.toUpperCase()}] ${message}`, meta ?? '')
}

export const log = {
  info:  (msg: string, meta?: Record<string, unknown>) => logImpl('info', msg, meta),
  warn:  (msg: string, meta?: Record<string, unknown>) => logImpl('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => logImpl('error', msg, meta),
}
