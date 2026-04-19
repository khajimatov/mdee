#!/usr/bin/env bun
import "./tree-sitter-worker-env.ts";
import {
  bold,
  BoxRenderable,
  createCliRenderer,
  fg,
  getTreeSitterClient,
  MarkdownRenderable,
  RGBA,
  ScrollBoxRenderable,
  SyntaxStyle,
  t,
  TextareaRenderable,
  TextRenderable,
  type CursorChangeEvent,
  type KeyEvent,
} from "@opentui/core";
import { basename, resolve } from "node:path";

type Mode = "view" | "edit";

function isModifierKey(key: KeyEvent): boolean {
  return key.ctrl || key.meta || key.shift || key.option || Boolean(key.super);
}

const h = (color: string, opts?: { bold?: boolean; italic?: boolean; underline?: boolean }) => ({
  fg: RGBA.fromHex(color),
  bold: opts?.bold,
  italic: opts?.italic,
  underline: opts?.underline,
});

function markdownSyntaxStyle(): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    default: h("#e6edf3"),
    conceal: h("#484f58"),

    "markup.heading.1": { ...h("#58a6ff"), bold: true },
    "markup.heading.2": { ...h("#79c0ff"), bold: true },
    "markup.heading.3": { ...h("#7ee787"), bold: true },
    "markup.heading.4": { ...h("#d2a8ff"), bold: true },
    "markup.heading.5": { ...h("#ffa657"), bold: true },
    "markup.heading.6": { ...h("#ff7b72"), bold: true },
    "markup.heading": { ...h("#58a6ff"), bold: true },

    "markup.list": h("#ff7b72"),
    "markup.list.checked": h("#7ee787"),
    "markup.list.unchecked": h("#8b949e"),
    "markup.quote": h("#8b949e"),
    "markup.raw": h("#79c0ff"),
    "markup.raw.block": h("#a5d6ff"),
    "markup.strong": { ...h("#e6edf3"), bold: true },
    "markup.italic": { ...h("#e6edf3"), italic: true },
    "markup.strikethrough": { ...h("#8b949e"), dim: true },

    "markup.link": h("#58a6ff"),
    "markup.link.label": h("#58a6ff"),
    "markup.link.url": { ...h("#a371f7"), underline: true },
    "markup.link.bracket.close": h("#58a6ff"),

    label: h("#ffa657"),
    "punctuation.special": h("#8b949e"),
    "punctuation.delimiter": h("#8b949e"),
    "keyword.directive": h("#d2a8ff"),
    "string.escape": h("#79c0ff"),
    "character.special": h("#79c0ff"),

    keyword: h("#ff7b72"),
    "keyword.function": h("#d2a8ff"),
    "keyword.return": h("#ff7b72"),
    "keyword.import": h("#ff7b72"),
    "keyword.type": h("#ff7b72"),
    "keyword.modifier": h("#ff7b72"),
    "keyword.repeat": h("#ff7b72"),
    "keyword.conditional": h("#ff7b72"),
    "keyword.conditional.ternary": h("#ff7b72"),
    "keyword.exception": h("#ff7b72"),
    "keyword.operator": h("#ff7b72"),
    "keyword.coroutine": h("#ff7b72"),
    string: h("#a5d6ff"),
    "string.regexp": h("#a371f7"),
    "string.special.url": { ...h("#a371f7"), underline: true },
    comment: { ...h("#8b949e"), italic: true },
    "comment.documentation": { ...h("#8b949e"), italic: true },
    number: h("#79c0ff"),
    boolean: h("#ff7b72"),
    function: h("#d2a8ff"),
    "function.call": h("#79c0ff"),
    "function.method": h("#d2a8ff"),
    "function.method.call": h("#79c0ff"),
    "function.builtin": h("#d2a8ff"),
    constructor: h("#ffa657"),
    variable: h("#e6edf3"),
    "variable.member": h("#79c0ff"),
    "variable.builtin": h("#ffa657"),
    "variable.parameter": h("#ffa657"),
    type: h("#ffa657"),
    "type.builtin": h("#ffa657"),
    operator: h("#ff7b72"),
    punctuation: h("#8b949e"),
    "punctuation.bracket": h("#8b949e"),
    property: h("#79c0ff"),
    namespace: h("#ffa657"),
    constant: h("#79c0ff"),
    "constant.builtin": h("#79c0ff"),
    module: h("#79c0ff"),
    "module.builtin": h("#79c0ff"),
    tag: h("#7ee787"),
    attribute: h("#79c0ff"),
  });
}

