function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function optionValues(property) {
  return Array.isArray(property.options)
    ? property.options.map((option) => normalize(`${option.label ?? ''} ${option.value ?? ''}`))
    : [];
}

function scoreOptionPattern(semanticKey, values) {
  if (values.length === 0) return { score: 0, reason: null };

  const combined = values.join(' | ');
  const patterns = {
    lead_quality: [
      /\ba\b.*\bb\b.*\bc\b/,
      /rank a.*rank b.*rank c/,
      /tier 1.*tier 2.*tier 3/,
      /hot.*warm.*cold/,
      /high.*medium.*low/,
      /priority 1.*priority 2/
    ],
    account_status: [
      /active.*churned/,
      /customer.*prospect/,
      /active.*inactive/
    ],
    meeting_outcome: [
      /completed.*no show/,
      /scheduled.*completed/,
      /rescheduled.*cancelled/
    ],
    call_outcome: [
      /connected.*wrong number/,
      /answered.*no answer/,
      /busy.*voicemail/
    ]
  };

  const matched = (patterns[semanticKey] ?? []).some((pattern) => pattern.test(combined));
  return matched
    ? { score: 0.22, reason: 'Property options match the expected business classification pattern.' }
    : { score: 0, reason: null };
}

function scoreProperty(field, property) {
  const searchable = normalize([
    property.property_name,
    property.label,
    property.description,
    property.group_name
  ].filter(Boolean).join(' '));
  const normalizedName = normalize(property.property_name);
  const normalizedLabel = normalize(property.label);
  const keywords = Array.isArray(field.keyword_hints) ? field.keyword_hints : [];
  const expectedTypes = Array.isArray(field.expected_types) ? field.expected_types : [];
  const reasons = [];
  let score = 0;

  for (const keywordValue of keywords) {
    const keyword = normalize(keywordValue);
    if (!keyword) continue;

    if (normalizedName === keyword || normalizedLabel === keyword) {
      score = Math.max(score, 0.78);
      reasons.push(`Exact semantic match with “${keywordValue}”.`);
      continue;
    }

    if (normalizedName.includes(keyword) || normalizedLabel.includes(keyword)) {
      score += 0.34;
      reasons.push(`Property name or label contains “${keywordValue}”.`);
      continue;
    }

    if (searchable.includes(keyword)) {
      score += 0.18;
      reasons.push(`Property metadata references “${keywordValue}”.`);
    }
  }

  const propertyTypes = [property.data_type, property.field_type]
    .map(normalize)
    .filter(Boolean);
  if (expectedTypes.some((type) => propertyTypes.includes(normalize(type)))) {
    score += 0.12;
    reasons.push('The property data type is compatible with this semantic field.');
  }

  const optionPattern = scoreOptionPattern(field.semantic_key, optionValues(property));
  score += optionPattern.score;
  if (optionPattern.reason) reasons.push(optionPattern.reason);

  if (property.hubspot_defined && score < 0.45) {
    score *= 0.88;
  }

  return {
    confidence: Math.min(0.99, Number(score.toFixed(4))),
    reasons: [...new Set(reasons)].slice(0, 5)
  };
}

export function buildMappingSuggestions(semanticFields, properties) {
  const suggestions = [];

  for (const field of semanticFields) {
    const allowedObjects = Array.isArray(field.object_types) ? field.object_types : [];

    const candidates = properties
      .filter((property) => allowedObjects.includes(property.object_type))
      .map((property) => ({
        semanticKey: field.semantic_key,
        objectType: property.object_type,
        propertyName: property.property_name,
        ...scoreProperty(field, property)
      }))
      .filter((candidate) => candidate.confidence >= 0.22)
      .sort((left, right) => right.confidence - left.confidence);

    const perObject = new Map();
    for (const candidate of candidates) {
      const currentCount = perObject.get(candidate.objectType) ?? 0;
      if (currentCount >= 3) continue;

      suggestions.push(candidate);
      perObject.set(candidate.objectType, currentCount + 1);
    }
  }

  return suggestions;
}

export function inferValueMapping(semanticKey, options) {
  if (!Array.isArray(options) || options.length === 0) return {};

  const output = {};
  const normalizedOptions = options.map((option) => ({
    value: String(option.value ?? option.label ?? ''),
    label: normalize(`${option.label ?? ''} ${option.value ?? ''}`)
  }));

  if (semanticKey === 'lead_quality') {
    const classifiers = [
      { target: 'highest', patterns: [/\brank a\b/, /\ba\b/, /tier 1/, /hot/, /high/, /priority 1/, /platinum/] },
      { target: 'medium', patterns: [/\brank b\b/, /\bb\b/, /tier 2/, /warm/, /medium/, /priority 2/, /gold/] },
      { target: 'lowest', patterns: [/\brank c\b/, /\bc\b/, /tier 3/, /cold/, /low/, /priority 3/, /silver/] }
    ];

    for (const option of normalizedOptions) {
      const classifier = classifiers.find((item) => item.patterns.some((pattern) => pattern.test(option.label)));
      if (classifier) output[option.value] = classifier.target;
    }
  }

  if (semanticKey === 'account_status') {
    for (const option of normalizedOptions) {
      if (/active|customer|live|renewed/.test(option.label)) output[option.value] = 'active';
      else if (/churn|lost|cancel|inactive/.test(option.label)) output[option.value] = 'inactive';
      else if (/prospect|lead|potential/.test(option.label)) output[option.value] = 'prospect';
    }
  }

  return output;
}
