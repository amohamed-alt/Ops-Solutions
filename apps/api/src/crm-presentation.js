function cleanText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function optionRows(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function humanizeInternalValue(value) {
  const text = cleanText(value);
  if (!text) return 'Unknown';
  if (/^[A-Z]{2,5}$/.test(text) || /[.@/]/.test(text)) return text;
  return text
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function buildPropertyPresentation(rows = []) {
  const objects = {};
  for (const row of rows) {
    const objectType = cleanText(row.object_type);
    const propertyName = cleanText(row.property_name);
    if (!objectType || !propertyName) continue;
    if (!objects[objectType]) objects[objectType] = {};

    const options = {};
    for (const option of optionRows(row.options)) {
      const value = cleanText(option?.value);
      const label = cleanText(option?.label);
      if (value && label) options[value] = label;
    }

    objects[objectType][propertyName] = {
      propertyName,
      label: cleanText(row.label) ?? humanizeInternalValue(propertyName),
      options
    };
  }
  return { objects };
}

export async function loadPropertyPresentation(postgres, workspaceId, objectTypes = []) {
  const normalizedTypes = [...new Set(
    (Array.isArray(objectTypes) ? objectTypes : [objectTypes])
      .map(cleanText)
      .filter(Boolean)
  )];
  const values = [workspaceId];
  const objectFilter = normalizedTypes.length
    ? `AND object_type = ANY($2::text[])`
    : '';
  if (normalizedTypes.length) values.push(normalizedTypes);

  const result = await postgres.query(
    `SELECT object_type, property_name, label, options
     FROM crm_properties
     WHERE workspace_id = $1
       ${objectFilter}
     ORDER BY object_type, property_name`,
    values
  );
  return buildPropertyPresentation(result.rows);
}

export function propertyDescriptor(presentation, objectType, propertyName, fallbackLabel = null) {
  const descriptor = presentation?.objects?.[objectType]?.[propertyName];
  return descriptor ?? {
    propertyName,
    label: fallbackLabel ?? humanizeInternalValue(propertyName),
    options: {}
  };
}

export function propertyValueLabel(presentation, objectType, propertyName, value) {
  const raw = cleanText(value);
  if (!raw) return 'Unknown';
  const descriptor = presentation?.objects?.[objectType]?.[propertyName];
  if (!descriptor) return humanizeInternalValue(raw);
  return descriptor.options?.[raw] ?? raw;
}

export function firstPropertyValueLabel(presentation, objectType, propertyNames, value) {
  const raw = cleanText(value);
  if (!raw) return 'Unknown';
  let discovered = false;
  for (const propertyName of propertyNames) {
    const descriptor = presentation?.objects?.[objectType]?.[propertyName];
    if (!descriptor) continue;
    discovered = true;
    if (descriptor.options?.[raw]) return descriptor.options[raw];
  }
  return discovered ? raw : humanizeInternalValue(raw);
}

export function labelDistribution(
  presentation,
  objectType,
  propertyName,
  rows,
  fallbackLabel = null
) {
  const descriptor = propertyDescriptor(presentation, objectType, propertyName, fallbackLabel);
  return {
    propertyName,
    propertyLabel: descriptor.label,
    rows: (rows ?? []).map((row) => ({
      ...row,
      key: cleanText(row.key) ?? 'Unknown',
      label: propertyValueLabel(presentation, objectType, propertyName, row.key)
    }))
  };
}

export function decoratePropertyBag(presentation, objectType, properties = {}, references = {}) {
  const displayed = {};
  for (const [propertyName, value] of Object.entries(properties ?? {})) {
    if (value === null || value === undefined || value === '') {
      displayed[propertyName] = value;
      continue;
    }
    displayed[propertyName] = propertyValueLabel(
      presentation,
      objectType,
      propertyName,
      value
    );
  }

  for (const ownerProperty of [
    'hubspot_owner_id',
    'hs_activity_assigned_to_user_id',
    'hs_created_by_user_id'
  ]) {
    const ownerId = cleanText(properties?.[ownerProperty]);
    if (ownerId && references.owners?.[ownerId]) {
      displayed[ownerProperty] = references.owners[ownerId];
    }
  }

  const pipelineId = cleanText(properties?.pipeline);
  const stageId = cleanText(properties?.dealstage);
  if (pipelineId && references.pipelines?.[pipelineId]) {
    displayed.pipeline = references.pipelines[pipelineId];
  }
  if (stageId) {
    displayed.dealstage = references.stages?.[`${pipelineId ?? ''}:${stageId}`]
      ?? references.stages?.[`:${stageId}`]
      ?? displayed.dealstage;
  }
  return displayed;
}

export async function loadReferenceLabels(postgres, workspaceId) {
  const [owners, pipelines, stages] = await Promise.all([
    postgres.query(
      `SELECT owner_id, user_id, first_name, last_name, email
       FROM crm_owners
       WHERE workspace_id = $1`,
      [workspaceId]
    ),
    postgres.query(
      `SELECT pipeline_id, label
       FROM crm_pipelines
       WHERE workspace_id = $1 AND object_type = 'deals'`,
      [workspaceId]
    ),
    postgres.query(
      `SELECT pipeline_id, stage_id, label
       FROM crm_pipeline_stages
       WHERE workspace_id = $1 AND object_type = 'deals'`,
      [workspaceId]
    )
  ]);

  const ownerLabels = {};
  for (const row of owners.rows) {
    const label = [row.first_name, row.last_name].filter(Boolean).join(' ')
      || row.email
      || `Owner ${row.owner_id}`;
    if (row.owner_id !== null && row.owner_id !== undefined) {
      ownerLabels[String(row.owner_id)] = label;
    }
    if (row.user_id !== null && row.user_id !== undefined) {
      ownerLabels[String(row.user_id)] = label;
    }
  }

  const pipelineLabels = Object.fromEntries(
    pipelines.rows
      .filter((row) => row.pipeline_id !== null && row.pipeline_id !== undefined)
      .map((row) => [String(row.pipeline_id), cleanText(row.label) ?? String(row.pipeline_id)])
  );
  const stageLabels = {};
  for (const row of stages.rows) {
    if (row.stage_id === null || row.stage_id === undefined) continue;
    const stageId = String(row.stage_id);
    const label = cleanText(row.label) ?? stageId;
    stageLabels[`${String(row.pipeline_id ?? '')}:${stageId}`] = label;
    if (!stageLabels[`:${stageId}`]) stageLabels[`:${stageId}`] = label;
  }

  return {
    owners: ownerLabels,
    pipelines: pipelineLabels,
    stages: stageLabels
  };
}
