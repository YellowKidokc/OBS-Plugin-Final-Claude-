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
  getTagCounts,
  setConceptRegistry
} from './tagging/tag-writer';
import { ConceptRegistry } from './tagging/concept-registry';
import { MermaidView, MERMAID_VIEW_TYPE, createMermaidCodeBlock } from './ui/mermaid-view';
import {
  ClassificationResultModal,
  BatchProcessingModal,
  TagSelectionModal
} from './ui/result-panel';
import { VaultIndexer } from './indexing/vault-indexer';
import { ConceptTrackerView, CONCEPT_TRACKER_VIEW_TYPE } from './ui/concept-tracker-view';
import {
  ConceptJourneyView,
  CONCEPT_JOURNEY_VIEW_TYPE,
  ConceptJourney,
  JourneyAnalysis
} from './ui/concept-journey-view';
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
  conceptRegistry: ConceptRegistry;

  async onload(): Promise<void> {
    console.log('Loading Semantic AI plugin');

    // Load settings
    await this.loadSettings();

    // Initialize managers
    this.promptManager = new PromptManager(this.settings);
    this.classifier = new AIClassifier(this.settings, this.promptManager);
    this.vaultIndexer = new VaultIndexer(this.app.vault);

    // Initialize concept registry for consistent UUIDs
    this.conceptRegistry = new ConceptRegistry(this.app.vault);
    await this.conceptRegistry.load();
    setConceptRegistry(this.conceptRegistry);

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

    this.registerView(
      CONCEPT_JOURNEY_VIEW_TYPE,
      (leaf) => new ConceptJourneyView(leaf)
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

    // Save concept registry if it has changes
    if (this.conceptRegistry && this.conceptRegistry.isDirty()) {
      await this.conceptRegistry.save();
    }
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

    // Concept Registry commands
    this.addCommand({
      id: 'view-concept-registry',
      name: 'View Concept Registry Stats',
      callback: () => {
        const stats = this.conceptRegistry.getStats();
        const typeBreakdown = Object.entries(stats.byType)
          .map(([type, count]) => `  ${type}: ${count}`)
          .join('\n');

        new Notice(
          `Concept Registry:\n` +
          `Total concepts: ${stats.totalConcepts}\n` +
          `Concepts with aliases: ${stats.withAliases}\n` +
          `Last updated: ${new Date(stats.lastUpdated).toLocaleString()}\n` +
          `By type:\n${typeBreakdown}`,
          10000
        );
      }
    });

    this.addCommand({
      id: 'export-concept-registry',
      name: 'Export Concept Registry',
      callback: async () => {
        const json = this.conceptRegistry.exportJSON();
        const filename = `concept-registry-${new Date().toISOString().split('T')[0]}.json`;

        // Create export file in vault root
        await this.app.vault.create(filename, json);
        new Notice(`Exported concept registry to ${filename}`);
      }
    });

    this.addCommand({
      id: 'save-concept-registry',
      name: 'Save Concept Registry',
      callback: async () => {
        await this.conceptRegistry.save();
        new Notice('Concept registry saved');
      }
    });

    // Concept Journey command
    this.addCommand({
      id: 'open-concept-journey',
      name: 'Open Concept Journey',
      callback: async () => {
        await this.openConceptJourney();
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
        .setTitle('Open Concept Journey')
        .setIcon('route')
        .onClick(async () => {
          await this.openConceptJourney();
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

      const result = await this.classifier.classify(content, defaultTypes, file.path);

      // Show result modal
      new ClassificationResultModal(
        this.app,
        result,
        file.path,
        async () => {
          // Apply tags
          await writeTags(this.app.vault, file, result.tags);
          new Notice(`Applied ${result.tags.length} tags`);

          // Save concept registry
          if (this.conceptRegistry.isDirty()) {
            await this.conceptRegistry.save();
          }

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
      const result = await this.classifier.classify(content, types, file.path);

      new ClassificationResultModal(
        this.app,
        result,
        file.path,
        async () => {
          await writeTags(this.app.vault, file, result.tags);
          new Notice(`Applied ${result.tags.length} tags`);

          // Save concept registry
          if (this.conceptRegistry.isDirty()) {
            await this.conceptRegistry.save();
          }

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
      const result = await this.classifier.classifySingleType(content, type, file.path);

      new ClassificationResultModal(
        this.app,
        result,
        file.path,
        async () => {
          await writeTags(this.app.vault, file, result.tags);
          new Notice(`Applied ${result.tags.length} ${type} tags`);

          // Save concept registry
          if (this.conceptRegistry.isDirty()) {
            await this.conceptRegistry.save();
          }
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

        // Save concept registry after batch processing
        if (this.conceptRegistry.isDirty()) {
          await this.conceptRegistry.save();
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

  /**
   * Open the concept journey view
   */
  async openConceptJourney(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(CONCEPT_JOURNEY_VIEW_TYPE)[0];

    if (!leaf) {
      const rightLeaf = this.app.workspace.getRightLeaf(false);
      if (rightLeaf) {
        await rightLeaf.setViewState({
          type: CONCEPT_JOURNEY_VIEW_TYPE,
          active: true
        });
        leaf = rightLeaf;
      }
    }

    if (leaf) {
      this.app.workspace.revealLeaf(leaf);

      const view = leaf.view as ConceptJourneyView;
      const index = this.vaultIndexer.getIndex();

      // Set up the view with data sources and callbacks
      view.setDataSources(
        this.conceptRegistry,
        index,
        // Open file callback
        (filePath: string) => {
          const file = this.app.vault.getAbstractFileByPath(filePath);
          if (file instanceof TFile) {
            this.app.workspace.getLeaf().openFile(file);
          }
        },
        // Analyze journey callback
        async (journey: ConceptJourney): Promise<JourneyAnalysis> => {
          return this.analyzeConceptJourney(journey);
        },
        // Generate forward links callback
        async (journey: ConceptJourney): Promise<void> => {
          return this.generateConceptForwardLinks(journey);
        }
      );
    }
  }

  /**
   * Analyze a concept journey using AI
   */
  private async analyzeConceptJourney(journey: ConceptJourney): Promise<JourneyAnalysis> {
    const validation = this.classifier.validateConfiguration();
    if (!validation.valid) {
      throw new Error(`Configuration error: ${validation.error}`);
    }

    // Build the occurrences list for the prompt
    const occurrences = journey.occurrences.map(o => ({
      file: o.fileName,
      type: o.tag.type,
      label: o.tag.label
    }));

    const prompt = this.promptManager.buildConceptJourneyPrompt(
      journey.concept,
      journey.aliases,
      occurrences
    );

    try {
      // Call the AI using the classifier's internal method via a simple wrapper
      const response = await this.callAIForJourney(prompt);

      // Parse the response
      let jsonStr = response.trim();
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }

      const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        jsonStr = objectMatch[0];
      }

      const analysis = JSON.parse(jsonStr);

      return {
        narrative: analysis.narrative || 'No narrative generated.',
        contradictions: analysis.contradictions || [],
        gaps: analysis.gaps || [],
        suggestions: analysis.suggestions || []
      };
    } catch (error) {
      console.error('Journey analysis error:', error);
      throw new Error(`Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Call AI for journey analysis (wrapper method)
   */
  private async callAIForJourney(prompt: string): Promise<string> {
    // Use requestUrl directly since we can't access private methods
    const { requestUrl } = await import('obsidian');

    if (!this.settings.apiKey && this.settings.aiProvider !== 'ollama') {
      throw new Error('API key not configured');
    }

    switch (this.settings.aiProvider) {
      case 'openai': {
        const response = await requestUrl({
          url: this.settings.apiEndpoint || 'https://api.openai.com/v1/chat/completions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.settings.apiKey}`
          },
          body: JSON.stringify({
            model: this.settings.modelName || 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
            max_tokens: 2048
          })
        });
        return response.json.choices[0]?.message?.content || '';
      }

      case 'anthropic': {
        const response = await requestUrl({
          url: 'https://api.anthropic.com/v1/messages',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.settings.apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: this.settings.modelName || 'claude-3-haiku-20240307',
            max_tokens: 2048,
            messages: [{ role: 'user', content: prompt }]
          })
        });
        return response.json.content[0]?.text || '';
      }

      case 'ollama': {
        const response = await requestUrl({
          url: this.settings.apiEndpoint || 'http://localhost:11434/api/generate',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.settings.modelName || 'llama2',
            prompt: prompt,
            stream: false
          })
        });
        return response.json.response || '';
      }

      default:
        throw new Error(`Unknown AI provider: ${this.settings.aiProvider}`);
    }
  }

  /**
   * Generate forward links for a concept journey
   */
  private async generateConceptForwardLinks(journey: ConceptJourney): Promise<void> {
    if (journey.occurrences.length < 2) {
      new Notice('Need at least 2 occurrences to generate forward links');
      return;
    }

    let linksAdded = 0;

    // Add forward link comments to each file pointing to the next occurrence
    for (let i = 0; i < journey.occurrences.length - 1; i++) {
      const current = journey.occurrences[i];
      const next = journey.occurrences[i + 1];

      const file = this.app.vault.getAbstractFileByPath(current.file);
      if (!(file instanceof TFile)) continue;

      const content = await this.app.vault.read(file);

      // Create forward link comment
      const forwardLink = `\n%%forward-link::${journey.concept}::[[${next.fileName}]]%%`;

      // Check if link already exists
      if (content.includes(`forward-link::${journey.concept}`)) {
        continue; // Skip if already has forward link for this concept
      }

      // Add after the tag block or at the end
      let newContent: string;
      const tagBlockEnd = content.indexOf('%%--- END SEMANTIC TAGS ---%%');
      if (tagBlockEnd !== -1) {
        newContent = content.slice(0, tagBlockEnd + '%%--- END SEMANTIC TAGS ---%%'.length) +
                     forwardLink +
                     content.slice(tagBlockEnd + '%%--- END SEMANTIC TAGS ---%%'.length);
      } else {
        newContent = content.trimEnd() + forwardLink;
      }

      await this.app.vault.modify(file, newContent);
      linksAdded++;
    }

    new Notice(`Added ${linksAdded} forward links for "${journey.concept}"`);
  }
}
