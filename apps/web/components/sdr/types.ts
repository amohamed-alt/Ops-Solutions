export type MetricStatus = 'ready' | 'configuration_required';

export interface MetricResult {
  key?: string;
  label?: string;
  status: MetricStatus;
  value: number | null;
  error?: string | null;
}

export interface ActivityTrendDatum {
  day: string;
  calls: number;
  meetings: number;
  tasks: number;
}

export interface FunnelDatum {
  key: string;
  label: string;
  value: number;
}

export interface StatusDatum {
  key: string;
  value: number;
}

export interface OwnerInfo {
  id: string;
  name: string;
  email?: string | null;
  archived?: boolean;
}

export interface OwnerActivityDatum {
  key: string;
  value: number;
  owner?: OwnerInfo;
}

export interface MappingItem {
  key: string;
  approved: boolean;
}

export interface OperationalSnapshot {
  totalCompanies?: number;
  openTasks?: number;
  tasksDueToday?: number;
  tasksDueTomorrow?: number;
  highPriorityTasks?: number;
  overdueTasks?: number;
  noNextActivity?: number;
  openDeals?: number;
  missingOwner?: number;
}

export interface DashboardModel {
  generatedAt?: string;
  freshness?: {
    totalRecords?: number;
    latestSync?: string | null;
  };
  metrics?: Record<string, MetricResult>;
  operationalSnapshot?: OperationalSnapshot;
  activityTrend?: ActivityTrendDatum[];
  conversionFunnel?: FunnelDatum[];
  leadStatus?: StatusDatum[];
  leaderboards?: {
    activityByOwner?: {
      status?: MetricStatus;
      value?: OwnerActivityDatum[];
    };
  };
  mappingReadiness?: {
    required?: MappingItem[];
    optional?: MappingItem[];
  };
}

export interface DashboardPayload {
  workspace?: Workspace;
  dashboard?: DashboardModel;
}

export interface Workspace {
  id: string;
  name: string;
  slug?: string;
  status?: string;
  portal_id?: number | string | null;
  hubspot_status?: string | null;
  last_discovered_at?: string | null;
}

export interface WorkspaceState {
  workspace: Workspace;
  initialized?: boolean;
  activeRun?: Record<string, unknown> | null;
  latestRun?: {
    status?: string;
    started_at?: string;
    completed_at?: string;
  } | null;
  recordCounts?: Array<{
    object_type: string;
    count: number | string;
    archived_count?: number | string;
  }>;
  freshness?: {
    newest_record_sync?: string | null;
    oldest_record_sync?: string | null;
    total_records?: number | string;
  } | null;
  error?: string;
}

export interface PriorityLead {
  id: string;
  properties: Record<string, string | undefined>;
  hubspotCreatedAt?: string | null;
  hubspotUpdatedAt?: string | null;
  syncedAt?: string | null;
}

export interface PriorityDrilldown {
  key: string;
  objectType: string;
  columns?: string[];
  limit: number;
  offset: number;
  fallback?: boolean;
  hasMore?: boolean;
  results: PriorityLead[];
}
