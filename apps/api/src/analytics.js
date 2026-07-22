const OBJECT_TYPES = new Set(['contacts', 'companies', 'deals', 'calls', 'meetings', 'tasks']);
const SYSTEM_FIELDS = Object.freeze({
  record_id: 'r.record_id',
  hubspot_created_at: 'r.hubspot_created_at',
  hubspot_updated_at: 'r.hubspot_updated_at',
  synced_at: 'r.synced_at'
});
const AGGREGATIONS = new Set(['count', 'distinct_count', 'sum', 'average']);

export class AnalyticsDefinitionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AnalyticsDefinitionError';
    this.statusCode = 400;
    this.category = 'INVALID_ANALYTICS_DEFINITION';
  }
}

function assertObjectType(value) {
  if (!OBJECT_TYPES.has(value)) {
    throw new AnalyticsDefinitionError(`Unsupported object type: ${value}`);
  }
  return value;
}

function assertPropertyName(value) {
  const propertyName = String(value ?? '').trim();
  if (!/^[a-zA-Z0-9_]+$/.test(propertyName)) {
    throw new AnalyticsDefinitionError(`Invalid CRM property name: ${propertyName || '(empty)'}`);
  }
  return propertyName;
}

function addParameter(state, value) {
  state.values.push(value);
  return `$${state.values.length}`;
}

function propertyExpression(field, state) {
  if (SYSTEM_FIELDS[field]) return SYSTEM_FIELDS[field];
  const propertyName = assertPropertyName(field);
  const key = addParameter(state, propertyName);
  return `(r.properties ->> ${key})`;
}

function numericExpression(expression) {
  return `CASE WHEN ${expression} ~ '^-?[0-9]+(?:\\.[0-9]+)?$' THEN ${expression}::numeric END`;
}

function dateExpression(expression) {
  return `NULLIF(${expression}, '')::timestamptz`;
}

function semanticRawValues(condition, context) {
  const semanticKey = String(condition.semanticField ?? '').trim();
  const mapping = context.mappings?.[semanticKey];

  if (!mapping?.propertyName) {
    throw new AnalyticsDefinitionError(`Semantic field is not mapped: ${semanticKey}`);
  }

  const target = String(condition.value ?? '');
  const rawValues = Object.entries(mapping.valueMapping ?? {})
    .filter(([, canonical]) => String(canonical) === target)
    .map(([raw]) => raw);

  return {
    field: mapping.propertyName,
    values: rawValues.length > 0 ? rawValues : [target]
  };
}

function compileScalarCondition(condition, state, context) {
  if (condition.virtualProperty) {
    const key = String(condition.virtualProperty);
    const virtualProperty = context.virtualProperties?.[key];
    if (!virtualProperty) {
      throw new AnalyticsDefinitionError(`Unknown virtual property: ${key}`);
    }

    const compiled = compileRule(virtualProperty.rule, state, context);
    const expected = condition.value !== false;
    return expected ? `(${compiled})` : `(NOT (${compiled}))`;
  }

  if (condition.operator === 'semantic_equals') {
    const semantic = semanticRawValues(condition, context);
    const expression = propertyExpression(semantic.field, state);
    const placeholders = semantic.values.map((value) => addParameter(state, String(value)));
    return `${expression} IN (${placeholders.join(', ')})`;
  }

  const expression = propertyExpression(condition.field, state);
  const operator = String(condition.operator ?? 'equals');

  switch (operator) {
    case 'equals': {
      const value = addParameter(state, String(condition.value));
      return `${expression} = ${value}`;
    }
    case 'not_equals': {
      const value = addParameter(state, String(condition.value));
      return `(${expression} IS NULL OR ${expression} <> ${value})`;
    }
    case 'in':
    case 'not_in': {
      const input = Array.isArray(condition.value) ? condition.value : [condition.value];
      const values = input.filter((value) => value !== undefined && value !== null);
      if (values.length === 0) {
        return operator === 'in' ? 'FALSE' : 'TRUE';
      }
      const placeholders = values.map((value) => addParameter(state, String(value)));
      return `${expression} ${operator === 'in' ? 'IN' : 'NOT IN'} (${placeholders.join(', ')})`;
    }
    case 'exists':
      return `(${expression} IS NOT NULL AND ${expression} <> '')`;
    case 'missing':
      return `(${expression} IS NULL OR ${expression} = '')`;
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const symbols = { gt: '>', gte: '>=', lt: '<', lte: '<=' };
      const value = addParameter(state, Number(condition.value));
      return `${numericExpression(expression)} ${symbols[operator]} ${value}::numeric`;
    }
    case 'before_days':
    case 'after_days': {
      const days = Number.parseInt(condition.value ?? 0, 10);
      if (!Number.isFinite(days) || days < 0 || days > 36500) {
        throw new AnalyticsDefinitionError(`Invalid day range: ${condition.value}`);
      }
      const value = addParameter(state, days);
      const symbol = operator === 'before_days' ? '<' : '>=';
      return `${dateExpression(expression)} ${symbol} NOW() - (${value}::int * INTERVAL '1 day')`;
    }
    default:
      throw new AnalyticsDefinitionError(`Unsupported filter operator: ${operator}`);
  }
}

