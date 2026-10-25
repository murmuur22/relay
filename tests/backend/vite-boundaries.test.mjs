// Required standalone consumers only; optional coverage has a separate command.
import test from 'node:test';
import {requiredConsumers} from '../helpers/required-consumers.mjs';
import {assertViteBoundaries} from '../helpers/vite-boundaries.mjs';
for(const {label,root} of requiredConsumers){
 test('Vite development file/CORS boundaries and ordinary module serving: '+label,{timeout:20000},()=>assertViteBoundaries(root));
}
