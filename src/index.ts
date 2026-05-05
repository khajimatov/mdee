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
  CliRenderEvents,
  type CursorChangeEvent,
  type KeyEvent,
  type ThemeMode,
} from "@opentui/core";
import { basename, resolve } from "node:path";
import { homedir } from "node:os";

const APP = "mdee";
const INSTALL_DIR = `${homedir()}/.${APP}/bin`;

const SHELL_CONFIGS: Record<string, string[]> = {
  zsh: [
    `${homedir()}/.zshrc`,
    `${homedir()}/.zshenv`,
    `${process.env.XDG_CONFIG_HOME || `${homedir()}/.config`}/zsh/.zshrc`,
    `${process.env.XDG_CONFIG_HOME || `${homedir()}/.config`}/zsh/.zshenv`,
  ],
  bash: [
    `${homedir()}/.bashrc`,
    `${homedir()}/.bash_profile`,
    `${homedir()}/.profile`,
    `${process.env.XDG_CONFIG_HOME || `${homedir()}/.config`}/bash/.bashrc`,
    `${process.env.XDG_CONFIG_HOME || `${homedir()}/.config`}/bash/.bash_profile`,
  ],
  fish: [`${homedir()}/.config/fish/config.fish`],
  ash: [`${homedir()}/.ashrc`, `${homedir()}/.profile`, `/etc/profile`],
  sh: [`${homedir()}/.ashrc`, `${homedir()}/.profile`, `/etc/profile`],
};

async function uninstall(): Promise<void> {
  const binaryPath = `${INSTALL_DIR}/${APP}`;
  let removedSomething = false;

  const rm = async (path: string): Promise<void> => {
    try {
      if (await Bun.file(path).exists()) {
        Bun.spawnSync(["rm", path]);
        console.log(`Removed ${path}`);
        removedSomething = true;
      }
    } catch {
      // ignore
    }
  };

  const rmdir = async (path: string): Promise<void> => {
    try {
      const stat = Bun.spawnSync(["ls", "-A", path]);
      if (stat.exitCode === 0 && stat.stdout.toString().trim() === "") {
        Bun.spawnSync(["rmdir", path]);
        console.log(`Removed directory ${path}`);
        removedSomething = true;
      }
    } catch {
      // ignore
    }
  };

  await rm(binaryPath);
  await rmdir(INSTALL_DIR);
  await rmdir(`${homedir()}/.${APP}`);

  const pathLinePattern = new RegExp(
    `^\\s*#\\s*${APP}\\s*$\\n\\s*(?:export\\s+PATH=${INSTALL_DIR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\$PATH|fish_add_path\\s+${INSTALL_DIR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\s*$`,
    "gm",
  );

  for (const files of Object.values(SHELL_CONFIGS)) {
    for (const configFile of files) {
      try {
        if (!(await Bun.file(configFile).exists())) continue;
        const content = await Bun.file(configFile).text();
        const newContent = content.replace(pathLinePattern, "\n");
        if (newContent !== content) {
          await Bun.write(configFile, newContent);
          console.log(`Removed PATH entry from ${configFile}`);
          removedSomething = true;
        }
      } catch {
        // ignore
      }
    }
  }

  if (!removedSomething) {
    console.log(`${APP} is not installed, nothing to uninstall.`);
  } else {
    console.log(`${APP} uninstalled.`);
  }

  process.exit(0);
}

type Mode = "view" | "edit";
function isModifierKey(key: KeyEvent): boolean {
  return key.ctrl || key.meta || key.shift || key.option || Boolean(key.super);
}

interface Palette {
  background: string;
  surface: string;
  text: string;
  muted: string;
  subtle: string;
  accent: string;
  blue: string;
  green: string;
  purple: string;
  orange: string;
  red: string;
  error: string;
  string: string;
  url: string;
  border: string;
  conceal: string;
  overlayBg: string;
  overlayOpacity: number;
}

const DARK: Palette = {
  background: "#0d1117",
  surface: "#161b22",
  text: "#e6edf3",
  muted: "#b1bac4",
  subtle: "#8b949e",
  accent: "#58a6ff",
  blue: "#79c0ff",
  green: "#7ee787",
  purple: "#d2a8ff",
  orange: "#ffa657",
  red: "#ff7b72",
  string: "#a5d6ff",
  url: "#a371f7",
  border: "#30363d",
  conceal: "#8b949e",
  error: "#f85149",
  overlayBg: "#000000",
  overlayOpacity: 0.8,
};

