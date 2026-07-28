const SUPPORTED_PROVIDERS = new Set(['disabled', 'resend', 'postmark']);

function safeText(value, max = 320) {
  return String(value ?? '').trim().slice(0, max);
}

function normalizedProvider(value) {
  const provider = safeText(value, 30).toLowerCase() || 'disabled';
  return SUPPORTED_PROVIDERS.has(provider) ? provider : 'unsupported';
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function evaluateEmailProviderReadiness(env = process.env) {
  const provider = normalizedProvider(env.EMAIL_PROVIDER);
  const fromAddress = safeText(env.EMAIL_FROM_ADDRESS);
  const fromName = safeText(env.EMAIL_FROM_NAME || 'Ops Intelligence', 120);
  const missing = [];
  const invalid = [];

  if (provider === 'disabled') {
    missing.push('EMAIL_PROVIDER');
  } else if (provider === 'unsupported') {
    invalid.push('EMAIL_PROVIDER');
  }

  if (!fromAddress) {
    missing.push('EMAIL_FROM_ADDRESS');
  } else if (!validEmail(fromAddress)) {
    invalid.push('EMAIL_FROM_ADDRESS');
  }

  if (provider === 'resend' && !safeText(env.RESEND_API_KEY, 500)) {
    missing.push('RESEND_API_KEY');
  }
  if (provider === 'postmark' && !safeText(env.POSTMARK_SERVER_TOKEN, 500)) {
    missing.push('POSTMARK_SERVER_TOKEN');
  }

  const configured = missing.length === 0 && invalid.length === 0 && ['resend', 'postmark'].includes(provider);
  const status = configured ? 'ready' : invalid.length > 0 ? 'invalid_configuration' : 'configuration_required';

  return {
    configured,
    status,
    provider,
    from: {
      configured: Boolean(fromAddress) && validEmail(fromAddress),
      addressDomain: validEmail(fromAddress) ? fromAddress.split('@')[1].toLowerCase() : null,
      nameConfigured: Boolean(fromName)
    },
    missing,
    invalid,
    capabilities: {
      transactionalEmail: configured,
      scheduledReports: configured,
      attachments: configured,
      providerMessageTracking: configured
    },
    nextActions: [
      ...missing.map((name) => `Configure ${name} in the production secret store.`),
      ...invalid.map((name) => `Correct the value configured for ${name} in the production secret store.`)
    ]
  };
}

export function serializeEmailProviderReadiness(env = process.env) {
  return JSON.stringify(evaluateEmailProviderReadiness(env), null, 2);
}
