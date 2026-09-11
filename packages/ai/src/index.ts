export interface AIProvider {
  readonly key: string;
  completeJson<T>(input: { model: string; system: string; user: string; schemaName: string }): Promise<T>;
}

export function validateSeoLengths(input: { title?: string; description?: string }, limits = { titleMin: 30, titleMax: 60, descriptionMin: 70, descriptionMax: 160 }) {
  const issues: string[] = [];
  if (input.title && (input.title.length < limits.titleMin || input.title.length > limits.titleMax)) {
    issues.push(`Title must be ${limits.titleMin}-${limits.titleMax} characters.`);
  }
  if (input.description && (input.description.length < limits.descriptionMin || input.description.length > limits.descriptionMax)) {
    issues.push(`Description must be ${limits.descriptionMin}-${limits.descriptionMax} characters.`);
  }
  return issues;
}
