/**
 * evaluate.js — LLM-as-Judge Evaluation
 *
 * Uses the "LLM as judge" pattern: one LLM evaluates another LLM's output
 * against structured criteria. Returns a score (1-10), reasoning, and pass/fail.
 *
 * The judge prompt is carefully structured to produce reliable, consistent
 * evaluations with explicit scoring rubrics.
 *
 * @module evaluate
 */

import { callLLM, estimateTokens } from './provider.js';
import { resolveCriteria, resolveCriteriaList } from './criteria.js';

// ---------------------------------------------------------------------------
// Judge prompt construction
// ---------------------------------------------------------------------------

/**
 * Build the system prompt for the LLM judge.
 * @param {import('./criteria.js').Criterion} criterion
 * @returns {string}
 */
function buildJudgeSystemPrompt(criterion) {
  return `You are an expert AI output evaluator. Your task is to rigorously evaluate the quality of an AI-generated response based on a specific criterion.

CRITERION: ${criterion.name}
${criterion.description}

SCORING GUIDE:
${criterion.scoring}

Passing threshold: ${criterion.passThreshold}/10

RULES:
1. Evaluate ONLY based on the given criterion — ignore other aspects.
2. Be objective, consistent, and evidence-based in your assessment.
3. Provide a clear, specific score with detailed reasoning.
4. You MUST respond with ONLY a valid JSON object — no markdown, no explanation outside JSON.

OUTPUT FORMAT (strict JSON):
{
  "score": <integer 1-10>,
  "reasoning": "<detailed explanation of score>",
  "passed": <true if score >= ${criterion.passThreshold}, false otherwise>,
  "highlights": ["<positive aspect 1>", ...],
  "issues": ["<issue 1>", ...]
}`;
}

/**
 * Build the user prompt containing the output to evaluate.
 * @param {string} output     — The LLM output to evaluate
 * @param {string} [input]    — The original input/prompt (optional context)
 * @param {string} [expected] — Expected output (optional reference)
 * @returns {string}
 */
function buildJudgeUserPrompt(output, input, expected) {
  let prompt = '## Output to Evaluate\n\n' + output;

  if (input) {
    prompt = '## Original Input/Prompt\n\n' + input + '\n\n' + prompt;
  }

  if (expected) {
    prompt += '\n\n## Expected Output (Reference)\n\n' + expected;
  }

  prompt += '\n\nPlease evaluate the output and return your JSON assessment.';

  return prompt;
}

// ---------------------------------------------------------------------------
// Parse judge response
// ---------------------------------------------------------------------------

/**
 * Parse the judge's JSON response, with fallback for malformed output.
 * @param {string} raw — Raw LLM response text
 * @returns {{ score: number, reasoning: string, passed: boolean, highlights: string[], issues: string[] }}
 */
function parseJudgeResponse(raw) {
  // Try direct JSON parse
  try {
    const parsed = JSON.parse(raw);
    return normalizeJudgment(parsed);
  } catch {
    // Fall through to extraction
  }

  // Try to extract JSON from markdown code block or surrounding text
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return normalizeJudgment(parsed);
    } catch {
      // Fall through
    }
  }

  // Last resort: try to extract score from text
  const scoreMatch = raw.match(/(?:score|rating)[:\s]*(\d{1,2})/i);
  const score = scoreMatch ? parseInt(scoreMatch[1], 10) : 5;

  return {
    score: Math.max(1, Math.min(10, score)),
    reasoning: raw.slice(0, 500),
    passed: score >= 7,
    highlights: [],
    issues: ['Failed to parse structured judge response'],
  };
}

/**
 * Normalize a parsed judgment object to ensure correct types/ranges.
 * @param {any} obj
 * @returns {{ score: number, reasoning: string, passed: boolean, highlights: string[], issues: string[] }}
 */
function normalizeJudgment(obj) {
  const score = Math.max(1, Math.min(10, parseInt(obj.score, 10) || 5));
  return {
    score,
    reasoning: String(obj.reasoning || 'No reasoning provided'),
    passed: Boolean(obj.passed) && score >= (obj.passThreshold || 7),
    highlights: Array.isArray(obj.highlights) ? obj.highlights : [],
    issues: Array.isArray(obj.issues) ? obj.issues : [],
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate a single output against one or more criteria using LLM-as-judge.
 *
 * @param {string} output   — The LLM output to evaluate
 * @param {string|import('./criteria.js').Criterion|Array<string|import('./criteria.js').Criterion>} criteria
 *                             Criteria name(s) or definition(s)
 * @param {Object} [judgeConfig={}] — Judge LLM configuration
 * @param {string} [judgeConfig.apiKey]
 * @param {string} [judgeConfig.baseUrl]
 * @param {string} [judgeConfig.model]     — Judge model (default: same as caller)
 * @param {number} [judgeConfig.temperature]
 * @param {string} [judgeConfig.input]     — Original input for context
 * @param {string} [judgeConfig.expected]  — Expected output for reference
 * @returns {Promise<{ score: number, reasoning: string, passed: boolean, criteria: string, details: Object[] }>}
 */
export async function evaluate(output, criteria, judgeConfig = {}) {
  if (!output || typeof output !== 'string') {
    throw new Error('Output must be a non-empty string');
  }

  const criteriaList = resolveCriteriaList(criteria);
  const {
    input,
    expected,
    ...llmConfig
  } = judgeConfig;

  const results = [];

  for (const criterion of criteriaList) {
    const systemPrompt = buildJudgeSystemPrompt(criterion);
    const userPrompt = buildJudgeUserPrompt(output, input, expected);

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const response = await callLLM(messages, llmConfig);
    const judgment = parseJudgeResponse(response.content);
    judgment.passThreshold = criterion.passThreshold;
    judgment.passed = judgment.score >= criterion.passThreshold;

    results.push({
      criterion: criterion.name,
      ...judgment,
      tokens: response.usage,
    });
  }

  // Aggregate: average score, all passed
  const avgScore = results.reduce((s, r) => s + r.score, 0) / results.length;
  const allPassed = results.every((r) => r.passed);

  return {
    score: Math.round(avgScore * 10) / 10,
    passed: allPassed,
    reasoning: results.map((r) => `[${r.criterion}] ${r.reasoning}`).join('\n\n'),
    criteria: results.map((r) => r.criterion).join(', '),
    details: results,
  };
}

/**
 * Quick score helper — returns just the numeric score (1-10).
 * Useful when you don't need the full evaluation breakdown.
 *
 * @param {string} output
 * @param {string|import('./criteria.js').Criterion} criterion
 * @param {Object} [judgeConfig]
 * @returns {Promise<number>}
 */
export async function score(output, criterion, judgeConfig = {}) {
  const result = await evaluate(output, criterion, judgeConfig);
  return result.score;
}

/**
 * Evaluate with multiple criteria and return a summary.
 *
 * @param {string} output
 * @param {Array<string|import('./criteria.js').Criterion>} criteriaList
 * @param {Object} [judgeConfig]
 * @returns {Promise<{ overall: number, passed: boolean, breakdown: Object[] }>}
 */
export async function evaluateFull(output, criteriaList, judgeConfig = {}) {
  const result = await evaluate(output, criteriaList, judgeConfig);
  return {
    overall: result.score,
    passed: result.passed,
    breakdown: result.details,
  };
}
