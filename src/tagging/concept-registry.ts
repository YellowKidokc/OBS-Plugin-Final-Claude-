/**
 * Concept Registry
 * Central registry for consistent UUIDs across all documents
 * This is the single source of truth for concept identification
 */

import { Vault } from 'obsidian';
import { TagType } from '../types';
import { generateUUID } from './uuid-generator';

/**
 * Registry entry for a concept
 */
export interface ConceptRegistryEntry {
  uuid: string;
  label: string;
  normalizedLabel: string;
  type: TagType;
  firstSeenFile: string;
  firstSeenDate: string;
  aliases: string[];  // Alternative labels that map to same concept
  metadata?: Record<string, unknown>;
}

/**
 * Registry data structure
 */
export interface ConceptRegistryData {
  version: string;
  lastUpdated: string;
  concepts: Record<string, ConceptRegistryEntry>;  // keyed by normalized label
  uuidIndex: Record<string, string>;  // uuid -> normalized label (reverse lookup)
}

const REGISTRY_FILE = '.obsidian/plugins/obsidian-semantic-ai/concept-registry.json';
const REGISTRY_VERSION = '1.0.0';

/**
 * Concept Registry class
 * Manages the central registry of concepts and their UUIDs
 */
export class ConceptRegistry {
  private vault: Vault;
  private data: ConceptRegistryData;
  private loaded: boolean = false;
  private dirty: boolean = false;

  constructor(vault: Vault) {
    this.vault = vault;
    this.data = this.createEmptyRegistry();
  }

  /**
   * Create empty registry structure
   */
  private createEmptyRegistry(): ConceptRegistryData {
    return {
      version: REGISTRY_VERSION,
      lastUpdated: new Date().toISOString(),
      concepts: {},
      uuidIndex: {}
    };
  }

  /**
   * Normalize a label for consistent matching
   */
  normalizeLabel(label: string): string {
    return label
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')  // Remove special chars except hyphens
      .replace(/\s+/g, ' ')       // Normalize whitespace
      .trim();
  }

  /**
   * Load registry from file
   */
  async load(): Promise<void> {
    try {
      const file = this.vault.getAbstractFileByPath(REGISTRY_FILE);

      if (file) {
        const content = await this.vault.read(file as any);
        this.data = JSON.parse(content);

        // Migration check
        if (!this.data.version || this.data.version !== REGISTRY_VERSION) {
          this.migrateRegistry();
        }
      } else {
        // Create new registry
        this.data = this.createEmptyRegistry();
        await this.save();
      }

      this.loaded = true;
    } catch (error) {
      console.error('Failed to load concept registry:', error);
      this.data = this.createEmptyRegistry();
      this.loaded = true;
    }
  }

  /**
   * Save registry to file
   */
  async save(): Promise<void> {
    if (!this.dirty && this.loaded) return;

    this.data.lastUpdated = new Date().toISOString();
    const content = JSON.stringify(this.data, null, 2);

    try {
      // Ensure directory exists
      const dir = REGISTRY_FILE.substring(0, REGISTRY_FILE.lastIndexOf('/'));
      const dirExists = this.vault.getAbstractFileByPath(dir);

      if (!dirExists) {
        await this.vault.createFolder(dir);
      }

      const file = this.vault.getAbstractFileByPath(REGISTRY_FILE);

      if (file) {
        await this.vault.modify(file as any, content);
      } else {
        await this.vault.create(REGISTRY_FILE, content);
      }

      this.dirty = false;
    } catch (error) {
      console.error('Failed to save concept registry:', error);
    }
  }

  /**
   * Migrate registry from older versions
   */
  private migrateRegistry(): void {
    // Future migrations go here
    this.data.version = REGISTRY_VERSION;
    this.dirty = true;
  }

  /**
   * Get or create a UUID for a concept
   * This is the main method - ensures consistent UUIDs
   */
  getOrCreateUUID(label: string, type: TagType, sourceFile: string): string {
    const normalized = this.normalizeLabel(label);

    // Check if concept exists
    if (this.data.concepts[normalized]) {
      return this.data.concepts[normalized].uuid;
    }

    // Check aliases
    for (const [key, entry] of Object.entries(this.data.concepts)) {
      if (entry.aliases.includes(normalized)) {
        return entry.uuid;
      }
    }

    // Create new entry
    const uuid = generateUUID();

    this.data.concepts[normalized] = {
      uuid,
      label,  // Keep original casing
      normalizedLabel: normalized,
      type,
      firstSeenFile: sourceFile,
      firstSeenDate: new Date().toISOString(),
      aliases: []
    };

    this.data.uuidIndex[uuid] = normalized;
    this.dirty = true;

    return uuid;
  }

