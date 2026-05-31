// ============================================================
// validation 测试 — TypeBox 参数校验
// ============================================================

import { describe, it, expect } from 'vitest';
import { Type } from 'typebox';
import { validateToolCall, validateToolArguments } from '../src/validation';
import type { Tool, ToolCall } from '../src/types';

// ---------- 辅助函数 ----------

function createToolCall(name: string, args: Record<string, unknown>): ToolCall {
  return { type: 'toolCall', id: 'test-id', name, arguments: args };
}

function createTool(name: string, schema: Tool['parameters']): Tool {
  return { name, description: `Test tool: ${name}`, parameters: schema };
}

// ---------- validateToolCall ----------

describe('validateToolCall', () => {
  it('returns validated arguments for a valid tool call', () => {
    const tool = createTool(
      'add',
      Type.Object({
        a: Type.Number(),
        b: Type.Number(),
      }),
    );
    const toolCall = createToolCall('add', { a: 1, b: 2 });
    const result = validateToolCall([tool], toolCall);
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it('throws if tool is not found', () => {
    const toolCall = createToolCall('unknown_tool', {});
    expect(() => validateToolCall([], toolCall)).toThrow('Tool "unknown_tool" not found');
  });

  it('validates with string-to-number coercion', () => {
    const tool = createTool(
      'parse',
      Type.Object({
        count: Type.Number(),
      }),
    );
    const toolCall = createToolCall('parse', { count: '42' });
    const result = validateToolCall([tool], toolCall);
    expect(result).toEqual({ count: 42 });
  });
});

// ---------- validateToolArguments ----------

describe('validateToolArguments', () => {
  it('returns arguments as-is when they match the schema', () => {
    const tool = createTool(
      'echo',
      Type.Object({
        message: Type.String(),
      }),
    );
    const toolCall = createToolCall('echo', { message: 'hello' });
    const result = validateToolArguments(tool, toolCall);
    expect(result).toEqual({ message: 'hello' });
  });

  it('throws with descriptive error for invalid arguments', () => {
    const tool = createTool(
      'strict',
      Type.Object({
        value: Type.Number(),
      }),
    );
    const toolCall = createToolCall('strict', { value: 'not-a-number' });
    expect(() => validateToolArguments(tool, toolCall)).toThrow(
      'Validation failed for tool "strict"',
    );
  });

  it('throws with descriptive error for missing required property', () => {
    const tool = createTool(
      'required_field',
      Type.Object(
        {
          name: Type.String(),
          age: Type.Number(),
        },
        { required: ['name', 'age'] },
      ),
    );
    const toolCall = createToolCall('required_field', { name: 'test' });
    expect(() => validateToolArguments(tool, toolCall)).toThrow();
  });

  it('handles nested object schemas', () => {
    const tool = createTool(
      'nested',
      Type.Object({
        config: Type.Object({
          enabled: Type.Boolean(),
        }),
      }),
    );
    const toolCall = createToolCall('nested', { config: { enabled: true } });
    const result = validateToolArguments(tool, toolCall);
    expect(result).toEqual({ config: { enabled: true } });
  });

  it('coerces string booleans', () => {
    const tool = createTool(
      'flag',
      Type.Object({
        active: Type.Boolean(),
      }),
    );
    const toolCall = createToolCall('flag', { active: 'true' });
    const result = validateToolArguments(tool, toolCall);
    expect(result).toEqual({ active: true });
  });

  it('does not mutate the original toolCall arguments', () => {
    const tool = createTool(
      'num',
      Type.Object({
        count: Type.Number(),
      }),
    );
    const toolCall = createToolCall('num', { count: '42' });
    const originalArgs = { ...toolCall.arguments };
    validateToolArguments(tool, toolCall);
    expect(toolCall.arguments).toEqual(originalArgs);
  });

  it('validates array parameters', () => {
    const tool = createTool(
      'list',
      Type.Object({
        items: Type.Array(Type.String()),
      }),
    );
    const toolCall = createToolCall('list', { items: ['a', 'b', 'c'] });
    const result = validateToolArguments(tool, toolCall);
    expect(result).toEqual({ items: ['a', 'b', 'c'] });
  });

  it('validates enum parameters', () => {
    const tool = createTool(
      'choose',
      Type.Object({
        color: Type.Union([Type.Literal('red'), Type.Literal('green'), Type.Literal('blue')]),
      }),
    );
    const toolCall = createToolCall('choose', { color: 'red' });
    const result = validateToolArguments(tool, toolCall);
    expect(result).toEqual({ color: 'red' });
  });

  it('works when Function constructor is disabled (restricted environment)', () => {
    const tool = createTool(
      'restricted',
      Type.Object({
        value: Type.Number(),
      }),
    );
    const toolCall = createToolCall('restricted', { value: '99' });

    // Pre-warm the validator cache while Function is still available
    validateToolArguments(tool, createToolCall('restricted', { value: 1 }));

    const originalFunction = globalThis.Function;
    globalThis.Function = (() => {
      throw new EvalError('Code generation from strings disallowed for this context');
    }) as unknown as FunctionConstructor;

    try {
      const result = validateToolArguments(tool, toolCall);
      expect(result).toEqual({ value: 99 });
    } finally {
      globalThis.Function = originalFunction;
    }
  });
});

// ---------- coercion for allOf/anyOf/oneOf ----------

describe('validateToolArguments — coercion for allOf/anyOf/oneOf', () => {
  it('coerces properties defined via allOf', () => {
    // allOf with one schema that has number property
    const tool = createTool('allof_tool', {
      type: 'object',
      properties: {
        count: { type: 'number' },
      },
      required: ['count'],
      allOf: [
        {
          type: 'object',
          properties: {
            count: { type: 'number' },
          },
        },
      ],
    } as any);
    const toolCall = createToolCall('allof_tool', { count: '42' });
    const result = validateToolArguments(tool, toolCall);
    expect(result.count).toBe(42);
  });

  it('coerces properties through anyOf', () => {
    const tool = createTool('anyof_tool', {
      type: 'object',
      properties: {
        value: { type: 'number' },
      },
      required: ['value'],
      anyOf: [
        {
          type: 'object',
          properties: {
            value: { type: 'number' },
          },
        },
      ],
    } as any);
    const toolCall = createToolCall('anyof_tool', { value: '10' });
    const result = validateToolArguments(tool, toolCall);
    expect(result.value).toBe(10);
  });

  it('coerces properties through oneOf', () => {
    const tool = createTool('oneof_tool', {
      type: 'object',
      properties: {
        flag: { type: 'boolean' },
      },
      required: ['flag'],
      oneOf: [
        {
          type: 'object',
          properties: {
            flag: { type: 'boolean' },
          },
        },
      ],
    } as any);
    const toolCall = createToolCall('oneof_tool', { flag: 'true' });
    const result = validateToolArguments(tool, toolCall);
    expect(result.flag).toBe(true);
  });

  it('coerces nested objects within allOf', () => {
    const tool = createTool('allof_nested', {
      type: 'object',
      properties: {
        config: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            count: { type: 'number' },
          },
        },
      },
      allOf: [
        {
          type: 'object',
          properties: {
            config: {
              type: 'object',
              properties: {
                enabled: { type: 'boolean' },
              },
            },
          },
        },
      ],
    } as any);
    const toolCall = createToolCall('allof_nested', {
      config: { enabled: 'true', count: '5' },
    });
    const result = validateToolArguments(tool, toolCall);
    expect(result.config.enabled).toBe(true);
    expect(result.config.count).toBe(5);
  });

  it('picks the first matching variant in anyOf', () => {
    const tool = createTool('anyof_multi', {
      type: 'object',
      anyOf: [
        {
          type: 'object',
          properties: {
            num: { type: 'number' },
          },
          required: ['num'],
        },
        {
          type: 'object',
          properties: {
            str: { type: 'string' },
          },
          required: ['str'],
        },
      ],
    } as any);
    // "7" should be coerced to 7 in the first variant
    const toolCall = createToolCall('anyof_multi', { num: '7' });
    const result = validateToolArguments(tool, toolCall);
    expect(result.num).toBe(7);
  });

  it('coerces array items in nested schemas', () => {
    const tool = createTool('array_items', {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: { type: 'number' },
        },
      },
    } as any);
    const toolCall = createToolCall('array_items', {
      items: ['1', '2', '3'],
    });
    const result = validateToolArguments(tool, toolCall);
    expect(result.items).toEqual([1, 2, 3]);
  });

  it('coerces additionalProperties', () => {
    const tool = createTool('additional_props', {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      additionalProperties: { type: 'number' },
    } as any);
    const toolCall = createToolCall('additional_props', {
      name: 'test',
      extra1: '10',
      extra2: '20',
    });
    const result = validateToolArguments(tool, toolCall);
    expect(result.name).toBe('test');
    expect(result.extra1).toBe(10);
    expect(result.extra2).toBe(20);
  });

  it('coerces primitive types: string to number', () => {
    const tool = createTool('primitive_str_num', {
      type: 'object',
      properties: {
        value: { type: 'number' },
      },
    } as any);
    const toolCall = createToolCall('primitive_str_num', { value: '3.14' });
    const result = validateToolArguments(tool, toolCall);
    expect(result.value).toBeCloseTo(3.14);
  });

  it('coerces primitive types: number to boolean', () => {
    const tool = createTool('primitive_num_bool', {
      type: 'object',
      properties: {
        flag: { type: 'boolean' },
      },
    } as any);
    const toolCall = createToolCall('primitive_num_bool', { flag: 1 });
    const result = validateToolArguments(tool, toolCall);
    expect(result.flag).toBe(true);
  });

  it('coerces primitive types: boolean to number', () => {
    const tool = createTool('primitive_bool_num', {
      type: 'object',
      properties: {
        count: { type: 'number' },
      },
    } as any);
    const toolCall = createToolCall('primitive_bool_num', { count: true });
    const result = validateToolArguments(tool, toolCall);
    expect(result.count).toBe(1);
  });

  it('coerces integer type from string', () => {
    const tool = createTool('integer_type', {
      type: 'object',
      properties: {
        id: { type: 'integer' },
      },
    } as any);
    const toolCall = createToolCall('integer_type', { id: '42' });
    const result = validateToolArguments(tool, toolCall);
    expect(result.id).toBe(42);
    expect(Number.isInteger(result.id)).toBe(true);
  });
});

