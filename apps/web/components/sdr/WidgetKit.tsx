'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Funnel,
  FunnelChart,
  LabelList,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

import type { ActivityTrendDatum, FunnelDatum, OwnerActivityDatum, StatusDatum } from './types';

export const CHART_COLORS = ['#087a50', '#f1bd28', '#3a7de0', '#744bc4', '#e85d4a', '#1aa6a0', '#d98d25', '#6a7d75'];
const GRID = '#dce7e2';
const TICK = '#667a71';

export function formatNumber(value: number | string | null | undefined) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(Number(value ?? 0));
}

export function compactNumber(value: number | string | null | undefined) {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value ?? 0));
}

export function Section({
  title,
  description,
  children,
  action,
  className = ''
}: {
  title: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`sdr-panel ${className}`.trim()}>
      <div className="sdr-panel-heading">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EmptyChart({ message = 'No data for the selected workspace' }: { message?: string }) {
  return <div className="sdr-empty-chart"><span>◇</span><strong>{message}</strong></div>;
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: any[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="sdr-chart-tooltip">
      {label ? <strong>{label}</strong> : null}
      {payload.map((item, index) => (
        <div key={`${item.name ?? 'value'}-${index}`}>
          <span style={{ background: item.color ?? item.fill }} />
          {item.name}: <b>{formatNumber(item.value)}</b>
        </div>
      ))}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  helper,
  icon: Icon,
  tone,
  onClick,
  formattedValue
}: {
  label: string;
  value: number;
  helper: string;
  icon: LucideIcon;
  tone: 'green' | 'blue' | 'teal' | 'amber' | 'red' | 'purple';
  onClick?: () => void;
  formattedValue?: string;
}) {
  const Component = onClick ? 'button' : 'article';
  return (
    <Component className={`sdr-kpi-card sdr-tone-${tone}`} onClick={onClick}>
      <div className="sdr-kpi-top"><span>{label}</span><Icon size={18} /></div>
      <strong>{formattedValue ?? formatNumber(value)}</strong>
      <small>{helper}{onClick ? <i>View records →</i> : null}</small>
    </Component>
  );
}

export function ActivityExecutionChart({
  rows,
  onPointClick
}: {
  rows: ActivityTrendDatum[];
  onPointClick?: (datum: ActivityTrendDatum) => void;
}) {
  if (!rows.length) return <EmptyChart message="Activity history will appear after synchronization." />;
  return (
    <div className="sdr-chart-body sdr-activity-chart">
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={rows} margin={{ top: 14, right: 12, left: -18, bottom: 0 }} onClick={(state: any) => {
          const datum = state?.activePayload?.[0]?.payload as ActivityTrendDatum | undefined;
          if (datum) onPointClick?.(datum);
        }}>
          <defs>
            <linearGradient id="callsFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#087a50" stopOpacity={0.22}/><stop offset="100%" stopColor="#087a50" stopOpacity={0}/></linearGradient>
            <linearGradient id="tasksFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f1bd28" stopOpacity={0.2}/><stop offset="100%" stopColor="#f1bd28" stopOpacity={0}/></linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
          <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: TICK, fontSize: 10 }} tickFormatter={(value) => String(value).slice(5)} minTickGap={20} />
          <YAxis axisLine={false} tickLine={false} tick={{ fill: TICK, fontSize: 10 }} />
          <Tooltip content={<ChartTooltip />} />
          <Area type="monotone" dataKey="calls" name="Calls" stroke="#087a50" fill="url(#callsFill)" strokeWidth={2.6} activeDot={{ r: 5, cursor: 'pointer' }} />
          <Area type="monotone" dataKey="tasks" name="Tasks" stroke="#f1bd28" fill="url(#tasksFill)" strokeWidth={2.3} activeDot={{ r: 5, cursor: 'pointer' }} />
          <Line type="monotone" dataKey="meetings" name="Meetings" stroke="#3a7de0" strokeWidth={2.4} dot={false} activeDot={{ r: 5, cursor: 'pointer' }} />
        </AreaChart>
      </ResponsiveContainer>
      <div className="sdr-chart-legend"><span><i style={{ background: '#087a50' }} />Calls</span><span><i style={{ background: '#f1bd28' }} />Tasks</span><span><i style={{ background: '#3a7de0' }} />Meetings</span></div>
    </div>
  );
}

export function ConversionFunnelChart({ rows, onSelect }: { rows: FunnelDatum[]; onSelect?: (datum: FunnelDatum) => void }) {
  if (!rows.length) return <EmptyChart message="Conversion cohorts are not available yet." />;
  const data = rows.map((row, index) => ({ ...row, fill: CHART_COLORS[index % CHART_COLORS.length] }));
  return (
    <div className="sdr-funnel-widget">
      <ResponsiveContainer width="100%" height={280}>
        <FunnelChart>
          <Tooltip content={<ChartTooltip />} />
          <Funnel dataKey="value" data={data} isAnimationActive onClick={(entry: any) => onSelect?.(entry?.payload ?? entry)} cursor={onSelect ? 'pointer' : 'default'}>
            {data.map((item) => <Cell key={item.key} fill={item.fill} />)}
            <LabelList position="right" fill="#385247" stroke="none" dataKey="label" fontSize={10} />
          </Funnel>
        </FunnelChart>
      </ResponsiveContainer>
      <div className="sdr-funnel-legend">
        {data.map((row) => <button key={row.key} type="button" onClick={() => onSelect?.(row)} disabled={!onSelect}><i style={{ background: row.fill }} /><span>{row.label}</span><strong>{compactNumber(row.value)}</strong></button>)}
      </div>
    </div>
  );
}

export function LeadStatusBars({ rows, onSelect }: { rows: StatusDatum[]; onSelect?: (datum: StatusDatum) => void }) {
  if (!rows.length) return <EmptyChart message="Lead status values will appear after contact synchronization." />;
  const data = rows.slice(0, 10).map((row) => ({ ...row, name: humanize(row.key) }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(290, data.length * 42 + 50)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 28, top: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={GRID} />
        <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: TICK, fontSize: 10 }} />
        <YAxis type="category" dataKey="name" width={132} axisLine={false} tickLine={false} tick={{ fill: '#31483e', fontSize: 10 }} />
        <Tooltip content={<ChartTooltip />} />
        <Bar dataKey="value" name="Contacts" fill="#087a50" radius={[0, 7, 7, 0]} cursor={onSelect ? 'pointer' : 'default'} onClick={(entry: any) => onSelect?.(entry?.payload ?? entry)} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function OwnerLeaderboardChart({ rows }: { rows: OwnerActivityDatum[] }) {
  if (!rows.length) return <EmptyChart message="Owner activity will appear after calls synchronize." />;
  const data = rows.slice(0, 8).map((row) => ({
    ...row,
    name: row.owner?.name ?? (row.key === 'Unassigned' ? 'Unassigned' : `Owner ${row.key}`)
  }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(280, data.length * 42 + 42)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 26 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={GRID} />
        <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: TICK, fontSize: 10 }} />
        <YAxis type="category" dataKey="name" width={145} axisLine={false} tickLine={false} tick={{ fill: '#31483e', fontSize: 10 }} />
        <Tooltip content={<ChartTooltip />} />
        <Bar dataKey="value" name="Calls" fill="#3a7de0" radius={[0, 7, 7, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function humanize(value: string | undefined) {
  return String(value || 'Unknown')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
