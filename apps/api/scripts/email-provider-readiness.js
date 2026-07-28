import { serializeEmailProviderReadiness } from '../src/email-provider-readiness.js';

process.stdout.write(`${serializeEmailProviderReadiness(process.env)}\n`);
