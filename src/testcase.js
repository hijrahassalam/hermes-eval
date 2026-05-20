/**
 * testcase.js — Test Case Management
 *
 * Load, create, filter, and auto-generate test cases for LLM evaluation.
 * Supports JSON and YAML (via simple inline parser) formats.
 *
 * @module testcase
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Simple YAML parser (subset — enough for test cases, no deps needed)
// ---------------------------------------------------------------------------

/**
 * Parse a simple YAML string into a JS object.
 * Handles: mappings, sequences, strings, numbers, booleans, null, nested objects.
 * Does NOT handle: anchors, aliases, multi-line strings, flow maps.
 *
 * @param {string} text
 * @returns {any}
 */
function parseSimpleYAML(text) {
  const lines = text.split('\n');
  const result = {};
  const stack = [{ obj: result, indent: -1 }];

  for (const rawLine of lines) {
    // Skip empty lines and comments
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = rawLine.search(/\S/);

    // Pop stack to find correct parent
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].obj;

    // List item
    if (trimmed.startsWith('- ')) {
      const value = parseYAMLValue(trimmed.slice(2));
      if (Array.isArray(parent)) {
        parent.push(value);
      }
      continue;
    }

    // Key: value
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim();
      const valStr = trimmed.slice(colonIdx + 1).trim();

      if (valStr === '' || valStr === '|' || valStr === '>') {
        // Nested object or array — create and push
        // Peek next line to determine type
        const nextLine = lines[lines.indexOf(rawLine) + 1]?.trim() || '';
        const isList = nextLine.startsWith('- ');
        const child = isList ? [] : {};
        parent[key] = child;
        stack.push({ obj: child, indent });
      } else {
        parent[key] = parseYAMLValue(valStr);
      }
    }
  }

  return result;
}

/**
 * Parse a YAML scalar value.
 * @param {string} str
 * @returns {any}
 */
function parseYAMLValue(str) {
  if (!str) return null;
  str = str.trim();

  // Quoted string
  if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
    return str.slice(1, -1);
  }

  // Boolean
  if (str === 'true') return true;
  if (str === 'false') return false;

  // Null
  if (str === 'null' || str === '~') return null;

  // Number
  if (/^-?\d+(\.\d+)?$/.test(str)) {
    const n = Number(str);
    if (!isNaN(n)) return n;
  }

  // Array inline: [a, b, c]
  if (str.startsWith('[') && str.endsWith(']')) {
    return str.slice(1, -1).split(',').map((s) => parseYAMLValue(s.trim()));
  }

  return str;
}

// ---------------------------------------------------------------------------
// Test case creation
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} TestCase
 * @property {string} id              — Unique identifier
 * @property {string} input           — The prompt/query sent to the agent
 * @property {string} [expectedOutput] — Expected correct output (optional)
 * @property {string[]} criteria      — Criteria names to evaluate against
 * @property {string[]} [tags]        — Tags for filtering
 * @property {string} [category]      — Category grouping
 * @property {number} [passThreshold] — Override default pass threshold
 * @property {Object} [metadata]      — Arbitrary extra data
 */

/**
 * Create a test case object with sensible defaults.
 *
 * @param {string} input    — The prompt/query
 * @param {string|string[]} criteria — Criteria name(s) to evaluate against
 * @param {Object} [opts]
 * @param {string} [opts.id]
 * @param {string} [opts.expectedOutput]
 * @param {string[]} [opts.tags]
 * @param {string} [opts.category]
 * @param {number} [opts.passThreshold]
 * @param {Object} [opts.metadata]
 * @returns {TestCase}
 */
export function createTestCase(input, criteria, opts = {}) {
  if (!input || typeof input !== 'string') {
    throw new Error('Test case input must be a non-empty string');
  }

  const criteriaArr = Array.isArray(criteria) ? criteria : [criteria];
  if (criteriaArr.length === 0) {
    throw new Error('At least one criterion is required');
  }

  return {
    id: opts.id || randomUUID(),
    input,
    expectedOutput: opts.expectedOutput || undefined,
    criteria: criteriaArr.map((c) => (typeof c === 'string' ? c : c.name)),
    tags: opts.tags || [],
    category: opts.category || undefined,
    passThreshold: opts.passThreshold || undefined,
    metadata: opts.metadata || {},
  };
}

// ---------------------------------------------------------------------------
// Loading test cases from disk
// ---------------------------------------------------------------------------

/**
 * Load test cases from a directory. Reads all .json and .yaml/.yml files.
 *
 * @param {string} dir — Directory path
 * @returns {Promise<TestCase[]>}
 */
