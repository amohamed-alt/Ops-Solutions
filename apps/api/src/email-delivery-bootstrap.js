import { ensureBillingSchema } from './billing.js';
import { postgres } from './database.js';
import { getEmailDeliveryConfiguration, startEmailDeliveryLoop } from './email-delivery.js';
import { startNewDeviceNotificationLoop } from './new-device-notifications.js';
import { ensureRetentionBudgetSchema } from './retention-budget.js';

await Promise.all([
  ensureBillingSchema(postgres),
  ensureRetentionBudgetSchema(postgres)
]);

const delivery = getEmailDeliveryConfiguration(process.env);
const stopScheduledReports = delivery.configured
  ? startEmailDeliveryLoop(postgres)
  : () => undefined;
const stopNewDeviceNotifications = delivery.configured
  ? startNewDeviceNotificationLoop(postgres)
  : () => undefined;

if (!delivery.configured) {
  console.info(JSON.stringify({
    level: 'info',
    event: 'email_delivery_disabled',
    provider: delivery.provider,
    missing: delivery.missing,
    features: ['scheduled_reports', 'new_device_security_notifications']
  }));
}

process.once('beforeExit', () => {
  stopScheduledReports();
  stopNewDeviceNotifications();
});
