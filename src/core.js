/**
 * cron-orbit Core Engine
 * Zero-dependency cron expression parser, evaluator, and collision simulator.
 */

const MONTH_NAMES = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12
};

const DAY_NAMES = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6
};

const MACROS = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *'
};

const FIELD_BOUNDS = [
  { name: 'second', min: 0, max: 59 },
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'dayOfMonth', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12, aliases: MONTH_NAMES },
  { name: 'dayOfWeek', min: 0, max: 7, aliases: DAY_NAMES } // 0 and 7 both mean Sunday
];

function sanitizeToken(token, aliases) {
  const upper = token.toUpperCase();
  if (aliases && upper in aliases) {
    return aliases[upper];
  }
  const parsed = parseInt(token, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid token: "${token}"`);
  }
  return parsed;
}

function parseRangeComponent(component, bound) {
  let step = 1;
  let rangePart = component;

  if (component.includes('/')) {
    const parts = component.split('/');
    if (parts.length !== 2) throw new Error(`Malformed step expression: "${component}"`);
    rangePart = parts[0];
    step = parseInt(parts[1], 10);
    if (Number.isNaN(step) || step <= 0) {
      throw new Error(`Invalid step increment: "${parts[1]}" in "${component}"`);
    }
  }

  let start = bound.min;
  let end = bound.max;

  if (rangePart === '*' || rangePart === '') {
    // Covers wildcard with optional step
  } else if (rangePart.includes('-')) {
    const sub = rangePart.split('-');
    if (sub.length !== 2) throw new Error(`Malformed range expression: "${rangePart}"`);
    start = sanitizeToken(sub[0], bound.aliases);
    end = sanitizeToken(sub[1], bound.aliases);
  } else {
    const single = sanitizeToken(rangePart, bound.aliases);
    if (component.includes('/')) {
      start = single;
      end = bound.max;
    } else {
      start = single;
      end = single;
    }
  }

  if (start < bound.min || start > bound.max) {
    throw new Error(`Value ${start} out of bounds for ${bound.name} (${bound.min}-${bound.max})`);
  }
  if (end < bound.min || end > bound.max) {
    throw new Error(`Value ${end} out of bounds for ${bound.name} (${bound.min}-${bound.max})`);
  }

  const matched = [];
  if (start <= end) {
    for (let i = start; i <= end; i += step) {
      matched.push(i);
    }
  } else {
    // Wraparound bounds (e.g. FRI-MON)
    for (let i = start; i <= bound.max; i += step) {
      matched.push(i);
    }
    for (let i = bound.min; i <= end; i += step) {
      matched.push(i);
    }
  }
  return matched;
}

export function parseCron(expression) {
  let raw = expression.trim();
  if (MACROS[raw]) {
    raw = MACROS[raw];
  }

  const tokens = raw.split(/\s+/);
  let hasSeconds = false;
  let bounds = [];

  if (tokens.length === 5) {
    hasSeconds = false;
    bounds = FIELD_BOUNDS.slice(1); // minute, hour, dom, month, dow
  } else if (tokens.length === 6) {
    hasSeconds = true;
    bounds = FIELD_BOUNDS; // second, minute, hour, dom, month, dow
  } else {
    throw new Error(`Expected 5 or 6 fields, received ${tokens.length} in "${expression}"`);
  }

  const parsedFields = bounds.map((bound, index) => {
    const token = tokens[index];
    const subTokens = token.split(',');
    const valueSet = new Set();

    for (const sub of subTokens) {
      const items = parseRangeComponent(sub, bound);
      for (const item of items) {
        // Normalize Day of Week 7 -> 0 (Sunday)
        if (bound.name === 'dayOfWeek' && item === 7) {
          valueSet.add(0);
        } else {
          valueSet.add(item);
        }
      }
    }

    return {
      name: bound.name,
      raw: token,
      values: Array.from(valueSet).sort((a, b) => a - b)
    };
  });

  const fieldMap = {};
  for (const field of parsedFields) {
    fieldMap[field.name] = field.values;
  }

  if (!hasSeconds) {
    fieldMap.second = [0];
  }

  return {
    raw: expression,
    hasSeconds,
    fields: parsedFields,
    fieldMap
  };
}

export function matchDate(parsed, date) {
  const s = date.getUTCSeconds();
  const m = date.getUTCMinutes();
  const h = date.getUTCHours();
  const dom = date.getUTCDate();
  const mon = date.getUTCMonth() + 1;
  const dow = date.getUTCDay();

  const map = parsed.fieldMap;
  if (!map.second.includes(s)) return false;
  if (!map.minute.includes(m)) return false;
  if (!map.hour.includes(h)) return false;
  if (!map.month.includes(mon)) return false;

  // Cron standard day-of-month and day-of-week intersection semantics:
  // If both are restricted (not '*'), an OR logic applies. If one is '*', AND applies.
  const domToken = parsed.fields.find(f => f.name === 'dayOfMonth')?.raw || '*';
  const dowToken = parsed.fields.find(f => f.name === 'dayOfWeek')?.raw || '*';
  const domRestricted = domToken !== '*';
  const dowRestricted = dowToken !== '*';

  if (domRestricted && dowRestricted) {
    return map.dayOfMonth.includes(dom) || map.dayOfWeek.includes(dow);
  }
  if (domRestricted) {
    return map.dayOfMonth.includes(dom);
  }
  if (dowRestricted) {
    return map.dayOfWeek.includes(dow);
  }
  return true;
}

export function getNextRuns(parsed, fromDate, limit = 5) {
  const results = [];
  // Round cursor forward to the next exact second boundary
  let cursor = new Date(Math.floor(fromDate.getTime() / 1000) * 1000 + 1000);
  const maxIterations = 60 * 60 * 24 * 366; // Max 1 full year sweep
  let iterations = 0;

  while (results.length < limit && iterations < maxIterations) {
    if (matchDate(parsed, cursor)) {
      results.push(new Date(cursor.getTime()));
    }
    // Advance by 1 second if second field is specified, else 60 seconds when on 0 sec
    if (parsed.hasSeconds) {
      cursor = new Date(cursor.getTime() + 1000);
    } else {
      // Advance to next whole minute if already at 0 seconds
      const s = cursor.getUTCSeconds();
      if (s === 0) {
        cursor = new Date(cursor.getTime() + 60000);
      } else {
        cursor = new Date(cursor.getTime() + (60 - s) * 1000);
      }
    }
    iterations++;
  }
  return results;
}

export function simulateTimeline(jobs, startDate, durationHours = 24) {
  const durationMs = durationHours * 3600 * 1000;
  const endTimestamp = startDate.getTime() + durationMs;
  const hourlyBuckets = Array.from({ length: durationHours }, () => ({}));
  const collisions = [];
  const jobEvents = {};

  jobs.forEach(job => {
    jobEvents[job.id] = [];
  });

  // Determine resolution: step by minutes across simulation
  const minuteStepMs = 60 * 1000;
  const totalMinutes = durationHours * 60;

  for (let m = 0; m < totalMinutes; m++) {
    const current = new Date(startDate.getTime() + m * minuteStepMs);
    const hourIndex = Math.floor(m / 60);
    const firingJobs = [];

    for (const job of jobs) {
      if (matchDate(job.parsed, current)) {
        firingJobs.push(job);
        hourlyBuckets[hourIndex][job.id] = (hourlyBuckets[hourIndex][job.id] || 0) + 1;
        jobEvents[job.id].push(new Date(current.getTime()));
      }
    }

    if (firingJobs.length > 1) {
      collisions.push({
        timestamp: new Date(current.getTime()),
        jobs: firingJobs.map(j => j.id)
      });
    }
  }

  return {
    startDate,
    durationHours,
    hourlyBuckets,
    collisions,
    jobEvents
  };
}
