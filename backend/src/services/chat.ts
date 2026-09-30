import { generateText } from './youtube';

/**
 * R5 — AI chat completions.
 *
 * Reuses the LLM provider chain from the YouTube service (`generateText`):
 * walks enabled providers by priority, skips the stub (never fabricates),
 * and throws `llm_not_configured` when no LLM key is set. Conversation
 * history is folded into a single prompt because the current adapters take
 * one prompt string. Token counts are estimated at chars/4 (the same
 * convention the Gemini adapter uses) and charged to the ai_tokens quota.
 */

export interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM = `You are the in-app AI assistant for VEO Studio, a personal AI video studio. \
You help with video ideas, script feedback, YouTube SEO, plan limits, and how to use the studio's tools. \
Be concise and practical. If asked about the user's account, quotas, or anything you cannot see, say so honestly instead of guessing.`;

export async function chatComplete(
  history: ChatMsg[],
  userId: string,
): Promise<{ text: string; provider: string; tokensIn: number; tokensOut: number; cost: number }> {
  const convo = history
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');
  const prompt = `${SYSTEM}\n\n${convo}\n\nAssistant:`;
  const { text, provider, cost } = await generateText('ai-chat', prompt, userId);
  const tokensIn = Math.ceil(prompt.length / 4);
  const tokensOut = Math.ceil(text.length / 4);
  return { text, provider, tokensIn, tokensOut, cost };
}

/** Thread title from the first user message (cheap, no extra LLM call). */
export function titleFrom(content: string): string {
  const t = content.trim().replace(/\s+/g, ' ').slice(0, 60);
  return t || 'New chat';
}
