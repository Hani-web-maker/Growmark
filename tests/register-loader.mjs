/**
 * Registers the .png loader hook. Used via:
 *   node --import ./tests/register-loader.mjs tests/engine-regression.mjs
 */
import { register } from 'node:module';
register('./png-loader.mjs', import.meta.url);
