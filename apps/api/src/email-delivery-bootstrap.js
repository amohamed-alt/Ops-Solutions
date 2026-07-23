import { postgres } from './database.js';
import { startEmailDeliveryLoop } from './email-delivery.js';

const stop = startEmailDeliveryLoop(postgres);

process.once('beforeExit', stop);
