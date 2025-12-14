/**
 * Mermaid View Component
 * Generates and displays Mermaid.js diagrams from semantic tags
 */

import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';
import { SemanticTag, TagType, SemanticAISettings } from '../types';
import { buildTagHierarchy } from '../tagging/tag-writer';

export const MERMAID_VIEW_TYPE = 'semantic-ai-mermaid-view';

/**
 * Mermaid View for displaying semantic graphs
 */
export class MermaidView extends ItemView {
  private settings: SemanticAISettings;
  private currentTags: SemanticTag[] = [];
  private currentFilePath: string = '';

  constructor(leaf: WorkspaceLeaf, settings: SemanticAISettings) {
    super(leaf);
    this.settings = settings;
  }

  getViewType(): string {
    return MERMAID_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Semantic Graph';
  }

  getIcon(): string {
    return 'git-branch';
  }

  /**
   * Update settings reference
   */
  updateSettings(settings: SemanticAISettings): void {
    this.settings = settings;
    this.refresh();
  }

  /**
   * Set tags to display
   */
  setTags(tags: SemanticTag[], filePath: string): void {
    this.currentTags = tags;
    this.currentFilePath = filePath;
    this.refresh();
  }

  /**
   * Clear the view
   */
  clear(): void {
    this.currentTags = [];
    this.currentFilePath = '';
    this.refresh();
  }

  /**
   * Refresh the view
   */
  refresh(): void {
    const container = this.containerEl.children[1];
    container.empty();

    if (this.currentTags.length === 0) {
      container.createEl('div', {
        cls: 'semantic-ai-empty-state',
        text: 'No semantic tags found. Run AI Classifier to analyze a note.'
      });
      return;
    }

    this.renderView(container as HTMLElement);
  }

  /**
   * Render the complete view
   */
  private renderView(container: HTMLElement): void {
    // Header with copy button
    const header = container.createEl('div', { cls: 'semantic-ai-header' });
    const headerRow = header.createEl('div', { cls: 'semantic-ai-header-row' });
    headerRow.createEl('h4', { text: `Semantic Map: ${this.currentFilePath.split('/').pop()}` });

    // Copy All button
    const copyBtn = headerRow.createEl('button', {
      cls: 'semantic-ai-copy-btn',
      text: '📋 Copy All'
    });
    copyBtn.addEventListener('click', () => this.copyAllContent());

    // Summary
    const summary = container.createEl('div', { cls: 'semantic-ai-summary' });
    this.renderSummary(summary);

    // Mermaid diagram
    const diagramContainer = container.createEl('div', { cls: 'semantic-ai-diagram' });
    this.renderMermaid(diagramContainer);

    // Tag list
    const tagList = container.createEl('div', { cls: 'semantic-ai-tag-list' });
    this.renderTagList(tagList);
  }

  /**
   * Copy all content to clipboard
   */
  private async copyAllContent(): Promise<void> {
    const fileName = this.currentFilePath.split('/').pop() || 'Unknown';

    // Build tag summary
    const counts: Record<string, number> = {};
    for (const tag of this.currentTags) {
      const key = tag.customType || tag.type;
      counts[key] = (counts[key] || 0) + 1;
    }

    const summaryLines = Object.entries(counts)
      .map(([type, count]) => `  ${type}: ${count}`)
      .join('\n');

    // Build tag details
    const tagDetails = this.currentTags
      .map(tag => `- [${tag.type}] ${tag.label} (${tag.uuid.slice(0, 8)})`)
      .join('\n');

    // Get Mermaid code
    const mermaidCode = this.generateMermaid();

    // Build full output
    const output = `# Semantic Map: ${fileName}

## Summary
${summaryLines}

## Tags (${this.currentTags.length} total)
${tagDetails}

## Mermaid Diagram
\`\`\`mermaid
${mermaidCode}
\`\`\`
`;

    try {
      await navigator.clipboard.writeText(output);
      new Notice('Copied to clipboard!');
    } catch (error) {
      new Notice('Failed to copy to clipboard');
      console.error('Copy failed:', error);
    }
  }

  /**
   * Render summary of tags
   */
  private renderSummary(container: HTMLElement): void {
    const counts: Record<string, number> = {};

    for (const tag of this.currentTags) {
      const key = tag.customType || tag.type;
      counts[key] = (counts[key] || 0) + 1;
    }

    const summaryList = container.createEl('div', { cls: 'semantic-ai-summary-grid' });

    for (const [type, count] of Object.entries(counts)) {
      const item = summaryList.createEl('div', { cls: 'semantic-ai-summary-item' });
      item.createEl('span', { cls: 'semantic-ai-count', text: String(count) });
      item.createEl('span', { cls: 'semantic-ai-type', text: type });
    }
  }

