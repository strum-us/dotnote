export {
  DocumentIndex,
  extractTerms,
  nameMatchScore,
  tokenizePath,
} from "./document-index";
export { DocumentIndexes } from "./document-indexes";
export {
  filenameField,
  foldernameField,
  namesField,
} from "./name-fields";
export {
  rebuildIndex,
  handleFsEvent,
  applyLocalSave,
  applyLocalDelete,
  applyLocalMove,
  type BuildProgress,
} from "./build-index";
export {
  INDEX_UPDATE_DEBOUNCE_MS,
  createIndexUpdateScheduler,
  type IndexFsEvent,
  type IndexUpdateScheduler,
} from "./schedule-index-update";
export {
  buildRecord,
  deriveTitle,
  filenameStem,
} from "./build-record";
export { flattenMarkdownPaths } from "./flatten-tree";
export {
  extractFirstMarkdownHeading,
  normalizeContent,
  stripFrontmatter,
} from "./normalize-content";
export { extractSnippet, toSearchResults } from "./snippet";
export { highlightMatches } from "./highlight";
export {
  InProcessSearchIndexEngine,
  type RawDoc,
  type SearchIndexEngine,
} from "./search-index-engine";
export type {
  DocumentRecord,
  IndexStatus,
  SearchResult,
} from "./types";
