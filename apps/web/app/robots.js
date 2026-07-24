export default function robots() {
  return {
    rules: [
      { userAgent: '*', allow: ['/', '/privacy', '/terms', '/security', '/support', '/data-deletion'], disallow: ['/api/', '/dashboard/', '/settings/', '/onboarding'] }
    ],
    sitemap: 'https://ops.dashboardtalentera.tech/sitemap.xml',
    host: 'https://ops.dashboardtalentera.tech'
  };
}