  /**
   * Render Mermaid diagram
   */
  private renderMermaid(container: HTMLElement): void {
    const mermaidCode = this.generateMermaid();

    // Create a code block for Mermaid rendering
    const pre = container.createEl('pre', { cls: 'mermaid' });
    pre.textContent = mermaidCode;

    // Also show raw code toggle
    const toggleBtn = container.createEl('button', {
      cls: 'semantic-ai-toggle-code',
      text: 'Show Code'
    });

    const codeBlock = container.createEl('pre', {
      cls: 'semantic-ai-code hidden'
    });
    codeBlock.createEl('code', { text: mermaidCode });

    toggleBtn.onclick = () => {
      codeBlock.classList.toggle('hidden');
      toggleBtn.textContent = codeBlock.classList.contains('hidden') ? 'Show Code' : 'Hide Code';
    };
  }

  /**
   * Render tag list with hierarchy
   */
  private renderTagList(container: HTMLElement): void {
    container.createEl('h5', { text: 'Tag Details' });

    const hierarchy = buildTagHierarchy(this.currentTags);
    const rootTags = hierarchy.get('root') || [];

    const list = container.createEl('ul', { cls: 'semantic-ai-tag-tree' });
    this.renderTagLevel(list, rootTags, hierarchy);
  }

  /**
   * Recursively render tag hierarchy
   */
  private renderTagLevel(
    container: HTMLElement,
    tags: SemanticTag[],
    hierarchy: Map<string, SemanticTag[]>
  ): void {
    for (const tag of tags) {
      const item = container.createEl('li', { cls: `semantic-ai-tag-item tag-${tag.type.toLowerCase()}` });

      const badge = item.createEl('span', {
        cls: 'semantic-ai-tag-badge',
        text: tag.type
      });
      badge.setAttribute('data-type', tag.type);

      item.createEl('span', {
        cls: 'semantic-ai-tag-label',
        text: tag.label
      });

      item.createEl('span', {
        cls: 'semantic-ai-tag-uuid',
        text: tag.uuid.slice(0, 8)
      });

      // Render children
      const children = hierarchy.get(tag.uuid);
      if (children && children.length > 0) {
        const childList = item.createEl('ul');
        this.renderTagLevel(childList, children, hierarchy);
      }
    }
  }

