// ============================================================
// TypeBox 参数校验
// 含 allOf/anyOf/oneOf coercion 逻辑
// ============================================================

import { Compile } from 'typebox/compile';
import type { TLocalizedValidationError } from 'typebox/error';
import { Value } from 'typebox/value';
import type { Tool, ToolCall } from './types';

const validatorCache = new WeakMap<object, ReturnType<typeof Compile>>();
const TYPEBOX_KIND = Symbol.for('TypeBox.Kind');

// ---------- JSON Schema 结构 ----------

interface JsonSchemaObject {
  type?: string | string[];
  properties?: Record<string, JsonSchemaObject>;
  items?: JsonSchemaObject | JsonSchemaObject[];
  additionalProperties?: boolean | JsonSchemaObject;
  allOf?: JsonSchemaObject[];
  anyOf?: JsonSchemaObject[];
  oneOf?: JsonSchemaObject[];
}

// ---------- 类型守卫 ----------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isJsonSchemaObject(value: unknown): value is JsonSchemaObject {
  return isRecord(value);
}

function hasTypeBoxMetadata(schema: unknown): boolean {
  return isRecord(schema) && Object.getOwnPropertySymbols(schema).includes(TYPEBOX_KIND);
}

function isValidatorSchema(value: unknown): value is Tool['parameters'] {
  return isRecord(value);
}

// ---------- Schema 类型提取 ----------

function getSchemaTypes(schema: JsonSchemaObject): string[] {
  if (typeof schema.type === 'string') return [schema.type];
  if (Array.isArray(schema.type))
    return schema.type.filter((t): t is string => typeof t === 'string');
  return [];
}

function matchesJsonType(value: unknown, type: string): boolean {
  switch (type) {
    case 'number':
      return typeof value === 'number';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'string':
      return typeof value === 'string';
    case 'null':
      return value === null;
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isRecord(value) && !Array.isArray(value);
    default:
      return false;
  }
}

// ---------- 原始类型强制转换 ----------

function coercePrimitiveByType(value: unknown, type: string): unknown {
  switch (type) {
    case 'number': {
      if (value === null) return 0;
      if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
      }
      if (typeof value === 'boolean') return value ? 1 : 0;
      return value;
    }
    case 'integer': {
      if (value === null) return 0;
      if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isInteger(parsed)) return parsed;
      }
      if (typeof value === 'boolean') return value ? 1 : 0;
      return value;
    }
    case 'boolean': {
      if (value === null) return false;
      if (typeof value === 'string') {
        if (value === 'true') return true;
        if (value === 'false') return false;
      }
      if (typeof value === 'number') {
        if (value === 1) return true;
        if (value === 0) return false;
      }
      return value;
    }
    case 'string': {
      if (value === null) return '';
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      return value;
    }
    case 'null': {
      if (value === '' || value === 0 || value === false) return null;
      return value;
    }
    default:
      return value;
  }
}

// ---------- 对象属性 coercion ----------

function applySchemaObjectCoercion(value: Record<string, unknown>, schema: JsonSchemaObject): void {
  const properties = schema.properties;
  const definedKeys = new Set<string>(properties ? Object.keys(properties) : []);

  if (properties) {
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (!(key in value)) continue;
      value[key] = coerceWithJsonSchema(value[key], propertySchema);
    }
  }

  if (schema.additionalProperties && isJsonSchemaObject(schema.additionalProperties)) {
    for (const [key, propertyValue] of Object.entries(value)) {
      if (definedKeys.has(key)) continue;
      value[key] = coerceWithJsonSchema(propertyValue, schema.additionalProperties);
    }
  }
}

// ---------- 数组项 coercion ----------

function applySchemaArrayCoercion(value: unknown[], schema: JsonSchemaObject): void {
  if (Array.isArray(schema.items)) {
    for (let index = 0; index < value.length; index++) {
      const itemSchema = schema.items[index];
      if (!itemSchema) continue;
      value[index] = coerceWithJsonSchema(value[index], itemSchema);
    }
    return;
  }

  if (isJsonSchemaObject(schema.items)) {
    for (let index = 0; index < value.length; index++) {
      value[index] = coerceWithJsonSchema(value[index], schema.items);
    }
  }
}

// ---------- 联合模式 coercion (anyOf/oneOf) ----------

function getSubSchemaValidator(schema: JsonSchemaObject): ReturnType<typeof Compile> | undefined {
  if (!isValidatorSchema(schema)) return undefined;
  try {
    return getValidator(schema);
  } catch {
    return undefined;
  }
}