const LIGHT: Palette = {
  background: "#ffffff",
  surface: "#f6f8fa",
  text: "#1f2328",
  muted: "#636c76",
  subtle: "#8b949e",
  accent: "#0969da",
  blue: "#0550ae",
  green: "#1a7f37",
  purple: "#8250df",
  orange: "#bc4c00",
  red: "#cf222e",
  string: "#0a3069",
  url: "#8250df",
  border: "#d0d7de",
  conceal: "#8b949e",
  error: "#cf222e",
  overlayBg: "#6e7781",
  overlayOpacity: 0.5,
};

function paletteForTheme(theme: ThemeMode): Palette {
  return theme === "dark" ? DARK : LIGHT;
}

const h = (
  color: string,
  opts?: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    dim?: boolean;
  },
) => ({
  fg: RGBA.fromHex(color),
  bold: opts?.bold,
  italic: opts?.italic,
  underline: opts?.underline,
  dim: opts?.dim,
});

function markdownSyntaxRules(p: Palette) {
  return {
    default: h(p.text),
    conceal: h(p.conceal),

    "markup.heading.1": { ...h(p.accent), bold: true },
    "markup.heading.2": { ...h(p.blue), bold: true },
    "markup.heading.3": { ...h(p.green), bold: true },
    "markup.heading.4": { ...h(p.purple), bold: true },
    "markup.heading.5": { ...h(p.orange), bold: true },
    "markup.heading.6": { ...h(p.red), bold: true },
    "markup.heading": { ...h(p.accent), bold: true },

    "markup.list": h(p.red),
    "markup.list.checked": h(p.green),
    "markup.list.unchecked": h(p.muted),
    "markup.quote": h(p.muted),
    "markup.raw": h(p.blue),
    "markup.raw.block": h(p.string),
    "markup.strong": { ...h(p.text), bold: true },
    "markup.italic": { ...h(p.text), italic: true },
    "markup.strikethrough": { ...h(p.muted), dim: true },

    "markup.link": h(p.accent),
    "markup.link.label": h(p.accent),
    "markup.link.url": { ...h(p.url), underline: true },
    "markup.link.bracket.close": h(p.accent),

    label: h(p.orange),
    "punctuation.special": h(p.muted),
    "punctuation.delimiter": h(p.muted),
    "keyword.directive": h(p.purple),
    "string.escape": h(p.blue),
    "character.special": h(p.blue),

    keyword: h(p.red),
    "keyword.function": h(p.purple),
    "keyword.return": h(p.red),
    "keyword.import": h(p.red),
    "keyword.type": h(p.red),
    "keyword.modifier": h(p.red),
    "keyword.repeat": h(p.red),
    "keyword.conditional": h(p.red),
    "keyword.conditional.ternary": h(p.red),
    "keyword.exception": h(p.red),
    "keyword.operator": h(p.red),
    "keyword.coroutine": h(p.red),
    string: h(p.string),
    "string.regexp": h(p.url),
    "string.special.url": { ...h(p.url), underline: true },
    comment: { ...h(p.muted), italic: true },
    "comment.documentation": { ...h(p.muted), italic: true },
    number: h(p.blue),
    boolean: h(p.red),
    function: h(p.purple),
    "function.call": h(p.blue),
    "function.method": h(p.purple),
    "function.method.call": h(p.blue),
    "function.builtin": h(p.purple),
    constructor: h(p.orange),
    variable: h(p.text),
    "variable.member": h(p.blue),
    "variable.builtin": h(p.orange),
    "variable.parameter": h(p.orange),
    type: h(p.orange),
    "type.builtin": h(p.orange),
    operator: h(p.red),
    punctuation: h(p.muted),
    "punctuation.bracket": h(p.muted),
    property: h(p.blue),
    namespace: h(p.orange),
    constant: h(p.blue),
    "constant.builtin": h(p.blue),
    module: h(p.blue),
    "module.builtin": h(p.blue),
    tag: h(p.green),
    attribute: h(p.blue),
  };
}

function markdownSyntaxStyle(p: Palette): SyntaxStyle {
  return SyntaxStyle.fromStyles(markdownSyntaxRules(p));
}

