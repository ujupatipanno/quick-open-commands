import { App, Plugin, PluginSettingTab, Setting, TFile, Notice, FuzzySuggestModal, WorkspaceLeaf, SearchComponent } from 'obsidian';

interface CommandConfig {
  id: string;
  filePath: string;
}

interface QuickOpenSettings {
  commands: CommandConfig[];
}

const DEFAULT_SETTINGS: QuickOpenSettings = {
  commands: []
};

function simpleHash(s: string): string {
  // djb2
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}

class FileSuggester extends FuzzySuggestModal<TFile> {
  private onChoose: (file: TFile) => void;
  
  constructor(app: App, onChoose: (file: TFile) => void) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder('파일 검색...');
  }
  
  getItems(): TFile[] {
    // return markdown files
    // @ts-ignore - getMarkdownFiles might not exist in older API versions
    if (typeof this.app.vault.getMarkdownFiles === 'function') {
      // @ts-ignore
      return this.app.vault.getMarkdownFiles();
    }
    // Fallback: filter all files for .md extension
    return this.app.vault.getFiles().filter((f) => f.path.endsWith('.md')) as TFile[];
  }
  
  getItemText(item: TFile): string {
    return item.path;
  }
  
  onChooseItem(item: TFile): void {
    this.onChoose(item);
  }
}

class QuickOpenPlugin extends Plugin {
  settings!: QuickOpenSettings;

  async onload() {
    await this.loadSettings();
    this.registerAllCommands();
    // Add a command to register the currently active note as a quick-open command
    this.addCommand({
      id: 'quick-open-add-current-note',
      name: '현재 탭 노트 추가',
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !(file instanceof TFile)) {
          new Notice('활성 탭에 노트가 열려있지 않습니다');
          return;
        }
        await this.addCommandForFile(file.path);
      }
    });
    this.addSettingTab(new QuickOpenSettingTab(this.app, this));
    // Watch for file rename/move events to keep commands in sync
    // Use registerEvent so listeners are cleaned up on unload
    // @ts-ignore
    this.registerEvent(this.app.vault.on('rename', (file, oldPath: string) => {
      if (!oldPath) return;
      const changed = this.settings.commands.filter((c) => c.filePath === oldPath);
      if (changed.length === 0) return;
      for (const cfg of changed) {
        // update stored path to new path
        cfg.filePath = (file as TFile).path;
        // re-register command to update displayed name in command palette
        try {
          // @ts-ignore
          this.app.commands.removeCommand(cfg.id);
        } catch (e) {}
        this.registerCommandForConfig(cfg);
      }
      this.saveSettings();
      new Notice(`명령 경로 업데이트됨: ${oldPath} → ${(file as TFile).path}`);
    }));

    // When a file is deleted, remove any registered commands that reference it
    // @ts-ignore
    this.registerEvent(this.app.vault.on('delete', async (file) => {
      const path = (file as TFile).path;
      const matched = this.settings.commands.filter((c) => c.filePath === path);
      if (matched.length === 0) return;

      for (const cfg of matched) {
        // remove from settings array
        const idx = this.settings.commands.findIndex((c) => c.id === cfg.id);
        if (idx !== -1) this.settings.commands.splice(idx, 1);
        try {
          // @ts-ignore
          this.app.commands.removeCommand(cfg.id);
        } catch (e) {}
      }

      await this.saveSettings();
      new Notice(`삭제된 파일에 대한 명령이 제거되었습니다: ${path}`);
      // If settings tab is open, attempt to refresh — best-effort
      try {
        // @ts-ignore
        const tabs = this.app.workspace.getLeavesOfType('settings');
        for (const leaf of tabs) {
          // @ts-ignore
          if (leaf.view && typeof leaf.view.display === 'function') {
            // @ts-ignore
            leaf.view.display();
          }
        }
      } catch (e) {
        // ignore
      }
    }));
  }

  onunload() {
    // remove commands
    for (const cfg of this.settings.commands) {
      try {
        // remove registered command by id
        // @ts-ignore
        this.app.commands.removeCommand(cfg.id);
      } catch (e) {
        // ignore
      }
    }
  }

  async loadSettings() {
    const loaded = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded) as QuickOpenSettings;
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private registerAllCommands() {
    for (const cfg of this.settings.commands) {
      this.registerCommandForConfig(cfg);
    }
  }

  private registerCommandForConfig(cfg: CommandConfig) {
    // Generate command name from filepath including path
    const fileName = cfg.filePath.split('/').pop()?.replace(/\.md$/, '') || cfg.filePath;
    const folderPath = cfg.filePath.substring(0, cfg.filePath.lastIndexOf('/'));
    const displayPath = folderPath ? `${folderPath}/${fileName}` : fileName;
    const commandName = `${displayPath} 열기`;
    // register command with Obsidian
    this.addCommand({
      id: cfg.id,
      name: commandName,
      callback: async () => {
        const file = this.app.vault.getAbstractFileByPath(cfg.filePath);
        if (!file || !(file instanceof TFile)) {
          new Notice(`파일을 찾을 수 없습니다: ${cfg.filePath}`);
          return;
        }
        // Get a leaf (tab) to open the file in, or use the active leaf
        const leaf = this.app.workspace.activeLeaf || this.app.workspace.getLeaf();
        if (leaf) {
          await leaf.openFile(file as TFile);
        }
      }
    });
  }

  async addCommandForFile(filePath: string) {
    // duplicate check
    if (this.settings.commands.some((c) => c.filePath === filePath)) {
      new Notice('이미 등록된 파일입니다');
      return;
    }
    const id = `quick-open-${simpleHash(filePath)}`;
    const cfg: CommandConfig = {
      id,
      filePath
    };
    this.settings.commands.push(cfg);
    this.registerCommandForConfig(cfg);
    await this.saveSettings();
    const fileName = filePath.split('/').pop()?.replace(/\.md$/, '') || filePath;
    const folderPath = filePath.substring(0, filePath.lastIndexOf('/'));
    const displayPath = folderPath ? `${folderPath}/${fileName}` : fileName;
    new Notice(`명령 추가됨: ${displayPath} 열기`);
  }

  async removeCommandById(id: string) {
    const idx = this.settings.commands.findIndex((c) => c.id === id);
    if (idx === -1) return;
    const [cfg] = this.settings.commands.splice(idx, 1);
    try {
      // remove from app commands
      // @ts-ignore
      this.app.commands.removeCommand(cfg.id);
    } catch (e) {
      // ignore
    }
    await this.saveSettings();
    const fileName = cfg.filePath.split('/').pop()?.replace(/\.md$/, '') || cfg.filePath;
    const folderPath = cfg.filePath.substring(0, cfg.filePath.lastIndexOf('/'));
    const displayPath = folderPath ? `${folderPath}/${fileName}` : fileName;
    new Notice(`명령 삭제됨: ${displayPath} 열기`);
  }
}

