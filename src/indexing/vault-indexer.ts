/**
 * Vault Index Module
 * Cross-document tracking and concept indexing
 */

import { TFile, TFolder, Vault, Notice } from 'obsidian';
import { SemanticTag, TagType } from '../types';
import { parseTags } from '../tagging/tag-writer';
import { estimateTokens } from '../ai/prompt-manager';

/**
 * Concept occurrence tracking
 */
export interface ConceptOccurrence {
  filePath: string;
  fileName: string;
  tagUuid: string;
  tagType: TagType;
  label: string;
  lineNumber?: number;
  context?: string;
}

/**
 * Concept entry in the index
 */
export interface ConceptEntry {
  label: string;
  normalizedLabel: string;
  occurrences: ConceptOccurrence[];
  firstSeen: {
    filePath: string;
    fileName: string;
    date?: string;
  };
  totalCount: number;
  fileCount: number;
  tagTypes: TagType[];
  relatedConcepts: string[];
}

/**
 * Cross-document relationship
 */
export interface CrossDocumentRelation {
  sourceFile: string;
  targetFile: string;
  sharedConcepts: string[];
  relationshipStrength: number; // 0-1 based on shared concepts
}

/**
 * Index metadata
 */
export interface IndexMetadata {
  lastUpdated: string;
  scope: 'folder' | 'vault';
  scopePath: string;
  totalFiles: number;
  totalTags: number;
  totalConcepts: number;
  estimatedTokens?: number;
  processingTimeMs?: number;
  skippedRelations?: boolean;  // True if we skipped expensive relation calculation
  wasAborted?: boolean;        // True if indexing was aborted
  warnings?: string[];         // Any warnings during indexing
}

/**
 * Complete vault/folder index
 */
export interface VaultIndex {
  metadata: IndexMetadata;
  concepts: Map<string, ConceptEntry>;
  relations: CrossDocumentRelation[];
  fileIndex: Map<string, SemanticTag[]>;
}

/**
 * Index cost estimate
 */
export interface IndexCostEstimate {
  fileCount: number;
  totalCharacters: number;
  estimatedTokens: number;
  estimatedCost: number;
  warning?: string;
}

/**
 * Indexer configuration
 */
export interface IndexerConfig {
  maxFiles: number;           // Max files to process (default 1000)
  maxRelationFiles: number;   // Max files for cross-relation (default 200)
  excludePatterns: string[];  // Folders to exclude
  batchSize: number;          // Files per batch (default 50)
  batchDelayMs: number;       // Delay between batches (default 10)
}

const DEFAULT_CONFIG: IndexerConfig = {
  maxFiles: 1000,
  maxRelationFiles: 200,
  excludePatterns: [
    '.obsidian',
    'node_modules',
    '.git',
    '_archive',
    '_Archive',
    '.trash',
    'Trash'
  ],
  batchSize: 50,
  batchDelayMs: 10
};

/**
 * Vault Indexer class
 */
export class VaultIndexer {
  private vault: Vault;
  private currentIndex: VaultIndex | null = null;
  private config: IndexerConfig;
  private abortController: AbortController | null = null;

