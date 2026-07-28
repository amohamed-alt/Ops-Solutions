export const AUTO_MAPPING_CONFIDENCE = 0.85;

function slotKey(item) {
  return `${item.semanticKey ?? item.semantic_key}:${item.objectType ?? item.object_type}`;
}

function normalizedSuggestion(row) {
  return {
    semanticKey: row.semanticKey ?? row.semantic_key,
    objectType: row.objectType ?? row.object_type,
    propertyName: row.propertyName ?? row.property_name,
    confidence: Number(row.confidence ?? 0),
    reasons: row.reasons ?? []
  };
}

export function selectAutoMappings(suggestions, existingMappings = [], threshold = AUTO_MAPPING_CONFIDENCE) {
  const occupied = new Set(existingMappings.map(slotKey));
  const winners = new Map();

  for (const raw of suggestions) {
    const suggestion = normalizedSuggestion(raw);
    if (!suggestion.semanticKey || !suggestion.objectType || !suggestion.propertyName) continue;
    if (!Number.isFinite(suggestion.confidence) || suggestion.confidence < threshold) continue;

    const key = slotKey(suggestion);
    if (occupied.has(key)) continue;

    const current = winners.get(key);
    if (!current || suggestion.confidence > current.confidence) {
      winners.set(key, suggestion);
    }
  }

  return [...winners.values()].sort((left, right) => (
    left.semanticKey.localeCompare(right.semanticKey)
      || left.objectType.localeCompare(right.objectType)
      || right.confidence - left.confidence
  ));
}
