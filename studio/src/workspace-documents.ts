export interface WorkspaceDocument {
  id: string;
  view: string;
  namespace: string;
  param?: string;
}

export interface WorkspaceDocumentState {
  documents: WorkspaceDocument[];
  active: string;
}

const VERSION = 1;
const MAX_DOCUMENTS = 12;
const VIEWS = new Set(["overview", "explorer", "graph", "scripts", "search", "memory", "admin", "cluster", "access"]);

export function workspaceDocument(view: string, namespace: string, param?: string): WorkspaceDocument {
  const cleanView = VIEWS.has(view) ? view : "overview";
  const cleanNamespace = namespace || "default";
  const cleanParam = param || undefined;
  return {
    // A document is a tool inside one namespace. Route parameters (such as
    // the selected node) update that document instead of spawning new tabs.
    id: [cleanView, cleanNamespace].map(encodeURIComponent).join(":"),
    view: cleanView,
    namespace: cleanNamespace,
    ...(cleanParam ? { param: cleanParam } : {}),
  };
}

export function addWorkspaceDocument(documents: WorkspaceDocument[], document: WorkspaceDocument): WorkspaceDocument[] {
  if (documents.some((item) => item.id === document.id)) {
    return documents.map((item) => (item.id === document.id ? document : item));
  }
  return [...documents.slice(-(MAX_DOCUMENTS - 1)), document];
}

export function workspaceStorageKey(identity: string): string {
  return `grafeno.studio.workspace.${encodeURIComponent(identity)}`;
}

export function readWorkspaceDocuments(key: string): WorkspaceDocumentState | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as { version?: unknown; documents?: unknown; active?: unknown };
    if (value.version !== VERSION || !Array.isArray(value.documents) || typeof value.active !== "string") return null;
    const documents = value.documents
      .filter((item): item is Partial<WorkspaceDocument> => Boolean(item) && typeof item === "object")
      .filter((item) => typeof item.view === "string" && VIEWS.has(item.view) && typeof item.namespace === "string")
      .map((item) => workspaceDocument(item.view!, item.namespace!, typeof item.param === "string" ? item.param : undefined))
      .filter((item, index, list) => list.findIndex((candidate) => candidate.id === item.id) === index)
      .slice(-MAX_DOCUMENTS);
    if (documents.length === 0) return null;
    const previousActive = value.documents.find(
      (item): item is Partial<WorkspaceDocument> & { view: string; namespace: string } =>
        Boolean(item) && typeof item === "object" && "id" in item && item.id === value.active &&
        typeof item.view === "string" && typeof item.namespace === "string",
    );
    const activeDocument = previousActive
      ? workspaceDocument(previousActive.view, previousActive.namespace, typeof previousActive.param === "string" ? previousActive.param : undefined)
      : undefined;
    const restored = activeDocument ? documents.map((item) => (item.id === activeDocument.id ? activeDocument : item)) : documents;
    const migratedActive = activeDocument?.id ?? value.active;
    return { documents: restored, active: restored.some((item) => item.id === migratedActive) ? migratedActive : restored[0].id };
  } catch {
    return null;
  }
}

export function writeWorkspaceDocuments(key: string, state: WorkspaceDocumentState): void {
  try {
    localStorage.setItem(key, JSON.stringify({ version: VERSION, documents: state.documents, active: state.active }));
  } catch {
    // Workspace restoration is a convenience; navigation still works without storage.
  }
}