  /**
   * Generate Mermaid diagram code
   */
  generateMermaid(): string {
    const direction = this.settings.graphDirection || 'TD';
    const lines: string[] = [`graph ${direction}`];

    // Create node definitions
    const nodeIds = new Map<string, string>();

    this.currentTags.forEach((tag, index) => {
      const nodeId = `n${index}`;
      nodeIds.set(tag.uuid, nodeId);

      const label = this.escapeLabel(tag.label);
      const shape = this.getShapeForType(tag.type);

      lines.push(`  ${nodeId}${shape.open}"${tag.type}: ${label}"${shape.close}`);
    });

    // Create edges based on parent relationships
    for (const tag of this.currentTags) {
      if (tag.parentUuid && nodeIds.has(tag.parentUuid)) {
        const parentId = nodeIds.get(tag.parentUuid);
        const childId = nodeIds.get(tag.uuid);
        lines.push(`  ${parentId} --> ${childId}`);
      }
    }

    // Create relationship edges between related types
    const axioms = this.currentTags.filter(t => t.type === 'Axiom');
    const claims = this.currentTags.filter(t => t.type === 'Claim');
    const evidence = this.currentTags.filter(t => t.type === 'EvidenceBundle');

    // Connect axioms to claims (if no explicit parent)
    for (const claim of claims) {
      if (!claim.parentUuid && axioms.length > 0) {
        const axiomId = nodeIds.get(axioms[0].uuid);
        const claimId = nodeIds.get(claim.uuid);
        if (axiomId && claimId) {
          lines.push(`  ${axiomId} -.-> ${claimId}`);
        }
      }
    }

    // Connect evidence to claims (if no explicit parent)
    for (const ev of evidence) {
      if (!ev.parentUuid && claims.length > 0) {
        const claimId = nodeIds.get(claims[0].uuid);
        const evId = nodeIds.get(ev.uuid);
        if (claimId && evId) {
          lines.push(`  ${claimId} -.-> ${evId}`);
        }
      }
    }

    // Add styling
    lines.push('');
    lines.push('  %% Styling');
    lines.push('  classDef axiom fill:#e1f5fe,stroke:#01579b');
    lines.push('  classDef claim fill:#fff3e0,stroke:#e65100');
    lines.push('  classDef evidence fill:#e8f5e9,stroke:#1b5e20');
    lines.push('  classDef relationship fill:#f3e5f5,stroke:#4a148c');
    lines.push('  classDef process fill:#fce4ec,stroke:#880e4f');
    lines.push('  classDef link fill:#e0f7fa,stroke:#006064');
    lines.push('  classDef name fill:#fff8e1,stroke:#ff6f00');
    lines.push('  classDef ontology fill:#efebe9,stroke:#3e2723');

    // Apply classes
    for (const tag of this.currentTags) {
      const nodeId = nodeIds.get(tag.uuid);
      const className = this.getClassForType(tag.type);
      if (nodeId && className) {
        lines.push(`  class ${nodeId} ${className}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Get Mermaid shape for tag type
   */
  private getShapeForType(type: TagType): { open: string; close: string } {
    switch (type) {
      case 'Axiom':
        return { open: '([', close: '])' }; // Stadium shape
      case 'Claim':
        return { open: '[', close: ']' }; // Rectangle
      case 'EvidenceBundle':
        return { open: '[(', close: ')]' }; // Cylinder
      case 'ScientificProcess':
        return { open: '{{', close: '}}' }; // Hexagon
      case 'Relationship':
        return { open: '>', close: ']' }; // Asymmetric
      case 'InternalLink':
      case 'ExternalLink':
      case 'ForwardLink':
        return { open: '((', close: '))' }; // Circle
      case 'ProperName':
        return { open: '[[', close: ']]' }; // Subroutine
      case 'WordOntology':
        return { open: '{', close: '}' }; // Rhombus
      default:
        return { open: '[', close: ']' };
    }
  }

  /**
   * Get CSS class for tag type
   */
  private getClassForType(type: TagType): string {
    const classMap: Partial<Record<TagType, string>> = {
      Axiom: 'axiom',
      Claim: 'claim',
      EvidenceBundle: 'evidence',
      Relationship: 'relationship',
      ScientificProcess: 'process',
      InternalLink: 'link',
      ExternalLink: 'link',
      ForwardLink: 'link',
      ProperName: 'name',
      WordOntology: 'ontology'
    };

    return classMap[type] || '';
  }

  /**
   * Escape label for Mermaid
   */
  private escapeLabel(label: string): string {
    return label
      .replace(/"/g, "'")
      .replace(/\[/g, '(')
      .replace(/\]/g, ')')
      .replace(/\{/g, '(')
      .replace(/\}/g, ')')
      .slice(0, 50) + (label.length > 50 ? '...' : '');
  }

  async onOpen(): Promise<void> {
    this.refresh();
  }

  async onClose(): Promise<void> {
    // Cleanup if needed
  }
}

/**
 * Generate Mermaid code string (utility function for embedding in notes)
 */
export function generateMermaidForNote(
  tags: SemanticTag[],
  direction: 'TD' | 'LR' | 'BT' | 'RL' = 'TD'
): string {
  if (tags.length === 0) {
    return '';
  }

  const tempView = {
    settings: { graphDirection: direction },
    currentTags: tags,
    escapeLabel: (label: string) => label
      .replace(/"/g, "'")
      .replace(/\[/g, '(')
      .replace(/\]/g, ')')
      .slice(0, 50),
    getShapeForType: (type: TagType) => ({ open: '[', close: ']' }),
    getClassForType: () => ''
  };

  // Build the mermaid graph
  const lines: string[] = [`graph ${direction}`];
  const nodeIds = new Map<string, string>();

  tags.forEach((tag, index) => {
    const nodeId = `n${index}`;
    nodeIds.set(tag.uuid, nodeId);
    const label = tempView.escapeLabel(tag.label);
    lines.push(`  ${nodeId}["${tag.type}: ${label}"]`);
  });

  for (const tag of tags) {
    if (tag.parentUuid && nodeIds.has(tag.parentUuid)) {
      const parentId = nodeIds.get(tag.parentUuid);
      const childId = nodeIds.get(tag.uuid);
      lines.push(`  ${parentId} --> ${childId}`);
    }
  }

  return lines.join('\n');
}

/**
 * Create Mermaid code block for embedding in notes
 */
export function createMermaidCodeBlock(tags: SemanticTag[], direction?: 'TD' | 'LR' | 'BT' | 'RL'): string {
  const mermaidCode = generateMermaidForNote(tags, direction);

  if (!mermaidCode) {
    return '';
  }

  return `\n\n\`\`\`mermaid\n${mermaidCode}\n\`\`\`\n`;
}
