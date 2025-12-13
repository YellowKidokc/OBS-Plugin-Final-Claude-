/**
 * Obsidian Semantic AI Plugin
 * AI-enhanced semantic plugin with academic-level tagging, visual flow graphs, and metadata management
 */

import {
  App,
  Plugin,
  TFile,
  TFolder,
  Notice,
  MarkdownView,
  Menu,
  Editor,
  WorkspaceLeaf
} from 'obsidian';

import {
  SemanticAISettings,
  DEFAULT_SETTINGS,
  TagType,
  SemanticTag,
  ClassificationResult
} from './types';

import { SemanticAISettingTab } from './settings';
import { PromptManager } from './ai/prompt-manager';
import { AIClassifier, BatchClassifier } from './ai/classifier';
import {
  writeTags,
  readTags,
  parseTags,
  hasTagBlock,
  getContentWithTagVisibility,
  getTagCounts
} from './tagging/tag-writer';
import { MermaidView, MERMAID_VIEW_TYPE, createMermaidCodeBlock } from './ui/mermaid-view';
import {
  ClassificationResultModal,
  BatchProcessingModal,
  TagSelectionModal
} from './ui/result-panel';
import { VaultIndexer } from './indexing/vault-indexer';
import { ConceptTrackerView, CONCEPT_TRACKER_VIEW_TYPE } from './ui/concept-tracker-view';
import {
  IndexConfirmationModal,
  IndexProgressModal,
  FolderSelectionModal
} from './ui/index-modal';

export default class SemanticAIPlugin extends Plugin {
  settings: SemanticAISettings;
  promptManager: PromptManager;
  classifier: AIClassifier;
  vaultIndexer: VaultIndexer;

  async onload(): Promise<void> {
    console.log('Loading Semantic AI plugin');

    // Load settings
    await this.loadSettings();

    // Initialize managers
    this.promptManager = new PromptManager(this.settings);
    this.classifier = new AIClassifier(this.settings, this.promptManager);
    this.vaultIndexer = new VaultIndexer(this.app.vault);

    // Register views
    this.registerView(
      MERMAID_VIEW_TYPE,
      (leaf) => new MermaidView(leaf, this.settings)
    );

    this.registerView(
      CONCEPT_TRACKER_VIEW_TYPE,
      (leaf) => new ConceptTrackerView(leaf, (filePath) => {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
          this.app.workspace.getLeaf().openFile(file);
        }
      })
    );

    // Add settings tab
    this.addSettingTab(new SemanticAISettingTab(this.app, this));

    // Add ribbon icon
    this.addRibbonIcon('brain', 'Semantic AI', (evt: MouseEvent) => {
      this.showSemanticMenu(evt);
    });

    // Register commands
    this.registerCommands();

    // Register context menu
    this.registerContextMenu();

