/**
 * Prompt Tabs Component
 * Settings UI for editing prompts per tag type
 */

import { Setting, TextAreaComponent } from 'obsidian';
import { TagType, DEFAULT_PROMPTS, CustomClassifier } from '../types';
import { PromptManager } from '../ai/prompt-manager';

/**
 * Create prompt editor tabs
 */
export function createPromptTabs(
  containerEl: HTMLElement,
  promptManager: PromptManager,
  onSave: () => void
): void {
  // Tab container
  const tabContainer = containerEl.createEl('div', { cls: 'semantic-ai-tabs' });
  const tabNav = tabContainer.createEl('div', { cls: 'semantic-ai-tab-nav' });
  const tabContent = tabContainer.createEl('div', { cls: 'semantic-ai-tab-content' });

  // Tag types for tabs
  const tagTypes: { type: TagType; name: string }[] = [
    { type: 'Axiom', name: 'Axioms' },
    { type: 'Claim', name: 'Claims' },
    { type: 'EvidenceBundle', name: 'Evidence' },
    { type: 'ScientificProcess', name: 'Process' },
    { type: 'Relationship', name: 'Relations' },
    { type: 'InternalLink', name: 'Int. Links' },
    { type: 'ExternalLink', name: 'Ext. Links' },
    { type: 'ProperName', name: 'Names' },
    { type: 'ForwardLink', name: 'Fwd Links' },
    { type: 'WordOntology', name: 'Ontology' },
    { type: 'Sentence', name: 'Sentences' },
    { type: 'Paragraph', name: 'Paragraphs' }
  ];

  // Create tab buttons
  const tabButtons: HTMLElement[] = [];
  const tabPanels: HTMLElement[] = [];

  tagTypes.forEach((tagType, index) => {
    // Tab button
    const tabBtn = tabNav.createEl('button', {
      cls: `semantic-ai-tab-btn ${index === 0 ? 'active' : ''}`,
      text: tagType.name
    });
    tabBtn.setAttribute('data-tab', tagType.type);
    tabButtons.push(tabBtn);

    // Tab panel
    const panel = tabContent.createEl('div', {
      cls: `semantic-ai-tab-panel ${index === 0 ? 'active' : ''}`
    });
    panel.setAttribute('data-tab', tagType.type);
    tabPanels.push(panel);

    createPromptEditor(panel, tagType.type, promptManager, onSave);

    // Tab click handler
    tabBtn.onclick = () => {
      tabButtons.forEach(btn => btn.removeClass('active'));
      tabPanels.forEach(p => p.removeClass('active'));

      tabBtn.addClass('active');
      panel.addClass('active');
    };
  });
}

/**
 * Create a prompt editor for a specific tag type
 */
function createPromptEditor(
  containerEl: HTMLElement,
  type: TagType,
  promptManager: PromptManager,
  onSave: () => void
): void {
  const isDefault = promptManager.isDefaultPrompt(type);

  containerEl.createEl('h4', { text: promptManager.getTagTypeName(type) });

  if (isDefault) {
    containerEl.createEl('p', {
      cls: 'semantic-ai-prompt-status',
      text: '✓ Using default prompt'
    });
  } else {
    containerEl.createEl('p', {
      cls: 'semantic-ai-prompt-status custom',
      text: '⚡ Custom prompt'
    });
  }

  // Prompt text area
  let textArea: TextAreaComponent;

  new Setting(containerEl)
    .setName('Prompt')
    .setDesc('Edit the prompt used to identify this semantic element type.')
    .addTextArea(text => {
      textArea = text;
      text
        .setPlaceholder('Enter prompt...')
        .setValue(promptManager.getPrompt(type))
        .onChange(value => {
          promptManager.setPrompt(type, value);
          onSave();
        });

      text.inputEl.rows = 6;
      text.inputEl.cols = 50;
    });

  // Reset button
  new Setting(containerEl)
    .setName('Reset to Default')
    .setDesc('Restore the default prompt for this tag type.')
    .addButton(button => {
      button
        .setButtonText('Reset')
        .onClick(() => {
          promptManager.resetPrompt(type);
          textArea.setValue(DEFAULT_PROMPTS[type]);
          onSave();

          // Update status
          const statusEl = containerEl.querySelector('.semantic-ai-prompt-status');
          if (statusEl) {
            statusEl.textContent = '✓ Using default prompt';
            statusEl.removeClass('custom');
          }
        });
    });

  // Show default
  const defaultContainer = containerEl.createEl('details', { cls: 'semantic-ai-default-prompt' });
  defaultContainer.createEl('summary', { text: 'View default prompt' });
  defaultContainer.createEl('pre', { text: DEFAULT_PROMPTS[type] });
}

/**
 * Create custom classifier settings
 */
