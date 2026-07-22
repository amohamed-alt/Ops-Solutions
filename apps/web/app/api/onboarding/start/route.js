import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';

import { adminHeaders } from '../../operations/auth';
import { createOnboardingSession, ONBOARDING_COOKIE, onboardingCookieOptions } from '../session';

const API_URL = process.env.API_INTERNAL_URL ?? 'http://api:3001';

function normalizeCompanyName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

export async function POST(request) {
  try {
    const body = await request.json();
    const companyName = normalizeCompanyName(body.companyName);
    const email = normalizeEmail(body.email);

    if (companyName.length < 2 || companyName.length > 120) {
      return NextResponse.json({ error: 'invalid_company', message: 'Enter a company name between 2 and 120 characters.' }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return NextResponse.json({ error: 'invalid_email', message: 'Enter a valid work email address.' }, { status: 400 });
    }

    const suffix = randomBytes(4).toString('hex');
    const workspaceResponse = await fetch(`${API_URL}/api/v1/workspaces`, {
      method: 'POST',
      headers: adminHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ name: companyName, slug: `${slugify(companyName) || 'workspace'}-${suffix}` }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000)
    });
    const workspace = await workspaceResponse.json();
    if (!workspaceResponse.ok) return NextResponse.json(workspace, { status: workspaceResponse.status });

    const oauthResponse = await fetch(`${API_URL}/api/v1/workspaces/${workspace.id}/hubspot/oauth/start`, {
      headers: adminHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000)
    });
    const oauth = await oauthResponse.json();
    if (!oauthResponse.ok) return NextResponse.json(oauth, { status: oauthResponse.status });

    const response = NextResponse.json({
      workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug },
      authorizationUrl: oauth.authorizationUrl,
      expiresInSeconds: oauth.expiresInSeconds
    }, { status: 201 });
    response.cookies.set(ONBOARDING_COOKIE, createOnboardingSession({ workspaceId: workspace.id, email }), onboardingCookieOptions());
    return response;
  } catch (error) {
    return NextResponse.json({ error: 'onboarding_unavailable', message: error.message }, { status: 503 });
  }
}
