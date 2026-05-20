/**
 * examples/chatbot-eval.js
 *
 * Evaluate a chatbot against FAQ test cases using the LLM-as-judge pattern.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... node examples/chatbot-eval.js
 */

import { createEval, loadTestCases } from '../src/index.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const API_KEY = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
const MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';
const BASE_URL = process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL;

if (!API_KEY) {
  console.error('❌ Set OPENAI_API_KEY or LLM_API_KEY environment variable');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Create evaluator
// ---------------------------------------------------------------------------

const evaluator = createEval({
  apiKey: API_KEY,
  model: MODEL,
  baseUrl: BASE_URL,
  judgeModel: MODEL, // Use same model as judge (or set a stronger one)
});

// ---------------------------------------------------------------------------
// Define a simple chatbot agent function
// ---------------------------------------------------------------------------

/**
 * Simulated FAQ chatbot — in production, replace with your actual agent.
 * @param {string} input — User question
 * @returns {Promise<string>} — Bot response
 */
async function chatbotAgent(input) {
  // This uses the LLM directly as a chatbot.
  // In production, replace this with your actual agent/chain/RAG pipeline.
  const { callLLM } = await import('../src/provider.js');

  const response = await callLLM(
    [
      {
        role: 'system',
        content:
          'You are a helpful customer support chatbot for an e-commerce company. ' +
          'Answer questions accurately and concisely. Be polite and professional. ' +
          'If you don\'t know the answer, say so honestly.',
      },
      { role: 'user', content: input },
    ],
    { apiKey: API_KEY, model: MODEL, baseUrl: BASE_URL }
  );

  return response.content;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('🧪 Hermes Eval — Chatbot Evaluation\n');

  // 1. Load test cases
  console.log('📋 Loading test cases...');
  const testCases = await loadTestCases('./tests');
  console.log(`   Found ${testCases.length} test case(s)\n`);

  // 2. Run test suite
  console.log('🚀 Running evaluation...\n');
  const results = await evaluator.runTests(testCases, {
    agentFn: chatbotAgent,
    concurrency: 3,
    timeout: 30_000,
    retries: 1,
    onProgress: (done, total) => {
      process.stderr.write(`\r   Progress: ${done}/${total}`);
    },
  });

  process.stderr.write('\n\n');

  // 3. Print text report
  const report = evaluator.generateReport(results, { format: 'text' });
  console.log(report);

  // 4. Save HTML report
  const htmlReport = evaluator.generateReport(results, { format: 'html' });
  const { writeFile } = await import('node:fs/promises');
  await writeFile('chatbot-eval-report.html', htmlReport);
  console.log('\n📁 HTML report saved to chatbot-eval-report.html');

  // 5. Save raw results
  await writeFile('chatbot-eval-results.json', JSON.stringify(results, null, 2));
  console.log('📁 Raw results saved to chatbot-eval-results.json');
}

main().catch(console.error);
