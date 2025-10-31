/* eslint-disable no-mixed-spaces-and-tabs */
import {
	App,
	CachedMetadata,
	FuzzySuggestModal,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TAbstractFile,
	TFile,
	TFolder,
} from "obsidian";

enum SortingStrategy {
	ALPHABETICAL = "alphabetical",
	CREATION_TIME = "creation time",
}

enum LowGraneSortingStrategy {
	FILEFIRST = "file first",
	FOLDERFIRST = "folder first",
}

interface Obsidian2BookSettings {
	foldersToIgnore: string[];
	filesToIgnore: string[];
	tagsToIgnore: string[];
	extensionsToIgnore: string[];
	generateTOCs: boolean;
	includeEmptyFolders: boolean;
	sortingStrategy: SortingStrategy;
	lowGraneSortingStrategy: LowGraneSortingStrategy;
}

const DEFAULT_SETTINGS: Obsidian2BookSettings = {
	foldersToIgnore: [],
	filesToIgnore: [],
	tagsToIgnore: [],
	extensionsToIgnore: [],
	generateTOCs: true,
	includeEmptyFolders: false,
	sortingStrategy: SortingStrategy.ALPHABETICAL,
	lowGraneSortingStrategy: LowGraneSortingStrategy.FILEFIRST,
};

export default class Obsidian2BookClass extends Plugin {
	settings!: Obsidian2BookSettings;
	ribbonButton!: HTMLElement;

