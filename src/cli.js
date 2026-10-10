#!/usr/bin/env node
import { parseCron, getNextRuns, simulateTimeline } from './core.js';

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  bgDark: '\x1b[48;5;236m'
};

function printHelp() {
  console.log(`
${ANSI.bold}${ANSI.cyan}cron-orbit${ANSI.reset} - High-Precision Cron Engine & Visual Timeline Simulator

${ANSI.bold}USAGE:${ANSI.reset}
  cron-orbit "<cron_expression>" [options]
  cron-orbit --compare "<expr_1>" "<expr_2>" [options]

${ANSI.bold}OPTIONS:${ANSI.reset}
  -s, --start <iso_string>   Simulation start time (default: current UTC)
  -n, --runs <number>        Number of forward runs to project (default: 5)
  -t, --timeline <hours>     Simulation timeline window in hours (default: 24, max: 72)
  -c, --compare              Compare multiple schedules for collision bursts
  -j, --json                 Output pure JSON representation for scripting
  -h, --help                 Display this CLI reference

${ANSI.bold}EXAMPLES:${ANSI.reset}
  ${ANSI.yellow}$ cron-orbit "*/15 2,4 * * 1-5"${ANSI.reset}
  ${ANSI.yellow}$ cron-orbit "0 0 1 * *" --runs 10 --start "2026-01-01T00:00:00Z"${ANSI.reset}
  ${ANSI.yellow}$ cron-orbit --compare "*/10 * * * *" "*/15 * * * *" --timeline 12${ANSI.reset}
`);
}

function parseArgs(args) {
  const config = {
    expressions: [],
    startDate: new Date(),
    runs: 5,
    timelineHours: 24,
    compare: false,
    json: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    } else if (arg === '-j' || arg === '--json') {
      config.json = true;
    } else if (arg === '-c' || arg === '--compare') {
      config.compare = true;
    } else if (arg === '-s' || arg === '--start') {
      const val = args[++i];
      if (!val) throw new Error('Missing value for --start flag');
      config.startDate = new Date(val);
      if (Number.isNaN(config.startDate.getTime())) throw new Error(`Invalid date string: ${val}`);
    } else if (arg === '-n' || arg === '--runs') {
      const val = parseInt(args[++i], 10);
      if (Number.isNaN(val) || val <= 0) throw new Error('Value for --runs must be a positive integer');
      config.runs = val;
    } else if (arg === '-t' || arg === '--timeline') {
      const val = parseInt(args[++i], 10);
      if (Number.isNaN(val) || val <= 0 || val > 72) throw new Error('Timeline must be between 1 and 72 hours');
      config.timelineHours = val;
    } else if (!arg.startsWith('-')) {
      config.expressions.push(arg);
    }
  }
  return config;
}

