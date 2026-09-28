import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

const schema = JSON.parse(fs.readFileSync(new URL('./ai-output.schema.json', import.meta.url), 'utf8'));
const checkType = (value, type) => type === 'null' ? value === null : type === 'array' ? Array.isArray(value)
  : type === 'integer' ? Number.isSafeInteger(value) : type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
    : typeof value === type;

function inspect(value, rule, path, errors) {
  if (rule.$ref) {
    const target = rule.$ref.split('/').at(-1);
    return inspect(value, schema.$defs[target], path, errors);
  }
  if (rule.const !== undefined && value !== rule.const) errors.push(`${path}: expected ${rule.const}`);
  if (rule.enum && !rule.enum.includes(value)) errors.push(`${path}: invalid enum`);
  const types = rule.type ? [].concat(rule.type) : null;
  if (types && !types.some(type => checkType(value, type))) {errors.push(`${path}: invalid type`); return;}
  if (typeof value === 'number' && (!Number.isFinite(value) || rule.minimum !== undefined && value < rule.minimum ||
    rule.exclusiveMinimum !== undefined && value <= rule.exclusiveMinimum || rule.maximum !== undefined && value > rule.maximum)) {
    errors.push(`${path}: number outside schema bounds`);
  }
  if (typeof value === 'string' && rule.pattern && !new RegExp(rule.pattern).test(value)) errors.push(`${path}: invalid text`);
  if (Array.isArray(value)) {
    if (rule.minItems !== undefined && value.length < rule.minItems || rule.maxItems !== undefined && value.length > rule.maxItems) errors.push(`${path}: array length outside schema bounds`);
    if (rule.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length) errors.push(`${path}: duplicate items`);
    if (rule.prefixItems) value.forEach((item, index) => inspect(item, rule.prefixItems[index], `${path}[${index}]`, errors));
    if (rule.items) value.forEach((item, index) => inspect(item, rule.items, `${path}[${index}]`, errors));
  } else if (value !== null && typeof value === 'object') {
    for (const key of rule.required ?? []) if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}: required`);
    for (const [key, item] of Object.entries(value)) {
      if (!Object.hasOwn(rule.properties ?? {}, key)) {if (rule.additionalProperties === false) errors.push(`${path}.${key}: unexpected field`);}
      else inspect(item, rule.properties[key], `${path}.${key}`, errors);
    }
  }
}

export function validateAIOutput(value) {
  const errors = [];
  inspect(value, schema, '$', errors);
  return {valid: errors.length === 0, errors};
}
export {schema as aiOutputSchema};
