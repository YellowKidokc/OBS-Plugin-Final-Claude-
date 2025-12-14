/**
 * Concept Tracker View
 * Displays cross-document concept index and relationships
 */

import { ItemView, WorkspaceLeaf, TFolder, Menu } from 'obsidian';
import { VaultIndex, ConceptEntry, CrossDocumentRelation } from '../indexing/vault-indexer';
import { TagType } from '../types';

export const CONCEPT_TRACKER_VIEW_TYPE = 'semantic-ai-concept-tracker';

/**
 * Concept Tracker View
 */
export class ConceptTrackerView extends ItemView {
  private index: VaultIndex | null = null;
  private currentView: 'overview' | 'concepts' | 'relations' | 'search' = 'overview';
  private searchQuery: string = '';
  private selectedType: TagType | 'all' = 'all';
  private onNavigateToFile: (filePath: string) => void;

  constructor(leaf: WorkspaceLeaf, onNavigateToFile: (filePath: string) => void) {
    super(leaf);
    this.onNavigateToFile = onNavigateToFile;
  }

  getViewType(): string {
    return CONCEPT_TRACKER_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Concept Tracker';
  }

  getIcon(): string {
    return 'search';
  }

  /**
   * Set the index to display
   */
  setIndex(index: VaultIndex | null): void {
    this.index = index;
    this.refresh();
  }

  /**
   * Refresh the view
   */
  refresh(): void {
    const container = this.containerEl.children[1];
    container.empty();

    if (!this.index) {
      this.renderEmptyState(container as HTMLElement);
      return;
    }

    this.renderView(container as HTMLElement);
  }

  /**
   * Render empty state
   */
  private renderEmptyState(container: HTMLElement): void {
    const empty = container.createEl('div', { cls: 'semantic-ai-empty-state' });
    empty.createEl('h3', { text: 'No Index Built' });
    empty.createEl('p', { text: 'Build an index to track concepts across your notes.' });
    empty.createEl('p', { text: 'Use the command palette:' });

    const commands = empty.createEl('ul');
    commands.createEl('li', { text: '"Index Current Folder" - Index a specific folder' });
    commands.createEl('li', { text: '"Index Entire Vault" - Index all notes (may be expensive)' });
  }

  /**
   * Render main view
   */
  private renderView(container: HTMLElement): void {
    // Header with tabs
    const header = container.createEl('div', { cls: 'semantic-ai-tracker-header' });
    this.renderTabs(header);

    // Content
    const content = container.createEl('div', { cls: 'semantic-ai-tracker-content' });

    switch (this.currentView) {
      case 'overview':
        this.renderOverview(content);
        break;
      case 'concepts':
        this.renderConceptList(content);
        break;
      case 'relations':
        this.renderRelations(content);
        break;
      case 'search':
        this.renderSearch(content);
        break;
    }
  }

  /**
   * Render tab navigation
   */
  private renderTabs(container: HTMLElement): void {
    const tabs = container.createEl('div', { cls: 'semantic-ai-tracker-tabs' });

    const tabItems: { id: 'overview' | 'concepts' | 'relations' | 'search'; label: string; icon: string }[] = [
      { id: 'overview', label: 'Overview', icon: '📊' },
      { id: 'concepts', label: 'Concepts', icon: '🏷️' },
      { id: 'relations', label: 'Relations', icon: '🔗' },
      { id: 'search', label: 'Search', icon: '🔍' }
    ];

    for (const tab of tabItems) {
      const tabEl = tabs.createEl('button', {
        cls: `semantic-ai-tracker-tab ${this.currentView === tab.id ? 'active' : ''}`,
        text: `${tab.icon} ${tab.label}`
      });

      tabEl.onclick = () => {
        this.currentView = tab.id;
        this.refresh();
      };
    }
  }

