# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Vault 2 Book** is an Obsidian plugin that converts an Obsidian vault (or a portion of it) into a single markdown file that can be exported to PDF as a book. The plugin traverses the vault's file structure, respects user-defined ignore rules, and generates a consolidated document with table of contents and proper heading hierarchy.

## Development Commands

### Build and Development
- **Build for production**: `npm run build`
  - Runs TypeScript type checking (`tsc -noEmit -skipLibCheck`)
  - Bundles with esbuild in production mode
- **Development mode**: `npm run dev`
  - Runs esbuild in watch mode with inline sourcemaps
  - Automatically rebuilds on file changes
- **Version bump**: `npm run version`
  - Updates manifest.json and versions.json
  - Stages changes for git commit

### Linting
The project uses ESLint with TypeScript parser. Configuration in `.eslintrc`:
- Disabled rules: `no-unused-vars` (in favor of TypeScript version), `@typescript-eslint/ban-ts-comment`, `no-prototype-builtins`, `@typescript-eslint/no-empty-function`
- Active rule: `@typescript-eslint/no-unused-vars` with `args: "none"`

## Architecture

### Core Plugin Structure
The plugin is entirely contained in `main.ts` with the following key components:

**Main Plugin Class**: `Obsidian2BookClass`
- Manages plugin lifecycle (onload/onunload)
- Registers commands and ribbon icon
- Handles settings persistence via Obsidian's data API

**Core Generation Function**: `generateBook(app, settings, startingFolder, depthOffset)`
- Entry point for book generation
- Traverses vault structure using `visitFolder()`
- Filters files/folders based on settings
- Generates markdown with TOCs and proper heading hierarchy
- Creates book file with `<!--book-ignore-->` marker

### File Traversal System
**`visitFolder()` function**: Recursive traversal that:
- Builds `fileStruct[]` array representing vault hierarchy
- Sorts by strategy: alphabetical or creation time
- Applies low-grane sorting: file-first or folder-first
- Respects depth tracking for heading levels

**Filtering Logic**:
- `checkFile()`: Async validation against tagsToIgnore, extensionsToIgnore, filesToIgnore, and book marker
- `checkFolder()`: Validates against foldersToIgnore and empty folder setting
- `checkTags()`: Checks both inline tags (`#tag`) and frontmatter tags

### User Interfaces
**`PathFuzzy` Modal**: Fuzzy search for folder selection
- Uses `FuzzySuggestModal` from Obsidian API
- Populates with folder-only traversal
- Calculates depth offset for heading adjustment

**`ConfirmModal`**: Reusable confirmation dialog
- Used for overwrite confirmation
- Used for book deletion confirmation

**`Obsidian2BookSettingsPage`**: Dynamic settings UI
- Toggle settings for TOCs and empty folders
- Dropdowns for sorting strategies
- Dynamic list management for ignore patterns (files, folders, tags, extensions)

### Settings System
All settings stored in `Obsidian2BookSettings` interface:
- Arrays for ignore patterns (folders, files, tags, extensions)
- Boolean flags (generateTOCs, includeEmptyFolders)
- Enum-based strategies (SortingStrategy, LowGraneSortingStrategy)

## Key Behaviors

### Book Identification
Books are identified by the comment `<!--book-ignore-->` in the file content. This marker:
- Prevents books from being included in other books
- Enables bulk deletion via "Remove all generated books" command

### Heading Depth Management
- Heading depth is clamped between 1-6 (Markdown limit)
- Depth offset calculated from starting folder path depth
- Root vault book starts with H1 vault name, others preserve relative hierarchy

### Table of Contents
When enabled, TOCs are generated for each folder showing:
- 📂 for folders
- 📄 for files
- Uses Obsidian's `[[#heading]]` link syntax

### File Embedding
Files are embedded using `![[path|name]]` syntax, which Obsidian resolves when exporting to PDF.

## TypeScript Configuration
- Target: ES6 with ESNext modules
- **Strict mode enabled** with all strict checks:
  - `strict: true` (enables all strict type-checking options)
  - `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, `strictBindCallApply`
  - `strictPropertyInitialization`, `noImplicitThis`, `alwaysStrict`
- Additional strict checks:
  - `noUnusedLocals`, `noUnusedParameters` (catch unused code)
  - `noImplicitReturns` (all code paths must return)
  - `noFallthroughCasesInSwitch` (explicit breaks required)
  - `noUncheckedIndexedAccess` (array access returns `T | undefined`)
- Inline source maps for debugging
- Isolated modules for build performance

### Important: Array Access Patterns
With `noUncheckedIndexedAccess`, array access via `arr[i]` returns `T | undefined`. Always check for undefined:
```typescript
// Bad
const item = array[i];
item.someMethod(); // Error: item might be undefined

// Good
const item = array[i];
if (!item) continue;
item.someMethod(); // OK
```

## ESLint Configuration
- Parser: `@typescript-eslint/parser` v8 with type-aware linting
- Extends: `recommended` + `recommended-type-checked`
- Key rules:
  - `@typescript-eslint/no-unused-vars: error` (args: none)
  - `@typescript-eslint/ban-ts-comment`: Requires 10+ char description with `@ts-ignore`
  - `@typescript-eslint/no-floating-promises: error` (must await/catch promises)
  - `@typescript-eslint/await-thenable: error` (don't await non-promises)
  - `@typescript-eslint/no-explicit-any: warn`

## Build System (esbuild)
- Entry: `main.ts` → Output: `main.js`
- External modules: Obsidian API, Electron, CodeMirror, Lezer
- Tree-shaking enabled
- Format: CommonJS (required by Obsidian)
- Target: ES2018

## Dependencies
All dependencies are kept up-to-date with latest stable versions:
- TypeScript 5.6+
- esbuild 0.25+ (security patches applied)
- ESLint tooling v8+
- No known security vulnerabilities

Run `npm outdated` and `npm audit` periodically to check for updates.

## Installation Notes
Plugin is manually installed (not in official plugin library yet):
1. Clone to `VaultFolder/.obsidian/plugins/`
2. Run `npm install` and `npm run build`
3. Enable in Obsidian settings
