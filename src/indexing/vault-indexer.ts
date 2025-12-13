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
 * Vault Indexer class
 */
export class VaultIndexer {
  private vault: Vault;
  private currentIndex: VaultIndex | null = null;

  constructor(vault: Vault) {
    this.vault = vault;
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
   * Get markdown files in scope
   */
  private getFilesInScope(scope: 'folder' | 'vault', folderPath?: string): TFile[] {
    const allFiles = this.vault.getMarkdownFiles();

    if (scope === 'vault') {
      return allFiles;
    }

    if (scope === 'folder' && folderPath) {
      return allFiles.filter(f => f.path.startsWith(folderPath));
    }

    return allFiles;
  }

  /**
   * Build index for folder or vault
   */
  async buildIndex(
    scope: 'folder' | 'vault',
    folderPath?: string,
    onProgress?: (current: number, total: number, fileName: string) => void
  ): Promise<VaultIndex> {
    const startTime = Date.now();
    const files = this.getFilesInScope(scope, folderPath);

    const concepts = new Map<string, ConceptEntry>();
    const fileIndex = new Map<string, SemanticTag[]>();
    const relations: CrossDocumentRelation[] = [];

    let totalTags = 0;

    // Process each file
    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      if (onProgress) {
        onProgress(i + 1, files.length, file.name);
      }

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
    }

    // Build cross-document relations
    const fileConceptMap = new Map<string, Set<string>>();

    for (const [filePath, tags] of fileIndex) {
      const conceptsInFile = new Set(tags.map(t => this.normalizeLabel(t.label)));
      fileConceptMap.set(filePath, conceptsInFile);
    }

    // Find relationships between files
    const filePaths = Array.from(fileConceptMap.keys());
    for (let i = 0; i < filePaths.length; i++) {
      for (let j = i + 1; j < filePaths.length; j++) {
        const file1 = filePaths[i];
        const file2 = filePaths[j];
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
    }

    // Find related concepts (concepts that appear in same files)
    for (const [label, entry] of concepts) {
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

      entry.relatedConcepts = Array.from(related).slice(0, 20); // Limit to 20
    }

    const processingTimeMs = Date.now() - startTime;

    const metadata: IndexMetadata = {
      lastUpdated: new Date().toISOString(),
      scope,
      scopePath: folderPath || '/',
      totalFiles: files.length,
      totalTags,
      totalConcepts: concepts.size,
      processingTimeMs
    };

    this.currentIndex = {
      metadata,
      concepts,
      relations,
      fileIndex
    };

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
