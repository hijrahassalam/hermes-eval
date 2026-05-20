#!/usr/bin/env node

/**
 * hermes-eval CLI
 *
 * Commands:
 *   hermes-eval run [--dir tests/] [--model mimo-v2.5] [--concurrency 3]
 *   hermes-eval evaluate <output> [--criteria accuracy,safety]
 *   hermes-eval compare [--models mimo,deepseek,kimi] [--tests tests/]
 *   hermes-eval generate <logfile> [--sample 100]
 *   hermes-eval report <results.json> [--format html]
 *
 * Uses node:util parseArgs — zero dependencies.
 */

import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Dynamic imports from the library
const lib = await import('../src/index.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function print(str) {
  process.stdout.write(str + '\n');
}

function err(str) {
  process.stderr.write(`❌ ${str}\n`);
}

function die(str) {
  err(str);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Command: run
// ---------------------------------------------------------------------------

async function cmdRun(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      dir: { type: 'string', short: 'd', default: './tests' },
      model: { type: 'string', short: 'm' },
      concurrency: { type: 'string', short: 'c', default: '3' },
      timeout: { type: 'string', short: 't', default: '60000' },
      retries: { type: 'string', short: 'r', default: '0' },
      'judge-model': { type: 'string' },
      output: { type: 'string', short: 'o' },
      format: { type: 'string', short: 'f', default: 'text' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: false,
  });

  if (values.help) {
    print(`Usage: hermes-eval run [options]

Options:
  -d, --dir <path>        Test case directory (default: ./tests)
  -m, --model <name>      Model to test (default: env LLM_MODEL)
  -c, --concurrency <n>   Parallel tests (default: 3)
  -t, --timeout <ms>      Per-test timeout (default: 60000)
  -r, --retries <n>       Retries per test (default: 0)
  --judge-model <name>    Model to use as judge
  -o, --output <path>     Save results to JSON file
  -f, --format <fmt>      Report format: text|html (default: text)
  -h, --help              Show this help`);
    return;
  }

  const evalInstance = lib.createEval({
    model: values.model,
    judgeModel: values['judge-model'],
  });

  print(`🧪 Loading test cases from ${values.dir}...`);
  const testCases = await lib.loadTestCases(values.dir);
  print(`   Found ${testCases.length} test case(s)\n`);

  if (testCases.length === 0) {
    die('No test cases found. Create .json or .yaml files in the test directory.');
  }

  // We need an agent function — for CLI, we use the LLM directly
  const agentFn = async (input) => {
    const response = await lib.callLLM(
      [{ role: 'user', content: input }],
      {
        apiKey: process.env.OPENAI_API_KEY || process.env.LLM_API_KEY,
        baseUrl: process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL,
        model: values.model || process.env.LLM_MODEL || 'gpt-4o-mini',
      }
    );
    return response.content;
  };

  print(`🚀 Running ${testCases.length} tests...\n`);

  const results = await lib.runSuite(testCases, agentFn, {
    concurrency: parseInt(values.concurrency, 10),
    timeout: parseInt(values.timeout, 10),
    retries: parseInt(values.retries, 10),
    onProgress: (done, total) => {
      process.stderr.write(`\r   Progress: ${done}/${total} (${Math.round(done / total * 100)}%)`);
    },
  });

  process.stderr.write('\n\n');

  // Print report
  const report = evalInstance.generateReport(results, { format: values.format });
  print(report);

  // Save results if requested
  if (values.output) {
    await mkdir(resolve(values.output, '..'), { recursive: true });
    await writeFile(resolve(values.output), JSON.stringify(results, null, 2));
    print(`\n📁 Results saved to ${values.output}`);
  }

  // Save HTML report if format is html
  if (values.format === 'html' && !values.output) {
    const htmlPath = `hermes-eval-report-${Date.now()}.html`;
    await writeFile(htmlPath, report);
    print(`\n📁 HTML report saved to ${htmlPath}`);
  }

  // Exit with non-zero if any tests failed
  if (results.summary.passRate < 1.0) {
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Command: evaluate
// ---------------------------------------------------------------------------

async function cmdEvaluate(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      criteria: { type: 'string', short: 'c', default: 'accuracy' },
      input: { type: 'string', short: 'i' },
      expected: { type: 'string', short: 'e' },
      model: { type: 'string', short: 'm' },
      'judge-model': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.help || positionals.length === 0) {
    print(`Usage: hermes-eval evaluate <output-text> [options]

Options:
  -c, --criteria <list>   Comma-separated criteria (default: accuracy)
  -i, --input <text>      Original input/prompt for context
  -e, --expected <text>   Expected output for reference
  -m, --model <name>      Model name (for API config)
  --judge-model <name>    Judge model (default: same as model)
  -h, --help              Show this help

Examples:
  hermes-eval evaluate "Paris is the capital of France" -c accuracy,safety
  hermes-eval evaluate "..." -i "What is the capital?" -c accuracy`);
    return;
  }

  const outputText = positionals.join(' ');
  const criteriaList = values.criteria.split(',').map((s) => s.trim());

  const evalInstance = lib.createEval({
    model: values.model,
    judgeModel: values['judge-model'],
  });

  print(`🔍 Evaluating output against: ${criteriaList.join(', ')}\n`);

  const result = await evalInstance.evaluate(outputText, criteriaList, {
    input: values.input,
    expected: values.expected,
  });

  print(`Score: ${result.score}/10 ${result.passed ? '✅ PASS' : '❌ FAIL'}`);
  print(`Criteria: ${result.criteria}`);
  print(`\nReasoning:\n${result.reasoning}`);

  if (result.details?.length > 0) {
    print('\nBreakdown:');
    for (const d of result.details) {
      print(`  ${d.criterion}: ${d.score}/10 ${d.passed ? '✅' : '❌'}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Command: compare
// ---------------------------------------------------------------------------

async function cmdCompare(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      models: { type: 'string', short: 'm', default: '' },
      tests: { type: 'string', short: 't', default: './tests' },
      concurrency: { type: 'string', short: 'c', default: '3' },
      output: { type: 'string', short: 'o' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: false,
  });

  if (values.help) {
    print(`Usage: hermes-eval compare [options]

Options:
  -m, --models <list>      Comma-separated model names
  -t, --tests <path>       Test case directory (default: ./tests)
  -c, --concurrency <n>    Parallel tests per model (default: 3)
  -o, --output <path>      Save comparison to JSON
  -h, --help               Show this help

Examples:
  hermes-eval compare -m gpt-4o-mini,deepseek-chat,kimi-vl
  hermes-eval compare -m gpt-4o,claude-3-sonnet -t ./my-tests/`);
    return;
  }

  const modelNames = values.models.split(',').map((s) => s.trim()).filter(Boolean);
  if (modelNames.length < 2) {
    die('At least 2 models required. Use --models model1,model2,model3');
  }

  const testCases = await lib.loadTestCases(values.tests);
  print(`📋 Loaded ${testCases.length} test cases\n`);
  print(`🏆 Comparing models: ${modelNames.join(', ')}\n`);

  // Factory: each model config → agent function
  const agentFnFactory = (modelCfg) => {
    return async (input) => {
      const response = await lib.callLLM(
        [{ role: 'user', content: input }],
        {
          apiKey: process.env.OPENAI_API_KEY || process.env.LLM_API_KEY,
          baseUrl: process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL,
          model: modelCfg.model,
        }
      );
      return response.content;
    };
  };

  const models = modelNames.map((m) => ({ name: m, model: m }));

  const comparison = await lib.compareModels(testCases, models, agentFnFactory, {
    concurrency: parseInt(values.concurrency, 10),
    onModelStart: (name, i) => {
      print(`\n▶ Running tests for ${name} (${i + 1}/${models.length})...`);
    },
    onModelDone: (name, summary) => {
      print(`  ✅ ${name}: ${(summary.passRate * 100).toFixed(1)}% pass rate, avg ${summary.avgScore}/10`);
    },
  });

  print('\n' + lib.generateComparisonReport(comparison));

  if (values.output) {
    await mkdir(resolve(values.output, '..'), { recursive: true });
    await writeFile(resolve(values.output), JSON.stringify(comparison, null, 2));
    print(`\n📁 Comparison saved to ${values.output}`);
  }
}

// ---------------------------------------------------------------------------
// Command: generate
// ---------------------------------------------------------------------------

async function cmdGenerate(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      sample: { type: 'string', short: 's' },
      criteria: { type: 'string', short: 'c', default: 'accuracy' },
      output: { type: 'string', short: 'o', default: './generated-tests.json' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.help || positionals.length === 0) {
    print(`Usage: hermes-eval generate <logfile> [options]

Options:
  -s, --sample <n>       Sample N entries from log (default: all)
  -c, --criteria <list>  Criteria for generated cases (default: accuracy)
  -o, --output <path>    Output file (default: ./generated-tests.json)
  -h, --help             Show this help

The log file should be JSON with entries like:
  [{ "input": "...", "output": "..." }, ...]`);
    return;
  }

  const logPath = positionals[0];
  print(`📄 Reading logs from ${logPath}...`);

  let logs;
  try {
    const content = await readFile(resolve(logPath), 'utf-8');
    logs = JSON.parse(content);
    if (!Array.isArray(logs)) logs = [logs];
  } catch (err) {
    die(`Failed to read log file: ${err.message}`);
  }

  const sampleSize = values.sample ? parseInt(values.sample, 10) : undefined;
  const criteria = values.criteria.split(',').map((s) => s.trim());

  const testCases = lib.generateFromLogs(logs, sampleSize, { criteria });

  await lib.saveTestCases(testCases, resolve(values.output));

  print(`\n✅ Generated ${testCases.length} test cases`);
  print(`📁 Saved to ${values.output}`);
}

// ---------------------------------------------------------------------------
// Command: report
// ---------------------------------------------------------------------------

async function cmdReport(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      format: { type: 'string', short: 'f', default: 'text' },
      output: { type: 'string', short: 'o' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.help || positionals.length === 0) {
    print(`Usage: hermes-eval report <results.json> [options]

Options:
  -f, --format <fmt>   Report format: text|html (default: text)
  -o, --output <path>  Output file (default: stdout / auto for html)
  -h, --help           Show this help`);
    return;
  }

  const resultsPath = positionals[0];
  let results;
  try {
    const content = await readFile(resolve(resultsPath), 'utf-8');
    results = JSON.parse(content);
  } catch (err) {
    die(`Failed to read results file: ${err.message}`);
  }

  const evalInstance = lib.createEval();
  const report = evalInstance.generateReport(results, { format: values.format });

  if (values.output) {
    await writeFile(resolve(values.output), report);
    print(`📁 Report saved to ${values.output}`);
  } else if (values.format === 'html') {
    const htmlPath = `hermes-eval-report-${Date.now()}.html`;
    await writeFile(htmlPath, report);
    print(`📁 HTML report saved to ${htmlPath}`);
  } else {
    print(report);
  }
}

// ---------------------------------------------------------------------------
// Main router
// ---------------------------------------------------------------------------

const COMMANDS = {
  run: cmdRun,
  evaluate: cmdEvaluate,
  compare: cmdCompare,
  generate: cmdGenerate,
  report: cmdReport,
};

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === '--help' || command === '-h') {
  print(`
🧪 hermes-eval — AI Agent Testing & Evaluation Framework

Usage: hermes-eval <command> [options]

Commands:
  run        Run a test suite against an agent
  evaluate   Evaluate a single output against criteria
  compare    Compare multiple models on the same tests
  generate   Generate test cases from conversation logs
  report     Generate a report from saved results

Options:
  -h, --help   Show help for a command

Run 'hermes-eval <command> --help' for command-specific help.
`);
  process.exit(0);
}

if (!COMMANDS[command]) {
  die(`Unknown command: "${command}". Run 'hermes-eval --help' for available commands.`);
}

try {
  await COMMANDS[command](args.slice(1));
} catch (err) {
  die(`Command failed: ${err.message}\n${err.stack}`);
}
