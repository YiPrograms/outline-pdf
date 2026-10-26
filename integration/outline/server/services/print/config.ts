import { ValidationError } from "@server/errors";

export function printConfig() {
  const integer = (name: string, fallback: number, maximum: number) => {
    const value = Number(process.env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
      throw ValidationError(`Invalid ${name}`);
    return value;
  };
  return {
    enabled: process.env.ADVANCED_PRINT_ENABLED === "true",
    maxDocuments: integer("ADVANCED_PRINT_MAX_DOCUMENTS", 200, 1000),
    maxBytes: integer("ADVANCED_PRINT_MAX_SIZE", 52428800, 268435456),
    timeoutMs: integer("ADVANCED_PRINT_TIMEOUT", 180000, 600000),
  };
}