  /**
   * Render overview tab
   */
  private renderOverview(container: HTMLElement): void {
    if (!this.index) return;

    const meta = this.index.metadata;

    // Index info
    const infoSection = container.createEl('div', { cls: 'semantic-ai-tracker-section' });
    infoSection.createEl('h4', { text: 'Index Information' });

    const infoGrid = infoSection.createEl('div', { cls: 'semantic-ai-info-grid' });

    this.addInfoItem(infoGrid, 'Scope', meta.scope === 'vault' ? 'Entire Vault' : `Folder: ${meta.scopePath}`);
    this.addInfoItem(infoGrid, 'Files Indexed', String(meta.totalFiles));
    this.addInfoItem(infoGrid, 'Total Tags', String(meta.totalTags));
    this.addInfoItem(infoGrid, 'Unique Concepts', String(meta.totalConcepts));
    this.addInfoItem(infoGrid, 'Last Updated', new Date(meta.lastUpdated).toLocaleString());

    if (meta.processingTimeMs) {
      this.addInfoItem(infoGrid, 'Processing Time', `${(meta.processingTimeMs / 1000).toFixed(2)}s`);
    }

    // Top concepts
    const topSection = container.createEl('div', { cls: 'semantic-ai-tracker-section' });
    topSection.createEl('h4', { text: 'Top Concepts (by frequency)' });

    const topConcepts = Array.from(this.index.concepts.values())
      .sort((a, b) => b.totalCount - a.totalCount)
      .slice(0, 10);

    const topList = topSection.createEl('div', { cls: 'semantic-ai-concept-list' });

    for (const concept of topConcepts) {
      this.renderConceptItem(topList, concept);
    }

    // Cross-file concepts
    const crossSection = container.createEl('div', { cls: 'semantic-ai-tracker-section' });
    crossSection.createEl('h4', { text: 'Concepts Appearing in Multiple Files' });

    const crossFileConcepts = Array.from(this.index.concepts.values())
      .filter(c => c.fileCount > 1)
      .sort((a, b) => b.fileCount - a.fileCount)
      .slice(0, 10);

    if (crossFileConcepts.length === 0) {
      crossSection.createEl('p', { cls: 'semantic-ai-muted', text: 'No concepts found in multiple files yet.' });
    } else {
      const crossList = crossSection.createEl('div', { cls: 'semantic-ai-concept-list' });

      for (const concept of crossFileConcepts) {
        this.renderConceptItem(crossList, concept, true);
      }
    }

    // Strong relationships
    const relSection = container.createEl('div', { cls: 'semantic-ai-tracker-section' });
    relSection.createEl('h4', { text: 'Strongly Related Documents' });

    const strongRelations = this.index.relations
      .filter(r => r.relationshipStrength > 0.2)
      .sort((a, b) => b.relationshipStrength - a.relationshipStrength)
      .slice(0, 5);

    if (strongRelations.length === 0) {
      relSection.createEl('p', { cls: 'semantic-ai-muted', text: 'No strong relationships found yet.' });
    } else {
      for (const rel of strongRelations) {
        this.renderRelationItem(relSection, rel);
      }
    }
  }

  /**
   * Render concept list tab
   */
  private renderConceptList(container: HTMLElement): void {
    if (!this.index) return;

    // Filter controls
    const controls = container.createEl('div', { cls: 'semantic-ai-tracker-controls' });

    const typeFilter = controls.createEl('select', { cls: 'semantic-ai-type-filter' });
    typeFilter.createEl('option', { value: 'all', text: 'All Types' });

    const types: TagType[] = ['Axiom', 'Claim', 'EvidenceBundle', 'Relationship', 'ScientificProcess', 'ProperName', 'WordOntology'];
    for (const type of types) {
      typeFilter.createEl('option', { value: type, text: type });
    }

    typeFilter.value = this.selectedType;
    typeFilter.onchange = () => {
      this.selectedType = typeFilter.value as TagType | 'all';
      this.refresh();
    };

    // Concept list
    let concepts = Array.from(this.index.concepts.values());

    if (this.selectedType !== 'all') {
      concepts = concepts.filter(c => c.tagTypes.includes(this.selectedType as TagType));
    }

    concepts.sort((a, b) => b.totalCount - a.totalCount);

    const listContainer = container.createEl('div', { cls: 'semantic-ai-concept-list scrollable' });

    container.createEl('p', {
      cls: 'semantic-ai-count-info',
      text: `Showing ${concepts.length} concepts`
    });

    for (const concept of concepts) {
      this.renderConceptItem(listContainer, concept, true, true);
    }
  }