function editorMarkdownSyntaxStyle(p: Palette): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    ...markdownSyntaxRules(p),

    "markup.heading.1": h(p.accent, { bold: true }),
    "markup.heading.2": h(p.blue, { bold: true }),
    "markup.heading.3": h(p.green, { bold: true }),
    "markup.heading.4": h(p.purple, { bold: true }),
    "markup.heading.5": h(p.orange, { bold: true }),
    "markup.heading.6": h(p.red, { bold: true }),
    "markup.heading": h(p.accent, { bold: true }),
    "markup.heading.marker": h(p.subtle, { bold: true }),

    "markup.list": h(p.orange, { bold: true }),
    "markup.list.marker": h(p.orange, { bold: true }),
    "markup.list.checked": h(p.green, { bold: true }),
    "markup.list.unchecked": h(p.muted),
    "markup.quote": h(p.muted, { italic: true }),
    "markup.raw": h(p.string),
    "markup.raw.block": h(p.string),
    "markup.strong": h(p.text, { bold: true }),
    "markup.italic": h(p.text, { italic: true }),
    "markup.strikethrough": h(p.muted, { dim: true }),

    "markup.link": h(p.accent),
    "markup.link.label": h(p.accent, { underline: true }),
    "markup.link.url": h(p.url, { underline: true }),
    "markup.link.bracket.open": h(p.subtle, { dim: true }),
    "markup.link.bracket.close": h(p.subtle, { dim: true }),

    label: h(p.orange, { bold: true }),
    "keyword.directive": h(p.purple, { bold: true }),
    "punctuation.special": h(p.subtle, { dim: true }),
    "punctuation.delimiter": h(p.subtle, { dim: true }),
    "punctuation.bracket": h(p.subtle, { dim: true }),
  });
}

