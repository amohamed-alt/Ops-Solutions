import { postgres } from './database.js';
import { getEmailDeliveryConfiguration, startEmailDeliveryLoop } from './email-delivery.js';
import { startNewDeviceNotificationLoop } from './new-device-notifications.js';
import { startOperationalAlertLoop } from './operational-alerts.js';

const delivery = getEmailDeliveryConfiguration(process.env);
const stopScheduledReports = delivery.configured
  ? startEmailDeliveryLoop(postgres)
  : () => undefined;
const stopNewDeviceNotifications = delivery.configured
  ? startNewDeviceNotificationLoop(postgres)
  : () => undefined;
const stopOperationalAlerts = delivery.configured
  ? startOperationalAlertLoop(postgres)
  : () => undefined;

if (!delivery.configured) {
  console.info(JSON.stringify({
    level: 'info',
    event: 'email_delivery_disabled',
    provider: delivery.provider,
    missing: delivery.missing,
    features: ['scheduled_reports', 'new_device_security_notifications', 'operational_alerts']
  }));
}

process.once('beforeExit', () => {
  stopScheduledReports();
  stopNewDeviceNotifications();
  stopOperationalAlerts();
});
