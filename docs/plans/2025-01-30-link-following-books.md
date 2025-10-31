# Link-Following Book Generation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add ability to generate books from a single file by following its wikilinks and including referenced content as endnotes with bidirectional navigation.

**Architecture:** Extract links from source file using Obsidian's metadata cache, categorize as file/heading/block references, extract content accordingly, generate book with inline reference markers `[[#📎 ref-N]]` at link points and full content sections at bottom with `[[#↑ return]]` links.

**Tech Stack:** TypeScript 5.6, Obsidian API (metadataCache, vault), existing filtering infrastructure

---

## Task 1: Add Link Parsing Types and Interfaces

**Files:**
- Modify: `main.ts` (add after existing types around line 133)

**Step 1: Add ParsedLink and Reference interfaces**

Add these types after the `fileStruct` type definition:

```typescript
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
```

**Step 2: Commit**

```bash
git add main.ts
git commit -m "Add ParsedLink and Reference type definitions"
```

---

## Task 2: Implement Link Parser

**Files:**
- Modify: `main.ts` (add after `checkFolder` function around line 213)

**Step 1: Add parseLink function**

```typescript
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
```

**Step 2: Build to verify no TypeScript errors**

```bash
npm run build
```

Expected: Build succeeds

**Step 3: Commit**

```bash
git add main.ts
git commit -m "Add parseLink function for categorizing wikilink types"
```

---

## Task 3: Implement Heading Extraction

**Files:**
- Modify: `main.ts` (add after `parseLink` function)

**Step 1: Add extractHeadingSection function**

```typescript
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
		if (match && match[1].length <= headingLevel) {
			endIdx = i;
			break;
		}
	}

	return lines.slice(startIdx, endIdx).join('\n');
}
```

**Step 2: Build to verify no TypeScript errors**

```bash
npm run build
```

Expected: Build succeeds

**Step 3: Commit**

```bash
git add main.ts
git commit -m "Add extractHeadingSection for heading-level content extraction"
```

---

## Task 4: Implement Block Extraction

**Files:**
- Modify: `main.ts` (add after `extractHeadingSection` function)

**Step 1: Add extractBlock function**

```typescript
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
```

**Step 2: Build to verify no TypeScript errors**

```bash
npm run build
```

Expected: Build succeeds

**Step 3: Commit**

```bash
git add main.ts
git commit -m "Add extractBlock for block-level content extraction"
```

---

## Task 5: Implement Content Extraction Router

**Files:**
- Modify: `main.ts` (add after `extractBlock` function)

**Step 1: Add extractContent function**

```typescript
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
```

**Step 2: Build to verify no TypeScript errors**

```bash
npm run build
```

Expected: Build succeeds

**Step 3: Commit**

```bash
git add main.ts
git commit -m "Add extractContent router for all link types"
```

---

## Task 6: Implement Reference Collection

**Files:**
- Modify: `main.ts` (add after `extractContent` function)

**Step 1: Add collectReferences function**

```typescript
async function collectReferences(
	app: App,
	sourceFile: TFile,
	settings: Obsidian2BookSettings
): Promise<Reference[]> {
	const cache = app.metadataCache.getFileCache(sourceFile);
	const links = cache?.links || [];
	const references: Reference[] = [];

	for (let i = 0; i < links.length; i++) {
		const link = links[i];
		if (!link) continue;

		const parsed = parseLink(link);

		// Resolve target file
		const targetFile = app.metadataCache.getFirstLinkpathDest(
			parsed.targetFile,
			sourceFile.path
		);

		if (!targetFile || !(targetFile instanceof TFile)) continue;

		// Apply ignore filters
		const isValid = await checkFile(app, targetFile, settings);
		if (!isValid) continue;

		// Extract content
		const content = await extractContent(app, parsed, sourceFile.path);
		if (!content || content.trim() === '') continue;

		references.push({
			id: `ref-${i + 1}`,
			parsedLink: parsed,
			content,
			sourceHeading: sourceFile.basename
		});
	}

	return references;
}
```

**Step 2: Build to verify no TypeScript errors**

```bash
npm run build
```

Expected: Build succeeds

**Step 3: Commit**