  /**
   * Render relations tab
   */
  private renderRelations(container: HTMLElement): void {
    if (!this.index) return;

    container.createEl('h4', { text: 'Document Relationships' });
    container.createEl('p', {
      cls: 'semantic-ai-muted',
      text: 'Documents that share concepts are connected. Higher strength = more shared concepts.'
    });

    const relations = this.index.relations
      .sort((a, b) => b.relationshipStrength - a.relationshipStrength);

    if (relations.length === 0) {
      container.createEl('p', { text: 'No relationships found. Try indexing more files.' });
      return;
    }

    container.createEl('p', {
      cls: 'semantic-ai-count-info',
      text: `${relations.length} relationships found`
    });

    const relList = container.createEl('div', { cls: 'semantic-ai-relation-list scrollable' });

    for (const rel of relations.slice(0, 50)) {
      this.renderRelationItem(relList, rel, true);
    }
  }

  /**
   * Render search tab
   */
  private renderSearch(container: HTMLElement): void {
    if (!this.index) return;

    // Search input
    const searchBox = container.createEl('div', { cls: 'semantic-ai-search-box' });

    const input = searchBox.createEl('input', {
      type: 'text',
      placeholder: 'Search concepts...',
      cls: 'semantic-ai-search-input'
    });
    input.value = this.searchQuery;

    input.oninput = () => {
      this.searchQuery = input.value;
      this.renderSearchResults(resultsContainer);
    };

    // Results
    const resultsContainer = container.createEl('div', { cls: 'semantic-ai-search-results scrollable' });
    this.renderSearchResults(resultsContainer);
  }

  /**
   * Render search results
   */
  private renderSearchResults(container: HTMLElement): void {
    container.empty();

    if (!this.index || !this.searchQuery.trim()) {
      container.createEl('p', { cls: 'semantic-ai-muted', text: 'Type to search concepts...' });
      return;
    }

    const query = this.searchQuery.toLowerCase();
    const results = Array.from(this.index.concepts.values())
      .filter(c =>
        c.label.toLowerCase().includes(query) ||
        c.normalizedLabel.includes(query)
      )
      .sort((a, b) => b.totalCount - a.totalCount);

    if (results.length === 0) {
      container.createEl('p', { text: `No results for "${this.searchQuery}"` });
      return;
    }

    container.createEl('p', {
      cls: 'semantic-ai-count-info',
      text: `${results.length} results`
    });

    for (const concept of results) {
      this.renderConceptItem(container, concept, true, true);
    }
  }