  constructor(vault: Vault, config?: Partial<IndexerConfig>) {
    this.vault = vault;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<IndexerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Abort any ongoing indexing operation
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Check if indexing is in progress
   */
  isIndexing(): boolean {
    return this.abortController !== null;
  }

  /**
   * Get current index
   */
  getIndex(): VaultIndex | null {
    return this.currentIndex;
  }

  /**
   * Estimate cost for indexing
   */
  async estimateIndexCost(
    scope: 'folder' | 'vault',
    folderPath?: string
  ): Promise<IndexCostEstimate> {
    const files = this.getFilesInScope(scope, folderPath);
    let totalCharacters = 0;

    for (const file of files) {
      const content = await this.vault.read(file);
      totalCharacters += content.length;
    }

    const estimatedTokens = estimateTokens(String(totalCharacters));

    // Rough cost estimate (assuming GPT-4o-mini pricing)
    const estimatedCost = (estimatedTokens / 1_000_000) * 0.15;

    let warning: string | undefined;
    if (files.length > 100) {
      warning = `Large scope: ${files.length} files. This may take a while and cost ~$${estimatedCost.toFixed(4)}.`;
    }
    if (files.length > 500) {
      warning = `Very large scope: ${files.length} files. Consider indexing specific folders instead. Estimated cost: ~$${estimatedCost.toFixed(4)}.`;
    }

    return {
      fileCount: files.length,
      totalCharacters,
      estimatedTokens,
      estimatedCost,
      warning
    };
  }

  /**
   * Get markdown files in scope (with exclusions and limits)
   */
  private getFilesInScope(scope: 'folder' | 'vault', folderPath?: string): TFile[] {
    let files = this.vault.getMarkdownFiles();

    // Filter by folder scope
    if (scope === 'folder' && folderPath) {
      files = files.filter(f => f.path.startsWith(folderPath));
    }

    // Apply exclusion patterns
    files = files.filter(f => {
      const lowerPath = f.path.toLowerCase();
      return !this.config.excludePatterns.some(pattern =>
        lowerPath.includes(pattern.toLowerCase())
      );
    });

    // Apply file limit
    if (files.length > this.config.maxFiles) {
      new Notice(`Large vault: limiting to ${this.config.maxFiles} files. Consider indexing specific folders.`, 5000);
      files = files.slice(0, this.config.maxFiles);
    }

    return files;
  }

  /**
   * Sleep for batching
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Build index for folder or vault (memory-safe with batching)
   */
  async buildIndex(
    scope: 'folder' | 'vault',
    folderPath?: string,
    onProgress?: (current: number, total: number, fileName: string) => void
  ): Promise<VaultIndex> {
    // Abort any previous indexing operation
    this.abort();

    // Create new abort controller for this operation
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const startTime = Date.now();
    const files = this.getFilesInScope(scope, folderPath);
    const warnings: string[] = [];

    const concepts = new Map<string, ConceptEntry>();
    const fileIndex = new Map<string, SemanticTag[]>();
    const relations: CrossDocumentRelation[] = [];

    let totalTags = 0;
    let skippedRelations = false;

    // Process files in batches to avoid memory pressure
    for (let batchStart = 0; batchStart < files.length; batchStart += this.config.batchSize) {
      // Check for abort before each batch
      if (signal.aborted) {
        warnings.push('Indexing was aborted by user');
        break;
      }

      const batchEnd = Math.min(batchStart + this.config.batchSize, files.length);

      for (let i = batchStart; i < batchEnd; i++) {
        // Check for abort within batch
        if (signal.aborted) {
          break;
        }

        const file = files[i];

        if (onProgress) {
          onProgress(i + 1, files.length, file.name);
        }

        try {
          const content = await this.vault.read(file);
          const parsedTags = parseTags(content);
          const tags = parsedTags.map(pt => pt.tag);

          fileIndex.set(file.path, tags);
          totalTags += tags.length;

          // Index each tag as a concept
          for (const parsedTag of parsedTags) {
            const tag = parsedTag.tag;
            const normalizedLabel = this.normalizeLabel(tag.label);

            const occurrence: ConceptOccurrence = {
              filePath: file.path,
              fileName: file.name,
              tagUuid: tag.uuid,
              tagType: tag.type,
              label: tag.label,
              lineNumber: parsedTag.lineNumber
            };

            if (concepts.has(normalizedLabel)) {
              const entry = concepts.get(normalizedLabel)!;
              entry.occurrences.push(occurrence);
              entry.totalCount++;

              if (!entry.tagTypes.includes(tag.type)) {
                entry.tagTypes.push(tag.type);
              }

              // Track unique files
              const uniqueFiles = new Set(entry.occurrences.map(o => o.filePath));
              entry.fileCount = uniqueFiles.size;
            } else {
              concepts.set(normalizedLabel, {
                label: tag.label,
                normalizedLabel,
                occurrences: [occurrence],
                firstSeen: {
                  filePath: file.path,
                  fileName: file.name,
                  date: new Date().toISOString()
                },
                totalCount: 1,
                fileCount: 1,
                tagTypes: [tag.type],
                relatedConcepts: []
              });
            }
          }
        } catch (error) {
          console.warn(`Failed to index file ${file.path}:`, error);
        }
      }

      // Yield to main thread between batches to prevent UI freeze
      if (batchEnd < files.length) {
        await this.sleep(this.config.batchDelayMs);
      }
    }

    // Only build cross-document relations for smaller indexes (O(n²) operation!)
    const filesWithTags = Array.from(fileIndex.keys()).filter(f =>
      (fileIndex.get(f)?.length || 0) > 0
    );

    if (!signal.aborted && filesWithTags.length <= this.config.maxRelationFiles) {
      // Build cross-document relations
      const fileConceptMap = new Map<string, Set<string>>();

      for (const filePath of filesWithTags) {
        const tags = fileIndex.get(filePath) || [];
        const conceptsInFile = new Set(tags.map(t => this.normalizeLabel(t.label)));
        fileConceptMap.set(filePath, conceptsInFile);
      }

      // Find relationships between files
      for (let i = 0; i < filesWithTags.length && !signal.aborted; i++) {
        for (let j = i + 1; j < filesWithTags.length; j++) {
          const file1 = filesWithTags[i];
          const file2 = filesWithTags[j];
          const concepts1 = fileConceptMap.get(file1)!;
          const concepts2 = fileConceptMap.get(file2)!;

          const sharedConcepts = Array.from(concepts1).filter(c => concepts2.has(c));

          if (sharedConcepts.length > 0) {
            const maxConcepts = Math.max(concepts1.size, concepts2.size);
            const relationshipStrength = sharedConcepts.length / maxConcepts;

            relations.push({
              sourceFile: file1,
              targetFile: file2,
              sharedConcepts,
              relationshipStrength
            });
          }
        }

        // Yield occasionally during relation building
        if (i % 50 === 0 && i > 0) {
          await this.sleep(1);
        }
      }

      // Find related concepts (concepts that appear in same files)
      // Only do this for smaller concept sets
      if (!signal.aborted && concepts.size <= 500) {
        for (const [label, entry] of concepts) {
          if (signal.aborted) break;

          const filesWithConcept = new Set(entry.occurrences.map(o => o.filePath));
          const related = new Set<string>();

          for (const [otherLabel, otherEntry] of concepts) {
            if (otherLabel === label) continue;

            const otherFiles = new Set(otherEntry.occurrences.map(o => o.filePath));
            const hasOverlap = Array.from(filesWithConcept).some(f => otherFiles.has(f));

            if (hasOverlap) {
              related.add(otherEntry.label);
            }
          }

          entry.relatedConcepts = Array.from(related).slice(0, 20);
        }
      }
    } else if (!signal.aborted) {
      // Skip expensive relation calculation for large vaults
      skippedRelations = true;
      warnings.push(`Skipped cross-file relations for ${filesWithTags.length} files (too large)`);
      new Notice(`Skipping cross-file relations for ${filesWithTags.length} files (too large). Use folder indexing for relations.`, 5000);
    }

    const processingTimeMs = Date.now() - startTime;
    const wasAborted = signal.aborted;

    // Clean up abort controller
    this.abortController = null;

    const metadata: IndexMetadata = {
      lastUpdated: new Date().toISOString(),
      scope,
      scopePath: folderPath || '/',
      totalFiles: files.length,
      totalTags,
      totalConcepts: concepts.size,
      processingTimeMs,
      skippedRelations,
      wasAborted,
      warnings: warnings.length > 0 ? warnings : undefined
    };

    this.currentIndex = {
      metadata,
      concepts,
      relations,
      fileIndex
    };

    // Show notice if aborted
    if (wasAborted) {
      new Notice('Indexing was aborted. Partial results available.', 3000);
    }

    return this.currentIndex;
  }

  /**
   * Normalize label for matching
   */
  private normalizeLabel(label: string): string {
    return label
      .toLowerCase()
      .trim()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ');
  }

  /**
   * Search concepts
   */
  searchConcepts(query: string): ConceptEntry[] {
    if (!this.currentIndex) return [];

    const normalizedQuery = this.normalizeLabel(query);
    const results: ConceptEntry[] = [];

    for (const [label, entry] of this.currentIndex.concepts) {
      if (label.includes(normalizedQuery) || entry.label.toLowerCase().includes(query.toLowerCase())) {
        results.push(entry);
      }
    }

    return results.sort((a, b) => b.totalCount - a.totalCount);
  }

  /**
   * Get concept by label
   */
  getConcept(label: string): ConceptEntry | undefined {
    if (!this.currentIndex) return undefined;
    return this.currentIndex.concepts.get(this.normalizeLabel(label));
  }

  /**
   * Get files related to a file
   */
  getRelatedFiles(filePath: string): CrossDocumentRelation[] {
    if (!this.currentIndex) return [];

    return this.currentIndex.relations
      .filter(r => r.sourceFile === filePath || r.targetFile === filePath)
      .sort((a, b) => b.relationshipStrength - a.relationshipStrength);
  }

  /**
   * Get top concepts
   */
  getTopConcepts(limit: number = 20): ConceptEntry[] {
    if (!this.currentIndex) return [];

    return Array.from(this.currentIndex.concepts.values())
      .sort((a, b) => b.totalCount - a.totalCount)
      .slice(0, limit);
  }

  /**
   * Get concepts by type
   */
  getConceptsByType(type: TagType): ConceptEntry[] {
    if (!this.currentIndex) return [];

    return Array.from(this.currentIndex.concepts.values())
      .filter(entry => entry.tagTypes.includes(type))
      .sort((a, b) => b.totalCount - a.totalCount);
  }

  /**
   * Get cross-document statistics
   */
  getStatistics(): {
    totalConcepts: number;
    totalOccurrences: number;
    avgOccurrencesPerConcept: number;
    conceptsAppearingMultipleTimes: number;
    conceptsInMultipleFiles: number;
    strongRelationships: number;
    typeBreakdown: Record<string, number>;
  } | null {
    if (!this.currentIndex) return null;

    let totalOccurrences = 0;
    let conceptsAppearingMultipleTimes = 0;
    let conceptsInMultipleFiles = 0;
    const typeBreakdown: Record<string, number> = {};

    for (const entry of this.currentIndex.concepts.values()) {
      totalOccurrences += entry.totalCount;

      if (entry.totalCount > 1) {
        conceptsAppearingMultipleTimes++;
      }

      if (entry.fileCount > 1) {
        conceptsInMultipleFiles++;
      }

      for (const type of entry.tagTypes) {
        typeBreakdown[type] = (typeBreakdown[type] || 0) + 1;
      }
    }

    const strongRelationships = this.currentIndex.relations
      .filter(r => r.relationshipStrength > 0.3).length;

    return {
      totalConcepts: this.currentIndex.metadata.totalConcepts,
      totalOccurrences,
      avgOccurrencesPerConcept: totalOccurrences / this.currentIndex.metadata.totalConcepts,
      conceptsAppearingMultipleTimes,
      conceptsInMultipleFiles,
      strongRelationships,
      typeBreakdown
    };
  }

  /**
   * Export index to JSON
   */
  exportToJSON(): string {
    if (!this.currentIndex) return '{}';

    const exportData = {
      metadata: this.currentIndex.metadata,
      concepts: Object.fromEntries(this.currentIndex.concepts),
      relations: this.currentIndex.relations,
      fileIndex: Object.fromEntries(this.currentIndex.fileIndex)
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Import index from JSON
   */
  importFromJSON(json: string): void {
    const data = JSON.parse(json);

    this.currentIndex = {
      metadata: data.metadata,
      concepts: new Map(Object.entries(data.concepts)),
      relations: data.relations,
      fileIndex: new Map(Object.entries(data.fileIndex))
    };
  }

  /**
   * Clear index
   */
  clearIndex(): void {
    this.currentIndex = null;
  }
}
