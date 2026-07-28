function normalizedConfidence(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(1, parsed));
}

function normalizedSource(value) {
  return String(value ?? '').trim().toLowerCase() || 'manual';
}

export function classifyReportingConfidence(rows = []) {
  const mappings = rows.map((row) => {
    const source = normalizedSource(row.source);
    return {
      semanticKey: String(row.semantic_key ?? row.semanticKey ?? ''),
      objectType: String(row.object_type ?? row.objectType ?? ''),
      propertyName: String(row.property_name ?? row.propertyName ?? ''),
      source,
      confidence: normalizedConfidence(row.confidence),
      inferred: source === 'inferred_auto'
    };
  }).filter((row) => row.semanticKey && row.objectType && row.propertyName);

  const inferredMappings = mappings.filter((mapping) => mapping.inferred);
  const exactMappings = mappings.filter((mapping) => !mapping.inferred);
  const inferredConfidences = inferredMappings
    .map((mapping) => mapping.confidence)
    .filter((value) => value !== null);

  const level = inferredMappings.length > 0 ? 'inferred' : 'exact';
  return {
    level,
    exactMappings: exactMappings.length,
    inferredMappings: inferredMappings.length,
    minimumInferredConfidence: inferredConfidences.length
      ? Math.min(...inferredConfidences)
      : null,
    confirmationRequired: inferredMappings.length > 0,
    message: inferredMappings.length > 0
      ? 'This report uses high-confidence inferred CRM mappings. Confirm them in Setup to mark the report as exact.'
      : 'This report uses confirmed CRM mappings.',
    nextAction: inferredMappings.length > 0
      ? 'Review and confirm inferred semantic mappings in Setup.'
      : null,
    mappings
  };
}

export async function loadReportingConfidence(postgres, workspaceId) {
  try {
    const result = await postgres.query(
      `SELECT
         pm.semantic_key,
         pm.object_type,
         pm.property_name,
         pm.source,
         suggestion.confidence
       FROM property_mappings pm
       LEFT JOIN LATERAL (
         SELECT confidence
         FROM property_mapping_suggestions pms
         WHERE pms.workspace_id = pm.workspace_id
           AND pms.semantic_key = pm.semantic_key
           AND pms.object_type = pm.object_type
           AND pms.property_name = pm.property_name
         ORDER BY pms.confidence DESC, pms.updated_at DESC
         LIMIT 1
       ) suggestion ON TRUE
       WHERE pm.workspace_id = $1
       ORDER BY pm.semantic_key, pm.object_type`,
      [workspaceId]
    );
    return classifyReportingConfidence(result.rows);
  } catch (error) {
    if (error?.code === '42P01') return classifyReportingConfidence([]);
    throw error;
  }
}

export function annotateReportingConfidence(report, confidence) {
  return {
    ...report,
    reportingConfidence: confidence
  };
}