async function main(): Promise<void> {
  const filename = Bun.argv[2];
  if (!filename) {
    console.error("Usage: mdee <file.md>");
    process.exit(1);
  }

  const absolutePath = resolve(filename);
  const file = Bun.file(absolutePath);
  if (!(await file.exists())) {
    console.error(`File not found: ${absolutePath}`);
    process.exit(1);
  }

  let documentText = await file.text();
  let lastSavedText = documentText;
  const syntaxStyle = markdownSyntaxStyle();
  const displayName = basename(absolutePath);

  const renderer = await createCliRenderer({
    useMouse: true,
    exitOnCtrlC: true,
  });

  const treeSitterClient = getTreeSitterClient();
  await treeSitterClient.initialize();

  renderer.setTerminalTitle(displayName);

  /** Fills the pane above the status bar; holds view (scroll) and edit (textarea) as siblings so the editor gets a real viewport height, not the combined scroll content height. */
  const body = new BoxRenderable(renderer, {
    id: "mdee-body",
    width: "100%",
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 0,
    flexDirection: "column",
  });

  const scroll = new ScrollBoxRenderable(renderer, {
    id: "mdee-scroll",
    width: "100%",
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 0,
    viewportCulling: false,
    scrollY: true,
    scrollX: false,
    contentOptions: {
      paddingLeft: 1,
      paddingRight: 1,
      paddingTop: 1,
      paddingBottom: 1,
    },
  });
  scroll.verticalScrollBar.visible = false;
  scroll.horizontalScrollBar.visible = false;

  const markdown = new MarkdownRenderable(renderer, {
    id: "mdee-md",
    content: documentText,
    syntaxStyle,
    treeSitterClient,
    fg: "#e6edf3",
    conceal: true,
    concealCode: false,
    width: "100%",
    tableOptions: {
      widthMode: "full",
      columnFitter: "balanced",
      wrapMode: "word",
      cellPadding: 1,
      borders: true,
      outerBorder: true,
      borderStyle: "rounded",
      borderColor: "#30363d",
      selectable: true,
    },
  });

  let mode: Mode = "view";
  let quitDialogOpen = false;
  let lastEditCursorStatus = "";
  let saveFlashTimer: ReturnType<typeof setTimeout> | undefined;

  const statusBar = new BoxRenderable(renderer, {
    id: "mdee-status",
    width: "100%",
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: "column",
    border: ["top"],
    borderStyle: "single",
    borderColor: "#30363d",
    paddingLeft: 1,
    paddingRight: 1,
    paddingTop: 0,
    paddingBottom: 0,
  });

  const statusRow = new BoxRenderable(renderer, {
    id: "mdee-status-row",
    width: "100%",
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    minHeight: 1,
    height: 1,
  });

  const statusColFile = new BoxRenderable(renderer, {
    id: "mdee-status-col-file",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    height: 1,
  });

  const statusColMode = new BoxRenderable(renderer, {
    id: "mdee-status-col-mode",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    height: 1,
  });

  const statusColCursor = new BoxRenderable(renderer, {
    id: "mdee-status-col-cursor",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    height: 1,
  });

  const statusFilename = new TextRenderable(renderer, {
    id: "mdee-status-file",
    content: displayName,
    fg: "#8b949e",
    wrapMode: "none",
    truncate: true,
    width: "100%",
    height: 1,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  });

  const statusMode = new TextRenderable(renderer, {
    id: "mdee-status-mode",
    content: "VIEW",
    fg: "#8b949e",
    wrapMode: "none",
    truncate: false,
    flexGrow: 0,
    flexShrink: 0,
    height: 1,
  });

  const statusCursor = new TextRenderable(renderer, {
    id: "mdee-status-cursor",
    content: "",
    fg: "#79c0ff",
    wrapMode: "none",
    truncate: false,
    flexGrow: 0,
    flexShrink: 0,
    height: 1,
  });

  statusColFile.add(statusFilename);
  statusColMode.add(statusMode);
  statusColCursor.add(statusCursor);
  statusRow.add(statusColFile);
  statusRow.add(statusColMode);
  statusRow.add(statusColCursor);
  statusBar.add(statusRow);

  function clearSaveFlashTimer(): void {
    if (saveFlashTimer !== undefined) {
      clearTimeout(saveFlashTimer);
      saveFlashTimer = undefined;
    }
  }

  /** Brief message in the status bar’s right slot; restores line:column in edit or clears in view. */
  function flashStatusMessage(message: string, color: string, durationMs = 1400): void {
    clearSaveFlashTimer();
    statusCursor.content = message.length > 64 ? `${message.slice(0, 61)}...` : message;
    statusCursor.fg = color;
    saveFlashTimer = setTimeout(() => {
      saveFlashTimer = undefined;
      if (mode === "edit") {
        statusCursor.content = lastEditCursorStatus;
        statusCursor.fg = "#79c0ff";
      } else {
        statusCursor.content = "";
        statusCursor.fg = "#79c0ff";
      }
    }, durationMs);
  }

  /** Sole writer of the line:column status; driven only by `onCursorChange` (`line` / `visualColumn` are 0-based). */
  function applyStatusCursorFromOnCursorChange(event: CursorChangeEvent): void {
    if (mode !== "edit") {
      statusCursor.content = "";
      lastEditCursorStatus = "";
      return;
    }
    lastEditCursorStatus = `${event.line + 1}:${event.visualColumn + 1}`;
    if (saveFlashTimer === undefined) {
      statusCursor.content = lastEditCursorStatus;
    }
  }

  function refreshStatusBar(): void {
    clearSaveFlashTimer();
    statusMode.content = mode === "view" ? "VIEW" : "EDIT";
    statusMode.fg = mode === "edit" ? "#58a6ff" : "#8b949e";
    applyStatusFilename();
    if (mode !== "edit") {
      statusCursor.content = "";
      statusCursor.fg = "#79c0ff";
    } else {
      statusCursor.content = lastEditCursorStatus;
      statusCursor.fg = "#79c0ff";
    }
  }

  const editor = new TextareaRenderable(renderer, {
    id: "mdee-editor",
    initialValue: documentText,
    syntaxStyle,
    wrapMode: "word",
    width: "100%",
    flexGrow: 1,
    minHeight: 0,
    visible: false,
    textColor: "#e6edf3",
    focusedTextColor: "#e6edf3",
    cursorColor: "#58a6ff",
    cursorStyle: { style: "line", blinking: true },
    onCursorChange: applyStatusCursorFromOnCursorChange,
  });
  editor.onContentChange = () => {
    applyStatusFilename();
  };

  const quitOverlay = new BoxRenderable(renderer, {
    id: "mdee-quit-overlay",
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    zIndex: 100,
    visible: false,
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#000000",
    opacity: 0.8,
  });

  const quitDialog = new BoxRenderable(renderer, {
    id: "mdee-quit-dialog",
    flexDirection: "column",
    gap: 1,
    paddingLeft: 2,
    paddingRight: 2,
    paddingTop: 1,
    paddingBottom: 1,
    border: true,
    borderStyle: "rounded",
    borderColor: "#30363d",
    backgroundColor: "#000000",
    maxWidth: "90%",
  });

  const quitTitle = new TextRenderable(renderer, {
    id: "mdee-quit-title",
    content: "Save changes?",
    fg: "#e6edf3",
    wrapMode: "none",
    truncate: false,
  });

  const quitBody = new TextRenderable(renderer, {
    id: "mdee-quit-body",
    content: "",
    fg: "#8b949e",
    wrapMode: "word",
    width: "100%",
  });

  const quitErrorText = new TextRenderable(renderer, {
    id: "mdee-quit-error",
    content: "",
    fg: "#f85149",
    wrapMode: "word",
    width: "100%",
    visible: false,
  });

  const quitHintMuted = fg("#6e7681");
  const quitHintKey = (label: string) => fg("#e6edf3")(bold(label));

  const quitHints = new TextRenderable(renderer, {
    id: "mdee-quit-hints",
    content: t`${quitHintKey("Y")}${quitHintMuted(" save and quit · ")}${quitHintKey("N")}${quitHintMuted(" discard · ")}${quitHintKey("Esc")}${quitHintMuted(" cancel")}`,
    fg: "#6e7681",
    wrapMode: "none",
    truncate: true,
    width: "100%",
  });

  quitDialog.add(quitTitle);
  quitDialog.add(quitBody);
  quitDialog.add(quitErrorText);
  quitDialog.add(quitHints);
  quitOverlay.add(quitDialog);

  scroll.add(markdown);
  body.add(scroll);
  body.add(editor);
  renderer.root.add(body);
  renderer.root.add(statusBar);
  renderer.root.add(quitOverlay);

  function getPendingDocument(): string {
    return mode === "edit" ? editor.plainText : documentText;
  }

  function isDirty(): boolean {
    return getPendingDocument() !== lastSavedText;
  }

  function applyStatusFilename(): void {
    statusFilename.content = isDirty() ? `${displayName} *` : displayName;
  }

  function showQuitDialog(): void {
    quitDialogOpen = true;
    quitErrorText.visible = false;
    quitErrorText.content = "";
    quitBody.content = `You have unsaved changes in ${displayName}.`;
    quitOverlay.visible = true;
  }

  function hideQuitDialog(): void {
    quitDialogOpen = false;
    quitOverlay.visible = false;
    if (mode === "edit") {
      editor.focus();
    } else {
      scroll.focus();
    }
  }

  function syncStateAfterSave(text: string): void {
    lastSavedText = text;
    documentText = text;
    markdown.content = documentText;
  }

  async function savePending(): Promise<void> {
    const text = getPendingDocument();
    if (text === lastSavedText) {
      flashStatusMessage("No changes", "#8b949e");
      return;
    }
    try {
      await Bun.write(absolutePath, text);
      syncStateAfterSave(text);
      flashStatusMessage("Saved", "#7ee787");
      applyStatusFilename();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      flashStatusMessage(`Save failed: ${message}`, "#f85149", 4000);
    }
  }

  async function savePendingAndQuit(): Promise<void> {
    const text = getPendingDocument();
    try {
      await Bun.write(absolutePath, text);
      syncStateAfterSave(text);
      renderer.destroy();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      quitErrorText.content = `Could not save: ${message}`;
      quitErrorText.visible = true;
    }
  }

  function discardAndQuit(): void {
    renderer.destroy();
  }

  function requestQuit(): void {
    if (!isDirty()) {
      renderer.destroy();
      return;
    }
    showQuitDialog();
  }

  function enterEditMode(): void {
    editor.setText(documentText);
    markdown.visible = false;
    scroll.visible = false;
    editor.visible = true;
    mode = "edit";
    refreshStatusBar();
    editor.focus();
  }

  function exitEditMode(): void {
    documentText = editor.plainText;
    markdown.content = documentText;
    editor.visible = false;
    scroll.visible = true;
    markdown.visible = true;
    mode = "view";
    refreshStatusBar();
    scroll.focus();
  }

  refreshStatusBar();
  scroll.focus();

  renderer.keyInput.on("keypress", (key: KeyEvent) => {
    if (quitDialogOpen) {
      key.stopPropagation();
      if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        hideQuitDialog();
        return;
      }
      if (
        (key.name === "y" || key.name === "Y") &&
        !key.ctrl &&
        !key.meta &&
        !key.option &&
        !key.super
      ) {
        void savePendingAndQuit();
        return;
      }
      if (
        (key.name === "n" || key.name === "N") &&
        !key.ctrl &&
        !key.meta &&
        !key.option &&
        !key.super
      ) {
        discardAndQuit();
        return;
      }
      return;
    }

    if (key.ctrl && key.name === "c") {
      key.stopPropagation();
      requestQuit();
      return;
    }

    const wantsSave =
      (key.ctrl || key.meta || key.super) &&
      key.name === "s" &&
      !key.shift &&
      !key.option;
    if (wantsSave) {
      key.stopPropagation();
      void savePending();
      return;
    }

    if (mode === "edit") {
      if (key.name === "escape") {
        key.stopPropagation();
        exitEditMode();
      }
      return;
    }

    if (key.name === "i" && !isModifierKey(key)) {
      key.stopPropagation();
      enterEditMode();
      return;
    }

    if (key.name === "q") {
      key.stopPropagation();
      requestQuit();
    }
  });

  renderer.start();
  await renderer.idle();
  process.exit(0);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exit(1);
});
