/**
 * hermes-eval — Main Entry Point
 *
 * Provides the `createEval()` factory that wires together all components:
 * evaluation, test case loading, suite running, model comparison, and reporting.
 *
 * @module hermes-eval
 *
 * @example
 * ```js
 * import { createEval } from 'hermes-eval';
 *
 * const eval = createEval({
 *   apiKey: process.env.OPENAI_API_KEY,
 *   model: 'gpt-4o-mini',
 * });
 *
 * const result = await eval.runTests();
 * console.log(result.summary.passRate);
 * ```
 */

import { evaluate, score, evaluateFull } from './evaluate.js';
import { loadTestCases, createTestCase, generateFromLogs, filterByTags, filterByCategory, saveTestCases } from './testcase.js';
import { runSuite } from './runner.js';
import { compareModels } from './compare.js';
import { generateTextReport, generateHTMLReport, generateComparisonReport, saveReport } from './report.js';
import { resolveCriteria, resolveCriteriaList, defineCriteria, getTemplate, BUILTIN_CRITERIA, TEMPLATES } from './criteria.js';
import { callLLM, estimateTokens, estimateMessagesTokens } from './provider.js';

/**
 * @typedef {Object} EvalConfig
 * @property {string} [provider]    — Provider name (default: 'openai')
 * @property {string} [model]       — Model to use (default: 'gpt-4o-mini')
 * @property {string} [apiKey]      — API key (or set OPENAI_API_KEY env)
 * @property {string} [baseUrl]     — API base URL
 * @property {string} [judgeModel]  — Model to use as judge (default: same as model)
 * @property {string} [testDir]     — Default test case directory
 */

/**
 * Create an evaluation instance with shared configuration.
 *
 * @param {EvalConfig} [config={}]
 * @returns {Object} Evaluation API
 */
export function createEval(config = {}) {
  const {
    provider = 'openai',
    model = process.env.LLM_MODEL || 'gpt-4o-mini',
    apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY,
    baseUrl = process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL,
    judgeModel,
    testDir = './tests',
  } = config;

  /** Shared LLM configuration for judge calls */
  const judgeConfig = {
    apiKey,
    baseUrl,
    model: judgeModel || model,
  };

  return {
    /**
     * Run a test suite. Loads test cases from disk if `cases` not provided.
     *
     * @param {import('./testcase.js').TestCase[]} [cases] — Test cases (optional, loads from testDir)
     * @param {Object} [options]
     * @param {function} [options.agentFn] — Agent function to test (required if not set in config)
     * @param {number} [options.concurrency=3]
     * @param {number} [options.timeout=60000]
     * @param {number} [options.retries=0]
     * @returns {Promise<import('./runner.js').SuiteResult>}
     */
    async runTests(cases, options = {}) {
      const testCases = cases || await loadTestCases(testDir);
      if (testCases.length === 0) {
        throw new Error(`No test cases found. Provide cases or set testDir.`);
      }

      const { agentFn, ...suiteOpts } = options;
      if (!agentFn) {
        throw new Error('agentFn is required — pass it in options');
      }

      return runSuite(testCases, agentFn, {
        ...suiteOpts,
        judgeConfig,
      });
    },

    /**
     * Evaluate a single output against criteria.
     *
     * @param {string} output — LLM output to evaluate
     * @param {string|Object|Array} criteria — Criteria to evaluate against
     * @param {Object} [opts]
     * @param {string} [opts.input]    — Original input for context
     * @param {string} [opts.expected] — Expected output for reference
     * @returns {Promise<{ score: number, reasoning: string, passed: boolean }>}
     */
    async evaluate(output, criteria, opts = {}) {
      return evaluate(output, criteria, { ...judgeConfig, ...opts });
    },

    /**
     * Quick numeric score.
     *
     * @param {string} output
     * @param {string|Object} criterion
     * @returns {Promise<number>}
     */
    async score(output, criterion) {
      return score(output, criterion, judgeConfig);
    },

    /**
     * Compare multiple models on the same test cases.
     *
     * @param {import('./testcase.js').TestCase[]} testCases
     * @param {import('./compare.js').ModelConfig[]} models
     * @param {function} agentFnFactory — (modelConfig) => async (input) => string
     * @param {Object} [options]
     * @returns {Promise<import('./compare.js').ComparisonResult>}
     */
    async compareModels(testCases, models, agentFnFactory, options = {}) {
      return compareModels(testCases, models, agentFnFactory, {
        ...options,
        judgeConfig,
      });
    },

    /**
     * Generate a text or HTML report from results.
     *
     * @param {import('./runner.js').SuiteResult|import('./compare.js').ComparisonResult} results
     * @param {Object} [opts]
     * @param {string} [opts.format='text'] — 'text' or 'html'
     * @returns {string}
     */
    generateReport(results, opts = {}) {
      const { format = 'text' } = opts;

      if (results.leaderboard) {
        // Comparison result
        return generateComparisonReport(results);
      }

      if (format === 'html') {
        return generateHTMLReport(results);
      }
      return generateTextReport(results);
    },

    // Expose sub-modules for advanced usage
    loadTestCases: (dir) => loadTestCases(dir || testDir),
    createTestCase,
    generateFromLogs,
    saveTestCases,
    saveReport,
    filterByTags,
    filterByCategory,
    defineCriteria,
    getTemplate,
    resolveCriteria,
    callLLM,
  };
}

// Re-export all modules for direct import
export {
  // Evaluate
  evaluate,
  score,
  evaluateFull,

  // Test cases
  loadTestCases,
  createTestCase,
  generateFromLogs,
  saveTestCases,
  filterByTags,
  filterByCategory,

  // Runner
  runSuite,

  // Compare
  compareModels,

  // Report
  generateTextReport,
  generateHTMLReport,
  generateComparisonReport,
  saveReport,

  // Criteria
  resolveCriteria,
  resolveCriteriaList,
  defineCriteria,
  getTemplate,
  BUILTIN_CRITERIA,
  TEMPLATES,

  // Provider
  callLLM,
  estimateTokens,
  estimateMessagesTokens,
};