  /**
   * Render a concept item
   */
  private renderConceptItem(
    container: HTMLElement,
    concept: ConceptEntry,
    showFileCount: boolean = false,
    expandable: boolean = false
  ): void {
    const item = container.createEl('div', { cls: 'semantic-ai-concept-item' });

    const header = item.createEl('div', { cls: 'semantic-ai-concept-header' });

    // Type badges
    const badges = header.createEl('div', { cls: 'semantic-ai-concept-badges' });
    for (const type of concept.tagTypes.slice(0, 3)) {
      badges.createEl('span', {
        cls: `semantic-ai-badge badge-${type.toLowerCase()}`,
        text: type
      });
    }

    // Label
    header.createEl('span', { cls: 'semantic-ai-concept-label', text: concept.label });

    // Count
    const countText = showFileCount
      ? `${concept.totalCount}× in ${concept.fileCount} files`
      : `${concept.totalCount}×`;

    header.createEl('span', { cls: 'semantic-ai-concept-count', text: countText });

    // Expandable details
    if (expandable) {
      const details = item.createEl('details', { cls: 'semantic-ai-concept-details' });
      details.createEl('summary', { text: 'Show occurrences' });

      const occList = details.createEl('ul', { cls: 'semantic-ai-occurrence-list' });

      for (const occ of concept.occurrences.slice(0, 20)) {
        const occItem = occList.createEl('li');

        const link = occItem.createEl('a', {
          cls: 'semantic-ai-file-link',
          text: occ.fileName
        });
        link.onclick = (e) => {
          e.preventDefault();
          this.onNavigateToFile(occ.filePath);
        };

        occItem.createEl('span', {
          cls: 'semantic-ai-occ-type',
          text: ` (${occ.tagType})`
        });
      }

      if (concept.occurrences.length > 20) {
        occList.createEl('li', {
          cls: 'semantic-ai-more',
          text: `... and ${concept.occurrences.length - 20} more`
        });
      }

      // Related concepts
      if (concept.relatedConcepts.length > 0) {
        const relatedEl = details.createEl('div', { cls: 'semantic-ai-related' });
        relatedEl.createEl('strong', { text: 'Related: ' });
        relatedEl.createEl('span', {
          text: concept.relatedConcepts.slice(0, 10).join(', ')
        });
      }

      // First seen
      details.createEl('p', {
        cls: 'semantic-ai-first-seen',
        text: `First seen in: ${concept.firstSeen.fileName}`
      });
    }
  }

  /**
   * Render a relation item
   */
  private renderRelationItem(
    container: HTMLElement,
    relation: CrossDocumentRelation,
    showConcepts: boolean = false
  ): void {
    const item = container.createEl('div', { cls: 'semantic-ai-relation-item' });

    const strength = Math.round(relation.relationshipStrength * 100);
    const strengthClass = strength > 50 ? 'strong' : strength > 25 ? 'medium' : 'weak';

    // Strength indicator
    item.createEl('span', {
      cls: `semantic-ai-strength ${strengthClass}`,
      text: `${strength}%`
    });

    // Files
    const filesEl = item.createEl('div', { cls: 'semantic-ai-relation-files' });

    const file1 = filesEl.createEl('a', {
      cls: 'semantic-ai-file-link',
      text: relation.sourceFile.split('/').pop()
    });
    file1.onclick = (e) => {
      e.preventDefault();
      this.onNavigateToFile(relation.sourceFile);
    };

    filesEl.createEl('span', { text: ' ↔ ' });

    const file2 = filesEl.createEl('a', {
      cls: 'semantic-ai-file-link',
      text: relation.targetFile.split('/').pop()
    });
    file2.onclick = (e) => {
      e.preventDefault();
      this.onNavigateToFile(relation.targetFile);
    };

    // Shared concepts
    if (showConcepts && relation.sharedConcepts.length > 0) {
      const shared = item.createEl('div', { cls: 'semantic-ai-shared-concepts' });
      shared.createEl('span', { cls: 'semantic-ai-muted', text: 'Shared: ' });
      shared.createEl('span', {
        text: relation.sharedConcepts.slice(0, 5).join(', ')
      });

      if (relation.sharedConcepts.length > 5) {
        shared.createEl('span', {
          cls: 'semantic-ai-more',
          text: ` +${relation.sharedConcepts.length - 5} more`
        });
      }
    }
  }

  /**
   * Add info item to grid
   */
  private addInfoItem(container: HTMLElement, label: string, value: string): void {
    const item = container.createEl('div', { cls: 'semantic-ai-info-item' });
    item.createEl('span', { cls: 'semantic-ai-info-label', text: label });
    item.createEl('span', { cls: 'semantic-ai-info-value', text: value });
  }

  async onOpen(): Promise<void> {
    this.refresh();
  }

  async onClose(): Promise<void> {
    // Cleanup
  }
}
