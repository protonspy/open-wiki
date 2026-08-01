/**
 * mammoth ships no type declarations and there is no `@types/mammoth`. This
 * declares the slice of its API `sources/docx.ts` uses, and nothing more: a
 * hand-written declaration that describes the whole library would be a second
 * copy of someone else's contract, drifting silently.
 */
declare module "mammoth" {
  export interface ConvertInput {
    buffer: Buffer;
  }

  export interface ConvertMessage {
    type: "warning" | "error";
    message: string;
  }

  export interface ConvertResult {
    value: string;
    messages: ConvertMessage[];
  }

  export function convertToHtml(input: ConvertInput): Promise<ConvertResult>;
  export function extractRawText(input: ConvertInput): Promise<ConvertResult>;

  const mammoth: {
    convertToHtml: typeof convertToHtml;
    extractRawText: typeof extractRawText;
  };
  export default mammoth;
}
