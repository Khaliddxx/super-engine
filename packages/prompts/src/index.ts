export * from "./qualify.js";
export * from "./redesign.js";
export * from "./template.js";
export * from "./outreach.js";
export * from "./triage.js";

export interface PromptVersion<TInput> {
  version: string;
  deployedAt: string;
  render: (input: TInput) => string;
}
