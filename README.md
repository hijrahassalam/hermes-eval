# 🧪 hermes-eval

**AI Agent Testing — Evaluate, Compare, Regression Test your LLM agents**

[![npm](https://img.shields.io/npm/v/hermes-eval?color=blue)](https://www.npmjs.com/package/hermes-eval)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![zero-deps](https://img.shields.io/badge/dependencies-zero-orange)]()

A zero-dependency CLI + library for testing prompts, evaluating LLM outputs, comparing models, and running regression tests on AI agents. Uses the **LLM-as-judge** pattern — one model evaluates another's outputs against structured criteria.

---

## ✨ Features

- **🔍 LLM-as-Judge Evaluation** — Use any LLM to evaluate outputs against structured criteria (accuracy, safety, tone, format, completeness, relevance)
- **📊 Model Comparison** — Run the same tests across multiple models and get a ranked leaderboard
- **🔄 Regression Testing** — Detect quality changes between versions with repeatable test suites
- **📝 Auto Test Generation** — Generate test cases from conversation logs automatically
- **📈 Rich Reports** — Text reports for terminal, HTML reports with inline SVG charts
- **🎯 Custom Criteria** — Build your own evaluation criteria with templates for customer service, code gen, medical advice, and creative writing
- **⚡ Zero Dependencies** — Pure Node.js, no external packages required
- **🌐 Any LLM** — Works with any OpenAI-compatible API (OpenAI, DeepSeek, Kimi, local models, etc.)

---

## 🚀 Quick Start

### 1. Install

```bash
npm install hermes-eval
# or use directly via npx
npx hermes-eval --help
```

### 2. Create Test Cases

Create `tests/my-tests.json`:

```json
[
  {
    "id": "test-001",
    "input": "What is the capital of France?",
    "expectedOutput": "The capital of France is Paris.",
    "criteria": ["accuracy", "completeness"],
    "tags": ["geography"]
  },
  {
    "id": "test-002",
    "input": "Explain quantum computing to a 5-year-old.",
    "criteria": ["accuracy", "tone", "completeness"],
    "tags": ["education"]
  }
]
```

### 3. Run

```bash
export OPENAI_API_KEY=sk-...
npx hermes-eval run --dir tests/ --model gpt-4o-mini
```

Output:
```
🧪 Loading test cases from tests/...
   Found 2 test case(s)

🚀 Running 2 tests...

══════════════════════════════════════════════════════════════
  HERMES-EVAL — Test Suite Report
══════════════════════════════════════════════════════════════

📊 SUMMARY
────────────────────────────────────────
  Total tests:    2
  Passed:         2 ✅
  Failed:         0 ❌
  Pass rate:      100.0%
  Avg score:      8.5/10
  [████████████████████████████████████████] 100.0%

══════════════════════════════════════════════════════════════
```

---

## 📖 CLI Reference

### `hermes-eval run` — Run Test Suite

```bash
hermes-eval run [options]

Options:
  -d, --dir <path>        Test case directory (default: ./tests)
  -m, --model <name>      Model to test (default: env LLM_MODEL)
  -c, --concurrency <n>   Parallel tests (default: 3)
  -t, --timeout <ms>      Per-test timeout (default: 60000)
  -r, --retries <n>       Retries per test (default: 0)
  --judge-model <name>    Model to use as judge (default: same as model)
  -o, --output <path>     Save results to JSON file
  -f, --format <fmt>      Report format: text|html (default: text)
```

### `hermes-eval evaluate` — Evaluate Single Output

```bash
hermes-eval evaluate "Paris is the capital of France" \
  --criteria accuracy,safety \
  --input "What is the capital of France?"

Options:
  -c, --criteria <list>   Comma-separated criteria (default: accuracy)
  -i, --input <text>      Original input for context
  -e, --expected <text>   Expected output for reference
  --judge-model <name>    Judge model
```

### `hermes-eval compare` — Compare Models

```bash
hermes-eval compare \
  --models gpt-4o-mini,deepseek-chat,kimi-vl \
  --tests tests/ \
  --concurrency 2

Options:
  -m, --models <list>      Comma-separated model names
  -t, --tests <path>       Test case directory
  -c, --concurrency <n>    Parallel tests per model
  -o, --output <path>      Save comparison to JSON
```

### `hermes-eval generate` — Generate Test Cases

```bash
hermes-eval generate conversations.json \
  --sample 100 \
  --criteria accuracy,completeness \
  --output generated-tests.json

Options:
  -s, --sample <n>       Sample N entries from log
  -c, --criteria <list>  Criteria for generated cases
  -o, --output <path>    Output file
```

### `hermes-eval report` — Generate Report

```bash
hermes-eval report results.json --format html --output report.html

Options:
  -f, --format <fmt>   Report format: text|html
  -o, --output <path>  Output file
```

---

## 📚 API Reference

### `createEval(config)` — Main Entry Point

```js
import { createEval } from 'hermes-eval';

const eval = createEval({
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4o-mini',          // Model to test
  judgeModel: 'gpt-4o',          // Model to use as judge (default: same)
  baseUrl: 'https://api.openai.com/v1',  // Custom API endpoint
  testDir: './tests',            // Default test case directory
});
```

### `eval.runTests(cases?, options)` — Run Test Suite

```js
const results = await eval.runTests(testCases, {
  agentFn: async (input) => myAgent(input),  // Required
  concurrency: 3,
  timeout: 60000,
  retries: 1,
});

console.log(results.summary.passRate);  // 0-1
console.log(results.summary.avgScore);  // Average score
```

### `eval.evaluate(output, criteria, opts?)` — Evaluate Output

```js
const result = await eval.evaluate(
  "Paris is the capital of France",
  ['accuracy', 'completeness'],
  { input: 'What is the capital of France?' }
);

console.log(result.score);     // 9.5
console.log(result.passed);    // true
console.log(result.reasoning); // Judge's explanation
```

### `eval.compareModels(testCases, models, factory)` — Compare Models

```js
const comparison = await eval.compareModels(
  testCases,
  [
    { name: 'gpt-4o-mini', model: 'gpt-4o-mini' },
    { name: 'deepseek', model: 'deepseek-chat', baseUrl: '...' },
  ],
  (modelConfig) => async (input) => {
    // Return an agent function for each model
    const res = await callLLM([{ role: 'user', content: input }], modelConfig);
    return res.content;
  }
);

console.log(comparison.leaderboard); // Sorted by pass rate
```

### `eval.generateReport(results, opts?)` — Generate Report

```js
const textReport = eval.generateReport(results, { format: 'text' });
const htmlReport = eval.generateReport(results, { format: 'html' });
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        hermes-eval                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌────────┐  │
│  │ testcase  │   │  runner  │   │ compare  │   │ report │  │
│  │ .js      │──▶│ .js      │──▶│ .js      │──▶│ .js    │  │
│  └──────────┘   └────┬─────┘   └──────────┘   └────────┘  │
│                      │                                      │
│                      ▼                                      │
│               ┌──────────┐                                  │
│               │ evaluate │                                  │
│               │ .js      │  ◀── LLM-as-Judge Pattern       │
│               └────┬─────┘                                  │
│                    │                                        │
│          ┌─────────┴──────────┐                             │
│          ▼                    ▼                              │
│   ┌──────────┐        ┌──────────┐                         │
│   │ criteria │        │ provider │                         │
│   │ .js      │        │ .js      │                         │
│   └──────────┘        └──────────┘                         │
│                                                             │
│   ┌──────────────────────────────────────────────────────┐  │
│   │                    CLI (cli/index.js)                │  │
│   │  run | evaluate | compare | generate | report        │  │
│   └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘

LLM-as-Judge Flow:
  ┌────────┐    input     ┌─────────┐   output    ┌─────────┐
  │  User  │─────────────▶│  Agent  │────────────▶│  Judge  │
  └────────┘              └─────────┘             │  LLM    │
                                                  └────┬────┘
                                                       │
                                                  { score: 9,
                                                    reasoning: "...",
                                                    passed: true }
```

---

## 🎯 Criteria System

### Built-in Criteria

| Criterion | Description | Default Threshold |
|-----------|-------------|-------------------|
| `accuracy` | Factual correctness, no hallucinations | 7/10 |
| `safety` | Free from harmful/dangerous content | 8/10 |
| `tone` | Appropriate communication style | 7/10 |
| `format` | Proper structure and organization | 7/10 |
| `completeness` | Fully addresses the query | 7/10 |
| `relevance` | Stays on topic, no filler | 7/10 |

### Domain Templates

```js
import { getTemplate } from 'hermes-eval';

// Pre-built criteria sets for common domains
const csTemplate = getTemplate('customer-service');
const codeTemplate = getTemplate('code-generation');
const medicalTemplate = getTemplate('medical-advice');
const creativeTemplate = getTemplate('creative-writing');
```

### Custom Criteria

```js
import { defineCriteria } from 'hermes-eval';

const brandVoice = defineCriteria({
  name: 'brand-voice',
  description: 'Does the response match our brand voice guidelines?',
  scoring: '1 = Completely off-brand; 5 = Neutral; 10 = Perfectly on-brand',
  passThreshold: 7,
});
```

---

## 🌍 Real-World Example: Testing a Chatbot with 100 FAQ Cases

```js
import { createEval, loadTestCases, generateFromLogs } from 'hermes-eval';

// 1. Load existing test cases
const manualTests = await loadTestCases('./tests/faq');

// 2. Generate more from conversation logs
const logs = await readFile('./production-logs.json', 'utf-8');
const autoTests = generateFromLogs(JSON.parse(logs), 80, {
  criteria: ['accuracy', 'tone'],
  tags: ['production-derived'],
});

// 3. Combine into a 100-case suite
const allTests = [...manualTests, ...autoTests].slice(0, 100);

// 4. Run evaluation
const evaluator = createEval({ model: 'gpt-4o-mini' });

const results = await evaluator.runTests(allTests, {
  agentFn: myChatbotAgent,
  concurrency: 5,
  timeout: 30000,
  retries: 1,
});

// 5. Generate report
const report = evaluator.generateReport(results, { format: 'html' });
await writeFile('chatbot-qa-report.html', report);

// 6. Check pass rate
if (results.summary.passRate < 0.9) {
  console.warn('⚠️ Pass rate below 90% — chatbot needs improvement!');
  process.exit(1);
}
```

---

## 🔧 Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` or `LLM_API_KEY` | API authentication | — |
| `OPENAI_BASE_URL` or `LLM_BASE_URL` | API endpoint | `https://api.openai.com/v1` |
| `LLM_MODEL` | Default model | `gpt-4o-mini` |

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Commit changes: `git commit -am 'feat: add my feature'`
4. Push to branch: `git push origin feat/my-feature`
5. Open a Pull Request

---

## 📄 License

MIT © [Hijrah Assalam](LICENSE)

---

## 🙏 Acknowledgments

Built with ❤️ by [Nous Research](https://nousresearch.com) — empowering developers to build, test, and evaluate AI agents with confidence.
