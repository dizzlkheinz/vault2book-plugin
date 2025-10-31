# Link-Following Book Generation Design

**Date:** 2025-01-30
**Feature:** Generate books from a single file by following wikilinks
**Status:** Design approved, ready for implementation

## Overview

Add ability to generate a book from a single source file by following its wikilinks and including referenced content as endnotes with bidirectional navigation.

### User Story

As a user, I want to create a book from a single "table of contents" note that links to other notes, so I can curate specific content without having to organize it into folders.

### Key Requirements

1. **One-level link following**: Only follow links directly in the source file (no recursive following)
2. **Order preservation**: Include linked files in order of appearance in source document
3. **Filter compliance**: Apply existing ignore filters (tags, extensions, filenames) to linked files
4. **Source file inclusion**: Source file content appears at top of book as introduction
5. **Granular link support**:
   - `[[file]]` → include entire file
   - `[[file#heading]]` → include heading section only
   - `[[file#^block-id]]` → include specific block only
6. **Endnote navigation**:
   - Replace links with `[[#📎 ref-N]]` markers
   - Add referenced content at bottom with `[[#↑ Source Title]]` return links

## Architecture

### High-Level Flow

```
Source File
    ↓
Extract Links (via Obsidian metadata cache)
    ↓
Parse Each Link (file/heading/block)
    ↓
Apply Ignore Filters
    ↓
Extract Content (based on link type)
    ↓
Generate Book:
  - Modified source content (with ref markers)
  - Referenced content sections (with return links)
```

### Core Components

**1. Link Parsing (`parseLink`)**
- Input: `LinkCache` from Obsidian metadata
- Output: `ParsedLink` with type and selector
- Logic:
  - Contains `#^` → block reference
  - Contains `#` → heading reference
  - No `#` → whole file

**2. Content Extraction (`extractContent`)**
- Input: `App`, `ParsedLink`
- Output: Extracted content string
- Delegates to:
  - `extractHeadingSection()` - find heading, extract until next same-level heading
  - `extractBlock()` - find block ID, extract paragraph
  - Full file read for file-type links

**3. Reference Collection (`collectReferences`)**
- Input: `App`, source `TFile`, `Settings`
- Output: Array of `Reference` objects
- Steps:
  1. Get metadata cache links
  2. Parse each link
  3. Resolve target file path
  4. Apply ignore filters via `checkFile()`
  5. Extract content
  6. Build reference object with ID

**4. Book Assembly (`generateBookFromFile`)**
- Input: `App`, `Settings`, source `TFile`
- Output: Complete book markdown
- Steps:
  1. Collect all valid references
  2. Replace original links with `[[#📎 ref-N]]` markers
  3. Add source content with book-ignore comment
  4. Append reference sections with return links

## Data Structures

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

## Implementation Details

### Link Parsing

Use Obsidian's `app.metadataCache.getFileCache(file)` which provides:
```typescript
{
  links: [
    {
      link: "target-file#heading",
      original: "[[target-file#heading|Custom Text]]",
      position: { start: {...}, end: {...} }
    }
  ]
}
```

**Why metadata cache over regex:**
- Already handles edge cases (code blocks, comments)
- Maintained by Obsidian - syntax changes handled automatically
- Existing dependency in codebase

### Heading Extraction

```typescript
function extractHeadingSection(content: string, heading: string): string {
  const lines = content.split('\n');
  const headingPattern = new RegExp(`^#{1,6}\\s+${heading}\\s*$`, 'i');

  let startIdx = -1;
  let headingLevel = 0;

  // Find heading
  for (let i = 0; i < lines.length; i++) {
    if (headingPattern.test(lines[i])) {
      startIdx = i;
      headingLevel = lines[i].match(/^#+/)?.[0].length || 0;
      break;
    }
  }

  if (startIdx === -1) return '';

  // Extract until next same-or-higher level heading
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const match = lines[i].match(/^(#+)\s/);
    if (match && match[1].length <= headingLevel) {
      endIdx = i;
      break;
    }
  }

  return lines.slice(startIdx, endIdx).join('\n');
}
```

### Block Extraction

```typescript
function extractBlock(content: string, blockId: string): string {
  const lines = content.split('\n');

  // Find line with ^block-id
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(`^${blockId}`)) {
      // Extract the paragraph (until blank line)
      let startIdx = i;
      let endIdx = i + 1;

      // Go back to start of paragraph
      while (startIdx > 0 && lines[startIdx - 1].trim() !== '') {
        startIdx--;
      }

      // Go forward to end of paragraph
      while (endIdx < lines.length && lines[endIdx].trim() !== '') {
        endIdx++;
      }

      return lines.slice(startIdx, endIdx + 1).join('\n');
    }
  }

  return '';
}
```

### File Path Resolution

Use Obsidian's built-in resolver:
```typescript
const targetFile = app.metadataCache.getFirstLinkpathDest(
  parsedLink.targetFile,
  sourceFile.path  // Context for relative links
);
```

This handles:
- Relative vs absolute paths
- File extensions (`.md` optional in links)
- Duplicate filenames (uses closest match)

## UI Integration

### New Command

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
      const bookFile = await this.app.vault.create(fileName, content);
      await this.app.workspace.getLeaf().openFile(bookFile);
      new Notice(`Book generated: ${fileName}`);
    } catch (e) {
      new Notice(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
});
```

