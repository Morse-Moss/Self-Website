import type { TokenUsage } from './budget.ts';

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AnswerRequest {
  instructions: string;
  messages: AiMessage[];
}

export type AnswerEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; usage: TokenUsage };

export interface AiProvider {
  embed(inputs: string[]): Promise<number[][]>;
  streamAnswer(request: AnswerRequest): AsyncIterable<AnswerEvent>;
}
