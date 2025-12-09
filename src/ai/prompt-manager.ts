/**
 * Prompt Manager
 * Manages prompts for each tag type and custom classifiers
 */

import { TagType, DEFAULT_PROMPTS, PromptTemplate, CustomClassifier, SemanticAISettings } from '../types';

/**
 * Prompt Manager class for handling all prompt-related operations
 */
export class PromptManager {
  private settings: SemanticAISettings;

  constructor(settings: SemanticAISettings) {
    this.settings = settings;
  }

  /**
   * Update settings reference
   */
  updateSettings(settings: SemanticAISettings): void {
    this.settings = settings;
  }

  /**
   * Get prompt for a specific tag type
   */
  getPrompt(type: TagType): string {
    return this.settings.prompts[type] || DEFAULT_PROMPTS[type];
  }

  /**
   * Set prompt for a specific tag type
   */
  setPrompt(type: TagType, prompt: string): void {
    this.settings.prompts[type] = prompt;
  }

  /**
   * Reset prompt to default for a specific tag type
   */
  resetPrompt(type: TagType): void {
    this.settings.prompts[type] = DEFAULT_PROMPTS[type];
  }

  /**
   * Reset all prompts to defaults
   */
  resetAllPrompts(): void {
    this.settings.prompts = { ...DEFAULT_PROMPTS };
  }

  /**
   * Get all prompt templates
   */
  getAllPrompts(): PromptTemplate[] {
    const tagTypes: TagType[] = [
      'Axiom', 'Claim', 'EvidenceBundle', 'ScientificProcess',
      'Relationship', 'InternalLink', 'ExternalLink', 'ProperName',
      'ForwardLink', 'WordOntology', 'Sentence', 'Paragraph'
    ];

    return tagTypes.map(type => ({
      type,
      name: this.getTagTypeName(type),
      prompt: this.getPrompt(type),
      isDefault: this.isDefaultPrompt(type)
    }));
  }

  /**
   * Check if a prompt is the default
   */
  isDefaultPrompt(type: TagType): boolean {
    return this.settings.prompts[type] === DEFAULT_PROMPTS[type];
  }

  /**
   * Get human-readable name for tag type
   */
  getTagTypeName(type: TagType): string {
    const names: Record<TagType, string> = {
      Axiom: 'Axioms',
      Claim: 'Claims',
      EvidenceBundle: 'Evidence Bundles',
      ScientificProcess: 'Scientific Processes',
      Relationship: 'Relationships',
      InternalLink: 'Internal Links',
      ExternalLink: 'External Links',
      ProperName: 'Proper Names',
      ForwardLink: 'Forward Links',
      WordOntology: 'Word Ontology',
      Sentence: 'Sentences',
      Paragraph: 'Paragraphs',
      Custom: 'Custom'
    };
    return names[type] || type;
  }

  /**
   * Get custom classifiers
   */
  getCustomClassifiers(): CustomClassifier[] {
    return this.settings.customClassifiers || [];
  }

  /**
   * Add a custom classifier
   */
  addCustomClassifier(keyword: string, prompt: string): CustomClassifier {
    const classifier: CustomClassifier = {
      id: `custom-${Date.now()}`,
      keyword,
      prompt,
      enabled: true
    };

    if (!this.settings.customClassifiers) {
      this.settings.customClassifiers = [];
    }

    this.settings.customClassifiers.push(classifier);
    return classifier;
  }

  /**
   * Update a custom classifier
   */
  updateCustomClassifier(id: string, updates: Partial<CustomClassifier>): void {
    const classifiers = this.settings.customClassifiers || [];
    const index = classifiers.findIndex(c => c.id === id);

    if (index !== -1) {
      classifiers[index] = { ...classifiers[index], ...updates };
    }
  }

  /**
   * Remove a custom classifier
   */
  removeCustomClassifier(id: string): void {
    this.settings.customClassifiers = (this.settings.customClassifiers || [])
      .filter(c => c.id !== id);
  }

  /**
   * Find custom classifier by keyword
   */
  findClassifierByKeyword(keyword: string): CustomClassifier | undefined {
    return (this.settings.customClassifiers || [])
      .find(c => c.enabled && c.keyword.toLowerCase() === keyword.toLowerCase());
  }

  /**
   * Build the full classification prompt
   */
  buildClassificationPrompt(content: string, types: TagType[]): string {
    const systemPrompt = this.buildSystemPrompt(types);
    const userPrompt = this.buildUserPrompt(content);

    return `${systemPrompt}\n\n${userPrompt}`;
  }

