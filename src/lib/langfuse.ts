import { LangfuseSpanProcessor } from "@langfuse/otel";
import { setLangfuseTracerProvider } from "@langfuse/tracing";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

let spanProcessor: LangfuseSpanProcessor | undefined;
let initialized = false;

export function isLangfuseEnabled(): boolean {
  return Boolean(process.env.LANGFUSE_SECRET_KEY && process.env.LANGFUSE_PUBLIC_KEY);
}

export function ensureLangfuseTracing(): void {
  if (initialized || !isLangfuseEnabled()) {
    return;
  }

  spanProcessor = new LangfuseSpanProcessor({
    exportMode: process.env.VERCEL ? "immediate" : "batched",
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    flushInterval: Number(process.env.LANGFUSE_FLUSH_INTERVAL ?? "1"),
  });

  const provider = new NodeTracerProvider({
    spanProcessors: [spanProcessor],
  });

  provider.register();
  setLangfuseTracerProvider(provider);
  initialized = true;
}

export async function flushLangfuse(): Promise<void> {
  await spanProcessor?.forceFlush();
}
