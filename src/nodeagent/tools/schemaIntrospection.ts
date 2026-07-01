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
  const typeName = zodTypeName(unwrapped);
  if (typeName !== "ZodObject") return { typeName, propertyNames: [], required: [] };
  const shape = zodShape(unwrapped);
  const propertyNames = Object.keys(shape).sort();
  const required = propertyNames.filter((key) => !zodIsOptionalish(shape[key])).sort();
  return { typeName, propertyNames, required };
}

function zodShape(schema: ZodTypeAny): Record<string, ZodTypeAny> {
  const shape = zodDef(schema).shape;
  return (typeof shape === "function" ? shape() : shape) as Record<string, ZodTypeAny>;
}

function unwrapZod(schema: ZodTypeAny): ZodTypeAny {
  let current = schema;
  for (let i = 0; i < 20; i++) {
    const typeName = zodTypeName(current);
    const def = zodDef(current);
    if (typeName === "ZodEffects") {
      current = def.schema ?? def.in ?? current;
      continue;
    }
    if (typeName === "ZodOptional" || typeName === "ZodNullable" || typeName === "ZodDefault" || typeName === "ZodCatch") {
      current = def.innerType ?? current;
      continue;
    }
    break;
  }
  return current;
}

function zodIsOptionalish(schema: ZodTypeAny): boolean {
  const typeName = zodTypeName(schema);
  if (typeName === "ZodOptional" || typeName === "ZodDefault" || typeName === "ZodCatch") return true;
  if (typeName === "ZodEffects") {
    const def = zodDef(schema);
    return zodIsOptionalish(def.schema ?? def.in ?? schema);
  }
  return false;
}

type ZodDefCompat = {
  typeName?: unknown;
  type?: unknown;
  shape?: unknown;
  schema?: ZodTypeAny;
  innerType?: ZodTypeAny;
  in?: ZodTypeAny;
};

function zodDef(schema: ZodTypeAny): ZodDefCompat {
  return ((schema as { _def?: ZodDefCompat; def?: ZodDefCompat })._def ?? (schema as { def?: ZodDefCompat }).def ?? {}) as ZodDefCompat;
}

function zodTypeName(schema: ZodTypeAny): string {
  const def = zodDef(schema);
  const v3 = typeof def.typeName === "string" ? def.typeName : undefined;
  if (v3) return v3;
  switch (def.type) {
    case "object": return "ZodObject";
    case "optional": return "ZodOptional";
    case "nullable": return "ZodNullable";
    case "default": return "ZodDefault";
    case "catch": return "ZodCatch";
    case "pipe": return "ZodEffects";
    default: return typeof def.type === "string" ? def.type : "unknown";
  }
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
