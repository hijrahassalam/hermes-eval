/**
 * examples/auto-generate.js
 *
 * Auto-generate test cases from conversation logs, then run them
 * for regression testing.
 *
 * Usage:
 *   node examples/auto-generate.js
 */

import { generateFromLogs, saveTestCases, createEval, runSuite, generateTextReport } from '../src/index.js';
import { readFile, writeFile } from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Sample conversation logs (in production, load from your logging system)
// ---------------------------------------------------------------------------

const SAMPLE_LOGS = [
  {
    input: 'What is your return policy?',
    output: 'Our return policy allows returns within 30 days of purchase with original receipt. Items must be in original condition.',
    tags: ['returns', 'policy'],
    category: 'faq',
  },
  {
    input: 'How do I track my order?',
    output: 'You can track your order by logging into your account and clicking "Order History". You\'ll find tracking links for all shipped orders.',
    tags: ['orders', 'tracking'],
    category: 'faq',
  },
  {
    input: 'Do you offer international shipping?',
    output: 'Yes, we ship to over 50 countries worldwide. International shipping costs vary by destination and are calculated at checkout.',
    tags: ['shipping', 'international'],
    category: 'faq',
  },
  {
    input: 'How do I change my password?',
    output: 'Go to Settings > Security > Change Password. You\'ll need to enter your current password and then your new password twice.',
    tags: ['account', 'password'],
    category: 'faq',
  },
  {
    input: 'What payment methods do you accept?',
    output: 'We accept Visa, Mastercard, American Express, PayPal, Apple Pay, and Google Pay. All payments are processed securely.',
    tags: ['payments', 'billing'],
    category: 'faq',
  },
  {
    input: 'Can I cancel my order?',
    output: 'Orders can be cancelled within 1 hour of placement if they haven\'t been processed yet. After that, please wait for delivery and use our return process.',
    tags: ['orders', 'cancellation'],
    category: 'faq',
  },
  {
    input: 'Where are you located?',
    output: 'Our headquarters are in San Francisco, CA. We have fulfillment centers across the US, EU, and Asia for fast shipping.',
    tags: ['company', 'location'],
    category: 'faq',
  },
  {
    input: 'How do I contact customer support?',
    output: 'You can reach us via email at support@example.com, live chat on our website (24/7), or call 1-800-EXAMPLE during business hours (9am-5pm PT).',
    tags: ['support', 'contact'],
    category: 'faq',
  },
  {
    input: 'Do you have a loyalty program?',
    output: 'Yes! Our Rewards Program gives you 1 point per dollar spent. Points can be redeemed for discounts. Sign up for free in your account settings.',
    tags: ['loyalty', 'rewards'],
    category: 'faq',
  },
  {
    input: 'What is your privacy policy?',
    output: 'We take privacy seriously. We never sell your data to third parties. You can read our full privacy policy at example.com/privacy.',
    tags: ['privacy', 'policy'],
    category: 'faq',
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('🧪 Hermes Eval — Auto-Generate Test Cases\n');

  // 1. Generate test cases from logs
  console.log('📝 Generating test cases from conversation logs...');
  const testCases = generateFromLogs(SAMPLE_LOGS, undefined, {
    criteria: ['accuracy', 'completeness', 'tone'],
    tags: ['faq', 'customer-service'],
  });

  console.log(`   Generated ${testCases.length} test case(s)\n`);

  // 2. Show a sample
  console.log('📋 Sample generated test case:');
  const sample = testCases[0];
  console.log(`   ID: ${sample.id}`);
  console.log(`   Input: ${sample.input}`);
  console.log(`   Expected: ${sample.expectedOutput}`);
  console.log(`   Criteria: ${sample.criteria.join(', ')}`);
  console.log(`   Tags: ${sample.tags.join(', ')}`);
  console.log('');

  // 3. Save to file
  await saveTestCases(testCases, './generated-tests.json');
  console.log('💾 Saved to generated-tests.json\n');

  // 4. Optionally run the generated tests (if API key is set)
  const API_KEY = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
  if (API_KEY) {
    console.log('🚀 Running generated test suite for regression testing...\n');

    const evaluator = createEval({ apiKey: API_KEY });
    const { callLLM } = await import('../src/provider.js');

    const agentFn = async (input) => {
      const response = await callLLM(
        [
          {
            role: 'system',
            content: 'You are a helpful customer support chatbot. Be concise and accurate.',
          },
          { role: 'user', content: input },
        ],
        { apiKey: API_KEY, model: process.env.LLM_MODEL || 'gpt-4o-mini' }
      );
      return response.content;
    };

    const results = await runSuite(testCases, agentFn, {
      concurrency: 3,
      judgeConfig: { apiKey: API_KEY },
      onProgress: (done, total) => {
        process.stderr.write(`\r   Progress: ${done}/${total}`);
      },
    });

    process.stderr.write('\n\n');

    const report = generateTextReport(results);
    console.log(report);

    await writeFile('regression-results.json', JSON.stringify(results, null, 2));
    console.log('\n📁 Regression results saved to regression-results.json');
  } else {
    console.log('ℹ️  Set OPENAI_API_KEY to automatically run the generated tests.');
    console.log('   The test cases have been saved for manual execution.');
  }
}

main().catch(console.error);
