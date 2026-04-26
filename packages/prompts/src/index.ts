export * from "./qualify.js";
export * from "./redesign.js";
export * from "./redesign-quality.js";
export * from "./template.js";
export * from "./outreach.js";
export * from "./triage.js";
export * from "./markets.js";

export interface PromptVersion<TInput> {
  version: string;
  deployedAt: string;
  render: (input: TInput) => string;
}
