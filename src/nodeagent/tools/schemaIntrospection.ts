import type { ZodTypeAny } from "zod";
import type { AgentTool } from "../core/types";

type JsonObject = Record<string, unknown>;

export type ToolSchemaSurface = {
  typeName: string;
  propertyNames: string[];
  required: string[];
};

export type ToolSchemaMismatch = {
  tool: string;
  reason: string;
};

export function canonicalToolSchemaSurface(tool: AgentTool): ToolSchemaSurface {
  return zodObjectSurface(tool.schema);
}

export function providerToolSchemaSurface(schema: JsonObject): ToolSchemaSurface {
  const properties = objectRecord(schema.properties) ?? {};
  const required = Array.isArray(schema.required) ? schema.required.map(String) : [];
  return {
    typeName: String(schema.type ?? "unknown"),
    propertyNames: Object.keys(properties).sort(),
    required: required.sort(),
  };
}

export function providerToolSchemaMismatches(tool: AgentTool, providerSchema: JsonObject): ToolSchemaMismatch[] {
  const canonical = canonicalToolSchemaSurface(tool);
  const provider = providerToolSchemaSurface(providerSchema);
  const mismatches: ToolSchemaMismatch[] = [];
  const providerProperties = new Set(provider.propertyNames);
  const providerRequired = new Set(provider.required);

  if (provider.typeName !== "object") {
    mismatches.push({ tool: tool.name, reason: `provider schema type must be object, got ${provider.typeName}` });
  }
  for (const property of canonical.propertyNames) {
    if (!providerProperties.has(property)) {
      mismatches.push({ tool: tool.name, reason: `provider schema missing canonical property ${property}` });
    }
  }
  for (const required of canonical.required) {
    if (!providerRequired.has(required)) {
      mismatches.push({ tool: tool.name, reason: `provider schema missing canonical required field ${required}` });
    }
  }
  for (const required of provider.required) {
    if (!providerProperties.has(required)) {
      mismatches.push({ tool: tool.name, reason: `provider schema requires unknown field ${required}` });
    }
  }
  return mismatches;
}

function zodObjectSurface(schema: ZodTypeAny): ToolSchemaSurface {
  const unwrapped = unwrapZod(schema);
  const typeName = String(unwrapped?._def?.typeName ?? "unknown");
  if (typeName !== "ZodObject") return { typeName, propertyNames: [], required: [] };
  const shape = zodShape(unwrapped);
  const propertyNames = Object.keys(shape).sort();
  const required = propertyNames.filter((key) => !zodIsOptionalish(shape[key])).sort();
  return { typeName, propertyNames, required };
}

function zodShape(schema: ZodTypeAny): Record<string, ZodTypeAny> {
  const shape = (schema as { _def?: { shape?: unknown } })._def?.shape;
  return (typeof shape === "function" ? shape() : shape) as Record<string, ZodTypeAny>;
}

function unwrapZod(schema: ZodTypeAny): ZodTypeAny {
  let current = schema;
  for (let i = 0; i < 20; i++) {
    const typeName = String(current?._def?.typeName ?? "");
    if (typeName === "ZodEffects") {
      current = current._def.schema;
      continue;
    }
    if (typeName === "ZodOptional" || typeName === "ZodNullable" || typeName === "ZodDefault" || typeName === "ZodCatch") {
      current = current._def.innerType;
      continue;
    }
    break;
  }
  return current;
}

function zodIsOptionalish(schema: ZodTypeAny): boolean {
  const typeName = String(schema?._def?.typeName ?? "");
  if (typeName === "ZodOptional" || typeName === "ZodDefault" || typeName === "ZodCatch") return true;
  if (typeName === "ZodEffects") return zodIsOptionalish(schema._def.schema);
  return false;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
