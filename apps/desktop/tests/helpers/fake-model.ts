import { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import {
  BaseChatModel,
  type BaseChatModelParams,
} from "@langchain/core/language_models/chat_models";

/**
 * A minimal scripted chat model for the agent-loop proof tests (group 6).
 *
 * `langchain`'s `FakeStreamingChatModel` always returns the same (index-0)
 * response on every invocation, and `FakeListChatModel` rebuilds its responses
 * as plain `AIMessage(text)` — losing `tool_calls`. Neither lets a test script a
 * sequence like "emit a `write_file` call, then end with text", which is exactly
 * the shape the human-in-the-loop loop needs: the model emits the call, the
 * middleware interrupts before the tool runs, the test resumes with a decision,
 * the tool runs (or not), and the model is called once more to finish.
 *
 * This one plays back a list of {@link AIMessage}s in order and then keeps
 * returning the last, so a run that emits one tool call and one text reply ends
 * rather than looping on the same call forever. It ignores the tools `bindTools`
 * is asked to bind — the responses are scripted, so the model "decides" what the
 * test needs it to decide.
 *
 * Not a real model: construction makes no network call, which is the point.
 */

export interface ScriptedResponse {
  content?: string;
  toolCalls?: Array<{ name: string; args: Record<string, unknown>; id?: string }>;
}

export class ScriptedChatModel extends BaseChatModel<BaseChatModelParams, AIMessageChunk> {
  readonly responses: AIMessage[];
  private i = 0;

  constructor(script: ScriptedResponse[]) {
    super({});
    this.responses = script.map((r, idx) => {
      const toolCalls = r.toolCalls?.map((tc) => ({
        name: tc.name,
        args: tc.args,
        id: tc.id ?? `call_${idx}`,
        type: "tool_call" as const,
      }));
      return new AIMessage({ content: r.content ?? "", tool_calls: toolCalls });
    });
    if (this.responses.length === 0) {
      this.responses.push(new AIMessage({ content: "" }));
    }
  }

  _llmType(): string {
    return "scripted";
  }

  override _combineLLMOutput(): never[] {
    return [];
  }

  /** `createAgent` calls `bindTools`; the script ignores it and stays itself. */
  override bindTools(): this {
    return this;
  }

  private next(): AIMessage {
    const msg = this.responses[this.i] ?? this.responses[this.responses.length - 1]!;
    if (this.i < this.responses.length - 1) this.i += 1;
    return msg;
  }

  override async _generate(): Promise<{
    generations: Array<{ message: AIMessage; text: string }>;
    llmOutput: Record<string, unknown>;
  }> {
    const msg = this.next();
    return {
      generations: [{ message: msg, text: typeof msg.content === "string" ? msg.content : "" }],
      llmOutput: {},
    };
  }

  override async *_streamResponseChunks(): AsyncGenerator<ChatGenerationChunk> {
    const msg = this.next();
    yield new ChatGenerationChunk({
      message: new AIMessageChunk({
        content: msg.content,
        // Tool calls ride the chunk so the model node aggregates them into the
        // AIMessage the tools node reads.
        tool_calls: msg.tool_calls,
      }),
      text: typeof msg.content === "string" ? msg.content : "",
    });
  }
}
