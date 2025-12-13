/**
 * AI Classifier Module
 * Handles AI-based classification of notes
 */

import { requestUrl, RequestUrlParam, Notice } from 'obsidian';
import {
  SemanticTag,
  TagType,
  ClassificationResult,
  AIClassificationResponse,
  SemanticAISettings,
  TokenEstimate
} from '../types';
import { PromptManager, estimateTokens, estimatePromptTokens, estimateCost } from './prompt-manager';
import { createTag } from '../tagging/tag-writer';

/**
 * AI Classifier class for handling all AI classification operations
 */
export class AIClassifier {
  private settings: SemanticAISettings;
  private promptManager: PromptManager;

  constructor(settings: SemanticAISettings, promptManager: PromptManager) {
    this.settings = settings;
    this.promptManager = promptManager;
  }

  /**
   * Update settings reference
   */
  updateSettings(settings: SemanticAISettings): void {
    this.settings = settings;
    this.promptManager.updateSettings(settings);
  }

  /**
   * Classify content using AI
   */
  async classify(
    content: string,
    types: TagType[] = ['Axiom', 'Claim', 'EvidenceBundle', 'Relationship'],
    sourceFile?: string
  ): Promise<ClassificationResult> {
    const prompt = this.promptManager.buildClassificationPrompt(content, types);

    try {
      const response = await this.callAI(prompt);
      const parsed = this.parseAIResponse(response);
      const tags = this.convertToTags(parsed, sourceFile);

      return {
        tags,
        summary: `Found ${tags.length} semantic elements`
      };
    } catch (error) {
      console.error('Classification error:', error);
      throw new Error(`Classification failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Classify content for a single tag type
   */
  async classifySingleType(content: string, type: TagType, sourceFile?: string): Promise<ClassificationResult> {
    const prompt = this.promptManager.buildSingleTypePrompt(content, type);

    try {
      const response = await this.callAI(prompt);
      const parsed = this.parseAIResponse(response);
      const tags = this.convertToTags(parsed, sourceFile);

      return {
        tags,
        summary: `Found ${tags.length} ${this.promptManager.getTagTypeName(type)}`
      };
    } catch (error) {
      console.error('Classification error:', error);
      throw new Error(`Classification failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Run custom classifier
   */
  async classifyCustom(content: string, keyword: string, sourceFile?: string): Promise<ClassificationResult> {
    const classifier = this.promptManager.findClassifierByKeyword(keyword);

    if (!classifier) {
      throw new Error(`Custom classifier '${keyword}' not found`);
    }

    const prompt = this.promptManager.buildCustomClassifierPrompt(content, classifier);

    try {
      const response = await this.callAI(prompt);
      const parsed = this.parseAIResponse(response);
      const tags = this.convertToTags(parsed, sourceFile);

      return {
        tags,
        summary: `Found ${tags.length} '${keyword}' elements`
      };
    } catch (error) {
      console.error('Custom classification error:', error);
      throw new Error(`Custom classification failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Estimate tokens and cost for classification
   */
  estimateClassification(content: string, types: TagType[]): TokenEstimate {
    const prompt = this.promptManager.buildClassificationPrompt(content, types);
    const inputTokens = estimatePromptTokens(prompt, '');

    // Estimate output tokens (roughly 20% of input for classification)
    const estimatedOutputTokens = Math.ceil(inputTokens * 0.2);

    return {
      inputTokens,
      estimatedOutputTokens,
      estimatedCost: estimateCost(inputTokens, estimatedOutputTokens, this.settings.modelName)
    };
  }

  /**
   * Call AI provider API
   */
  private async callAI(prompt: string): Promise<string> {
    if (!this.settings.apiKey && this.settings.aiProvider !== 'ollama') {
      throw new Error('API key not configured. Please add your API key in settings.');
    }

    switch (this.settings.aiProvider) {
      case 'openai':
        return this.callOpenAI(prompt);
      case 'anthropic':
        return this.callAnthropic(prompt);
      case 'ollama':
        return this.callOllama(prompt);
      case 'custom':
        return this.callCustomAPI(prompt);
      default:
        throw new Error(`Unknown AI provider: ${this.settings.aiProvider}`);
    }
  }

  /**
   * Call OpenAI API
   */
  private async callOpenAI(prompt: string): Promise<string> {
    const requestParams: RequestUrlParam = {
      url: this.settings.apiEndpoint || 'https://api.openai.com/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.settings.apiKey}`
      },
      body: JSON.stringify({
        model: this.settings.modelName || 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 4096
      })
    };

    const response = await requestUrl(requestParams);

    if (response.status !== 200) {
      throw new Error(`OpenAI API error: ${response.status} - ${response.text}`);
    }

    const data = response.json;
    return data.choices[0]?.message?.content || '';
  }

  /**
   * Call Anthropic API
   */
  private async callAnthropic(prompt: string): Promise<string> {
    const requestParams: RequestUrlParam = {
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.settings.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: this.settings.modelName || 'claude-3-haiku-20240307',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    };

    const response = await requestUrl(requestParams);

    if (response.status !== 200) {
      throw new Error(`Anthropic API error: ${response.status} - ${response.text}`);
    }

    const data = response.json;
    return data.content[0]?.text || '';
  }

  /**
   * Call Ollama API (local)
   */
  private async callOllama(prompt: string): Promise<string> {
    const requestParams: RequestUrlParam = {
      url: this.settings.apiEndpoint || 'http://localhost:11434/api/generate',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.settings.modelName || 'llama2',
        prompt: prompt,
        stream: false
      })
    };

    const response = await requestUrl(requestParams);

    if (response.status !== 200) {
      throw new Error(`Ollama API error: ${response.status} - ${response.text}`);
    }

    const data = response.json;
    return data.response || '';
  }

  /**
   * Call custom API endpoint
   */
  private async callCustomAPI(prompt: string): Promise<string> {
    if (!this.settings.apiEndpoint) {
      throw new Error('Custom API endpoint not configured');
    }

    const requestParams: RequestUrlParam = {
      url: this.settings.apiEndpoint,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.settings.apiKey && { 'Authorization': `Bearer ${this.settings.apiKey}` })
      },
      body: JSON.stringify({
        prompt: prompt,
        model: this.settings.modelName
      })
    };