  /**
   * Build system prompt with all selected tag types
   */
  buildSystemPrompt(types: TagType[]): string {
    const header = `You are a semantic analysis AI. Your task is to analyze text and identify semantic elements according to specific criteria. For each element found, provide a JSON response.

Output format: Return a JSON array of objects. Each object must have:
- "type": The tag type (one of: ${types.join(', ')})
- "label": A concise, descriptive label for the identified element
- "parentLabel": (optional) The label of a parent element if this is nested
- "confidence": (optional) A confidence score from 0 to 1

Example output:
[
  {"type": "Axiom", "label": "Conservation of Energy", "confidence": 0.95},
  {"type": "Claim", "label": "Renewable energy is more sustainable", "parentLabel": "Conservation of Energy", "confidence": 0.85}
]

Tag Type Definitions:`;

    const definitions = types.map(type => {
      const prompt = this.getPrompt(type);
      return `\n### ${type}\n${prompt}`;
    }).join('\n');

    return `${header}${definitions}`;
  }

  /**
   * Build user prompt with content
   */
  buildUserPrompt(content: string): string {
    return `Analyze the following text and identify all semantic elements according to the definitions above. Return ONLY valid JSON, no other text.

---
TEXT TO ANALYZE:
${content}
---

JSON Response:`;
  }

  /**
   * Build prompt for a specific tag type only
   */
  buildSingleTypePrompt(content: string, type: TagType): string {
    const prompt = this.getPrompt(type);

    return `You are a semantic analysis AI. Your task is to identify ${this.getTagTypeName(type)} in the given text.

${prompt}

Output format: Return a JSON array of objects. Each object must have:
- "type": "${type}"
- "label": A concise, descriptive label
- "confidence": (optional) A confidence score from 0 to 1

Return ONLY valid JSON, no other text.

---
TEXT TO ANALYZE:
${content}
---

JSON Response:`;
  }

  /**
   * Build prompt for custom classifier
   */
  buildCustomClassifierPrompt(content: string, classifier: CustomClassifier): string {
    return `You are a semantic analysis AI. Your task is to analyze text according to custom criteria.

Custom Classifier: ${classifier.keyword}
Instructions: ${classifier.prompt}

Output format: Return a JSON array of objects. Each object must have:
- "type": "Custom"
- "customType": "${classifier.keyword}"
- "label": A concise, descriptive label
- "confidence": (optional) A confidence score from 0 to 1

Return ONLY valid JSON, no other text.

---
TEXT TO ANALYZE:
${content}
---

JSON Response:`;
  }

  /**
   * Export prompts to JSON
   */
  exportPrompts(): string {
    return JSON.stringify({
      prompts: this.settings.prompts,
      customClassifiers: this.settings.customClassifiers
    }, null, 2);
  }

  /**
   * Import prompts from JSON
   */
  importPrompts(json: string): void {
    try {
      const data = JSON.parse(json);

      if (data.prompts) {
        this.settings.prompts = { ...DEFAULT_PROMPTS, ...data.prompts };
      }

      if (data.customClassifiers) {
        this.settings.customClassifiers = data.customClassifiers;
      }
    } catch (error) {
      throw new Error('Invalid prompt configuration JSON');
    }
  }
}

/**
 * Token estimation utilities
 */
export function estimateTokens(text: string): number {
  // Rough estimate: ~4 characters per token for English text
  return Math.ceil(text.length / 4);
}

export function estimatePromptTokens(prompt: string, content: string): number {
  return estimateTokens(prompt) + estimateTokens(content);
}

export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  model: string
): number {
  // Pricing per 1M tokens (approximate, may vary)
  const pricing: Record<string, { input: number; output: number }> = {
    'gpt-4o': { input: 2.50, output: 10.00 },
    'gpt-4o-mini': { input: 0.15, output: 0.60 },
    'gpt-4-turbo': { input: 10.00, output: 30.00 },
    'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
    'claude-3-opus': { input: 15.00, output: 75.00 },
    'claude-3-sonnet': { input: 3.00, output: 15.00 },
    'claude-3-haiku': { input: 0.25, output: 1.25 }
  };

  const modelPricing = pricing[model] || pricing['gpt-4o-mini'];
  const inputCost = (inputTokens / 1_000_000) * modelPricing.input;
  const outputCost = (outputTokens / 1_000_000) * modelPricing.output;

  return inputCost + outputCost;
}