async function main(): Promise<void> {
  const arg = Bun.argv[2];
  if (arg === "--uninstall" || arg === "uninstall") {
    await uninstall();
    return;
  }

  const filename = arg;
  if (!filename) {
    console.error("Usage: mdee <file.md>");
    console.error("       mdee --uninstall");
    process.exit(1);
  }

  const absolutePath = resolve(filename);
  const file = Bun.file(absolutePath);
  let documentText = (await file.exists()) ? await file.text() : "";
  let lastSavedText = documentText;
  const displayName = basename(absolutePath);

  const renderer = await createCliRenderer({
    useMouse: true,
    exitOnCtrlC: true,
  });

  // @ts-expect-error waitForThemeMode exists on CliRenderer (renderer.d.ts) but TS resolution may lag
  const detectedTheme: ThemeMode | null = await renderer.waitForThemeMode(1000);
  let palette: Palette = paletteForTheme(detectedTheme ?? "dark");
  let syntaxStyle = markdownSyntaxStyle(palette);
  let editorSyntaxStyle = editorMarkdownSyntaxStyle(palette);

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
    backgroundColor: palette.background,
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
      paddingBottom: 0,
    },
  });
  scroll.verticalScrollBar.visible = false;
  scroll.horizontalScrollBar.visible = false;

  const markdown = new MarkdownRenderable(renderer, {
    id: "mdee-md",
    content: documentText,
    syntaxStyle,
    treeSitterClient,
    fg: palette.text,
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
      borderColor: palette.border,
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
    borderColor: palette.border,
    backgroundColor: palette.background,
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
    fg: palette.muted,
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
    fg: palette.muted,
    wrapMode: "none",
    truncate: false,
    flexGrow: 0,
    flexShrink: 0,
    height: 1,
  });

  const statusCursor = new TextRenderable(renderer, {
    id: "mdee-status-cursor",
    content: "",
    fg: palette.blue,
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
  function flashStatusMessage(
    message: string,
    color: string,
    durationMs = 1400,
  ): void {
    clearSaveFlashTimer();
    statusCursor.content =
      message.length > 64 ? `${message.slice(0, 61)}...` : message;
    statusCursor.fg = color;
    saveFlashTimer = setTimeout(() => {
      saveFlashTimer = undefined;
      if (mode === "edit") {
        statusCursor.content = lastEditCursorStatus;
        statusCursor.fg = palette.blue;
      } else {
        statusCursor.content = "";
        statusCursor.fg = palette.blue;
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
    statusMode.fg = mode === "edit" ? palette.accent : palette.muted;
    applyStatusFilename();
    if (mode !== "edit") {
      statusCursor.content = "";
      statusCursor.fg = palette.blue;
    } else {
      statusCursor.content = lastEditCursorStatus;
      statusCursor.fg = palette.blue;
    }
  }

  const editorWrap = new BoxRenderable(renderer, {
    id: "mdee-editor-wrap",
    width: "100%",
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 0,
    visible: false,
    paddingLeft: 1,
    paddingRight: 1,
    paddingTop: 1,
    paddingBottom: 0,
  });

  const editor = new TextareaRenderable(renderer, {
    id: "mdee-editor",
    initialValue: documentText,
    syntaxStyle: editorSyntaxStyle,
    wrapMode: "word",
    width: "100%",
    flexGrow: 1,
    minHeight: 0,
    textColor: palette.text,
    focusedTextColor: palette.text,
    cursorColor: palette.accent,
    cursorStyle: { style: "line", blinking: true },
    onCursorChange: applyStatusCursorFromOnCursorChange,
  });

  editorWrap.add(editor);
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
  });

  const quitBackdrop = new BoxRenderable(renderer, {
    id: "mdee-quit-backdrop",
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    backgroundColor: palette.overlayBg,
    opacity: palette.overlayOpacity,
    zIndex: 0,
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
    borderColor: palette.border,
    backgroundColor: palette.surface,
    maxWidth: "90%",
    zIndex: 1,
  });

  const quitTitle = new TextRenderable(renderer, {
    id: "mdee-quit-title",
    content: "Save changes?",
    fg: palette.text,
    wrapMode: "none",
    truncate: false,
  });

  const quitBody = new TextRenderable(renderer, {
    id: "mdee-quit-body",
    content: "",
    fg: palette.muted,
    wrapMode: "word",
    width: "100%",
  });

  const quitErrorText = new TextRenderable(renderer, {
    id: "mdee-quit-error",
    content: "",
    fg: palette.error,
    wrapMode: "word",
    width: "100%",
    visible: false,
  });

  function buildQuitHintsContent(p: Palette) {
    const m = fg(p.subtle);
    const k = (label: string) => fg(p.text)(bold(label));
    return t`${k("Y")}${m(" save and quit · ")}${k("N")}${m(" discard · ")}${k("Esc")}${m(" cancel")}`;
  }

  const quitHints = new TextRenderable(renderer, {
    id: "mdee-quit-hints",
    content: buildQuitHintsContent(palette),
    fg: palette.subtle,
    wrapMode: "none",
    truncate: true,
    width: "100%",
  });

  quitDialog.add(quitTitle);
  quitDialog.add(quitBody);
  quitDialog.add(quitErrorText);
  quitDialog.add(quitHints);
  quitOverlay.add(quitBackdrop);
  quitOverlay.add(quitDialog);

  scroll.add(markdown);
  body.add(scroll);
  body.add(editorWrap);
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
      flashStatusMessage("No changes", palette.muted);
      return;
    }
    try {
      await Bun.write(absolutePath, text);
      syncStateAfterSave(text);
      flashStatusMessage("Saved", palette.green);
      applyStatusFilename();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      flashStatusMessage(`Save failed: ${message}`, palette.error, 4000);
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
    editorWrap.visible = true;
    mode = "edit";
    refreshStatusBar();
    editor.focus();
  }

  function exitEditMode(): void {
    documentText = editor.plainText;
    markdown.content = documentText;
    editorWrap.visible = false;
    scroll.visible = true;
    markdown.visible = true;
    mode = "view";
    refreshStatusBar();
    scroll.focus();
  }

  function applyTheme(newPalette: Palette): void {
    palette = newPalette;
    syntaxStyle = markdownSyntaxStyle(palette);
    editorSyntaxStyle = editorMarkdownSyntaxStyle(palette);

    body.backgroundColor = palette.background;
    statusBar.borderColor = palette.border;
    statusBar.backgroundColor = palette.background;

    markdown.syntaxStyle = syntaxStyle;
    markdown.fg = palette.text;
    markdown.tableOptions = {
      ...markdown.tableOptions,
      borderColor: palette.border,
    };

    editor.syntaxStyle = editorSyntaxStyle;
    editor.textColor = palette.text;
    editor.focusedTextColor = palette.text;
    editor.cursorColor = palette.accent;

    statusFilename.fg = palette.muted;
    statusMode.fg = mode === "edit" ? palette.accent : palette.muted;
    statusCursor.fg = palette.blue;

    quitBackdrop.backgroundColor = palette.overlayBg;
    quitBackdrop.opacity = palette.overlayOpacity;
    quitDialog.borderColor = palette.border;
    quitDialog.backgroundColor = palette.surface;
    quitTitle.fg = palette.text;
    quitBody.fg = palette.muted;
    quitErrorText.fg = palette.error;
    quitHints.fg = palette.subtle;
    quitHints.content = buildQuitHintsContent(palette);
  }

  renderer.on(CliRenderEvents.THEME_MODE, (newTheme: ThemeMode) => {
    applyTheme(paletteForTheme(newTheme));
  });

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

    if (key.ctrl && key.name === "c" && mode !== "edit") {
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
