export type ReportingConfidence = {
  level?: 'exact' | 'inferred' | 'proxy' | string;
  exactMappings?: number;
  inferredMappings?: number;
  minimumInferredConfidence?: number | null;
  confirmationRequired?: boolean;
  message?: string | null;
  nextAction?: string | null;
};

export type ReportingConfidenceStatus = {
  level: 'exact' | 'inferred' | 'proxy';
  label: string;
  detail: string;
  actionLabel: string | null;
  actionHref: string | null;
};

const REPORTS_PATTERN = /\/api\/dashboard\/[^/]+\/reports(?:\?[^#]*)?$/;

export function isDashboardReportRequest(input: RequestInfo | URL, init?: RequestInit) {
  const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (method !== 'GET') return false;
  const url = input instanceof Request ? input.url : String(input);
  return REPORTS_PATTERN.test(url);
}

export function reportingConfidenceFromPayload(payload: unknown): ReportingConfidence | null {
  if (!payload || typeof payload !== 'object') return null;
  const report = (payload as { report?: unknown }).report;
  if (!report || typeof report !== 'object') return null;

  const confidence = (report as { reportingConfidence?: unknown }).reportingConfidence;
  if (confidence && typeof confidence === 'object') return confidence as ReportingConfidence;

  const degradation = (report as { reportingDegradation?: unknown }).reportingDegradation;
  if (degradation && typeof degradation === 'object' && (degradation as { active?: boolean }).active === true) {
    return {
      level: 'proxy',
      confirmationRequired: true,
      message: String((degradation as { message?: unknown }).message ?? 'Core analytics are shown because a semantic mapping is missing.'),
      nextAction: String((degradation as { nextAction?: unknown }).nextAction ?? 'Review semantic mappings in Setup.')
    };
  }

  return null;
}

export function formatReportingConfidenceStatus(confidence: ReportingConfidence | null): ReportingConfidenceStatus | null {
  if (!confidence) return null;
  const level = confidence.level === 'proxy' ? 'proxy' : confidence.level === 'inferred' ? 'inferred' : 'exact';

  if (level === 'proxy') {
    return {
      level,
      label: 'Proxy reporting',
      detail: confidence.message || 'Core analytics are shown because one or more semantic mappings are missing.',
      actionLabel: 'Review mappings',
      actionHref: '/settings/mappings'
    };
  }

  if (level === 'inferred') {
    const inferredCount = Number(confidence.inferredMappings ?? 0);
    const minimumConfidence = Number(confidence.minimumInferredConfidence);
    const confidenceDetail = Number.isFinite(minimumConfidence)
      ? ` Minimum mapping confidence: ${Math.round(minimumConfidence * 100)}%.`
      : '';
    return {
      level,
      label: 'Inferred reporting',
      detail: confidence.message || `${inferredCount || 'Some'} CRM mappings were inferred automatically.${confidenceDetail}`,
      actionLabel: 'Confirm mappings',
      actionHref: '/settings/mappings'
    };
  }

  const exactCount = Number(confidence.exactMappings ?? 0);
  return {
    level,
    label: 'Exact reporting',
    detail: confidence.message || `${exactCount ? `${exactCount} ` : ''}confirmed CRM mappings are being used.`,
    actionLabel: null,
    actionHref: null
  };
}