    // Register event handlers
    this.registerEventHandlers();
  }

  async onunload(): Promise<void> {
    console.log('Unloading Semantic AI plugin');
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);

    // Update managers with new settings
    if (this.promptManager) {
      this.promptManager.updateSettings(this.settings);
    }
    if (this.classifier) {
      this.classifier.updateSettings(this.settings);
    }
  }

  /**
   * Register all plugin commands
   */
  private registerCommands(): void {
    // Run AI Classifier
    this.addCommand({
      id: 'run-ai-classifier',
      name: 'Run AI Classifier',
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        await this.runClassifier(view.file);
      }
    });

    // Run classifier with type selection
    this.addCommand({
      id: 'run-ai-classifier-select',
      name: 'Run AI Classifier (Select Types)',
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        await this.runClassifierWithSelection(view.file);
      }
    });

    // Classify as specific type
    this.addCommand({
      id: 'classify-as-axiom',
      name: 'Classify as: Axiom',
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        await this.classifyAs(view.file, 'Axiom');
      }
    });

    this.addCommand({
      id: 'classify-as-claim',
      name: 'Classify as: Claim',
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        await this.classifyAs(view.file, 'Claim');
      }
    });

    this.addCommand({
      id: 'classify-as-evidence',
      name: 'Classify as: Evidence',
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        await this.classifyAs(view.file, 'EvidenceBundle');
      }
    });

    // Show/Hide Hidden Tags
    this.addCommand({
      id: 'toggle-hidden-tags',
      name: 'Toggle Hidden Tags Visibility',
      callback: () => {
        this.settings.showHiddenTags = !this.settings.showHiddenTags;
        this.saveSettings();
        new Notice(`Hidden tags ${this.settings.showHiddenTags ? 'shown' : 'hidden'}`);
      }
    });

    this.addCommand({
      id: 'show-hidden-tags',
      name: 'Show All Hidden Tags',
      callback: () => {
        this.settings.showHiddenTags = true;
        this.saveSettings();
        new Notice('Hidden tags now visible');
      }
    });

    // Open Semantic Map
    this.addCommand({
      id: 'open-semantic-map',
      name: 'Open Semantic Map',
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        await this.openSemanticMap(view.file);
      }
    });

    // Regenerate Semantic Graph
    this.addCommand({
      id: 'regenerate-semantic-graph',
      name: 'Regenerate Semantic Graph',
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        await this.regenerateGraph(view.file);
      }
    });

    // Batch classify folder
    this.addCommand({
      id: 'batch-classify-folder',
      name: 'Batch Classify Folder',
      callback: async () => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
          const folder = activeFile.parent;
          if (folder) {
            await this.batchClassifyFolder(folder);
          }
        }
      }
    });

    // Index current folder
    this.addCommand({
      id: 'index-current-folder',
      name: 'Index Current Folder',
      callback: async () => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && activeFile.parent) {
          await this.indexFolder(activeFile.parent);
        } else {
          new Notice('No folder selected');
        }
      }
    });

    // Index selected folder (opens folder picker)
    this.addCommand({
      id: 'index-select-folder',
      name: 'Index Folder (Select)',
      callback: async () => {
        await this.showFolderSelectionForIndex();
      }
    });

    // Index entire vault
    this.addCommand({
      id: 'index-vault',
      name: 'Index Entire Vault',
      callback: async () => {
        await this.indexVault();
      }
    });

    // Open concept tracker
    this.addCommand({
      id: 'open-concept-tracker',
      name: 'Open Concept Tracker',
      callback: async () => {
        await this.openConceptTracker();
      }
    });

    // Search concepts
    this.addCommand({
      id: 'search-concepts',
      name: 'Search Concepts',
      callback: async () => {
        await this.openConceptTracker();
        // The concept tracker view has a search tab
      }
    });
  }

  /**
   * Register context menu items
   */
  private registerContextMenu(): void {
    // File context menu
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu: Menu, file: TFile | TFolder) => {
        if (file instanceof TFile && file.extension === 'md') {
          menu.addSeparator();

          menu.addItem((item) => {
            item
              .setTitle('Run AI Classifier')
              .setIcon('brain')
              .onClick(async () => {
                await this.runClassifier(file);
              });
          });

          menu.addItem((item) => {
            item
              .setTitle('Open Semantic Map')
              .setIcon('git-branch')
              .onClick(async () => {
                await this.openSemanticMap(file);
              });
          });

          menu.addItem((item) => {
            item
              .setTitle('Show Hidden Tags')
              .setIcon('eye')
              .onClick(async () => {
                this.settings.showHiddenTags = true;
                await this.saveSettings();
                new Notice('Hidden tags now visible');
              });
          });

          // Classify as submenu
          menu.addItem((item) => {
            item
              .setTitle('Classify as...')
              .setIcon('tag')
              .onClick(() => {
                // Show type selection modal
                this.runClassifierWithSelection(file);
              });
          });
        }

        // Folder context menu
        if (file instanceof TFolder) {
          menu.addSeparator();

          menu.addItem((item) => {
            item
              .setTitle('Batch Classify This Folder')
              .setIcon('brain')
              .onClick(async () => {
                await this.batchClassifyFolder(file);
              });
          });

          menu.addItem((item) => {
            item
              .setTitle('Index This Folder')
              .setIcon('search')
              .onClick(async () => {
                await this.indexFolder(file);
              });
          });
        }
      })
    );

    // Editor context menu
    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor, view: MarkdownView) => {
        menu.addSeparator();

        menu.addItem((item) => {
          item
            .setTitle('Run AI Classifier')
            .setIcon('brain')
            .onClick(async () => {
              await this.runClassifier(view.file);
            });
        });

        menu.addItem((item) => {
          item
            .setTitle('Open Semantic Map')
            .setIcon('git-branch')
            .onClick(async () => {
              await this.openSemanticMap(view.file);
            });
        });
      })
    );
  }

  /**
   * Register event handlers
   */
  private registerEventHandlers(): void {
    // Could add file change watchers here for auto-classification
  }

  /**
   * Show semantic menu from ribbon
   */
  private showSemanticMenu(evt: MouseEvent): void {
    const menu = new Menu();

    menu.addItem((item) => {
      item
        .setTitle('Run AI Classifier')
        .setIcon('brain')
        .onClick(async () => {
          const file = this.app.workspace.getActiveFile();
          if (file) {
            await this.runClassifier(file);
          } else {
            new Notice('No active file');
          }
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('Open Semantic Map')
        .setIcon('git-branch')
        .onClick(async () => {
          const file = this.app.workspace.getActiveFile();
          if (file) {
            await this.openSemanticMap(file);
          }
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('Toggle Hidden Tags')
        .setIcon('eye')
        .onClick(() => {
          this.settings.showHiddenTags = !this.settings.showHiddenTags;
          this.saveSettings();
          new Notice(`Hidden tags ${this.settings.showHiddenTags ? 'shown' : 'hidden'}`);
        });
    });

    menu.addSeparator();

    menu.addItem((item) => {
      item
        .setTitle('Open Concept Tracker')
        .setIcon('search')
        .onClick(async () => {
          await this.openConceptTracker();
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('Index Current Folder')
        .setIcon('folder-search')
        .onClick(async () => {
          const activeFile = this.app.workspace.getActiveFile();
          if (activeFile && activeFile.parent) {
            await this.indexFolder(activeFile.parent);
          } else {
            new Notice('No folder selected');
          }
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('Index Entire Vault')
        .setIcon('vault')
        .onClick(async () => {
          await this.indexVault();
        });
    });

    menu.addSeparator();

    menu.addItem((item) => {
      item
        .setTitle('Settings')
        .setIcon('settings')
        .onClick(() => {
          // @ts-ignore - Accessing internal API
          this.app.setting.open();
          // @ts-ignore
          this.app.setting.openTabById('obsidian-semantic-ai');
        });
    });

    menu.showAtMouseEvent(evt);
  }

  /**
   * Run AI classifier on a file
   */
  async runClassifier(file: TFile | null): Promise<void> {
    if (!file) {
      new Notice('No file selected');
      return;
    }

    const validation = this.classifier.validateConfiguration();
    if (!validation.valid) {
      new Notice(`Configuration error: ${validation.error}`);
      return;
    }

    new Notice('Running AI classification...');

    try {
      const content = await this.app.vault.read(file);
      const defaultTypes: TagType[] = ['Axiom', 'Claim', 'EvidenceBundle', 'Relationship'];

      const result = await this.classifier.classify(content, defaultTypes);

      // Show result modal
      new ClassificationResultModal(
        this.app,
        result,
        file.path,
        async () => {
          // Apply tags
          await writeTags(this.app.vault, file, result.tags);
          new Notice(`Applied ${result.tags.length} tags`);

          // Generate Mermaid if enabled
          if (this.settings.autoGenerateMermaid) {
            if (this.settings.mermaidPosition === 'panel') {
              await this.openSemanticMap(file);
            } else {
              await this.appendMermaid(file, result.tags);
            }
          }
        },
        () => {
          new Notice('Classification cancelled');
        }
      ).open();
    } catch (error) {
      console.error('Classification error:', error);
      new Notice(`Classification failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Run classifier with type selection
   */
  async runClassifierWithSelection(file: TFile | null): Promise<void> {
    if (!file) {
      new Notice('No file selected');
      return;
    }

    new TagSelectionModal(
      this.app,
      ['Axiom', 'Claim', 'EvidenceBundle', 'Relationship'],
      async (types) => {
        await this.runClassifierWithTypes(file, types);
      },
      () => {}
    ).open();
  }

  /**
   * Run classifier with specific types
   */
  async runClassifierWithTypes(file: TFile, types: TagType[]): Promise<void> {
    const validation = this.classifier.validateConfiguration();
    if (!validation.valid) {
      new Notice(`Configuration error: ${validation.error}`);
      return;
    }

    new Notice('Running AI classification...');

    try {
      const content = await this.app.vault.read(file);
      const result = await this.classifier.classify(content, types);

      new ClassificationResultModal(
        this.app,
        result,
        file.path,
        async () => {
          await writeTags(this.app.vault, file, result.tags);
          new Notice(`Applied ${result.tags.length} tags`);

          if (this.settings.autoGenerateMermaid) {
            if (this.settings.mermaidPosition === 'panel') {
              await this.openSemanticMap(file);
            } else {
              await this.appendMermaid(file, result.tags);
            }
          }
        },
        () => {
          new Notice('Classification cancelled');
        }
      ).open();
    } catch (error) {
      new Notice(`Classification failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Classify as a specific type
   */
  async classifyAs(file: TFile | null, type: TagType): Promise<void> {
    if (!file) {
      new Notice('No file selected');
      return;
    }

    new Notice(`Classifying as ${type}...`);

    try {
      const content = await this.app.vault.read(file);
      const result = await this.classifier.classifySingleType(content, type);

      new ClassificationResultModal(
        this.app,
        result,
        file.path,
        async () => {
          await writeTags(this.app.vault, file, result.tags);
          new Notice(`Applied ${result.tags.length} ${type} tags`);
        },
        () => {}
      ).open();
    } catch (error) {
      new Notice(`Classification failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Open semantic map view
   */
  async openSemanticMap(file: TFile | null): Promise<void> {
    if (!file) {
      new Notice('No file selected');
      return;
    }

    // Get or create the view
    let leaf = this.app.workspace.getLeavesOfType(MERMAID_VIEW_TYPE)[0];

    if (!leaf) {
      const rightLeaf = this.app.workspace.getRightLeaf(false);
      if (rightLeaf) {
        await rightLeaf.setViewState({
          type: MERMAID_VIEW_TYPE,
          active: true
        });
        leaf = rightLeaf;
      }
    }

    if (leaf) {
      this.app.workspace.revealLeaf(leaf);

      const view = leaf.view as MermaidView;
      const tags = await readTags(this.app.vault, file);
      view.setTags(tags, file.path);
    }
  }

  /**
   * Regenerate semantic graph
   */
  async regenerateGraph(file: TFile | null): Promise<void> {
    if (!file) {
      new Notice('No file selected');
      return;
    }

    const tags = await readTags(this.app.vault, file);

    if (tags.length === 0) {
      new Notice('No tags found in this file');
      return;
    }

    if (this.settings.mermaidPosition === 'panel') {
      await this.openSemanticMap(file);
    } else {
      await this.appendMermaid(file, tags);
    }

    new Notice('Graph regenerated');
  }

  /**
   * Append Mermaid diagram to file
   */
  private async appendMermaid(file: TFile, tags: SemanticTag[]): Promise<void> {
    const mermaidBlock = createMermaidCodeBlock(tags, this.settings.graphDirection);

    if (mermaidBlock) {
      let content = await this.app.vault.read(file);

      // Remove existing mermaid block if present
      content = content.replace(/\n\n```mermaid\ngraph[\s\S]*?```\n/g, '');

      // Add new mermaid block before tags
      const tagBlockIndex = content.indexOf('\n\n%%--- SEMANTIC TAGS ---%%');
      if (tagBlockIndex !== -1) {
        content = content.slice(0, tagBlockIndex) + mermaidBlock + content.slice(tagBlockIndex);
      } else {
        content = content.trimEnd() + mermaidBlock;
      }

      await this.app.vault.modify(file, content);
    }
  }

  /**
   * Batch classify folder
   */
  async batchClassifyFolder(folder: TFolder): Promise<void> {
    const files = this.app.vault.getMarkdownFiles()
      .filter(f => f.path.startsWith(folder.path));

    if (files.length === 0) {
      new Notice('No markdown files in folder');
      return;
    }

    // Get token estimate
    const fileContents = await Promise.all(
      files.map(async f => ({
        path: f.path,
        content: await this.app.vault.read(f)
      }))
    );

    const batchClassifier = new BatchClassifier(
      this.classifier,
      () => {}
    );

    const defaultTypes: TagType[] = ['Axiom', 'Claim', 'EvidenceBundle', 'Relationship'];
    const estimate = batchClassifier.estimateBatchCost(fileContents, defaultTypes);

    // Show confirmation modal
    const modal = new BatchProcessingModal(
      this.app,
      files,
      {
        inputTokens: estimate.totalTokens,
        estimatedOutputTokens: Math.ceil(estimate.totalTokens * 0.2),
        estimatedCost: estimate.estimatedCost
      },
      async () => {
        // Start processing
        let totalTags = 0;

        const processor = new BatchClassifier(
          this.classifier,
          (file, status, counts) => {
            modal.updateProgress(file, status, counts);
            if (counts) {
              totalTags += Object.values(counts).reduce((a, b) => a + b, 0);
            }
          }
        );

        const results = await processor.processFiles(fileContents, defaultTypes);

        // Write tags to files
        for (const [path, result] of results) {
          const file = this.app.vault.getAbstractFileByPath(path) as TFile;
          if (file && result.tags.length > 0) {
            await writeTags(this.app.vault, file, result.tags);
          }
        }

        modal.complete(totalTags);
      },
      () => {}
    );

    modal.open();
  }

  /**
   * Index a specific folder
   */
  async indexFolder(folder: TFolder): Promise<void> {
    const estimate = await this.vaultIndexer.estimateIndexCost('folder', folder.path);

    new IndexConfirmationModal(
      this.app,
      'folder',
      folder.path,
      estimate,
      async () => {
        await this.runIndexing('folder', folder.path);
      },
      () => {}
    ).open();
  }

  /**
   * Index entire vault
   */
  async indexVault(): Promise<void> {
    const estimate = await this.vaultIndexer.estimateIndexCost('vault');

    new IndexConfirmationModal(
      this.app,
      'vault',
      '/',
      estimate,
      async () => {
        await this.runIndexing('vault');
      },
      () => {}
    ).open();
  }

  /**
   * Run the actual indexing process
   */
  private async runIndexing(scope: 'folder' | 'vault', folderPath?: string): Promise<void> {
    const progressModal = new IndexProgressModal(this.app);
    progressModal.open();

    try {
      const index = await this.vaultIndexer.buildIndex(
        scope,
        folderPath,
        (current, total, fileName) => {
          progressModal.updateProgress(current, total, fileName);
        }
      );

      progressModal.complete({
        files: index.metadata.totalFiles,
        concepts: index.metadata.totalConcepts,
        relations: index.relations.length,
        timeMs: index.metadata.processingTimeMs || 0
      });

      // Open concept tracker after indexing
      setTimeout(() => {
        progressModal.close();
        this.openConceptTracker();
      }, 1500);

    } catch (error) {
      progressModal.close();
      new Notice(`Indexing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Show folder selection modal for indexing
   */
  async showFolderSelectionForIndex(): Promise<void> {
    const folders: TFolder[] = [];

    // Get all folders
    this.app.vault.getAllLoadedFiles().forEach(file => {
      if (file instanceof TFolder) {
        folders.push(file);
      }
    });

    new FolderSelectionModal(
      this.app,
      folders,
      async (folder) => {
        await this.indexFolder(folder);
      }
    ).open();
  }

  /**
   * Open the concept tracker view
   */
  async openConceptTracker(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(CONCEPT_TRACKER_VIEW_TYPE)[0];

    if (!leaf) {
      const rightLeaf = this.app.workspace.getRightLeaf(false);
      if (rightLeaf) {
        await rightLeaf.setViewState({
          type: CONCEPT_TRACKER_VIEW_TYPE,
          active: true
        });
        leaf = rightLeaf;
      }
    }

    if (leaf) {
      this.app.workspace.revealLeaf(leaf);

      const view = leaf.view as ConceptTrackerView;
      const index = this.vaultIndexer.getIndex();
      view.setIndex(index);
    }
  }
}