export function createCustomClassifierSettings(
  containerEl: HTMLElement,
  promptManager: PromptManager,
  onSave: () => void
): void {
  containerEl.createEl('h3', { text: 'Custom Classifiers' });
  containerEl.createEl('p', {
    text: 'Define your own semantic categories with custom keywords and prompts.'
  });

  // Existing classifiers
  const classifiers = promptManager.getCustomClassifiers();
  const listEl = containerEl.createEl('div', { cls: 'semantic-ai-classifier-list' });

  function renderClassifiers(): void {
    listEl.empty();

    const currentClassifiers = promptManager.getCustomClassifiers();

    if (currentClassifiers.length === 0) {
      listEl.createEl('p', {
        cls: 'semantic-ai-empty',
        text: 'No custom classifiers defined.'
      });
      return;
    }

    for (const classifier of currentClassifiers) {
      createClassifierItem(listEl, classifier, promptManager, onSave, renderClassifiers);
    }
  }

  renderClassifiers();

  // Add new classifier
  containerEl.createEl('h4', { text: 'Add New Classifier' });

  let newKeyword = '';
  let newPrompt = '';

  new Setting(containerEl)
    .setName('Keyword')
    .setDesc('A unique keyword to identify this classifier (e.g., "method", "hypothesis")')
    .addText(text => {
      text
        .setPlaceholder('Enter keyword...')
        .onChange(value => {
          newKeyword = value;
        });
    });

  new Setting(containerEl)
    .setName('Prompt')
    .setDesc('The prompt to use when this keyword is invoked')
    .addTextArea(text => {
      text
        .setPlaceholder('Enter prompt...')
        .onChange(value => {
          newPrompt = value;
        });

      text.inputEl.rows = 4;
    });

  new Setting(containerEl)
    .addButton(button => {
      button
        .setButtonText('Add Classifier')
        .setCta()
        .onClick(() => {
          if (!newKeyword.trim() || !newPrompt.trim()) {
            return;
          }

          promptManager.addCustomClassifier(newKeyword.trim(), newPrompt.trim());
          onSave();
          renderClassifiers();

          // Clear inputs
          newKeyword = '';
          newPrompt = '';
        });
    });
}

/**
 * Create a classifier item in the list
 */
function createClassifierItem(
  containerEl: HTMLElement,
  classifier: CustomClassifier,
  promptManager: PromptManager,
  onSave: () => void,
  rerender: () => void
): void {
  const itemEl = containerEl.createEl('div', { cls: 'semantic-ai-classifier-item' });

  const headerEl = itemEl.createEl('div', { cls: 'semantic-ai-classifier-header' });

  headerEl.createEl('span', {
    cls: 'semantic-ai-classifier-keyword',
    text: classifier.keyword
  });

  const statusEl = headerEl.createEl('span', {
    cls: `semantic-ai-classifier-status ${classifier.enabled ? 'enabled' : 'disabled'}`,
    text: classifier.enabled ? 'Enabled' : 'Disabled'
  });

  // Toggle enabled
  new Setting(itemEl)
    .setName('Enabled')
    .addToggle(toggle => {
      toggle
        .setValue(classifier.enabled)
        .onChange(value => {
          promptManager.updateCustomClassifier(classifier.id, { enabled: value });
          onSave();
          statusEl.textContent = value ? 'Enabled' : 'Disabled';
          statusEl.className = `semantic-ai-classifier-status ${value ? 'enabled' : 'disabled'}`;
        });
    });

  // Prompt preview
  const promptPreview = itemEl.createEl('div', { cls: 'semantic-ai-classifier-prompt' });
  promptPreview.createEl('strong', { text: 'Prompt: ' });
  promptPreview.createEl('span', {
    text: classifier.prompt.length > 100
      ? classifier.prompt.slice(0, 100) + '...'
      : classifier.prompt
  });

  // Actions
  new Setting(itemEl)
    .addButton(button => {
      button
        .setButtonText('Delete')
        .setWarning()
        .onClick(() => {
          promptManager.removeCustomClassifier(classifier.id);
          onSave();
          rerender();
        });
    });
}

/**
 * Create import/export section for prompts
 */
export function createPromptImportExport(
  containerEl: HTMLElement,
  promptManager: PromptManager,
  onSave: () => void
): void {
  containerEl.createEl('h3', { text: 'Import / Export' });

  new Setting(containerEl)
    .setName('Export Prompts')
    .setDesc('Download all prompts and custom classifiers as JSON')
    .addButton(button => {
      button
        .setButtonText('Export')
        .onClick(() => {
          const data = promptManager.exportPrompts();
          const blob = new Blob([data], { type: 'application/json' });
          const url = URL.createObjectURL(blob);

          const a = document.createElement('a');
          a.href = url;
          a.download = 'semantic-ai-prompts.json';
          a.click();

          URL.revokeObjectURL(url);
        });
    });

  new Setting(containerEl)
    .setName('Import Prompts')
    .setDesc('Load prompts from a JSON file')
    .addButton(button => {
      button
        .setButtonText('Import')
        .onClick(() => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = '.json';

          input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;

            try {
              const text = await file.text();
              promptManager.importPrompts(text);
              onSave();
            } catch (error) {
              console.error('Import failed:', error);
            }
          };

          input.click();
        });
    });

  new Setting(containerEl)
    .setName('Reset All Prompts')
    .setDesc('Reset all prompts to their default values')
    .addButton(button => {
      button
        .setButtonText('Reset All')
        .setWarning()
        .onClick(() => {
          promptManager.resetAllPrompts();
          onSave();
        });
    });
}
