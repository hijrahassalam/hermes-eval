/**
 * examples/model-comparison.js
 *
 * Compare 3 models on the same test suite to find the best one.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... node examples/model-comparison.js
 */

import { createEval, loadTestCases, compareModels, generateComparisonReport } from '../src/index.js';
import { callLLM } from '../src/provider.js';
import { writeFile } from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const API_KEY = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
const BASE_URL = process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL;

if (!API_KEY) {
  console.error('❌ Set OPENAI_API_KEY or LLM_API_KEY environment variable');
  process.exit(1);
}

// Models to compare
const MODELS = [
  { name: 'gpt-4o-mini', model: 'gpt-4o-mini' },
  { name: 'gpt-4o', model: 'gpt-4o' },
  { name: 'deepseek-chat', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' },
];

// ---------------------------------------------------------------------------
// Agent function factory — creates an agent for each model
// ---------------------------------------------------------------------------

/**
 * Factory that creates an agent function for a specific model config.
 * @param {Object} modelConfig — { name, model, baseUrl? }
 * @returns {function} — async (input) => string
 */
function createAgent(modelConfig) {
  return async (input) => {
    const response = await callLLM(
      [
        {
          role: 'system',
          content: 'You are a helpful assistant. Answer questions accurately and concisely.',
        },
        { role: 'user', content: input },
      ],
      {
        apiKey: API_KEY,
        model: modelConfig.model,
        baseUrl: modelConfig.baseUrl || BASE_URL,
      }
    );
    return response.content;
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('🧪 Hermes Eval — Model Comparison\n');

  // 1. Load test cases
  console.log('📋 Loading test cases...');
  const testCases = await loadTestCases('./tests');
  console.log(`   Found ${testCases.length} test case(s)\n`);

  // 2. Run comparison
  console.log('🏆 Comparing models...\n');

  const comparison = await compareModels(testCases, MODELS, createAgent, {
    concurrency: 2,
    timeout: 30_000,
    judgeConfig: {
      apiKey: API_KEY,
      model: 'gpt-4o-mini', // Use a consistent judge across all models
      baseUrl: BASE_URL,
    },
    onModelStart: (name, i) => {
      console.log(`\n▶ [${i + 1}/${MODELS.length}] Testing ${name}...`);
    },
    onModelDone: (name, summary) => {
      console.log(`  ✅ ${name}: ${(summary.passRate * 100).toFixed(1)}% pass, avg ${summary.avgScore}/10, ${summary.avgLatencyMs}ms`);
    },
  });

  // 3. Print comparison report
  console.log('\n' + generateComparisonReport(comparison));

  // 4. Save results
  await writeFile('model-comparison.json', JSON.stringify(comparison, null, 2));
  console.log('📁 Comparison results saved to model-comparison.json');

  // 5. Print recommendation
  if (comparison.leaderboard.length > 0) {
    const winner = comparison.leaderboard[0];
    console.log(`\n🏆 Recommendation: ${winner.name}`);
    console.log(`   Pass rate: ${(winner.passRate * 100).toFixed(1)}%`);
    console.log(`   Avg score: ${winner.avgScore}/10`);
    console.log(`   Avg latency: ${winner.avgLatencyMs}ms`);
  }
}

main().catch(console.error);
