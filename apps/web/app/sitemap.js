const APP_URL = 'https://ops.dashboardtalentera.tech';

export default function sitemap() {
  const lastModified = new Date('2026-07-24T00:00:00.000Z');
  return [
    { url: `${APP_URL}/`, lastModified, changeFrequency: 'monthly', priority: 1 },
    { url: `${APP_URL}/privacy`, lastModified, changeFrequency: 'yearly', priority: 0.8 },
    { url: `${APP_URL}/terms`, lastModified, changeFrequency: 'yearly', priority: 0.8 },
    { url: `${APP_URL}/security`, lastModified, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${APP_URL}/support`, lastModified, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${APP_URL}/data-deletion`, lastModified, changeFrequency: 'yearly', priority: 0.8 }
  ];
}
