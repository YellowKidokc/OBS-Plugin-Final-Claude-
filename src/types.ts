// Tag types supported by the plugin
export type TagType =
  | 'Axiom'
  | 'Claim'
  | 'EvidenceBundle'
  | 'ScientificProcess'
  | 'Relationship'
  | 'InternalLink'
  | 'ExternalLink'
  | 'ProperName'
  | 'ForwardLink'
  | 'WordOntology'
  | 'Sentence'
  | 'Paragraph'
  | 'Custom';

// A semantic tag with UUID and hierarchy support
export interface SemanticTag {
  type: TagType;
  uuid: string;
  label: string;
  parentUuid: string | null;
  customType?: string; // For custom tag types
  metadata?: Record<string, unknown>;
}

// Parsed tag from file content
export interface ParsedTag {
  raw: string;
  tag: SemanticTag;
  lineNumber: number;
}

// Classification result from AI
export interface ClassificationResult {
  tags: SemanticTag[];
  mermaidGraph?: string;
  summary?: string;
}

// Batch processing result
export interface BatchResult {
  file: string;
  success: boolean;
  tagCounts: Record<TagType, number>;
  error?: string;
}

// Prompt template for a tag type
export interface PromptTemplate {
  type: TagType | 'Custom';
  name: string;
  prompt: string;
  isDefault: boolean;
  customKeyword?: string;
}

// Custom classifier definition
export interface CustomClassifier {
  id: string;
  keyword: string;
  prompt: string;
  enabled: boolean;
}

// Plugin settings
export interface SemanticAISettings {
  // AI Provider settings
  aiProvider: 'openai' | 'anthropic' | 'ollama' | 'custom';
  apiKey: string;
  apiEndpoint: string;
  modelName: string;

  // Prompt templates
  prompts: Record<TagType, string>;

  // Custom classifiers
  customClassifiers: CustomClassifier[];

  // UI settings
  showHiddenTags: boolean;
  autoGenerateMermaid: boolean;
  mermaidPosition: 'append' | 'panel';

  // Graph settings
  graphDirection: 'TD' | 'LR' | 'BT' | 'RL';
  graphTheme: 'default' | 'forest' | 'dark' | 'neutral';

  // Batch processing
  confirmBatchProcessing: boolean;
  showTokenEstimate: boolean;

  // Backend sync (Phase 2)
  enablePostgresSync: boolean;
  postgresConnectionString: string;
  pythonServiceUrl: string;
}

// Default prompts for each tag type
export const DEFAULT_PROMPTS: Record<TagType, string> = {
  Axiom: `Identify core foundational truths in this document. These are axioms — statements that do not rely on prior proof and support other claims. Return each axiom with a clear, concise label.`,

  Claim: `Identify any claims made by the author. A claim asserts a position that can be supported or refuted. Return each claim with a descriptive label.`,

  EvidenceBundle: `Identify evidence used to support claims or axioms. This may be empirical data, quotes, citations, or logical arguments. Return each piece of evidence with a label describing what it supports.`,

  ScientificProcess: `Identify any scientific processes, methodologies, or experimental procedures described in the text. Return each with a label describing the process.`,

  Relationship: `Identify explicit or implicit relationships between concepts, entities, or events in the text. Return each relationship with a label describing the connection.`,

  InternalLink: `Identify references to other notes or sections within this document or vault. Return each with a label.`,

  ExternalLink: `Identify references to external sources, URLs, or citations. Return each with a descriptive label.`,

  ProperName: `Identify proper names of people, places, organizations, or specific entities mentioned in the text. Return each with contextual information.`,

  ForwardLink: `Identify concepts or topics that could be expanded in future notes or require further exploration. Return each with a suggested focus.`,

  WordOntology: `Identify specialized terms and link them to their definitions, origins, or ontological categories. Return each term with its category and definition.`,

  Sentence: `Identify key sentences that contain important claims, evidence, or concepts. Return each with a label describing its significance.`,

  Paragraph: `Identify paragraphs that form logical units of thought. Return each with a summary label.`,

  Custom: `Analyze the text according to the specified criteria. Return findings with descriptive labels.`
};

// Default settings
export const DEFAULT_SETTINGS: SemanticAISettings = {
  aiProvider: 'openai',
  apiKey: '',
  apiEndpoint: 'https://api.openai.com/v1/chat/completions',
  modelName: 'gpt-4o-mini',

  prompts: { ...DEFAULT_PROMPTS },
  customClassifiers: [],

  showHiddenTags: false,
  autoGenerateMermaid: true,
  mermaidPosition: 'panel',

  graphDirection: 'TD',
  graphTheme: 'default',

  confirmBatchProcessing: true,
  showTokenEstimate: true,

  enablePostgresSync: false,
  postgresConnectionString: '',
  pythonServiceUrl: 'http://localhost:5000'
};

// AI response format
export interface AIClassificationResponse {
  type: TagType;
  label: string;
  parentLabel?: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

// Token estimation
export interface TokenEstimate {
  inputTokens: number;
  estimatedOutputTokens: number;
  estimatedCost: number;
}