class QuickOpenSettingTab extends PluginSettingTab {
  plugin: QuickOpenPlugin;

  private filterText: string = '';
  private listContainer: HTMLDivElement | null = null;

  constructor(app: App, plugin: QuickOpenPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Quick Open Commands' });

    // Search filter always displayed
    const searchContainer = containerEl.createDiv({ cls: 'quick-open-search' });
    const searchComponent = new SearchComponent(searchContainer);
    searchComponent.setPlaceholder('명령 또는 파일 검색...')
      .setValue(this.filterText)
      .onChange((value) => {
        this.filterText = value;
        this.updateList();
      });

    new Setting(containerEl)
      .addButton((btn) => {
        btn.setButtonText('+ 새 명령 추가').onClick(() => {
          const modal = new FileSuggester(this.app, async (file) => {
            await this.plugin.addCommandForFile(file.path);
            this.display();
            modal.close();
          });
          modal.open();
        });
      });

    this.listContainer = containerEl.createDiv();
    this.updateList();
  }

  private updateList(): void {
    if (!this.listContainer) return;
    this.listContainer.empty();

    const items = this.plugin.settings.commands.filter((c) => {
      if (!this.filterText) return true;
      const ft = this.filterText.toLowerCase();
      const fileName = c.filePath.split('/').pop()?.replace(/\.md$/, '') || c.filePath;
      return fileName.toLowerCase().includes(ft) || c.filePath.toLowerCase().includes(ft);
    });

    if (items.length === 0) {
      this.listContainer.createEl('div', { text: '해당 검색어와 일치하는 명령이 없습니다. 검색어를 변경해 보세요.' });
      return;
    }

    for (const cfg of items) {
      const fileName = cfg.filePath.split('/').pop()?.replace(/\.md$/, '') || cfg.filePath;
      const folderPath = cfg.filePath.substring(0, cfg.filePath.lastIndexOf('/'));
      const displayPath = folderPath ? `${folderPath}/${fileName}` : fileName;
      const setting = new Setting(this.listContainer)
        .setName(`${displayPath} 열기`);

      const file = this.app.vault.getAbstractFileByPath(cfg.filePath);
      if (!file || !(file instanceof TFile)) {
        // add warning indicator
        const nameEl = setting.nameEl;
        nameEl.createEl('span', { text: ' ⚠️', attr: { title: '파일을 찾을 수 없습니다' } }).style.color = 'var(--interactive-danger)';
        // make name red-ish
        setting.nameEl.style.color = 'var(--interactive-danger)';
      }

      // Add open in new tab button
      setting.addExtraButton((btn) => {
        btn.setIcon('square-arrow-out-up-right').setTooltip('새 탭에서 열기').onClick(async () => {
          const file = this.app.vault.getAbstractFileByPath(cfg.filePath);
          if (file && file instanceof TFile) {
            const newLeaf = this.app.workspace.getLeaf('tab');
            await newLeaf.openFile(file);
          } else {
            new Notice('파일을 찾을 수 없습니다');
          }
        });
      });

      // Add delete button
      setting.addExtraButton((btn) => {
        btn.setIcon('trash').setTooltip('삭제').onClick(async () => {
          await this.plugin.removeCommandById(cfg.id);
          this.display();
        });
      });
    }
  }
}

export default QuickOpenPlugin;