```bash
git add main.ts
git commit -m "Add collectReferences to gather and filter all linked content"
```

---

## Task 7: Implement Book Assembly from File

**Files:**
- Modify: `main.ts` (add after `collectReferences` function)

**Step 1: Add generateBookFromFile function**

```typescript
async function generateBookFromFile(
	app: App,
	settings: Obsidian2BookSettings,
	sourceFile: TFile
): Promise<string> {
	let book = `<!--book-ignore-->\n<!--dont-delete-these-comments-->\n\n`;

	// 1. Collect all references
	const references = await collectReferences(app, sourceFile, settings);

	// 2. Read source file and replace links with reference markers
	let sourceContent = await app.vault.read(sourceFile);

	// Replace each original link with reference marker
	references.forEach((ref) => {
		const refMarker = ref.parsedLink.displayText
			? `[[#📎 ${ref.id}|${ref.parsedLink.displayText}]]`
			: `[[#📎 ${ref.id}]]`;
		sourceContent = sourceContent.replace(
			ref.parsedLink.originalLink,
			refMarker
		);
	});

	// 3. Add source file content
	book += `# ${sourceFile.basename}\n\n`;
	book += sourceContent;
	book += '\n\n---\n\n';

	// 4. Add all references as endnotes
	references.forEach(ref => {
		book += `## 📎 ${ref.id}\n`;
		book += `[[#↑ ${ref.sourceHeading}]]\n\n`;
		book += ref.content;
		book += '\n\n---\n\n';
	});

	return book;
}
```

**Step 2: Build to verify no TypeScript errors**

```bash
npm run build
```

Expected: Build succeeds

**Step 3: Commit**

```bash
git add main.ts
git commit -m "Add generateBookFromFile for complete book assembly"
```

---

## Task 8: Add Command Palette Command

**Files:**
- Modify: `main.ts:onload()` method (add after existing commands around line 92)

**Step 1: Add new command registration**

Add this command after the "generate-book-from-folder" command:

```typescript
this.addCommand({
	id: "generate-book-from-file",
	name: "Generate book from this file",
	callback: async () => {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice("No active file");
			return;
		}

		try {
			const content = await generateBookFromFile(
				this.app,
				this.settings,
				activeFile
			);
			const fileName = `${activeFile.basename}_book.md`;
			const existingFile = this.app.vault.getAbstractFileByPath(fileName);

			if (existingFile != null) {
				new ConfirmModal(
					this.app,
					"Overwrite",
					`A file named ${fileName} already exists. Do you want to overwrite it?`,
					async () => {
						await this.app.vault.modify(existingFile as TFile, content);
						await this.app.workspace.getLeaf().openFile(existingFile as TFile);
						new Notice(`Book updated: ${fileName}`);
					},
					() => {}
				).open();
			} else {
				const bookFile = await this.app.vault.create(fileName, content);
				await this.app.workspace.getLeaf().openFile(bookFile);
				new Notice(`Book generated: ${fileName}`);
			}
		} catch (e) {
			new Notice(`Error: ${e instanceof Error ? e.message : String(e)}`);
		}
	}
});
```

**Step 2: Build to verify no TypeScript errors**

```bash
npm run build
```

Expected: Build succeeds

**Step 3: Commit**

```bash
git add main.ts
git commit -m "Add command palette command for book from file generation"
```

---

## Task 9: Add File Context Menu Integration

**Files:**
- Modify: `main.ts:onload()` method (add after `addSettingTab` around line 94)

**Step 1: Add file menu event handler**

Add this registration after the `addSettingTab` call:

```typescript
this.registerEvent(
	this.app.workspace.on('file-menu', (menu, file) => {
		if (!(file instanceof TFile)) return;

		menu.addItem((item) => {
			item
				.setTitle('Generate book from this file')
				.setIcon('book')
				.onClick(async () => {
					try {
						const content = await generateBookFromFile(
							this.app,
							this.settings,
							file
						);
						const fileName = `${file.basename}_book.md`;
						const existingFile = this.app.vault.getAbstractFileByPath(fileName);

						if (existingFile != null) {
							new ConfirmModal(
								this.app,
								"Overwrite",
								`A file named ${fileName} already exists. Do you want to overwrite it?`,
								async () => {
									await this.app.vault.modify(existingFile as TFile, content);
									new Notice(`Book updated: ${fileName}`);
								},
								() => {}
							).open();
						} else {
							await this.app.vault.create(fileName, content);
							new Notice(`Book generated: ${fileName}`);
						}
					} catch (e) {
						new Notice(`Error: ${e instanceof Error ? e.message : String(e)}`);
					}
				});
		});
	})
);
```

**Step 2: Build to verify no TypeScript errors**

```bash
npm run build
```

Expected: Build succeeds

**Step 3: Commit**

```bash
git add main.ts
git commit -m "Add file context menu integration for book generation"
```

---

## Task 10: Update README Documentation

**Files:**
- Modify: `README.md` (add to Usage section after line 27)

**Step 1: Add documentation for new feature**

Add this section after the folder-based generation documentation:

```markdown
Generate a book from a specific file by running the command `Vault 2 Book: Generate book from this file` from the command palette (`Ctrl/Cmd + P`) or right-clicking the file in the file explorer.