function renderBox(title, rows) {
  const maxLen = Math.max(title.length + 4, ...rows.map(r => r.replace(/\x1b\[[0-9;]*m/g, '').length + 2));
  const width = Math.min(Math.max(maxLen, 74), 100);
  
  const top = `┌${'─'.repeat(width - 2)}┐`;
  const titleLine = `│ ${ANSI.bold}${ANSI.cyan}${title.padEnd(width - 4)}${ANSI.reset} │`;
  const sep = `├${'─'.repeat(width - 2)}┤`;
  const bottom = `└${'─'.repeat(width - 2)}┘`;

  console.log(ANSI.cyan + top + ANSI.reset);
  console.log(titleLine);
  console.log(ANSI.cyan + sep + ANSI.reset);
  for (const row of rows) {
    const uncoloredLen = row.replace(/\x1b\[[0-9;]*m/g, '').length;
    const padding = Math.max(0, width - 4 - uncoloredLen);
    console.log(`│ ${row}${' '.repeat(padding)} │`);
  }
  console.log(ANSI.cyan + bottom + ANSI.reset);
}

function renderMatrix(jobs, timeline) {
  const hours = timeline.durationHours;
  let headerRow = '  Hour: ';
  for (let h = 0; h < hours; h++) {
    headerRow += (h < 10 ? `0${h}` : `${h}`) + ' ';
  }
  console.log(`\n${ANSI.bold}${ANSI.yellow}${hours}-HOUR VISUAL TIMELINE MATRIX (UTC):${ANSI.reset}`);
  console.log(ANSI.dim + headerRow + ANSI.reset);
  console.log(ANSI.dim + '  ──────┼' + '───'.repeat(hours) + ANSI.reset);

  const icons = ['■', '▲', '◆', '●', '✦'];
  jobs.forEach((job, idx) => {
    const icon = icons[idx % icons.length];
    let rowStr = `  ${job.id.padEnd(5)} │ `;
    for (let h = 0; h < hours; h++) {
      const count = timeline.hourlyBuckets[h][job.id] || 0;
      if (count > 0) {
        rowStr += `${ANSI.green}${icon}  ${ANSI.reset}`;
      } else {
        rowStr += `${ANSI.dim}·  ${ANSI.reset}`;
      }
    }
    console.log(rowStr);
  });
  console.log(ANSI.dim + '  ──────┼' + '───'.repeat(hours) + ANSI.reset);

  if (timeline.collisions.length > 0) {
    let alertStr = `  ${ANSI.red}${ANSI.bold}ALERT │ ${ANSI.reset}`;
    for (let h = 0; h < hours; h++) {
      const hasColl = timeline.collisions.some(c => c.timestamp.getUTCHours() === h);
      alertStr += hasColl ? `${ANSI.red}⚡  ${ANSI.reset}` : '   ';
    }
    console.log(alertStr);
    console.log(`  ${ANSI.red}${ANSI.bold}* Identified ${timeline.collisions.length} contention points where multiple jobs fire concurrently.${ANSI.reset}`);
  } else {
    console.log(`  ${ANSI.green}STATUS│ No concurrent execution conflicts detected across window.${ANSI.reset}`);
  }
}

function run() {
  try {
    const config = parseArgs(process.argv.slice(2));
    if (config.expressions.length === 0) {
      config.expressions = ['*/15 2,4 * * 1-5'];
    }

    const parsedJobs = config.expressions.map((expr, i) => {
      const parsed = parseCron(expr);
      return {
        id: `#${i + 1}`,
        raw: expr,
        parsed
      };
    });

    if (config.json) {
      const jsonOutput = {
        jobs: parsedJobs.map(j => ({
          id: j.id,
          expression: j.raw,
          fields: j.parsed.fieldMap,
          nextRuns: getNextRuns(j.parsed, config.startDate, config.runs).map(d => d.toISOString())
        }))
      };
      console.log(JSON.stringify(jsonOutput, null, 2));
      return;
    }

    // Terminal UI Display
    const headerRows = [
      `Reference Date : ${ANSI.yellow}${config.startDate.toISOString()}${ANSI.reset}`,
      `Evaluated Jobs : ${ANSI.bold}${parsedJobs.length}${ANSI.reset}`,
      `Projection Span: ${config.timelineHours} Hours`
    ];
    renderBox('CRON-ORBIT :: ENGINE & WORKLOAD PROJECTOR', headerRows);

    // Show parsed fields breakdown
    for (const job of parsedJobs) {
      console.log(`\n${ANSI.bold}${ANSI.magenta}JOB ${job.id} EXPRESSION:${ANSI.reset} ${ANSI.cyan}${job.raw}${ANSI.reset}`);
      console.log(ANSI.dim + '┌─────────────┬────────────────────────────────────────────┐' + ANSI.reset);
      console.log(ANSI.dim + '│ Field       │ Resolved Matching Discrete Values           │' + ANSI.reset);
      console.log(ANSI.dim + '├─────────────┼────────────────────────────────────────────┤' + ANSI.reset);
      for (const f of job.parsed.fields) {
        const valStr = f.values.length > 12 
          ? `${f.values.slice(0, 10).join(', ')} ... (${f.values.length} total)` 
          : f.values.join(', ');
        console.log(`│ ${f.name.padEnd(11)} │ ${valStr.padEnd(42)} │`);
      }
      console.log(ANSI.dim + '└─────────────┴────────────────────────────────────────────┘' + ANSI.reset);
    }

    // Visual Timeline Matrix
    const timeline = simulateTimeline(parsedJobs, config.startDate, config.timelineHours);
    renderMatrix(parsedJobs, timeline);

    // Next Run Schedules
    console.log(`\n${ANSI.bold}${ANSI.cyan}NEXT PROJECTED EXECUTION ITERATIONS:${ANSI.reset}`);
    for (const job of parsedJobs) {
      const runs = getNextRuns(job.parsed, config.startDate, config.runs);
      console.log(`\n  ${ANSI.bold}${job.id} (${job.raw}):${ANSI.reset}`);
      runs.forEach((r, idx) => {
        console.log(`    ${ANSI.dim}${String(idx + 1).padStart(2, '0')}.${ANSI.reset} ${ANSI.green}${r.toISOString()}${ANSI.reset} (in ${((r.getTime() - config.startDate.getTime()) / 60000).toFixed(1)} mins)`);
      });
    }
    console.log('');
  } catch (err) {
    console.error(`\n${ANSI.red}${ANSI.bold}Error:${ANSI.reset} ${err.message}\n`);
    process.exit(1);
  }
}

run();
