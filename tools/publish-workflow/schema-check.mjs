import fs from 'node:fs';

const schema = JSON.parse(fs.readFileSync(new URL('../layout-schema-v3.json', import.meta.url), 'utf8'));
const typeOf = value => value === null ? 'null' : Array.isArray(value) ? 'array' :
  Number.isSafeInteger(value) ? 'integer' : typeof value;

function inspect(value, rule, at, errors) {
  if (rule.$ref) return inspect(value, schema.$defs[rule.$ref.split('/').at(-1)], at, errors);
  if (rule.const !== undefined && value !== rule.const) errors.push(`${at}: expected ${rule.const}`);
  if (rule.enum && !rule.enum.includes(value)) errors.push(`${at}: invalid enum`);
  if (rule.type) {
    const actual = typeOf(value), expected = [].concat(rule.type);
    if (!expected.includes(actual) && !(actual === 'integer' && expected.includes('number'))) {
      errors.push(`${at}: invalid type`); return;
    }
  }
  if (typeof value === 'number' && (!Number.isFinite(value) ||
    rule.minimum !== undefined && value < rule.minimum ||
    rule.exclusiveMinimum !== undefined && value <= rule.exclusiveMinimum ||
    rule.maximum !== undefined && value > rule.maximum)) errors.push(`${at}: invalid number`);
  if (typeof value === 'string') {
    if (rule.pattern && !new RegExp(rule.pattern).test(value)) errors.push(`${at}: invalid ID`);
    if (rule.format === 'date-time' && !Number.isFinite(Date.parse(value))) errors.push(`${at}: invalid date-time`);
  }
  if (Array.isArray(value)) {
    if (rule.minItems !== undefined && value.length < rule.minItems || rule.maxItems !== undefined && value.length > rule.maxItems) errors.push(`${at}: invalid array length`);
    value.forEach((item, i) => inspect(item, rule.prefixItems?.[i] ?? rule.items ?? {}, `${at}[${i}]`, errors));
  } else if (value !== null && typeof value === 'object') {
    for (const key of rule.required ?? []) if (!Object.hasOwn(value, key)) errors.push(`${at}.${key}: required`);
    for (const [key, item] of Object.entries(value)) {
      const child = rule.properties?.[key];
      if (child) inspect(item, child, `${at}.${key}`, errors);
      else if (rule.additionalProperties === false) errors.push(`${at}.${key}: unexpected`);
    }
  }
}

export function checkLayoutSchema(layout) {
  const errors = [];
  inspect(layout, schema, '$', errors);
  return {valid: errors.length === 0, errors};
}