export function compileRule(rule, state, context) {
  if (!rule || typeof rule !== 'object') {
    throw new AnalyticsDefinitionError('A filter rule object is required');
  }

  if (Array.isArray(rule.conditions)) {
    const operator = String(rule.operator ?? 'AND').toUpperCase();
    if (!['AND', 'OR'].includes(operator)) {
      throw new AnalyticsDefinitionError(`Unsupported rule group operator: ${operator}`);
    }
    if (rule.conditions.length === 0) return 'TRUE';

    const children = rule.conditions.map((condition) => compileRule(condition, state, context));
    return `(${children.join(` ${operator} `)})`;
  }

  return compileScalarCondition(rule, state, context);
}

function virtualFilter(definition, context) {
  if (!definition.virtualProperty) return definition.filters;
  const virtualProperty = context.virtualProperties?.[definition.virtualProperty];
  if (!virtualProperty) {
    throw new AnalyticsDefinitionError(`Unknown virtual property: ${definition.virtualProperty}`);
  }

  if (!definition.filters) return virtualProperty.rule;
  return {
    operator: 'AND',
    conditions: [virtualProperty.rule, definition.filters]
  };
}

function aggregateExpression(definition, state) {
  const aggregation = String(definition.aggregation ?? 'count');
  if (!AGGREGATIONS.has(aggregation)) {
    throw new AnalyticsDefinitionError(`Unsupported aggregation: ${aggregation}`);
  }

  if (aggregation === 'count') return 'COUNT(*)::bigint';

  if (!definition.field) {
    throw new AnalyticsDefinitionError(`${aggregation} requires a field`);
  }

  const expression = propertyExpression(definition.field, state);
  if (aggregation === 'distinct_count') return `COUNT(DISTINCT ${expression})::bigint`;
  if (aggregation === 'sum') return `COALESCE(SUM(${numericExpression(expression)}), 0)`;
  return `AVG(${numericExpression(expression)})`;
}

export function compileMetricQuery({ workspaceId, definition, mappings = {}, virtualProperties = {} }) {
  if (!workspaceId) throw new AnalyticsDefinitionError('workspaceId is required');
  const objectType = assertObjectType(definition.objectType);
  const state = { values: [workspaceId, objectType] };
  const context = { mappings, virtualProperties };
  const where = ['r.workspace_id = $1', 'r.object_type = $2', 'r.archived = FALSE'];
  const rule = virtualFilter(definition, context);

  if (rule) where.push(compileRule(rule, state, context));

  let groupExpression = null;
  if (definition.groupBy) {
    groupExpression = propertyExpression(definition.groupBy, state);
  }

  const aggregate = aggregateExpression(definition, state);
  const text = groupExpression
    ? `
      SELECT ${groupExpression} AS group_key, ${aggregate} AS value
      FROM crm_records r
      WHERE ${where.join(' AND ')}
      GROUP BY ${groupExpression}
      ORDER BY value DESC NULLS LAST
      LIMIT 100
    `
    : `
      SELECT ${aggregate} AS value
      FROM crm_records r
      WHERE ${where.join(' AND ')}
    `;

  return { text, values: state.values };
}

export function compileDrilldownQuery({
  workspaceId,
  objectType,
  filters,
  mappings = {},
  virtualProperties = {},
  limit = 50,
  offset = 0
}) {
  assertObjectType(objectType);
  const safeLimit = Math.min(200, Math.max(1, Number.parseInt(limit, 10) || 50));
  const safeOffset = Math.max(0, Number.parseInt(offset, 10) || 0);
  const state = { values: [workspaceId, objectType] };
  const where = ['r.workspace_id = $1', 'r.object_type = $2', 'r.archived = FALSE'];

  if (filters) {
    where.push(compileRule(filters, state, { mappings, virtualProperties }));
  }

  const limitParameter = addParameter(state, safeLimit);
  const offsetParameter = addParameter(state, safeOffset);

  return {
    text: `
      SELECT
        r.record_id,
        r.properties,
        r.hubspot_created_at,
        r.hubspot_updated_at,
        r.synced_at
      FROM crm_records r
      WHERE ${where.join(' AND ')}
      ORDER BY r.hubspot_updated_at DESC NULLS LAST, r.record_id
      LIMIT ${limitParameter}::int
      OFFSET ${offsetParameter}::int
    `,
    values: state.values,
    limit: safeLimit,
    offset: safeOffset
  };
}

export function indexTemplate(template) {
  const virtualProperties = Object.fromEntries(
    (template.virtualProperties ?? []).map((item) => [item.key, item])
  );
  const metrics = Object.fromEntries(
    (template.metrics ?? []).map((item) => [item.key, item])
  );

  return { virtualProperties, metrics };
}
