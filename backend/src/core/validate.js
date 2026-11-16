import { invalid } from './errors.js';

/**
 * Tiny declarative validator.
 * rule: { type: 'string'|'email'|'int'|'number'|'bool'|'enum'|'array'|'date', required, default, nullable,
 *         min, max, minLength, maxLength, values, pattern, item }
 * partial=true -> only validate keys that are present (PATCH semantics).
 */
export function validate(input, schema, { partial = false } = {}) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const out = {};
  const errors = {};
  for (const [key, rule] of Object.entries(schema)) {
    const val = src[key];
    const blank = typeof val === 'string' && val.trim() === '';
    const absent = val === undefined || val === null || blank;
    if (absent) {
      if ((val === null || blank) && rule.nullable) { out[key] = null; continue; }
      if (val === undefined && rule.default !== undefined && !partial) { out[key] = typeof rule.default === 'function' ? rule.default() : rule.default; continue; }
      if (rule.required && !partial) errors[key] = 'is required';
      else if (rule.required && partial && val !== undefined) errors[key] = 'cannot be empty';
      continue;
    }
    const r = check(val, rule);
    if (r.error) errors[key] = r.error; else out[key] = r.value;
  }
  if (Object.keys(errors).length) throw invalid(errors);
  return out;
}

function check(val, rule) {
  switch (rule.type) {
    case 'string': case 'email': {
      if (typeof val !== 'string') return { error: 'must be text' };
      const s = val.trim();
      if (rule.minLength && s.length < rule.minLength) return { error: `must be at least ${rule.minLength} characters` };
      if (s.length > (rule.maxLength || 500)) return { error: `must be at most ${rule.maxLength || 500} characters` };
      if (rule.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return { error: 'must be a valid email address' };
      if (rule.pattern && !rule.pattern.test(s)) return { error: rule.patternMessage || 'has an invalid format' };
      return { value: rule.type === 'email' ? s.toLowerCase() : s };
    }
    case 'int': case 'number': {
      const n = typeof val === 'string' ? Number(val) : val;
      if (typeof n !== 'number' || !Number.isFinite(n)) return { error: 'must be a number' };
      if (rule.type === 'int' && !Number.isInteger(n)) return { error: 'must be a whole number' };
      if (rule.min !== undefined && n < rule.min) return { error: `must be at least ${rule.min}` };
      if (rule.max !== undefined && n > rule.max) return { error: `must be at most ${rule.max}` };
      return { value: n };
    }
    case 'bool': {
      if (typeof val === 'boolean') return { value: val };
      if (val === 1 || val === 'true' || val === '1') return { value: true };
      if (val === 0 || val === 'false' || val === '0') return { value: false };
      return { error: 'must be true or false' };
    }
    case 'enum':
      return rule.values.includes(val) ? { value: val } : { error: `must be one of: ${rule.values.join(', ')}` };
    case 'date': {
      const t = Date.parse(val);
      return Number.isNaN(t) ? { error: 'must be a valid date' } : { value: new Date(t).toISOString() };
    }
    case 'array': {
      if (!Array.isArray(val)) return { error: 'must be a list' };
      if (rule.min !== undefined && val.length < rule.min) return { error: `needs at least ${rule.min} item(s)` };
      if (rule.max !== undefined && val.length > rule.max) return { error: `allows at most ${rule.max} items` };
      if (!rule.item) return { value: val };
      const outArr = [];
      for (let i = 0; i < val.length; i++) {
        let r;
        if (rule.item.shape) {
          try { r = { value: validate(val[i], rule.item.shape) }; }
          catch (e) { r = { error: Object.entries(e.details || {}).map(([k, m]) => `${k} ${m}`).join('; ') }; }
        } else r = check(val[i], rule.item);
        if (r.error) return { error: `item ${i + 1}: ${r.error}` };
        outArr.push(r.value);
      }
      return { value: outArr };
    }
    default:
      return { value: val };
  }
}

export const idRule = (extra = {}) => ({ type: 'int', min: 1, ...extra });
