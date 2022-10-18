import type { LogLevel } from '#@shared/modules/logger.js';
import { inBrowser } from '#@shared/modules/utils.js';
export let config: { log_level?: LogLevel; loc_level?: LogLevel } = {};

if (inBrowser()) {
} else {
}
