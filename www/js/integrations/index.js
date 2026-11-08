import demo from './demo.js';
import homeassistant from './homeassistant.js';
import hue from './hue.js';
import shelly from './shelly.js';
import webhook from './webhook.js';
import sonos from './sonos.js';
import googlehome from './googlehome.js';

// Order here is the order shown in the "Connect devices" screen.
export const INTEGRATIONS = { googlehome, homeassistant, hue, sonos, shelly, webhook, demo };
