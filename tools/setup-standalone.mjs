import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {iconPython} from '../server/icons.mjs';

// Operator supplies Python/Pillow (for example Debian python3-pil). Never install an app.
const pillow=spawnSync(iconPython(),['-c','from PIL import Image; Image.new("RGB", (1, 1))'],{timeout:10000,stdio:'ignore'});
if(pillow.error||pillow.status!==0){
 console.error('Pillow preflight failed: configure RELAY_ICON_PYTHON with an absolute Python executable providing Pillow.');
 process.exit(1);
}
const cli=fileURLToPath(new URL('./cli.js',import.meta.resolve('playwright/package.json')));
const browsers=spawnSync(process.execPath,[cli,'install','chromium'],{timeout:300000,stdio:'inherit'});
if(browsers.error||browsers.status!==0){console.error('Chromium installation failed.');process.exit(1);}
console.log('Standalone ready: Pillow verified; Playwright Chromium installed. No native integrations installed or started.');
