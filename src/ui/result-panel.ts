/**
 * Result Panel Component
 * Displays classification results and batch processing status
 */

import { Modal, App, Setting, TFile } from 'obsidian';
import { ClassificationResult, BatchResult, SemanticTag, TagType, TokenEstimate } from '../types';
import { getTagCounts } from '../tagging/tag-writer';

/**
 * Classification Result Modal
 * Shows results after AI classification
 */
export class ClassificationResultModal extends Modal {
  private result: ClassificationResult;
  private filePath: string;
  private onConfirm: () => void;
  private onCancel: () => void;

  constructor(
    app: App,
    result: ClassificationResult,
    filePath: string,
    onConfirm: () => void,
    onCancel: () => void
  ) {
    super(app);
    this.result = result;
    this.filePath = filePath;
    this.onConfirm = onConfirm;
    this.onCancel = onCancel;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('semantic-ai-result-modal');

    contentEl.createEl('h2', { text: 'Classification Results' });
    contentEl.createEl('p', {
      cls: 'semantic-ai-file-path',
      text: `File: ${this.filePath}`
    });

    // Summary
    const counts = getTagCounts(this.result.tags);
    const summaryEl = contentEl.createEl('div', { cls: 'semantic-ai-result-summary' });

    summaryEl.createEl('h4', { text: `Found ${this.result.tags.length} semantic elements:` });

    const countsList = summaryEl.createEl('ul');
    for (const [type, count] of Object.entries(counts)) {
      countsList.createEl('li', { text: `${type}: ${count}` });
    }

    // Tag preview
    if (this.result.tags.length > 0) {
      const previewEl = contentEl.createEl('div', { cls: 'semantic-ai-tag-preview' });
      previewEl.createEl('h4', { text: 'Tags Preview:' });

      const previewList = previewEl.createEl('div', { cls: 'semantic-ai-preview-list' });

      for (const tag of this.result.tags.slice(0, 10)) {
        const tagEl = previewList.createEl('div', { cls: 'semantic-ai-preview-tag' });
        tagEl.createEl('span', {
          cls: `semantic-ai-tag-type type-${tag.type.toLowerCase()}`,
          text: tag.type
        });
        tagEl.createEl('span', {
          cls: 'semantic-ai-tag-label',
          text: tag.label
        });
      }

      if (this.result.tags.length > 10) {
        previewList.createEl('p', {
          cls: 'semantic-ai-more',
          text: `... and ${this.result.tags.length - 10} more`
        });
      }
    }

    // Actions
    const actionsEl = contentEl.createEl('div', { cls: 'semantic-ai-actions' });

    const cancelBtn = actionsEl.createEl('button', { text: 'Cancel' });
    cancelBtn.onclick = () => {
      this.onCancel();
      this.close();
    };

    const confirmBtn = actionsEl.createEl('button', {
      cls: 'mod-cta',
      text: 'Apply Tags'
    });
    confirmBtn.onclick = () => {
      this.onConfirm();
      this.close();
    };
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * Batch Processing Modal
 * Shows progress and results for batch classification
 */
export class BatchProcessingModal extends Modal {
  private files: TFile[];
  private estimate: TokenEstimate;
  private onConfirm: () => void;
  private onCancel: () => void;
  private progressEl: HTMLElement | null = null;
  private resultsEl: HTMLElement | null = null;
  private isProcessing: boolean = false;

  constructor(
    app: App,
    files: TFile[],
    estimate: TokenEstimate,
    onConfirm: () => void,
    onCancel: () => void
  ) {
    super(app);
    this.files = files;
    this.estimate = estimate;
    this.onConfirm = onConfirm;
    this.onCancel = onCancel;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('semantic-ai-batch-modal');

    contentEl.createEl('h2', { text: 'Batch Classification' });

    // File summary
    const summaryEl = contentEl.createEl('div', { cls: 'semantic-ai-batch-summary' });
    summaryEl.createEl('p', { text: `Files to process: ${this.files.length}` });

    // Token estimate
    const estimateEl = contentEl.createEl('div', { cls: 'semantic-ai-estimate' });
    estimateEl.createEl('h4', { text: 'Estimated Cost:' });

    const estimateList = estimateEl.createEl('ul');
    estimateList.createEl('li', { text: `Input tokens: ~${this.estimate.inputTokens.toLocaleString()}` });
    estimateList.createEl('li', { text: `Output tokens: ~${this.estimate.estimatedOutputTokens.toLocaleString()}` });
    estimateList.createEl('li', {
      text: `Estimated cost: $${this.estimate.estimatedCost.toFixed(4)}`
    });

    // File list
    const fileListEl = contentEl.createEl('div', { cls: 'semantic-ai-file-list' });
    fileListEl.createEl('h4', { text: 'Files:' });

    const list = fileListEl.createEl('ul');
    for (const file of this.files.slice(0, 20)) {
      list.createEl('li', { text: file.path });
    }
    if (this.files.length > 20) {
      list.createEl('li', {
        cls: 'semantic-ai-more',
        text: `... and ${this.files.length - 20} more`
      });
    }

    // Progress section (hidden initially)
    this.progressEl = contentEl.createEl('div', {
      cls: 'semantic-ai-progress hidden'
    });
    this.progressEl.createEl('h4', { text: 'Progress:' });

    this.resultsEl = this.progressEl.createEl('div', {
      cls: 'semantic-ai-progress-results'
    });

    // Actions
    const actionsEl = contentEl.createEl('div', { cls: 'semantic-ai-actions' });

    const cancelBtn = actionsEl.createEl('button', { text: 'Cancel' });
    cancelBtn.onclick = () => {
      if (!this.isProcessing) {
        this.onCancel();
        this.close();
      }
    };

    const confirmBtn = actionsEl.createEl('button', {
      cls: 'mod-cta',
      text: 'Start Processing'
    });
    confirmBtn.onclick = () => {
      if (!this.isProcessing) {
        this.isProcessing = true;
        this.progressEl?.removeClass('hidden');
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Processing...';
        this.onConfirm();
      }
    };
  }

  /**
   * Update progress display
   */
  updateProgress(file: string, status: string, counts?: Record<string, number>): void {
    if (!this.resultsEl) return;

    const itemEl = this.resultsEl.createEl('div', { cls: 'semantic-ai-progress-item' });

    const statusIcon = status === 'complete' ? '✅' : status === 'processing' ? '📄' : '❌';
    itemEl.createEl('span', { text: statusIcon });

    itemEl.createEl('span', {
      cls: 'semantic-ai-progress-file',
      text: file.split('/').pop() || file
    });

    if (status === 'complete' && counts) {
      const countsText = Object.entries(counts)
        .map(([type, count]) => `${count} ${type}`)
        .join(', ');

      itemEl.createEl('span', {
        cls: 'semantic-ai-progress-counts',
        text: countsText
      });
    } else if (status !== 'complete' && status !== 'processing') {
      itemEl.createEl('span', {
        cls: 'semantic-ai-progress-error',
        text: status
      });
    }

    // Auto-scroll
    this.resultsEl.scrollTop = this.resultsEl.scrollHeight;
  }

  /**
   * Mark processing as complete
   */
  complete(totalTags: number): void {
    this.isProcessing = false;

    if (this.progressEl) {
      this.progressEl.createEl('div', {
        cls: 'semantic-ai-complete',
        text: `✨ Processing complete! Total tags created: ${totalTags}`
      });
    }

    // Update button
    const confirmBtn = this.contentEl.querySelector('.mod-cta');
    if (confirmBtn) {
      confirmBtn.textContent = 'Done';
      (confirmBtn as HTMLButtonElement).disabled = false;
      (confirmBtn as HTMLButtonElement).onclick = () => this.close();
    }
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * Token Estimate Modal
 * Shows cost estimate before processing
 */
export class TokenEstimateModal extends Modal {
  private estimate: TokenEstimate;
  private fileCount: number;
  private onConfirm: () => void;
  private onCancel: () => void;

  constructor(
    app: App,
    estimate: TokenEstimate,
    fileCount: number,
    onConfirm: () => void,
    onCancel: () => void
  ) {
    super(app);
    this.estimate = estimate;
    this.fileCount = fileCount;
    this.onConfirm = onConfirm;
    this.onCancel = onCancel;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('semantic-ai-estimate-modal');

    contentEl.createEl('h2', { text: 'Cost Estimate' });

    const infoEl = contentEl.createEl('div', { cls: 'semantic-ai-estimate-info' });

    new Setting(infoEl)
      .setName('Files to process')
      .setDesc(String(this.fileCount));

    new Setting(infoEl)
      .setName('Estimated input tokens')
      .setDesc(`~${this.estimate.inputTokens.toLocaleString()}`);

    new Setting(infoEl)
      .setName('Estimated output tokens')
      .setDesc(`~${this.estimate.estimatedOutputTokens.toLocaleString()}`);

    new Setting(infoEl)
      .setName('Estimated cost')
      .setDesc(`$${this.estimate.estimatedCost.toFixed(4)}`);

    contentEl.createEl('p', {
      cls: 'semantic-ai-estimate-note',
      text: 'Note: Actual costs may vary based on content complexity and model response.'
    });

    // Actions
    const actionsEl = contentEl.createEl('div', { cls: 'semantic-ai-actions' });

    const cancelBtn = actionsEl.createEl('button', { text: 'Cancel' });
    cancelBtn.onclick = () => {
      this.onCancel();
      this.close();
    };

    const confirmBtn = actionsEl.createEl('button', {
      cls: 'mod-cta',
      text: 'Proceed'
    });
    confirmBtn.onclick = () => {
      this.onConfirm();
      this.close();
    };
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * Tag Selection Modal
 * Allows user to select which tag types to classify
 */
export class TagSelectionModal extends Modal {
  private selectedTypes: Set<TagType>;
  private onConfirm: (types: TagType[]) => void;
  private onCancel: () => void;

  private allTypes: TagType[] = [
    'Axiom', 'Claim', 'EvidenceBundle', 'ScientificProcess',
    'Relationship', 'InternalLink', 'ExternalLink', 'ProperName',
    'ForwardLink', 'WordOntology', 'Sentence', 'Paragraph'
  ];

  constructor(
    app: App,
    defaultTypes: TagType[],
    onConfirm: (types: TagType[]) => void,
    onCancel: () => void
  ) {
    super(app);
    this.selectedTypes = new Set(defaultTypes);
    this.onConfirm = onConfirm;
    this.onCancel = onCancel;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('semantic-ai-selection-modal');

    contentEl.createEl('h2', { text: 'Select Tag Types' });
    contentEl.createEl('p', { text: 'Choose which semantic elements to identify:' });

    // Type checkboxes
    const typesEl = contentEl.createEl('div', { cls: 'semantic-ai-type-selection' });

    for (const type of this.allTypes) {
      new Setting(typesEl)
        .setName(type)
        .addToggle(toggle => {
          toggle
            .setValue(this.selectedTypes.has(type))
            .onChange(value => {
              if (value) {
                this.selectedTypes.add(type);
              } else {
                this.selectedTypes.delete(type);
              }
            });
        });
    }

    // Quick actions
    const quickEl = contentEl.createEl('div', { cls: 'semantic-ai-quick-actions' });

    const selectAllBtn = quickEl.createEl('button', { text: 'Select All' });
    selectAllBtn.onclick = () => {
      this.selectedTypes = new Set(this.allTypes);
      this.close();
      this.open();
    };

    const selectNoneBtn = quickEl.createEl('button', { text: 'Clear All' });
    selectNoneBtn.onclick = () => {
      this.selectedTypes.clear();
      this.close();
      this.open();
    };

    const academicBtn = quickEl.createEl('button', { text: 'Academic Set' });
    academicBtn.onclick = () => {
      this.selectedTypes = new Set(['Axiom', 'Claim', 'EvidenceBundle', 'Relationship']);
      this.close();
      this.open();
    };

    // Actions
    const actionsEl = contentEl.createEl('div', { cls: 'semantic-ai-actions' });

    const cancelBtn = actionsEl.createEl('button', { text: 'Cancel' });
    cancelBtn.onclick = () => {
      this.onCancel();
      this.close();
    };

    const confirmBtn = actionsEl.createEl('button', {
      cls: 'mod-cta',
      text: 'Classify'
    });
    confirmBtn.onclick = () => {
      if (this.selectedTypes.size === 0) {
        return;
      }
      this.onConfirm(Array.from(this.selectedTypes));
      this.close();
    };
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