This will:
- Follow all wikilinks in the source file (one level only)
- Extract referenced content (full files, heading sections, or blocks)
- Apply your ignore filters to linked files
- Generate a book with endnote-style navigation:
  - Links become reference markers like `[[#📎 ref-1]]`
  - Referenced content appears at bottom with return links `[[#↑ Source]]`

The book will be generated in the root of your vault with the name `<source-file>_book.md`.
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add link-following book generation to README"
```

---

## Task 11: Final Build and Verification

**Files:**
- All modified files

**Step 1: Clean build**

```bash
npm run build
```

Expected: Build succeeds with no errors

**Step 2: Verify TypeScript strict mode compliance**

The build command already runs `tsc -noEmit -skipLibCheck` which verifies all strict type checking passes.

Expected: No TypeScript errors

**Step 3: Create final commit**

```bash
git add -A
git commit -m "feat: complete link-following book generation feature

Adds ability to generate books from single files by following wikilinks.
Supports file/heading/block granularity with endnote-style navigation.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Testing Checklist (Manual)

After implementation, test these scenarios in Obsidian:

**Basic functionality:**
- [ ] Generate book from file with only `[[file]]` links
- [ ] Generate book from file with `[[file#heading]]` links
- [ ] Generate book from file with `[[file#^block]]` links
- [ ] Generate book from file with mixed link types
- [ ] Verify reference markers `[[#📎 ref-N]]` appear in source
- [ ] Verify return links `[[#↑ Source]]` work (click returns to top)

**Edge cases:**
- [ ] Broken link (file doesn't exist) - should skip gracefully
- [ ] Link to heading that doesn't exist - should skip
- [ ] Link to block that doesn't exist - should skip
- [ ] Linked file matches ignore filter - should skip
- [ ] Empty extracted content - should skip reference
- [ ] Duplicate links to same target - should create separate refs

**UI integration:**
- [ ] Command palette command appears
- [ ] Right-click file shows "Generate book from this file"
- [ ] Overwrite confirmation works for existing books
- [ ] Notice appears on success
- [ ] Error notice appears on failure

**Navigation:**
- [ ] Click `[[#📎 ref-1]]` jumps to endnote
- [ ] Click `[[#↑ Source]]` returns to top
- [ ] Works in Obsidian preview mode
- [ ] Works in Obsidian reading mode

---

## Rollback Plan

If issues discovered:

```bash
# Return to master
git checkout master

# Delete feature branch
git branch -D feature/link-following-books

# Remove worktree
git worktree remove .worktrees/link-following-books
```

---

## Notes for Implementation

**Key architectural decisions:**
- Using Obsidian's `metadataCache.getFileCache()` for link parsing ensures compatibility with all link formats
- Using `metadataCache.getFirstLinkpathDest()` for path resolution handles relative links and duplicate filenames correctly
- Reusing `checkFile()` ensures ignore filters work consistently across all generation modes
- String replacement for reference markers is simple but assumes original links are unique (Obsidian enforces this)

**Potential improvements for future:**
- Add setting to toggle filter application on linked files
- Add depth control for recursive link following
- Add preview modal before generating book
- Add batch processing for multiple files
