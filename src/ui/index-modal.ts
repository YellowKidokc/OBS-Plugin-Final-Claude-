/**
 * Index Confirmation Modal
 * Shows cost estimate and confirmation before indexing
 */

import { App, Modal, Setting, TFolder, Notice } from 'obsidian';
import { IndexCostEstimate } from '../indexing/vault-indexer';

/**
 * Index Confirmation Modal
 */
export class IndexConfirmationModal extends Modal {
  private indexScope: 'folder' | 'vault';
  private scopePath: string;
  private estimate: IndexCostEstimate;
  private onConfirm: () => void;
  private onCancel: () => void;

  constructor(
    app: App,
    indexScope: 'folder' | 'vault',
    scopePath: string,
    estimate: IndexCostEstimate,
    onConfirm: () => void,
    onCancel: () => void
  ) {
    super(app);
    this.indexScope = indexScope;
    this.scopePath = scopePath;
    this.estimate = estimate;
    this.onConfirm = onConfirm;
    this.onCancel = onCancel;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('semantic-ai-index-modal');

    // Title
    contentEl.createEl('h2', {
      text: this.indexScope === 'vault' ? 'Index Entire Vault' : 'Index Folder'
    });

    // Scope info
    contentEl.createEl('p', {
      text: this.indexScope === 'vault'
        ? 'This will scan all markdown files in your vault.'
        : `This will scan all markdown files in: ${this.scopePath}`
    });

    // Estimate section
    const estimateSection = contentEl.createEl('div', { cls: 'semantic-ai-estimate-section' });
    estimateSection.createEl('h4', { text: 'Estimate' });

    const estimateGrid = estimateSection.createEl('div', { cls: 'semantic-ai-estimate-grid' });

    this.addEstimateItem(estimateGrid, 'Files to scan', String(this.estimate.fileCount));
    this.addEstimateItem(estimateGrid, 'Total characters', this.estimate.totalCharacters.toLocaleString());
    this.addEstimateItem(estimateGrid, 'Estimated tokens', `~${this.estimate.estimatedTokens.toLocaleString()}`);

    // Warning for vault-wide
    if (this.indexScope === 'vault' || this.estimate.fileCount > 50) {
      const warningEl = contentEl.createEl('div', { cls: 'semantic-ai-index-warning' });

      if (this.estimate.warning) {
        warningEl.createEl('p', { text: `⚠️ ${this.estimate.warning}` });
      }

      if (this.indexScope === 'vault') {
        warningEl.createEl('p', {
          text: '💡 Tip: Consider indexing specific folders instead for faster results and lower costs.'
        });
      }

      // Cost disclaimer
      warningEl.createEl('p', {
        cls: 'semantic-ai-cost-note',
        text: 'Note: Indexing reads existing tags from files. No AI API calls are made during indexing - it only scans what you\'ve already classified.'
      });
    }

    // What this does
    const infoSection = contentEl.createEl('div', { cls: 'semantic-ai-index-info' });
    infoSection.createEl('h4', { text: 'What this does:' });

    const infoList = infoSection.createEl('ul');
    infoList.createEl('li', { text: 'Scans all tagged notes in the selected scope' });
    infoList.createEl('li', { text: 'Builds a cross-reference index of all concepts' });
    infoList.createEl('li', { text: 'Tracks where each concept appears' });
    infoList.createEl('li', { text: 'Finds relationships between documents' });
    infoList.createEl('li', { text: 'Identifies concepts that span multiple files' });

    // Actions
    const actionsEl = contentEl.createEl('div', { cls: 'semantic-ai-actions' });

    const cancelBtn = actionsEl.createEl('button', { text: 'Cancel' });
    cancelBtn.onclick = () => {
      this.onCancel();
      this.close();
    };

    const confirmBtn = actionsEl.createEl('button', {
      cls: 'mod-cta',
      text: this.indexScope === 'vault' ? 'Index Vault' : 'Index Folder'
    });
    confirmBtn.onclick = () => {
      this.onConfirm();
      this.close();
    };
  }