// ---------- coercePrimitiveByType via pure JSON Schema ----------

describe('validateToolArguments — coercePrimitiveByType edge cases', () => {
  it('coerces null to 0 for number type', () => {
    const tool = createTool('null_to_num', {
      type: 'object',
      properties: { value: { type: 'number' } },
    } as any);
    const toolCall = createToolCall('null_to_num', { value: null });
    const result = validateToolArguments(tool, toolCall);
    expect(result.value).toBe(0);
  });

  it('coerces null to 0 for integer type', () => {
    const tool = createTool('null_to_int', {
      type: 'object',
      properties: { value: { type: 'integer' } },
    } as any);
    const toolCall = createToolCall('null_to_int', { value: null });
    const result = validateToolArguments(tool, toolCall);
    expect(result.value).toBe(0);
  });

  it('coerces null to false for boolean type', () => {
    const tool = createTool('null_to_bool', {
      type: 'object',
      properties: { value: { type: 'boolean' } },
    } as any);
    const toolCall = createToolCall('null_to_bool', { value: null });
    const result = validateToolArguments(tool, toolCall);
    expect(result.value).toBe(false);
  });

  it('coerces null to empty string for string type', () => {
    const tool = createTool('null_to_str', {
      type: 'object',
      properties: { value: { type: 'string' } },
    } as any);
    const toolCall = createToolCall('null_to_str', { value: null });
    const result = validateToolArguments(tool, toolCall);
    expect(result.value).toBe('');
  });

  it('coerces empty string to null for null type', () => {
    const tool = createTool('str_to_null', {
      type: 'object',
      properties: { value: { type: 'null' } },
    } as any);
    const toolCall = createToolCall('str_to_null', { value: '' });
    const result = validateToolArguments(tool, toolCall);
    expect(result.value).toBeNull();
  });

  it('coerces 0 to null for null type', () => {
    const tool = createTool('zero_to_null', {
      type: 'object',
      properties: { value: { type: 'null' } },
    } as any);
    const toolCall = createToolCall('zero_to_null', { value: 0 });
    const result = validateToolArguments(tool, toolCall);
    expect(result.value).toBeNull();
  });

  it('coerces false to null for null type', () => {
    const tool = createTool('false_to_null', {
      type: 'object',
      properties: { value: { type: 'null' } },
    } as any);
    const toolCall = createToolCall('false_to_null', { value: false });
    const result = validateToolArguments(tool, toolCall);
    expect(result.value).toBeNull();
  });

  it('coerces boolean false to 0 for number type', () => {
    const tool = createTool('bool_false_num', {
      type: 'object',
      properties: { value: { type: 'number' } },
    } as any);
    const toolCall = createToolCall('bool_false_num', { value: false });
    const result = validateToolArguments(tool, toolCall);
    expect(result.value).toBe(0);
  });

  it('coerces boolean true to 1 for integer type', () => {
    const tool = createTool('bool_true_int', {
      type: 'object',
      properties: { value: { type: 'integer' } },
    } as any);
    const toolCall = createToolCall('bool_true_int', { value: true });
    const result = validateToolArguments(tool, toolCall);
    expect(result.value).toBe(1);
  });

  it('coerces 0 to false for boolean type', () => {
    const tool = createTool('zero_to_bool', {
      type: 'object',
      properties: { value: { type: 'boolean' } },
    } as any);
    const toolCall = createToolCall('zero_to_bool', { value: 0 });
    const result = validateToolArguments(tool, toolCall);
    expect(result.value).toBe(false);
  });

  it('coerces number to string for string type', () => {
    const tool = createTool('num_to_str', {
      type: 'object',
      properties: { value: { type: 'string' } },
    } as any);
    const toolCall = createToolCall('num_to_str', { value: 42 });
    const result = validateToolArguments(tool, toolCall);
    expect(result.value).toBe('42');
  });

  it('coerces boolean to string for string type', () => {
    const tool = createTool('bool_to_str', {
      type: 'object',
      properties: { value: { type: 'string' } },
    } as any);
    const toolCall = createToolCall('bool_to_str', { value: true });
    const result = validateToolArguments(tool, toolCall);
    expect(result.value).toBe('true');
  });

  it('throws validation error for non-coercible string to number', () => {
    const tool = createTool('nan_num', {
      type: 'object',
      properties: { value: { type: 'number' } },
    } as any);
    const toolCall = createToolCall('nan_num', { value: 'not-a-number' });
    // "not-a-number" can't be parsed to finite number, coercion leaves it as-is, then validation fails
    expect(() => validateToolArguments(tool, toolCall)).toThrow(/Validation failed/);
  });

  it('throws validation error for float string to integer', () => {
    const tool = createTool('float_int', {
      type: 'object',
      properties: { value: { type: 'integer' } },
    } as any);
    const toolCall = createToolCall('float_int', { value: '3.14' });
    // "3.14" is not an integer, coercion leaves it as-is, then validation fails
    expect(() => validateToolArguments(tool, toolCall)).toThrow(/Validation failed/);
  });

  it('throws validation error for arbitrary string to boolean', () => {
    const tool = createTool('str_to_bool', {
      type: 'object',
      properties: { value: { type: 'boolean' } },
    } as any);
    const toolCall = createToolCall('str_to_bool', { value: 'yes' });
    // "yes" is not "true"/"false", coercion leaves it as-is, then validation fails
    expect(() => validateToolArguments(tool, toolCall)).toThrow(/Validation failed/);
  });

  it('coerces number 1 to boolean true', () => {
    const tool = createTool('one_to_bool', {
      type: 'object',
      properties: { value: { type: 'boolean' } },
    } as any);
    const toolCall = createToolCall('one_to_bool', { value: 1 });
    const result = validateToolArguments(tool, toolCall);
    expect(result.value).toBe(true);
  });
});

