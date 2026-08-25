import { AsyncLocalStorage } from "node:async_hooks";

export interface CorrelationContext {
  readonly correlationId: string;
}

export interface LogFields {
  readonly correlationId?: string;
  readonly [key: string]: unknown;
}

export interface OperationalLogger {
  info(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export interface LogRecord extends LogFields {
  readonly timestamp: string;
  readonly level: "info" | "error";
  readonly event: string;
  readonly service: string;
}

export type LogWriter = (record: LogRecord) => void;

const storage = new AsyncLocalStorage<CorrelationContext>();

export function runWithCorrelation<T>(
  correlationId: string,
  operation: () => T,
): T {
  return storage.run({ correlationId }, operation);
}

export function currentCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

export class StructuredLogger implements OperationalLogger {
  constructor(
    private readonly service = "vibe-control-plane",
    private readonly writer: LogWriter = (record) => {
      process.stdout.write(`${JSON.stringify(record)}\n`);
    },
  ) {}

  info(event: string, fields: LogFields = {}): void {
    this.write("info", event, fields);
  }

  error(event: string, fields: LogFields = {}): void {
    this.write("error", event, fields);
  }

  private write(level: LogRecord["level"], event: string, fields: LogFields): void {
    const correlationId = fields.correlationId ?? currentCorrelationId();
    this.writer({
      timestamp: new Date().toISOString(),
      level,
      event,
      service: this.service,
      ...(correlationId ? { correlationId } : {}),
      ...fields,
    });
  }
}

export const silentLogger: OperationalLogger = {
  info: () => undefined,
  error: () => undefined,
};
