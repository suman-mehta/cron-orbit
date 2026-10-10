import { performance } from 'node:perf_hooks';
import { parseCron, getNextRuns, simulateTimeline } from '../src/core.js';

function benchmark(name, fn, iterations = 10000) {
  // Warmup
  for (let i = 0; i < Math.min(iterations, 500); i++) fn();

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    fn();
  }
  const elapsedMs = performance.now() - start;
  const opsPerSec = Math.round((iterations / elapsedMs) * 1000);
  const nsPerOp = Math.round((elapsedMs / iterations) * 1000000);

  console.log(`│ ${name.padEnd(34)} │ ${String(opsPerSec.toLocaleString()).padStart(12)} ops/s │ ${String(nsPerOp).padStart(8)} ns/op │`);
}

console.log('┌────────────────────────────────────┬─────────────────────┬──────────────┐');
console.log('│ Benchmark Target                   │ Throughput          │ Latency      │');
console.log('├────────────────────────────────────┼─────────────────────┼──────────────┤');

benchmark('Parse Standard 5-Part Cron', () => {
  parseCron('*/15 2,4 * * 1-5');
}, 20000);

benchmark('Parse Extended 6-Part Cron', () => {
  parseCron('15,45 */5 1-12 * * 0,6');
}, 20000);

const compiled = parseCron('*/5 * * * *');
const refDate = new Date('2025-01-01T00:00:00.000Z');

benchmark('Project 10 Occurrences', () => {
  getNextRuns(compiled, refDate, 10);
}, 10000);

const j1 = { id: '#1', parsed: parseCron('*/15 * * * *') };
const j2 = { id: '#2', parsed: parseCron('*/30 * * * *') };

benchmark('24-Hour Conflict Simulation (2 Jobs)', () => {
  simulateTimeline([j1, j2], refDate, 24);
}, 2000);

console.log('└────────────────────────────────────┴─────────────────────┴──────────────┘');
