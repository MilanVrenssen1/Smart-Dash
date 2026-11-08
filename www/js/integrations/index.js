import demo from './demo.js';
import homeassistant from './homeassistant.js';
import hue from './hue.js';
import shelly from './shelly.js';
import webhook from './webhook.js';

// Order here is the order shown in the "Connect devices" screen.
export const INTEGRATIONS = { homeassistant, hue, shelly, webhook, demo };
