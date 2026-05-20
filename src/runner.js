/**
 * runner.js — Test Suite Runner
 *
 * Runs test cases against an agent function with configurable concurrency,
 * timeouts, retries, and progress reporting.
 *
 * @module runner
 */

import { evaluate } from './evaluate.js';

/**
 * @typedef {Object} TestResult
 * @property {string} testCaseId
 * @property {string} input
 * @property {string} output        — Agent's response
 * @property {number} score         — Evaluation score (1-10)
 * @property {boolean} passed       — Whether it passed
 * @property {string} reasoning     — Judge's reasoning
 * @property {Object[]} details     — Per-criterion details
 * @property {number} latencyMs     — Time taken by agent
 * @property {number} evalLatencyMs — Time taken by judge
 * @property {number} attempts      — Number of attempts
 * @property {string} [error]       — Error message if failed
 */

/**
 * @typedef {Object} SuiteResult
 * @property {TestResult[]} results
 * @property {Object} summary
 * @property {number} summary.total
 * @property {number} summary.passed
 * @property {number} summary.failed
 * @property {number} summary.errors
 * @property {number} summary.passRate   — 0-1
 * @property {number} summary.avgScore   — Average score
 * @property {number} summary.minScore
 * @property {number} summary.maxScore
 * @property {number} summary.totalLatencyMs
 * @property {number} summary.avgLatencyMs
 */

// ---------------------------------------------------------------------------
// Concurrency helper
// ---------------------------------------------------------------------------

/**
 * Run async tasks with bounded concurrency.
 * @template T
 * @param {(() => Promise<T>)[]} tasks
 * @param {number} concurrency
 * @param {function} [onProgress] — Called with (completed, total) after each task
 * @returns {Promise<T[]>}
 */
async function runWithConcurrency(tasks, concurrency, onProgress) {
  const results = new Array(tasks.length);
  let nextIndex = 0;
  let completed = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const idx = nextIndex++;
      results[idx] = await tasks[idx]();
      completed++;
      if (onProgress) onProgress(completed, tasks.length);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Wrap a promise with a timeout.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} label
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms, label = 'Operation') {
  if (!ms || ms <= 0) return promise;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);

    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

// ---------------------------------------------------------------------------
// Single test execution
// ---------------------------------------------------------------------------

/**
 * Run a single test case with retry support.
 *
 * @param {import('./testcase.js').TestCase} testCase
 * @param {function} agentFn      — async (input: string) => string
 * @param {Object} judgeConfig    — LLM judge configuration
 * @param {Object} opts
 * @param {number} [opts.timeout]   — Per-test timeout in ms
 * @param {number} [opts.retries]   — Number of retries on failure
 * @returns {Promise<TestResult>}
 */
async function runSingleTest(testCase, agentFn, judgeConfig, opts = {}) {
  const { timeout = 60_000, retries = 0 } = opts;
  const maxAttempts = 1 + Math.max(0, retries);
  let lastError;
  let output;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Run the agent
      const agentStart = Date.now();
      output = await withTimeout(
        Promise.resolve(agentFn(testCase.input)),
        timeout,
        `Test "${testCase.id}"`
      );
      const agentLatency = Date.now() - agentStart;

      // Evaluate the output
      const evalStart = Date.now();
      const evalResult = await evaluate(output, testCase.criteria, {
        ...judgeConfig,
        input: testCase.input,
        expected: testCase.expectedOutput,
      });
      const evalLatency = Date.now() - evalStart;

      return {
        testCaseId: testCase.id,
        input: testCase.input,
        output,
        score: evalResult.score,
        passed: evalResult.passed,
        reasoning: evalResult.reasoning,
        details: evalResult.details,
        latencyMs: agentLatency,
        evalLatencyMs: evalLatency,
        attempts: attempt,
      };
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        // Brief pause before retry
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  }

  // All attempts failed
  return {
    testCaseId: testCase.id,
    input: testCase.input,
    output: output || '',
    score: 0,
    passed: false,
    reasoning: '',
    details: [],
    latencyMs: 0,
    evalLatencyMs: 0,
    attempts: maxAttempts,
    error: lastError?.message || 'Unknown error',
  };
}

// ---------------------------------------------------------------------------
// Suite runner
// ---------------------------------------------------------------------------

/**
 * Run a full test suite against an agent function.
 *
 * @param {import('./testcase.js').TestCase[]} testCases — Test cases to run
 * @param {function} agentFn  — async (input: string) => string — the agent to test
 * @param {Object} [options]
 * @param {number} [options.concurrency=3]  — Max parallel tests
 * @param {number} [options.timeout=60000]  — Per-test timeout (ms)
 * @param {number} [options.retries=0]      — Retries per test on failure
 * @param {Object} [options.judgeConfig={}] — LLM judge configuration
 * @param {function} [options.onProgress]   — Progress callback (completed, total)
 * @returns {Promise<SuiteResult>}
 */
export async function runSuite(testCases, agentFn, options = {}) {
  const {
    concurrency = 3,
    timeout = 60_000,
    retries = 0,
    judgeConfig = {},
    onProgress,
  } = options;

  if (!Array.isArray(testCases) || testCases.length === 0) {
    throw new Error('testCases must be a non-empty array');
  }
  if (typeof agentFn !== 'function') {
    throw new Error('agentFn must be a function');
  }

  const startTime = Date.now();

  // Build task list
  const tasks = testCases.map((tc) => () =>
    runSingleTest(tc, agentFn, judgeConfig, { timeout, retries })
  );

  // Execute with concurrency
  const results = await runWithConcurrency(tasks, concurrency, onProgress);

  // Compute summary
  const totalLatency = Date.now() - startTime;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed && !r.error).length;
  const errors = results.filter((r) => r.error).length;
  const scores = results.map((r) => r.score);
  const latencies = results.map((r) => r.latencyMs).filter((l) => l > 0);

  const summary = {
    total: results.length,
    passed,
    failed,
    errors,
    passRate: results.length > 0 ? Math.round((passed / results.length) * 1000) / 1000 : 0,
    avgScore: scores.length > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : 0,
    minScore: scores.length > 0 ? Math.min(...scores) : 0,
    maxScore: scores.length > 0 ? Math.max(...scores) : 0,
    totalLatencyMs: totalLatency,
    avgLatencyMs: latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
  };

  return { results, summary };
}