### File Context Menu

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
            await this.app.vault.create(fileName, content);
            new Notice(`Book generated: ${fileName}`);
          } catch (e) {
            new Notice(`Error: ${e instanceof Error ? e.message : String(e)}`);
          }
        });
    });
  })
);
```

## Example Output

**Source file:** `research-toc.md`
```markdown
# My Research

Authentication uses JWT [[auth-doc#JWT Setup]].

Configuration details: [[config#Environment Variables]].

See the troubleshooting guide [[troubleshooting]].
```

**Generated book:** `research-toc_book.md`
```markdown
<!--book-ignore-->
<!--dont-delete-these-comments-->

# My Research

Authentication uses JWT [[#📎 ref-1]].

Configuration details: [[#📎 ref-2]].

See the troubleshooting guide [[#📎 ref-3]].

---

## 📎 ref-1
[[#↑ My Research]]

### JWT Setup

JWT tokens are generated using...

[content from auth-doc#JWT Setup section]

---

## 📎 ref-2
[[#↑ My Research]]

### Environment Variables

The following environment variables...

[content from config#Environment Variables section]

---

## 📎 ref-3
[[#↑ My Research]]

# Troubleshooting Guide

[entire troubleshooting.md file content]

---
```

## Edge Cases & Error Handling

### Broken Links
**Scenario:** Link points to non-existent file/heading/block
**Handling:** Skip the reference, don't add to endnotes, leave original link syntax in source

### Circular References
**Scenario:** Source file links to itself
**Handling:** Not possible with one-level following, but check anyway and skip

### Duplicate Links
**Scenario:** Source links to same file/heading multiple times
**Handling:** Create separate reference for each occurrence (`ref-1`, `ref-2`, etc.)

### Filtered Files
**Scenario:** Linked file matches ignore pattern (tag, extension, filename)
**Handling:** Skip the reference, leave original link in source

### Empty Content
**Scenario:** Heading/block extraction returns empty string
**Handling:** Skip the reference rather than create empty endnote

### Large Books
**Scenario:** Many references create very long book
**Handling:** No artificial limit, but consider adding notice "Generated book with N references"

## Testing Considerations

### Unit Tests
- `parseLink()` - various link formats
- `extractHeadingSection()` - different heading levels, nested headings
- `extractBlock()` - block at different positions, multi-line blocks
- Filter application on linked files

### Integration Tests
- Full book generation with mixed link types
- Return link navigation works in Obsidian
- Book exports to PDF correctly

### Manual Testing Checklist
- [ ] Generate book from file with file-only links
- [ ] Generate book from file with heading links
- [ ] Generate book from file with block links
- [ ] Generate book from file with mixed link types
- [ ] Verify ignore filters work on linked files
- [ ] Test return links work (click ↑, returns to top)
- [ ] Test reference links work (click 📎, goes to endnote)
- [ ] Export to PDF and verify links work
- [ ] Test with broken links (file doesn't exist)
- [ ] Test with duplicate links to same target

## Open Questions

1. **Custom display text:** If link is `[[file|Custom Text]]`, should reference marker preserve custom text?
   - **Decision:** Yes, use `[[#📎 ref-1|Custom Text]]`

2. **Reference formatting:** Should references inherit source file heading level or always be H2?
   - **Decision:** Always H2 for consistency

3. **Empty source sections:** If source file has no content besides links, include it anyway?
   - **Decision:** Yes, include even if empty (user intent was to use it)

## Future Enhancements

- Recursive link following (configurable depth)
- Option to include/exclude source file
- Order customization (appearance vs alphabetical)
- Toggle for filter application on linked files
- Preview mode before generating book
- Batch processing (select multiple files, generate from each)

## Dependencies

**Existing:**
- `checkFile()` - filter validation
- `app.metadataCache` - link parsing
- `app.vault` - file reading
- Obsidian types: `TFile`, `LinkCache`, `CachedMetadata`

**New:**
- None - uses existing Obsidian API

## Implementation Estimate

**Core functionality:** 4-6 hours
- Link parsing: 1 hour
- Content extraction: 2 hours
- Book assembly: 1-2 hours
- UI integration: 1 hour

**Testing & refinement:** 2-3 hours
- Edge cases
- Manual testing
- Bug fixes

**Total:** 6-9 hours