  private addEstimateItem(container: HTMLElement, label: string, value: string): void {
    const item = container.createEl('div', { cls: 'semantic-ai-estimate-item' });
    item.createEl('span', { cls: 'semantic-ai-estimate-label', text: label });
    item.createEl('span', { cls: 'semantic-ai-estimate-value', text: value });
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * Index Progress Modal
 */
export class IndexProgressModal extends Modal {
  private progressEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private currentFileEl: HTMLElement | null = null;
  private progressBar: HTMLElement | null = null;

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('semantic-ai-progress-modal');

    contentEl.createEl('h2', { text: 'Building Index...' });

    this.statusEl = contentEl.createEl('p', { cls: 'semantic-ai-progress-status' });
    this.statusEl.textContent = 'Starting...';

    // Progress bar
    const progressContainer = contentEl.createEl('div', { cls: 'semantic-ai-progress-bar-container' });
    this.progressBar = progressContainer.createEl('div', { cls: 'semantic-ai-progress-bar' });
    this.progressBar.style.width = '0%';

    this.currentFileEl = contentEl.createEl('p', {
      cls: 'semantic-ai-current-file',
      text: ''
    });

    this.progressEl = contentEl.createEl('div', { cls: 'semantic-ai-progress-log' });
  }

  /**
   * Update progress
   */
  updateProgress(current: number, total: number, fileName: string): void {
    const percent = Math.round((current / total) * 100);

    if (this.statusEl) {
      this.statusEl.textContent = `Processing ${current} of ${total} files (${percent}%)`;
    }

    if (this.progressBar) {
      this.progressBar.style.width = `${percent}%`;
    }

    if (this.currentFileEl) {
      this.currentFileEl.textContent = `Current: ${fileName}`;
    }
  }

  /**
   * Mark as complete
   */
  complete(stats: { files: number; concepts: number; relations: number; timeMs: number }): void {
    if (this.statusEl) {
      this.statusEl.textContent = '✅ Index complete!';
    }

    if (this.progressBar) {
      this.progressBar.style.width = '100%';
      this.progressBar.addClass('complete');
    }

    if (this.currentFileEl) {
      this.currentFileEl.textContent = '';
    }

    // Show stats
    const statsEl = this.contentEl.createEl('div', { cls: 'semantic-ai-index-stats' });
    statsEl.createEl('p', { text: `📁 Files indexed: ${stats.files}` });
    statsEl.createEl('p', { text: `🏷️ Concepts found: ${stats.concepts}` });
    statsEl.createEl('p', { text: `🔗 Relationships: ${stats.relations}` });
    statsEl.createEl('p', { text: `⏱️ Time: ${(stats.timeMs / 1000).toFixed(2)}s` });

    // Close button
    const closeBtn = this.contentEl.createEl('button', {
      cls: 'mod-cta',
      text: 'View Results'
    });
    closeBtn.onclick = () => this.close();
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * Folder Selection Modal
 */
export class FolderSelectionModal extends Modal {
  private folders: TFolder[];
  private onSelect: (folder: TFolder) => void;

  constructor(app: App, folders: TFolder[], onSelect: (folder: TFolder) => void) {
    super(app);
    this.folders = folders;
    this.onSelect = onSelect;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('semantic-ai-folder-modal');

    contentEl.createEl('h2', { text: 'Select Folder to Index' });
    contentEl.createEl('p', { text: 'Choose a folder to build a concept index:' });

    const folderList = contentEl.createEl('div', { cls: 'semantic-ai-folder-list' });

    // Sort folders by path
    const sortedFolders = [...this.folders].sort((a, b) => a.path.localeCompare(b.path));

    for (const folder of sortedFolders) {
      const folderItem = folderList.createEl('button', {
        cls: 'semantic-ai-folder-item',
        text: folder.path || '/ (Root)'
      });

      folderItem.onclick = () => {
        this.onSelect(folder);
        this.close();
      };
    }

    // Cancel button
    const cancelBtn = contentEl.createEl('button', {
      cls: 'semantic-ai-cancel-btn',
      text: 'Cancel'
    });
    cancelBtn.onclick = () => this.close();
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
