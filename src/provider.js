/**
 * provider.js — LLM Provider Abstraction
 *
 * Provides a unified interface to call any OpenAI-compatible LLM API.
 * Includes rate limiting, retry logic with exponential backoff,
 * and basic token estimation.
 *
 * @module provider
 */

// ---------------------------------------------------------------------------
// Token estimation (rough char-based heuristic, no tiktoken dependency)
// ---------------------------------------------------------------------------

/**
 * Estimate token count from text using a simple heuristic.
 * English text averages ~4 chars per token; this is a reasonable proxy.
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  if (!text) return 0;
  // ~4 chars per token for English, ~2 for CJK
  const cjkChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const otherChars = text.length - cjkChars;
  return Math.ceil(otherChars / 4) + Math.ceil(cjkChars / 2);
}

/**
 * Estimate total tokens for a messages array.
 * @param {Array<{role: string, content: string}>} messages
 * @returns {number}
 */
export function estimateMessagesTokens(messages) {
  let total = 4; // base overhead per request
  for (const msg of messages) {
    total += 4; // role + separators per message
    total += estimateTokens(msg.content || '');
  }
  return total;
}

// ---------------------------------------------------------------------------
// Rate limiter (simple token-bucket per-key)
// ---------------------------------------------------------------------------

const buckets = new Map();

/**
 * Simple rate limiter — waits if the bucket is empty.
 * @param {string} key   Identifier (e.g. API key or base URL)
 * @param {number} rpm   Requests per minute allowed
 * @returns {Promise<void>}
 */
async function rateLimit(key, rpm = 60) {
  const now = Date.now();
  if (!buckets.has(key)) {
    buckets.set(key, { timestamps: [], rpm });
  }
  const bucket = buckets.get(key);
  bucket.rpm = rpm; // allow dynamic updates

  // Prune timestamps older than 60 s
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < 60_000);

  if (bucket.timestamps.length >= rpm) {
    const oldest = bucket.timestamps[0];
    const waitMs = 60_000 - (now - oldest) + 50; // +50 ms buffer
    await new Promise((r) => setTimeout(r, waitMs));
  }

  bucket.timestamps.push(Date.now());
}

// ---------------------------------------------------------------------------
// Core LLM call
// ---------------------------------------------------------------------------

/**
 * Call an OpenAI-compatible chat completions endpoint.
 *
 * @param {Array<{role: string, content: string}>} messages  Chat messages
 * @param {Object} config
 * @param {string} config.apiKey       API key (or OPENAI_API_KEY env)
 * @param {string} [config.baseUrl]    Base URL (default: https://api.openai.com/v1)
 * @param {string} [config.model]      Model name (default: gpt-4o-mini)
 * @param {number} [config.temperature] Sampling temperature (default: 0)
 * @param {number} [config.maxTokens]  Max response tokens (default: 1024)
 * @param {number} [config.maxRetries] Retries on transient errors (default: 3)
 * @param {number} [config.rpm]        Rate limit, requests/minute (default: 60)
 * @returns {Promise<{content: string, usage: {prompt: number, completion: number, total: number}, finishReason: string}>}
 */
export async function callLLM(messages, config = {}) {
  const {
    apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY,
    baseUrl = process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
    model = process.env.LLM_MODEL || 'gpt-4o-mini',
    temperature = 0,
    maxTokens = 1024,
    maxRetries = 3,
    rpm = 60,
  } = config;

  if (!apiKey) {
    throw new Error(
      'No API key provided. Set OPENAI_API_KEY, LLM_API_KEY, or pass config.apiKey.'
    );
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  const rateLimitKey = `${baseUrl}:${apiKey.slice(0, 8)}`;

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 1s, 2s, 4s …
      const delay = Math.min(1000 * 2 ** (attempt - 1), 30_000);
      await new Promise((r) => setTimeout(r, delay));
    }

    await rateLimit(rateLimitKey, rpm);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      // Transient errors — retry
      if (response.status === 429 || response.status >= 500) {
        const text = await response.text().catch(() => '');
        lastError = new Error(`LLM API error ${response.status}: ${text}`);
        if (attempt < maxRetries) continue;
        throw lastError;
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`LLM API error ${response.status}: ${text}`);
      }

      const data = await response.json();
      const choice = data.choices?.[0];
      if (!choice) {
        throw new Error('LLM returned no choices');
      }

      return {
        content: choice.message?.content ?? '',
        usage: {
          prompt: data.usage?.prompt_tokens ?? estimateMessagesTokens(messages),
          completion: data.usage?.completion_tokens ?? estimateTokens(choice.message?.content ?? ''),
          total: data.usage?.total_tokens ?? 0,
        },
        finishReason: choice.finish_reason ?? 'stop',
      };
    } catch (err) {
      if (err.message.startsWith('LLM API error')) {
        throw err; // non-retryable
      }
      lastError = err;
      if (attempt >= maxRetries) break;
    }
  }

  throw lastError || new Error('LLM call failed after retries');
}