function coerceWithUnionSchema(value: unknown, schemas: JsonSchemaObject[]): unknown {
  for (const schema of schemas) {
    const candidate = structuredClone(value);
    const coerced = coerceWithJsonSchema(candidate, schema);
    const validator = getSubSchemaValidator(schema);
    if (validator?.Check(coerced)) return coerced;
  }
  return value;
}

// ---------- 主 coercion 函数 ----------

function coerceWithJsonSchema(value: unknown, schema: JsonSchemaObject): unknown {
  let nextValue = value;

  // allOf: 递归应用每个嵌套模式
  if (Array.isArray(schema.allOf)) {
    for (const nested of schema.allOf) {
      nextValue = coerceWithJsonSchema(nextValue, nested);
    }
  }

  // anyOf: 尝试每个候选项
  if (Array.isArray(schema.anyOf)) {
    nextValue = coerceWithUnionSchema(nextValue, schema.anyOf);
  }

  // oneOf: 尝试每个候选项
  if (Array.isArray(schema.oneOf)) {
    nextValue = coerceWithUnionSchema(nextValue, schema.oneOf);
  }

  // 原始类型联合（e.g. type: ["string", "number"]）
  const schemaTypes = getSchemaTypes(schema);
  const matchesUnionMember =
    schemaTypes.length > 1 && schemaTypes.some((t) => matchesJsonType(nextValue, t));
  if (schemaTypes.length > 0 && !matchesUnionMember) {
    for (const schemaType of schemaTypes) {
      const candidate = coercePrimitiveByType(nextValue, schemaType);
      if (candidate !== nextValue) {
        nextValue = candidate;
        break;
      }
    }
  }

  // 对象属性递归
  if (schemaTypes.includes('object') && isRecord(nextValue) && !Array.isArray(nextValue)) {
    applySchemaObjectCoercion(nextValue, schema);
  }

  // 数组项递归
  if (schemaTypes.includes('array') && Array.isArray(nextValue)) {
    applySchemaArrayCoercion(nextValue, schema);
  }

  return nextValue;
}

// ---------- Validator 缓存 ----------

function getValidator(schema: Tool['parameters']): ReturnType<typeof Compile> {
  const key = schema as object;
  const cached = validatorCache.get(key);
  if (cached) return cached;
  const validator = Compile(schema);
  validatorCache.set(key, validator);
  return validator;
}

// ---------- 错误格式化 ----------

function formatValidationPath(error: TLocalizedValidationError): string {
  if (error.keyword === 'required') {
    const requiredProperties = (error.params as { requiredProperties?: string[] })
      .requiredProperties;
    const requiredProperty = requiredProperties?.[0];
    if (requiredProperty) {
      const basePath = error.instancePath.replace(/^\//, '').replace(/\//g, '.');
      return basePath ? `${basePath}.${requiredProperty}` : requiredProperty;
    }
  }
  const path = error.instancePath.replace(/^\//, '').replace(/\//g, '.');
  return path || 'root';
}

// ---------- 公开 API ----------

export function validateToolCall(tools: Tool[], toolCall: ToolCall): Record<string, unknown> {
  const tool = tools.find((t) => t.name === toolCall.name);
  if (!tool) throw new Error(`Tool "${toolCall.name}" not found`);
  return validateToolArguments(tool, toolCall);
}

export function validateToolArguments(tool: Tool, toolCall: ToolCall): Record<string, unknown> {
  const args = structuredClone(toolCall.arguments);
  Value.Convert(tool.parameters, args);

  const validator = getValidator(tool.parameters);

  // 对非 TypeBox schema（纯 JSON Schema）尝试自定义 coercion
  if (!hasTypeBoxMetadata(tool.parameters) && isJsonSchemaObject(tool.parameters)) {
    const coerced = coerceWithJsonSchema(args, tool.parameters);
    if (coerced !== args) {
      if (isRecord(args) && isRecord(coerced)) {
        for (const key of Object.keys(args)) {
          delete args[key];
        }
        Object.assign(args, coerced);
      } else {
        return validator.Check(coerced) && isRecord(coerced) ? coerced : args;
      }
    }
  }

  if (validator.Check(args)) return args;

  const errors =
    validator
      .Errors(args)
      .map((e) => `  - ${formatValidationPath(e)}: ${e.message}`)
      .join('\n') || 'Unknown validation error';

  throw new Error(
    `Validation failed for tool "${toolCall.name}":\n${errors}\n\nReceived arguments:\n${JSON.stringify(toolCall.arguments, null, 2)}`,
  );
}