	async onload() {
		await this.loadSettings();

		this.ribbonButton = this.addRibbonIcon(
			"book",
			"Obsidian 2 Book: Generate a book from a specified folder",
			() => {
				new PathFuzzy(this, generateBook).open();
			}
		);

		this.addCommand({
			id: "generate-vault-book",
			name: "Generate book from the entire vault",
			callback: () => {
				generateBook(this.app, this.settings);
			},
		});

		this.addCommand({
			id: "generate-book-from-folder",
			name: "Generate a book from a specified folder",
			callback: () => {
				new PathFuzzy(this, generateBook).open();
			},
		});

		this.addCommand({
			id: "remove-all-books-from-vault",
			name: "Remove all generated books from vault",
			callback: () => {
				new ConfirmModal(
					this.app,
					"Remove all books?",
					`You are about to delete every book you have created in you vault, procede?
					WARNING: All files containing the following comment: <!--book-ignore--> will be deleted`,
					() => removeAllBooks(this.app),
					() => {}
				).open();
			},
		});

		this.addSettingTab(new Obsidian2BookSettingsPage(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

async function removeAllBooks(app: App): Promise<void> {
	const { vault } = app;
	const books = vault.getFiles();
	for (const file of books) {
		const fileContent = await vault.read(file);
		if (isBook(fileContent)) {
			await vault.delete(file);
		}
	}
}

type fileStruct = {
	type: "file" | "folder";
	path: string;
	name: string;
	graphicName: string;
	creationTime?: number;
	modificationTime?: number;
	depth: number;
	document: TAbstractFile;
};

interface ParsedLink {
	originalLink: string;       // "[[auth-file#setup]]"
	targetFile: string;         // "auth-file"
	linkType: 'file' | 'heading' | 'block';
	selector?: string;          // "setup" or "^block-id"
	displayText?: string;       // custom display text if provided
}

interface Reference {
	id: string;              // "ref-1", "ref-2"
	parsedLink: ParsedLink;
	content: string;         // Extracted content
	sourceHeading: string;   // Source file basename for return link
}

let fileList: fileStruct[] = [];

function isDocFile(file: TAbstractFile): boolean {
	return file instanceof TFile;
}

function isDocFolder(file: TAbstractFile): boolean {
	return file instanceof TFolder;
}

function isBook(fileContent: string): boolean {
	return fileContent.includes("<!--book-ignore-->");
}

function checkTags(cache: CachedMetadata | null, tagsToIgnore: string[]) {
	if (cache == null) return false;

	const elabTags = tagsToIgnore.map((t) => {
		if (t[0] == "#") return t.slice(1).toLowerCase();
		return t.toLowerCase();
	});
	const frontmatter = cache.frontmatter;
	const found =
		(cache.tags != null &&
			cache.tags.some((t) =>
				elabTags.includes(t.tag.slice(1).toLocaleLowerCase())
			)) ||
		(frontmatter != undefined &&
			frontmatter.tag != null &&
			elabTags.some((t) => frontmatter.tag.includes(t.toLowerCase())));
	return found;
}

/**
 * true if file is valid false if file is to be ignored
 */
async function checkFile(
	app: App,
	file: TFile,
	settings: Obsidian2BookSettings
): Promise<boolean> {
	const fileContent = await app.vault.read(file);
	const isBookIgnore = isBook(fileContent);
	const cachedMetadata = app.metadataCache.getFileCache(file);
	const isTagIgnore = checkTags(cachedMetadata, settings.tagsToIgnore);

	const isExtIgnore =
		settings.extensionsToIgnore.length == 0
			? false
			: settings.extensionsToIgnore
					.filter((x) => x.trim() != "")
					.some((ext) => ("." + file.extension).includes(ext.trim()));
	const isFileIgnore =
		settings.filesToIgnore.length == 0
			? false
			: settings.filesToIgnore
					.filter((x) => x.trim() != "")
					.some((f) => file.name.trim() == f.trim());

	return Promise.resolve(
		!isBookIgnore && !isTagIgnore && !isExtIgnore && !isFileIgnore
	);
}

function checkFolder(
	file: TFolder,
	settings: Obsidian2BookSettings
): boolean {
	const isFolderIgnore =
		settings.foldersToIgnore.length == 0
			? false
			: settings.foldersToIgnore
					.filter((x) => x.trim() != "")
					.some((f) => file.name.trim() == f.trim());
	const isEmpty = settings.includeEmptyFolders
		? false
		: file.children.length == 0;
	return !isFolderIgnore && !isEmpty;
}

function parseLink(linkInfo: { link: string; original: string; displayText?: string }): ParsedLink {
	const linkText = linkInfo.link;
	const displayText = linkInfo.displayText;

	// Block reference: contains #^
	if (linkText.includes('#^')) {
		const parts = linkText.split('#^');
		return {
			targetFile: parts[0] || '',
			linkType: 'block',
			selector: parts[1] || '',
			originalLink: linkInfo.original,
			displayText
		};
	}

	// Heading reference: contains #
	if (linkText.includes('#')) {
		const parts = linkText.split('#');
		return {
			targetFile: parts[0] || '',
			linkType: 'heading',
			selector: parts[1] || '',
			originalLink: linkInfo.original,
			displayText
		};
	}

	// Whole file reference
	return {
		targetFile: linkText,
		linkType: 'file',
		originalLink: linkInfo.original,
		displayText
	};
}

function extractHeadingSection(content: string, heading: string): string {
	const lines = content.split('\n');
	const headingPattern = new RegExp(`^#{1,6}\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');

	let startIdx = -1;
	let headingLevel = 0;

	// Find heading
	for (let i = 0; i < lines.length; i++) {
		if (headingPattern.test(lines[i] || '')) {
			startIdx = i;
			const match = lines[i]?.match(/^#+/);
			headingLevel = match ? match[0].length : 0;
			break;
		}
	}

	if (startIdx === -1) return '';

	// Extract until next same-or-higher level heading
	let endIdx = lines.length;
	for (let i = startIdx + 1; i < lines.length; i++) {
		const line = lines[i];
		if (!line) continue;
		const match = line.match(/^(#+)\s/);
		if (match && match[1] && match[1].length <= headingLevel) {
			endIdx = i;
			break;
		}
	}

	return lines.slice(startIdx, endIdx).join('\n');
}

function extractBlock(content: string, blockId: string): string {
	const lines = content.split('\n');

	// Find line with ^block-id
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line) continue;
		if (line.includes(`^${blockId}`)) {
			// Extract the paragraph (until blank line)
			let startIdx = i;
			let endIdx = i + 1;

			// Go back to start of paragraph
			while (startIdx > 0 && (lines[startIdx - 1]?.trim() || '') !== '') {
				startIdx--;
			}

			// Go forward to end of paragraph
			while (endIdx < lines.length && (lines[endIdx]?.trim() || '') !== '') {
				endIdx++;
			}

			return lines.slice(startIdx, endIdx + 1).join('\n');
		}
	}

	return '';
}

async function extractContent(
	app: App,
	parsedLink: ParsedLink,
	sourcePath: string
): Promise<string> {
	// Resolve target file path using Obsidian's resolver
	const targetFile = app.metadataCache.getFirstLinkpathDest(
		parsedLink.targetFile,
		sourcePath
	);

	if (!targetFile || !(targetFile instanceof TFile)) {
		return '';
	}

	const content = await app.vault.read(targetFile);

	switch (parsedLink.linkType) {
		case 'file':
			return content;

		case 'heading':
			if (!parsedLink.selector) return '';
			return extractHeadingSection(content, parsedLink.selector);

		case 'block':
			if (!parsedLink.selector) return '';
			return extractBlock(content, parsedLink.selector);

		default:
			return '';
	}
}

function visitFolder(
	settings: Obsidian2BookSettings,
	fileStr: TAbstractFile,
	app: App,
	onlyFolders = false,
	depth = 0
): void {
	if (fileStr instanceof TFile && !onlyFolders) {
		const file: TFile = fileStr;
		fileList.push({
			type: "file",
			path: (depth > 0 ? "/" : "") + file.path,
			name: file.name,
			graphicName: file.basename,
			creationTime: file.stat.ctime,
			modificationTime: file.stat.mtime,
			depth,
			document: file,
		});
	} else if (fileStr instanceof TFolder) {
		const dir: TFolder = fileStr;
		fileList.push({
			type: "folder",
			path: (depth > 0 ? "/" : "") + dir.path,
			name: dir.name,
			graphicName: dir.name,
			depth,
			document: dir,
		});
		let allChild: TAbstractFile[] = dir.children;
		allChild = allChild.sort((a, b) => {
			if (isDocFolder(a) && isDocFile(b)) {
				if (
					settings.lowGraneSortingStrategy ===
					LowGraneSortingStrategy.FILEFIRST
				)
					return 1;
				// Folder First
				else return -1;
			}
			if (isDocFile(a) && isDocFolder(b)) {
				if (
					settings.lowGraneSortingStrategy ===
					LowGraneSortingStrategy.FILEFIRST
				)
					return -1;
				// Folder First
				else return 1;
			}
			if (isDocFolder(a) && isDocFolder(b)) {
				const dirA: TFolder = a as TFolder;
				const dirB: TFolder = b as TFolder;
				return dirA.name.localeCompare(dirB.name);
			}
			if (isDocFile(a) && isDocFile(b)) {
				const fileA: TFile = a as TFile;
				const fileB: TFile = b as TFile;
				switch (settings.sortingStrategy) {
					case SortingStrategy.ALPHABETICAL:
						return fileA.basename.localeCompare(fileB.basename);
					case SortingStrategy.CREATION_TIME:
						return fileA.stat.ctime - fileB.stat.ctime;
				}
			}
			return 0;
		});

		for (let i = 0; i < allChild.length; i++) {
			const child = allChild[i];
			if (!child) continue;

			// Skip files when onlyFolders is true
			if (onlyFolders && child instanceof TFile) {
				continue;
			}
			// Skip folders that should be ignored
			if (child instanceof TFolder && !checkFolder(child, settings)) {
				continue;
			}
			// Note: File filtering via checkFile() is handled in generateBook()
			// where it can be properly awaited. We skip it here since checkFile is async
			// and this function is called in synchronous contexts (e.g., PathFuzzy.getItems)
			visitFolder(settings, child, app, onlyFolders, depth + 1);
		}
	}
}

async function getTableOfContent(
	app: App,
	currPath: string,
	currDepth: number,
	fileList: fileStruct[],
	settings: Obsidian2BookSettings
): Promise<string> {
	const tocArray: fileStruct[] = [...fileList].filter(
		(file) => file.depth === currDepth + 1 && file.path.includes(currPath)
	);
	let toc = "";
	for (const file of tocArray) {
		if (file.type === "folder") {
			const isFolderValid = checkFolder(
				file.document as TFolder,
				{ ...settings }
			);
			if (isFolderValid) toc += `📂 [[#${file.graphicName}]]\n`;
		} else {
			const isFileValid = await checkFile(
				app,
				file.document as TFile,
				settings
			);
			if (isFileValid) toc += `📄 [[#${file.graphicName}]]\n`;
		}
	}
	return toc;
}

function getSpacer(isFullPage = false): string {
	if (isFullPage) {
		return '<div style="page-break-after: always;"></div>';
	}
	return '<div style="height: 200px;"></div>';
}

const clamp = (number: number, min: number, max: number): number =>
	Math.max(min, Math.min(number, max));

async function generateBook(
	app: App,
	settings: Obsidian2BookSettings,
	startingFolder = "/",
	depthOffset = 0
): Promise<boolean> {
	const { vault } = app;

	const generateTOCs = settings.generateTOCs;

	const files: TAbstractFile | null = vault.getAbstractFileByPath("/");
	if (files === null || !isDocFolder(files)) {
		console.error("Could not find folder: " + startingFolder);
		if (startingFolder === "/") new Notice("Empty Vault");
		else new Notice("Could not find folder: " + startingFolder);
		return Promise.resolve(false);
	}

	visitFolder(settings, files, app);
	const documents: fileStruct[] = fileList.filter((d) =>
		d.path.startsWith(startingFolder)
	);
	fileList = [];

	let content = `\n`;

	content += "\n<!--book-ignore-->\n<!--dont-delete-these-comments-->\n\n";

	for (let i = 0; i < documents.length; i++) {
		const file = documents[i];
		if (!file) continue;

		if (file.type === "folder") {
			const isFolderValid = checkFolder(file.document as TFolder, {
				...settings,
			});
			if (!isFolderValid) continue;
		}
		if (file.type === "file") {
			const isFileValid = await checkFile(app, file.document as TFile, {
				...settings,
			});
			if (!isFileValid) continue;
		}
		const currToc = await getTableOfContent(
			app,
			file.path,
			file.depth,
			documents,
			{ ...settings }
		);
		if (i == 0 && startingFolder == "/") {
			content += `# ${vault.getName()}\n\n${
				generateTOCs ? currToc : ""
			}\n\n---\n\n${getSpacer(true)}\n\n`;
		} else {
			const fileDepth = clamp(file.depth - depthOffset, 1, 6);
			const titleMD = new Array(fileDepth).fill("#").join("");
			if (file.type === "folder") {
				content += `${
					file.depth == 1 ? getSpacer(true) : "---"
				}\n\n${titleMD} ${file.graphicName}\n\n${
					generateTOCs ? currToc : ""
				}\n\n---\n\n`;
			} else {
				content += `\n\n${titleMD} ${file.graphicName}\n\n![[${file.path}|${file.name}]]\n\n---\n\n`;
			}
		}
	}

	try {
		const fileName = `${
			vault.getName() +
			(startingFolder == "/"
				? ""
				: startingFolder.replace(/\s+|\\|\//g, "-"))
		}_book.md`;
		const fileExists = vault.getAbstractFileByPath(fileName);
		if (fileExists != null) {
			new ConfirmModal(
				app,
				"Overwrite",
				`A file named ${fileName} already exists. Do you want to overwrite it?`,
				() => {
					vault
						.modify(fileExists as TFile, content)
						.then(() =>
							app.workspace
								.getLeaf()
								.openFile(fileExists as TFile)
						);
				},
				() => {}
			).open();
		} else {
			const fileCreated = await vault.create(fileName, content);
			app.workspace.getLeaf().openFile(fileCreated);
		}
	} catch (e) {
		new Notice(e instanceof Error ? e.message : String(e));
	}

	return Promise.resolve(true);
}

class ConfirmModal extends Modal {
	private confirmCallback: () => void;
	private cancelCallback: () => void;

	constructor(
		app: App,
		title: string,
		content: string,
		confirmCallback: () => void,
		cancelCallback: () => void
	) {
		super(app);
		this.titleEl.setText(title);
		this.contentEl.setText(content);
		this.confirmCallback = confirmCallback;
		this.cancelCallback = cancelCallback;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createDiv({ cls: "modal-button-container" }, (div) => {
			div.createEl(
				"button",
				{ text: "Confirm", cls: "mod-cta" },
				(button) => {
					button.onClickEvent(() => {
						this.close();
						this.confirmCallback();
					});
				}
			);
			div.createEl("button", { text: "Cancel" }, (button) => {
				button.onClickEvent(() => {
					this.close();
					this.cancelCallback();
				});
			});
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

export class PathFuzzy extends FuzzySuggestModal<fileStruct> {
	plugin: Obsidian2BookClass;
	selectCallBack: any;
	constructor(plugin: Obsidian2BookClass, selectCallBack: any) {
		super(plugin.app);
		this.plugin = plugin;
		this.selectCallBack = selectCallBack;
	}

	getItems(): fileStruct[] {
		visitFolder(
			this.plugin.settings,
			this.app.vault.getRoot(),
			this.app,
			true
		);
		const files = [...fileList];
		fileList = [];
		return files;
	}

	getItemText(folder: fileStruct): string {
		return folder.path;
	}

	onChooseItem(folder: fileStruct) {
		new Notice(`Selected ${folder.path}`);
		const depthOffset =
			folder.path.split("").filter((x) => x == "/").length - 1;
		this.selectCallBack(
			this.plugin.app,
			this.plugin.settings,
			folder.path,
			depthOffset
		);
	}
}

class Obsidian2BookSettingsPage extends PluginSettingTab {
	plugin: Obsidian2BookClass;

	constructor(app: App, plugin: Obsidian2BookClass) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("Generate TOCs")
			.setDesc("Generate Table of Contents for all directories")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.generateTOCs)
					.onChange(async (value) => {
						this.plugin.settings.generateTOCs = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Include Empty folders")
			.setDesc("Show titles of folders even if empty")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.includeEmptyFolders)
					.onChange(async (value) => {
						this.plugin.settings.includeEmptyFolders = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Sorting strategy")
			.setDesc("Sorting strategy for the book")
			.addDropdown((dropdown) =>
				dropdown
					.addOption(SortingStrategy.ALPHABETICAL, "Alphabetical")
					.addOption(SortingStrategy.CREATION_TIME, "Creation time")
					.setValue(this.plugin.settings.sortingStrategy)
					.onChange(async (value) => {
						this.plugin.settings.sortingStrategy =
							value as SortingStrategy;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Sorting order")
			.setDesc("Sorting order for the book")
			.addDropdown((dropdown) =>
				dropdown
					.addOption(LowGraneSortingStrategy.FILEFIRST, "File First")
					.addOption(
						LowGraneSortingStrategy.FOLDERFIRST,
						"Folder First"
					)
					.setValue(this.plugin.settings.lowGraneSortingStrategy)
					.onChange(async (value) => {
						this.plugin.settings.lowGraneSortingStrategy =
							value as LowGraneSortingStrategy;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Add file to ignore")
			.setDesc("Add file name to the list of file to be ignored")
			.addButton((button) =>
				button.setButtonText("Add Element").onClick(async () => {
					this.plugin.settings.filesToIgnore.push("");
					await this.plugin.saveSettings();
					this.display();
				})
			);

		for (let i = 0; i < this.plugin.settings.filesToIgnore.length; i++) {
			const element = this.plugin.settings.filesToIgnore[i];
			if (element === undefined) continue;
			new Setting(containerEl)
				.setName("File to ignore " + i)
				.setDesc("Set file name to ignore")
				.addText((text) =>
					text
						.setPlaceholder("Enter file name")
						.setValue(element)
						.onChange(async (value) => {
							this.plugin.settings.filesToIgnore[i] = value;
							await this.plugin.saveSettings();
						})
				)
				.addButton((button) =>
					button.setButtonText("-").onClick(async () => {
						this.plugin.settings.filesToIgnore.splice(i, 1);
						await this.plugin.saveSettings();
						this.display();
					})
				);
		}

		new Setting(containerEl)
			.setName("Add extension to ignore")
			.setDesc("Add extension to the list of extensions to be ignored")
			.addButton((button) =>
				button.setButtonText("Add Element").onClick(async () => {
					this.plugin.settings.extensionsToIgnore.push("");
					await this.plugin.saveSettings();
					this.display();
				})
			);

		for (
			let i = 0;
			i < this.plugin.settings.extensionsToIgnore.length;
			i++
		) {
			const element = this.plugin.settings.extensionsToIgnore[i];
			if (element === undefined) continue;
			new Setting(containerEl)
				.setName("Extension to ignore " + i)
				.setDesc("Set exntesion to ignore")
				.addText((text) =>
					text
						.setPlaceholder("Enter exntesion")
						.setValue(element)
						.onChange(async (value) => {
							this.plugin.settings.extensionsToIgnore[i] = value;
							await this.plugin.saveSettings();
						})
				)
				.addButton((button) =>
					button.setButtonText("-").onClick(async () => {
						this.plugin.settings.extensionsToIgnore.splice(i, 1);
						await this.plugin.saveSettings();
						this.display();
					})
				);
		}

		new Setting(containerEl)
			.setName("Add folder to ignore")
			.setDesc("Add folder name to the list of folder to be ignored")
			.addButton((button) =>
				button.setButtonText("Add Element").onClick(async () => {
					this.plugin.settings.foldersToIgnore.push("");
					await this.plugin.saveSettings();
					this.display();
				})
			);

		for (let i = 0; i < this.plugin.settings.foldersToIgnore.length; i++) {
			const element = this.plugin.settings.foldersToIgnore[i];
			if (element === undefined) continue;
			new Setting(containerEl)
				.setName("Folder to ignore " + i)
				.setDesc("Set folder name to ignore")
				.addText((text) =>
					text
						.setPlaceholder("Enter folder name")
						.setValue(element)
						.onChange(async (value) => {
							this.plugin.settings.foldersToIgnore[i] = value;
							await this.plugin.saveSettings();
						})
				)
				.addButton((button) =>
					button.setButtonText("-").onClick(async () => {
						this.plugin.settings.foldersToIgnore.splice(i, 1);
						await this.plugin.saveSettings();
						this.display();
					})
				);
		}

		new Setting(containerEl)
			.setName("Add tags to ignore")
			.setDesc("Add tags name to the list of tags to be ignored")
			.addButton((button) =>
				button.setButtonText("Add Element").onClick(async () => {
					this.plugin.settings.tagsToIgnore.push("");
					await this.plugin.saveSettings();
					this.display();
				})
			);

		for (let i = 0; i < this.plugin.settings.tagsToIgnore.length; i++) {
			const element = this.plugin.settings.tagsToIgnore[i];
			if (element === undefined) continue;
			new Setting(containerEl)
				.setName("Tag to ignore " + i)
				.setDesc("Set tag to ignore")
				.addText((text) =>
					text
						.setPlaceholder("Enter tag")
						.setValue(element)
						.onChange(async (value) => {
							this.plugin.settings.tagsToIgnore[i] = value;
							await this.plugin.saveSettings();
						})
				)
				.addButton((button) =>
					button.setButtonText("-").onClick(async () => {
						this.plugin.settings.tagsToIgnore.splice(i, 1);
						await this.plugin.saveSettings();
						this.display();
					})
				);
		}
	}
}