// ---------- matchesJsonType via type union coercion ----------

describe('validateToolArguments — type union coercion', () => {
  it('coerces value to match a type union (string | number)', () => {
    const tool = createTool('union_str_num', {
      type: 'object',
      properties: { value: { type: ['string', 'number'] } },
    } as any);
    // A number value already matches "number" in the union
    const toolCall = createToolCall('union_str_num', { value: 42 });
    const result = validateToolArguments(tool, toolCall);
    expect(result.value).toBe(42);
  });

  it('coerces value when it does not match any union member', () => {
    const tool = createTool('union_str_num_coerce', {
      type: 'object',
      properties: { value: { type: ['string', 'number'] } },
    } as any);
    // null does not match string or number, should be coerced
    const toolCall = createToolCall('union_str_num_coerce', { value: null });
    const result = validateToolArguments(tool, toolCall);
    // Should be coerced to something (number -> 0, or string -> "")
    expect(result.value === 0 || result.value === '').toBe(true);
  });

  it('coerces value for array type', () => {
    const tool = createTool('array_type', {
      type: 'object',
      properties: { items: { type: 'array', items: { type: 'number' } } },
    } as any);
    const toolCall = createToolCall('array_type', { items: ['1', '2'] });
    const result = validateToolArguments(tool, toolCall);
    expect(result.items).toEqual([1, 2]);
  });

  it('coerces array items with tuple-style items array', () => {
    const tool = createTool('tuple_items', {
      type: 'object',
      properties: {
        pair: {
          type: 'array',
          items: [{ type: 'number' }, { type: 'boolean' }],
        },
      },
    } as any);
    const toolCall = createToolCall('tuple_items', { pair: ['42', 1] });
    const result = validateToolArguments(tool, toolCall);
    expect(result.pair[0]).toBe(42);
    expect(result.pair[1]).toBe(true);
  });
});