    const response = await requestUrl(requestParams);

    if (response.status !== 200) {
      throw new Error(`Custom API error: ${response.status} - ${response.text}`);
    }

    const data = response.json;
    // Try common response formats
    return data.response || data.content || data.text || data.output || JSON.stringify(data);
  }

  /**
   * Parse AI response into structured data
   */
  private parseAIResponse(response: string): AIClassificationResponse[] {
    // Try to extract JSON from the response
    let jsonStr = response.trim();

    // Handle markdown code blocks
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    // Handle responses that start with text before JSON
    const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      jsonStr = arrayMatch[0];
    }

    try {
      const parsed = JSON.parse(jsonStr);

      if (!Array.isArray(parsed)) {
        // If single object, wrap in array
        return [parsed];
      }

      return parsed;
    } catch (error) {
      console.error('Failed to parse AI response:', response);

      // Try to salvage partial JSON
      const partialMatch = jsonStr.match(/\{[^{}]*\}/g);
      if (partialMatch) {
        const results: AIClassificationResponse[] = [];
        for (const match of partialMatch) {
          try {
            results.push(JSON.parse(match));
          } catch {
            // Skip invalid entries
          }
        }
        if (results.length > 0) {
          return results;
        }
      }

      throw new Error('Failed to parse AI response as JSON');
    }
  }

  /**
   * Convert AI responses to semantic tags
   */
  private convertToTags(responses: AIClassificationResponse[], sourceFile?: string): SemanticTag[] {
    const tags: SemanticTag[] = [];
    const labelToUuid = new Map<string, string>();

    // First pass: create all tags
    for (const response of responses) {
      if (!response.type || !response.label) {
        continue;
      }

      const tag = createTag(
        response.type as TagType,
        response.label,
        null,
        response.type === 'Custom' ? (response as { customType?: string }).customType : undefined,
        sourceFile
      );

      if (response.metadata) {
        tag.metadata = response.metadata;
      }

      tags.push(tag);
      labelToUuid.set(response.label, tag.uuid);
    }

    // Second pass: link parent references
    for (let i = 0; i < responses.length; i++) {
      const response = responses[i];
      if (response.parentLabel && labelToUuid.has(response.parentLabel)) {
        tags[i].parentUuid = labelToUuid.get(response.parentLabel) || null;
      }
    }

    return tags;
  }

  /**
   * Validate API configuration
   */
  validateConfiguration(): { valid: boolean; error?: string } {
    if (this.settings.aiProvider === 'ollama') {
      return { valid: true };
    }

    if (!this.settings.apiKey) {
      return { valid: false, error: 'API key is required' };
    }

    if (this.settings.aiProvider === 'custom' && !this.settings.apiEndpoint) {
      return { valid: false, error: 'Custom API endpoint is required' };
    }

    return { valid: true };
  }

  /**
   * Test API connection
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    const validation = this.validateConfiguration();
    if (!validation.valid) {
      return { success: false, message: validation.error || 'Invalid configuration' };
    }

    try {
      const response = await this.callAI('Respond with exactly: {"test": "success"}');

      if (response.includes('success')) {
        return { success: true, message: 'Connection successful!' };
      }

      return { success: true, message: 'Connection established, but response format may vary.' };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Connection failed'
      };
    }
  }
}

/**
 * Batch classifier for processing multiple files
 */
export class BatchClassifier {
  private classifier: AIClassifier;
  private onProgress: (file: string, status: string, counts?: Record<string, number>) => void;

  constructor(
    classifier: AIClassifier,
    onProgress: (file: string, status: string, counts?: Record<string, number>) => void
  ) {
    this.classifier = classifier;
    this.onProgress = onProgress;
  }

  /**
   * Process multiple files
   */
  async processFiles(
    files: { path: string; content: string }[],
    types: TagType[]
  ): Promise<Map<string, ClassificationResult>> {
    const results = new Map<string, ClassificationResult>();

    for (const file of files) {
      this.onProgress(file.path, 'processing');

      try {
        const result = await this.classifier.classify(file.content, types, file.path);
        results.set(file.path, result);

        const counts: Record<string, number> = {};
        for (const tag of result.tags) {
          counts[tag.type] = (counts[tag.type] || 0) + 1;
        }

        this.onProgress(file.path, 'complete', counts);
      } catch (error) {
        this.onProgress(file.path, `error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        results.set(file.path, { tags: [], summary: 'Classification failed' });
      }

      // Add delay between requests to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return results;
  }

  /**
   * Estimate total cost for batch processing
   */
  estimateBatchCost(
    files: { content: string }[],
    types: TagType[]
  ): { totalTokens: number; estimatedCost: number } {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const file of files) {
      const estimate = this.classifier.estimateClassification(file.content, types);
      totalInputTokens += estimate.inputTokens;
      totalOutputTokens += estimate.estimatedOutputTokens;
    }

    return {
      totalTokens: totalInputTokens + totalOutputTokens,
      estimatedCost: files.reduce((sum, file) => {
        const estimate = this.classifier.estimateClassification(file.content, types);
        return sum + estimate.estimatedCost;
      }, 0)
    };
  }
}
