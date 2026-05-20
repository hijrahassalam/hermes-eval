/**
 * compare.js — Model Comparison
 *
 * Run the same test suite across multiple models/configurations and produce
 * a ranked leaderboard with pass rates, average scores, and latency.
 *
 * @module compare
 */

import { runSuite } from './runner.js';

/**
 * @typedef {Object} ModelConfig
 * @property {string} name   — Display name (e.g. "gpt-4o", "deepseek-v3")
 * @property {string} model  — Model identifier for the API
 * @property {string} [apiKey]
 * @property {string} [baseUrl]
 * @property {string} [judgeModel] — Override judge model for this comparison
 */

/**
 * @typedef {Object} LeaderboardEntry
 * @property {string} name
 * @property {number} passRate       — 0-1
 * @property {number} avgScore       — Average score across all tests
 * @property {number} minScore
 * @property {number} maxScore
 * @property {number} avgLatencyMs
 * @property {number} totalLatencyMs
 * @property {number} total
 * @property {number} passed
 * @property {number} failed
 * @property {import('./runner.js').TestResult[]} results
 */

/**
 * @typedef {Object} ComparisonResult
 * @property {LeaderboardEntry[]} leaderboard — Sorted by pass rate then avg score
 * @property {Object} stats                   — Statistical analysis
 * @property {number} stats.bestPassRate
 * @property {number} stats.worstPassRate
 * @property {number} stats.passRateSpread
 * @property {boolean} stats.significantDifference — True if spread > 10%
 */

// ---------------------------------------------------------------------------
// Statistical helpers
// ---------------------------------------------------------------------------

/**
 * Compute standard deviation of an array of numbers.
 * @param {number[]} values
 * @returns {number}
 */
function stddev(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Two-sample t-test (Welch's) to check if two models' scores are
 * significantly different. Returns p-value approximation.
 *
 * @param {number[]} a — Scores from model A
 * @param {number[]} b — Scores from model B
 * @returns {{ tStatistic: number, significant: boolean }}
 */
function welchTTest(a, b) {
  if (a.length < 2 || b.length < 2) {
    return { tStatistic: 0, significant: false };
  }

  const meanA = a.reduce((s, v) => s + v, 0) / a.length;
  const meanB = b.reduce((s, v) => s + v, 0) / b.length;
  const varA = a.reduce((s, v) => s + (v - meanA) ** 2, 0) / (a.length - 1);
  const varB = b.reduce((s, v) => s + (v - meanB) ** 2, 0) / (b.length - 1);

  const se = Math.sqrt(varA / a.length + varB / b.length);
  if (se === 0) return { tStatistic: 0, significant: false };

  const t = (meanA - meanB) / se;

  // Rough significance: |t| > 2 ≈ p < 0.05
  return {
    tStatistic: Math.round(t * 100) / 100,
    significant: Math.abs(t) > 2,
  };
}

// ---------------------------------------------------------------------------
// Model comparison
// ---------------------------------------------------------------------------

/**
 * Compare multiple models on the same test suite.
 *
 * For each model, an `agentFn` factory is called to produce the agent
 * function for that model. If `agentFn` is already a function (not a factory),
 * the model config is passed to it each time.
 *
 * @param {import('./testcase.js').TestCase[]} testCases — Test cases to run
 * @param {ModelConfig[]} models    — Models to compare
 * @param {function|Object} agentFnOrFactory
 *   - function(agentConfig) → async (input) => string  (factory)
 *   - OR async (input) => string (single function, model config passed as judgeConfig)
 * @param {Object} [options]
 * @param {number} [options.concurrency=3]
 * @param {number} [options.timeout=60000]
 * @param {number} [options.retries=0]
 * @param {Object} [options.judgeConfig={}]
 * @param {function} [options.onModelStart]  — (modelName, index)
 * @param {function} [options.onModelDone]   — (modelName, summary)
 * @returns {Promise<ComparisonResult>}
 */
export async function compareModels(testCases, models, agentFnOrFactory, options = {}) {
  const {
    concurrency = 3,
    timeout = 60_000,
    retries = 0,
    judgeConfig = {},
    onModelStart,
    onModelDone,
  } = options;

  if (!Array.isArray(models) || models.length === 0) {
    throw new Error('models must be a non-empty array');
  }

  const leaderboard = [];

  for (let i = 0; i < models.length; i++) {
    const modelCfg = models[i];
    const modelName = modelCfg.name || modelCfg.model;

    if (onModelStart) onModelStart(modelName, i);

    // Build the agent function for this model
    let agentFn;
    if (typeof agentFnOrFactory === 'function' && agentFnOrFactory.length > 0) {
      // Factory pattern: call with model config
      agentFn = await agentFnOrFactory(modelCfg);
    } else {
      // Single function — model config goes to judge
      agentFn = agentFnOrFactory;
    }

    // Build judge config, potentially overriding per-model
    const modelJudgeConfig = {
      ...judgeConfig,
      ...(modelCfg.apiKey ? { apiKey: modelCfg.apiKey } : {}),
      ...(modelCfg.baseUrl ? { baseUrl: modelCfg.baseUrl } : {}),
      ...(modelCfg.judgeModel ? { model: modelCfg.judgeModel } : {}),
    };

    const suiteResult = await runSuite(testCases, agentFn, {
      concurrency,
      timeout,
      retries,
      judgeConfig: modelJudgeConfig,
    });

    const entry = {
      name: modelName,
      model: modelCfg.model,
      passRate: suiteResult.summary.passRate,
      avgScore: suiteResult.summary.avgScore,
      minScore: suiteResult.summary.minScore,
      maxScore: suiteResult.summary.maxScore,
      avgLatencyMs: suiteResult.summary.avgLatencyMs,
      totalLatencyMs: suiteResult.summary.totalLatencyMs,
      total: suiteResult.summary.total,
      passed: suiteResult.summary.passed,
      failed: suiteResult.summary.failed,
      results: suiteResult.results,
    };

    leaderboard.push(entry);

    if (onModelDone) onModelDone(modelName, suiteResult.summary);
  }

  // Sort leaderboard: primary by passRate desc, secondary by avgScore desc
  leaderboard.sort((a, b) => {
    if (b.passRate !== a.passRate) return b.passRate - a.passRate;
    return b.avgScore - a.avgScore;
  });

  // Statistical analysis
  const passRates = leaderboard.map((e) => e.passRate);
  const allScores = leaderboard.map((e) =>
    e.results.map((r) => r.score)
  );

  let tTests = [];
  if (leaderboard.length >= 2) {
    // Pairwise t-tests between top model and others
    const topScores = allScores[0];
    for (let i = 1; i < leaderboard.length; i++) {
      const test = welchTTest(topScores, allScores[i]);
      tTests.push({
        compared: `${leaderboard[0].name} vs ${leaderboard[i].name}`,
        ...test,
      });
    }
  }

  const bestPassRate = Math.max(...passRates);
  const worstPassRate = Math.min(...passRates);

  return {
    leaderboard,
    stats: {
      bestPassRate,
      worstPassRate,
      passRateSpread: Math.round((bestPassRate - worstPassRate) * 1000) / 1000,
      significantDifference: (bestPassRate - worstPassRate) > 0.1,
      tTests,
    },
  };
}