  /**
   * Get UUID for a concept (returns undefined if not found)
   */
  getUUID(label: string): string | undefined {
    const normalized = this.normalizeLabel(label);
    return this.data.concepts[normalized]?.uuid;
  }

  /**
   * Get concept by UUID
   */
  getByUUID(uuid: string): ConceptRegistryEntry | undefined {
    const normalized = this.data.uuidIndex[uuid];
    if (normalized) {
      return this.data.concepts[normalized];
    }
    return undefined;
  }

  /**
   * Get concept by label
   */
  getByLabel(label: string): ConceptRegistryEntry | undefined {
    const normalized = this.normalizeLabel(label);
    return this.data.concepts[normalized];
  }

  /**
   * Check if concept exists
   */
  exists(label: string): boolean {
    const normalized = this.normalizeLabel(label);
    return !!this.data.concepts[normalized];
  }

  /**
   * Add an alias for a concept
   */
  addAlias(label: string, alias: string): boolean {
    const normalized = this.normalizeLabel(label);
    const normalizedAlias = this.normalizeLabel(alias);

    const entry = this.data.concepts[normalized];
    if (!entry) return false;

    if (!entry.aliases.includes(normalizedAlias)) {
      entry.aliases.push(normalizedAlias);
      this.dirty = true;
    }

    return true;
  }

  /**
   * Merge two concepts (keep first, redirect second)
   */
  mergeConcepts(keepLabel: string, mergeLabel: string): boolean {
    const keepNorm = this.normalizeLabel(keepLabel);
    const mergeNorm = this.normalizeLabel(mergeLabel);

    const keepEntry = this.data.concepts[keepNorm];
    const mergeEntry = this.data.concepts[mergeNorm];

    if (!keepEntry || !mergeEntry) return false;

    // Add merged label as alias
    keepEntry.aliases.push(mergeNorm);
    keepEntry.aliases.push(...mergeEntry.aliases);

    // Remove duplicates
    keepEntry.aliases = [...new Set(keepEntry.aliases)];

    // Update UUID index
    delete this.data.uuidIndex[mergeEntry.uuid];

    // Remove merged entry
    delete this.data.concepts[mergeNorm];

    this.dirty = true;
    return true;
  }

  /**
   * Update concept metadata
   */
  updateMetadata(label: string, metadata: Record<string, unknown>): boolean {
    const normalized = this.normalizeLabel(label);
    const entry = this.data.concepts[normalized];

    if (!entry) return false;

    entry.metadata = { ...entry.metadata, ...metadata };
    this.dirty = true;

    return true;
  }

  /**
   * Get all concepts
   */
  getAllConcepts(): ConceptRegistryEntry[] {
    return Object.values(this.data.concepts);
  }

  /**
   * Get concepts by type
   */
  getConceptsByType(type: TagType): ConceptRegistryEntry[] {
    return Object.values(this.data.concepts).filter(c => c.type === type);
  }

  /**
   * Search concepts
   */
  search(query: string): ConceptRegistryEntry[] {
    const normalizedQuery = this.normalizeLabel(query);

    return Object.values(this.data.concepts).filter(entry => {
      return entry.normalizedLabel.includes(normalizedQuery) ||
             entry.aliases.some(a => a.includes(normalizedQuery));
    });
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    totalConcepts: number;
    byType: Record<string, number>;
    withAliases: number;
    lastUpdated: string;
  } {
    const byType: Record<string, number> = {};
    let withAliases = 0;

    for (const entry of Object.values(this.data.concepts)) {
      byType[entry.type] = (byType[entry.type] || 0) + 1;
      if (entry.aliases.length > 0) withAliases++;
    }

    return {
      totalConcepts: Object.keys(this.data.concepts).length,
      byType,
      withAliases,
      lastUpdated: this.data.lastUpdated
    };
  }

  /**
   * Export registry to JSON string
   */
  exportJSON(): string {
    return JSON.stringify(this.data, null, 2);
  }

  /**
   * Import registry from JSON string (merges with existing)
   */
  importJSON(json: string, overwrite: boolean = false): number {
    const imported: ConceptRegistryData = JSON.parse(json);
    let count = 0;

    for (const [key, entry] of Object.entries(imported.concepts)) {
      if (overwrite || !this.data.concepts[key]) {
        this.data.concepts[key] = entry;
        this.data.uuidIndex[entry.uuid] = key;
        count++;
      }
    }

    this.dirty = true;
    return count;
  }

  /**
   * Clear the registry (dangerous!)
   */
  clear(): void {
    this.data = this.createEmptyRegistry();
    this.dirty = true;
  }

  /**
   * Get raw data (for Python sync)
   */
  getRawData(): ConceptRegistryData {
    return this.data;
  }

  /**
   * Check if registry needs saving
   */
  isDirty(): boolean {
    return this.dirty;
  }
}
