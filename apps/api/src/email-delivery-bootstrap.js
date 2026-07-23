import { postgres } from './database.js';
import { getEmailDeliveryConfiguration, startEmailDeliveryLoop } from './email-delivery.js';

const delivery = getEmailDeliveryConfiguration(process.env);
const stop = delivery.configured
  ? startEmailDeliveryLoop(postgres)
  : () => undefined;

if (!delivery.configured) {
  console.info(JSON.stringify({
    level: 'info',
    event: 'scheduled_report_delivery_disabled',
    provider: delivery.provider,
    missing: delivery.missing
  }));
}

process.once('beforeExit', stop);
