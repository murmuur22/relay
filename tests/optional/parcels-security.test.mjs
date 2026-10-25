// Explicit optional coverage, intentionally outside tests/backend/*.test.mjs.
import test from 'node:test';
import {assertViteBoundaries} from '../helpers/vite-boundaries.mjs';
import {assertSourceMapBoundaries} from '../helpers/source-map-boundaries.mjs';
const root=new URL('../../integrations/parcels/',import.meta.url);
test('Parcels Vite development file/CORS boundaries and ordinary module serving',{timeout:20000},()=>assertViteBoundaries(root));
test('Parcels indexed source-map offsets are bounded with valid maps retained',()=>assertSourceMapBoundaries(root));
