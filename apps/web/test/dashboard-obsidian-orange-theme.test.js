import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pageSource = readFileSync(new URL('../app/dashboard/page.js', import.meta.url), 'utf8');
const themeSource = readFileSync(new URL('../components/sdr/dashboard-obsidian-orange.css', import.meta.url), 'utf8');

function expectTheme(fragment, message) {
  assert.ok(themeSource.includes(fragment), message);
}

assert.ok(
  pageSource.includes("import '@/components/sdr/dashboard-obsidian-orange.css';"),
  'the production dashboard must load the command-center theme after the existing dashboard layers'
);
assert.ok(
  pageSource.indexOf('dashboard-obsidian-orange.css') > pageSource.indexOf('dashboard-saas-refresh.css'),
  'the command-center theme must load after the SaaS refresh so its scoped overrides remain deterministic'
);

expectTheme('--workspace-accent: #f97316', 'the design system must use the approved orange accent');
expectTheme('--obsidian: #111111', 'the design system must define an accessible obsidian navigation tone');
expectTheme('.dashboard-workspace-experience .ric-sidebar', 'the theme must style the tenant navigation shell');
expectTheme('.dashboard-workspace-experience .ric-heading', 'the theme must compact and strengthen the dashboard heading');
expectTheme('min-height: 126px', 'the dashboard heading and KPI density must keep decision data above the fold');
expectTheme('.dashboard-workspace-experience .ric-kpi-grid .ric-kpi::before', 'KPI cards must expose a consistent accent rail');
expectTheme('.dashboard-workspace-experience .ric-attention', 'the operational attention panel must have a dedicated high-contrast treatment');
expectTheme('.dashboard-workspace-experience .ric-chart', 'chart surfaces must receive the richer plot treatment');
expectTheme('.recharts-default-tooltip', 'Recharts tooltips must follow the dashboard visual system');
expectTheme(':focus-visible', 'keyboard focus must remain visible across dashboard controls');
expectTheme('@media (max-width: 760px)', 'the command center must retain a mobile-specific layout');
expectTheme('@media (prefers-reduced-motion: reduce)', 'the theme must respect reduced-motion preferences');

assert.ok(!themeSource.includes('url('), 'the visual system must not introduce external tracking or remote assets');
assert.ok(!themeSource.includes('data:'), 'the visual system must not inline opaque data payloads');

console.log('dashboard obsidian-orange visual regression checks passed');
