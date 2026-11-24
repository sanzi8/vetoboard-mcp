import type { McpServer } from "@modelcontextprotocol/server";

/**
 * Universal Cross-Vendor Function-Calling JSON Schema Sanitizer & Validator (`schemaCompat.ts`).
 *
 * Why this exists:
 * `zod@4` emits JSON Schema Draft 2020-12 keywords such as `"propertyNames": { "type": "string" }`,
 * `"$schema"`, and nested `"additionalProperties": { "anyOf": [...] }`.
 * While Anthropic / Antigravity accept them, **DeepSeek API (`deepseek-chat` / `deepseek-reasoner`),
 * OpenAI Function Calling, Google Gemini OpenAI-compat, and LiteLLM / Hermes Agent** reject schemas
 * containing `propertyNames` or union `additionalProperties` with `HTTP 400 Invalid function schema`.
 *
 * Stripping these wire-only Draft-2020-12 artifacts from `tools/list` preserves 100% of Zod's
 * server-side runtime validation while making every VetoBoard tool schema clean across all 6+ ecosystems.
 */

const FORBIDDEN_CROSS_VENDOR_KEYS = new Set([
  "$schema",
  "propertyNames",
  "unevaluatedProperties",
  "prefixItems",
]);

export function sanitizeJsonSchemaForCrossVendor(node: unknown): unknown {
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node)) {
    return node.map((item) => sanitizeJsonSchemaForCrossVendor(item));
  }

  const record = node as Record<string, unknown>;
  const cleaned: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (FORBIDDEN_CROSS_VENDOR_KEYS.has(key)) continue;

    if (
      key === "additionalProperties" &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      const addPropObj = value as Record<string, unknown>;
      if ("anyOf" in addPropObj || "oneOf" in addPropObj) {
        cleaned[key] = true;
        continue;
      }
    }

    cleaned[key] = sanitizeJsonSchemaForCrossVendor(value);
  }

  return cleaned;
}

export function applyUniversalSchemaSanitizer(server: McpServer): void {
  const normalizeRootSchema = (raw: unknown): Record<string, unknown> => {
    const sanitized = sanitizeJsonSchemaForCrossVendor(raw) as Record<string, unknown>;
    if (sanitized.type !== "object") {
      sanitized.type = "object";
    }
    if (!sanitized.properties || typeof sanitized.properties !== "object") {
      sanitized.properties = {};
    }
    return sanitized;
  };

  const internal = server as unknown as {
    _toolInputSchemaJson?: Record<string, Record<string, unknown>>;
    server?: {
      _requestHandlers?: Map<
        string,
        (req: unknown, extra: unknown) => Promise<{ tools?: Array<Record<string, unknown>> }> | { tools?: Array<Record<string, unknown>> }
      >;
    };
  };

  const cache = internal._toolInputSchemaJson;
  if (cache && typeof cache === "object") {
    for (const toolName of Object.keys(cache)) {
      const raw = cache[toolName];
      if (raw) cache[toolName] = normalizeRootSchema(raw);
    }
  }

  const handlers = internal.server?._requestHandlers;
  const origToolsList = handlers?.get("tools/list");
  if (handlers && origToolsList) {
    handlers.set("tools/list", async (req, extra) => {
      const res = await origToolsList(req, extra);
      if (!res || !Array.isArray(res.tools)) return res;
      return {
        ...res,
        tools: res.tools.map((tool) => ({
          ...tool,
          ...(tool.inputSchema ? { inputSchema: normalizeRootSchema(tool.inputSchema) } : {}),
        })),
      };
    });
  }
}

export interface SchemaCompatibilityIssue {
  readonly toolName: string;
  readonly path: string;
  readonly reason: string;
}

export function auditToolSchemaForAllVendors(params: {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: unknown;
}): SchemaCompatibilityIssue[] {
  const issues: SchemaCompatibilityIssue[] = [];
  const { name, description, inputSchema } = params;

  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
    issues.push({
      path: "$name",
      reason: `Tool name "${name}" violates OpenAI/DeepSeek ^[a-zA-Z0-9_-]{1,64}$ constraint.`,
      toolName: name,
    });
  }

  if (!description || description.trim().length === 0) {
    issues.push({
      path: "$description",
      reason: "Missing non-empty tool description.",
      toolName: name,
    });
  } else if (description.length > 1024) {
    issues.push({
      path: "$description",
      reason: `Description length (${description.length}) exceeds OpenAI/DeepSeek 1024-char limit.`,
      toolName: name,
    });
  }

  if (!inputSchema || typeof inputSchema !== "object" || Array.isArray(inputSchema)) {
    issues.push({
      path: "$",
      reason: "Root inputSchema must be a JSON object.",
      toolName: name,
    });
    return issues;
  }

  const root = inputSchema as Record<string, unknown>;
  if (root.type !== "object") {
    issues.push({
      path: "$.type",
      reason: `Root inputSchema.type must be "object" (got ${JSON.stringify(root.type)}).`,
      toolName: name,
    });
  }
  if (!root.properties || typeof root.properties !== "object") {
    issues.push({
      path: "$.properties",
      reason: "Root inputSchema must define a properties object.",
      toolName: name,
    });
  }

  const walk = (node: unknown, path: string): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, idx) => walk(item, `${path}[${idx}]`));
      return;
    }
    const obj = node as Record<string, unknown>;
    for (const badKey of ["$schema", "propertyNames", "unevaluatedProperties", "prefixItems", "anyOf", "oneOf"]) {
      if (badKey in obj) {
        issues.push({
          path: `${path}.${badKey}`,
          reason: `Contains "${badKey}", which triggers HTTP 400 in strict DeepSeek / OpenAI / Gemini tool parsers.`,
          toolName: name,
        });
      }
    }
    if (obj.type === "array" && (!obj.items || typeof obj.items !== "object")) {
      issues.push({
        path: `${path}.items`,
        reason: 'Schema node with type="array" is missing an "items" schema.',
        toolName: name,
      });
    }
    for (const [k, v] of Object.entries(obj)) {
      walk(v, `${path}.${k}`);
    }
  };

  walk(root, "$");
  return issues;
}