// ---------- formatValidationPath edge cases ----------

describe('validateToolArguments — error path formatting', () => {
  it('formats error for missing required property at root level', () => {
    const tool = createTool('required_root', {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    } as any);
    const toolCall = createToolCall('required_root', {});
    expect(() => validateToolArguments(tool, toolCall)).toThrow(/name/);
  });

  it('formats error for nested invalid property', () => {
    const tool = createTool('nested_error', {
      type: 'object',
      properties: {
        config: {
          type: 'object',
          properties: {
            value: { type: 'number' },
          },
        },
      },
    } as any);
    const toolCall = createToolCall('nested_error', { config: { value: 'bad' } });
    expect(() => validateToolArguments(tool, toolCall)).toThrow(/config/);
  });
});

// ---------- coerceWithUnionSchema (anyOf/oneOf multi-variant) ----------

describe('validateToolArguments — union schema coercion edge cases', () => {
  it('throws validation error when no anyOf variant matches', () => {
    const tool = createTool('anyof_no_match', {
      type: 'object',
      anyOf: [
        {
          type: 'object',
          properties: { num: { type: 'number' } },
          required: ['num'],
        },
        {
          type: 'object',
          properties: { str: { type: 'string' } },
          required: ['str'],
        },
      ],
    } as any);
    // Neither variant should match with empty object
    const toolCall = createToolCall('anyof_no_match', {});
    expect(() => validateToolArguments(tool, toolCall)).toThrow(/Validation failed/);
  });

  it('coerces oneOf with multiple variants', () => {
    const tool = createTool('oneof_multi', {
      type: 'object',
      oneOf: [
        {
          type: 'object',
          properties: { flag: { type: 'boolean' } },
          required: ['flag'],
        },
        {
          type: 'object',
          properties: { count: { type: 'number' } },
          required: ['count'],
        },
      ],
    } as any);
    const toolCall = createToolCall('oneof_multi', { flag: 'true' });
    const result = validateToolArguments(tool, toolCall);
    expect(result.flag).toBe(true);
  });
});