export async function loadTestCases(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    throw new Error(`Cannot read test directory "${dir}": ${err.message}`);
  }

  const testCases = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      // Recurse into subdirectories
      const nested = await loadTestCases(fullPath);
      testCases.push(...nested);
      continue;
    }

    const ext = extname(entry.name).toLowerCase();
    if (!['.json', '.yaml', '.yml'].includes(ext)) continue;

    const content = await readFile(fullPath, 'utf-8');

    try {
      let data;
      if (ext === '.json') {
        data = JSON.parse(content);
      } else {
        data = parseSimpleYAML(content);
      }

      // Handle array of test cases or single object
      const cases = Array.isArray(data) ? data : [data];

      for (const tc of cases) {
        // Normalize and validate
        if (!tc.input) continue; // Skip entries without input

        testCases.push({
          id: tc.id || `${basename(entry.name, ext)}-${testCases.length + 1}`,
          input: tc.input || tc.prompt || tc.query || tc.question,
          expectedOutput: tc.expectedOutput || tc.expected || tc.answer || undefined,
          criteria: normalizeCriteria(tc.criteria || tc.evaluation || ['accuracy']),
          tags: tc.tags || [],
          category: tc.category || undefined,
          passThreshold: tc.passThreshold || undefined,
          metadata: tc.metadata || {},
        });
      }
    } catch (err) {
      console.warn(`⚠ Skipping ${fullName}: parse error — ${err.message}`);
    }
  }

  return testCases;
}

/**
 * Normalize criteria to array of strings.
 * @param {any} criteria
 * @returns {string[]}
 */
function normalizeCriteria(criteria) {
  if (typeof criteria === 'string') return [criteria];
  if (Array.isArray(criteria)) return criteria.map(String);
  return ['accuracy'];
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

/**
 * Filter test cases by tags (ANY match).
 *
 * @param {TestCase[]} cases
 * @param {string[]} tags
 * @returns {TestCase[]}
 */
export function filterByTags(cases, tags) {
  if (!tags || tags.length === 0) return cases;
  return cases.filter((tc) => tc.tags.some((t) => tags.includes(t)));
}

/**
 * Filter test cases by category.
 *
 * @param {TestCase[]} cases
 * @param {string} category
 * @returns {TestCase[]}
 */
export function filterByCategory(cases, category) {
  if (!category) return cases;
  return cases.filter((tc) => tc.category === category);
}

// ---------------------------------------------------------------------------
// Auto-generate from conversation logs
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ConversationLog
 * @property {string} input   — User input
 * @property {string} output  — Agent response
 * @property {string[]} [tags] — Optional tags
 * @property {string} [category] — Optional category
 */

/**
 * Generate test cases from conversation history logs.
 * Extracts input/output pairs and creates test cases with default criteria.
 *
 * @param {ConversationLog[]} logs    — Array of conversation entries
 * @param {number} [sampleSize]       — Max number to sample (default: all)
 * @param {Object} [opts]
 * @param {string[]} [opts.criteria]  — Criteria for generated cases (default: ['accuracy'])
 * @param {string[]} [opts.tags]      — Tags to add to all generated cases
 * @returns {TestCase[]}
 */
export function generateFromLogs(logs, sampleSize, opts = {}) {
  if (!Array.isArray(logs) || logs.length === 0) {
    throw new Error('Logs must be a non-empty array');
  }

  // Sample if requested
  let selected = [...logs];
  if (sampleSize && sampleSize < selected.length) {
    // Fisher-Yates shuffle for unbiased sampling
    for (let i = selected.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [selected[i], selected[j]] = [selected[j], selected[i]];
    }
    selected = selected.slice(0, sampleSize);
  }

  const criteria = opts.criteria || ['accuracy'];
  const extraTags = opts.tags || [];

  return selected
    .filter((log) => log.input && log.output)
    .map((log, i) => ({
      id: `gen-${i + 1}-${Date.now().toString(36)}`,
      input: log.input,
      expectedOutput: log.output,
      criteria: normalizeCriteria(criteria),
      tags: [...(log.tags || []), ...extraTags, 'auto-generated'],
      category: log.category || 'auto-generated',
      passThreshold: undefined,
      metadata: { source: 'log-generation', originalIndex: i },
    }));
}

// ---------------------------------------------------------------------------
// Saving test cases
// ---------------------------------------------------------------------------

/**
 * Save test cases to a JSON file.
 *
 * @param {TestCase[]} cases
 * @param {string} outputPath — File path to write
 * @returns {Promise<void>}
 */
export async function saveTestCases(cases, outputPath) {
  const dir = join(outputPath, '..');
  await mkdir(dir, { recursive: true });
  await writeFile(outputPath, JSON.stringify(cases, null, 2), 'utf-8');
}
