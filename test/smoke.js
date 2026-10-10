import assert from 'node:assert';
import { parseCron, matchDate, getNextRuns, simulateTimeline } from '../src/core.js';

console.log('Running cron-orbit Smoke Suite...');

// Test 1: Standard 5-field parsing
const p1 = parseCron('*/15 0,12 * * 1-5');
assert.strictEqual(p1.hasSeconds, false);
assert.deepStrictEqual(p1.fieldMap.minute, [0, 15, 30, 45]);
assert.deepStrictEqual(p1.fieldMap.hour, [0, 12]);
assert.deepStrictEqual(p1.fieldMap.dayOfWeek, [1, 2, 3, 4, 5]);

// Test 2: Extended 6-field with seconds & aliases
const p2 = parseCron('30 0 12 1 JAN,DEC MON');
assert.strictEqual(p2.hasSeconds, true);
assert.deepStrictEqual(p2.fieldMap.second, [30]);
assert.deepStrictEqual(p2.fieldMap.month, [1, 12]);
assert.deepStrictEqual(p2.fieldMap.dayOfWeek, [1]);

// Test 3: Macro replacement
const p3 = parseCron('@hourly');
assert.deepStrictEqual(p3.fieldMap.minute, [0]);
assert.strictEqual(p3.fieldMap.hour.length, 24);

// Test 4: Next run calculation accuracy
const baseDate = new Date('2025-01-01T00:00:00.000Z');
const nextRuns = getNextRuns(p1, baseDate, 3);
assert.strictEqual(nextRuns.length, 3);
assert.strictEqual(nextRuns[0].toISOString(), '2025-01-01T00:15:00.000Z');
assert.strictEqual(nextRuns[1].toISOString(), '2025-01-01T00:30:00.000Z');
assert.strictEqual(nextRuns[2].toISOString(), '2025-01-01T00:45:00.000Z');

// Test 5: Collision Simulation
const jobA = { id: '#1', parsed: parseCron('0 4 * * *') };
const jobB = { id: '#2', parsed: parseCron('*/30 4 * * *') };
const sim = simulateTimeline([jobA, jobB], baseDate, 24);
assert.ok(sim.collisions.length >= 1, 'Collision should be detected at 04:00');
assert.strictEqual(sim.collisions[0].timestamp.getUTCHours(), 4);
assert.strictEqual(sim.collisions[0].timestamp.getUTCMinutes(), 0);

// Test 6: Error validations
assert.throws(() => parseCron('invalid string with way too many fields right here'), /Expected 5 or 6 fields/);
assert.throws(() => parseCron('60 * * * *'), /out of bounds for minute/);
assert.throws(() => parseCron('* 25 * * *'), /out of bounds for hour/);

console.log('✓ All 6 smoke assertions passed cleanly.');
