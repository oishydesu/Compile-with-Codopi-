import { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  AlertCircle,
  Bell,
  Bug,
  CheckCircle2,
  Code2,
  FileCode2,
  Files,
  FolderOpen,
  GitBranch,
  Info,
  Package,
  Play,
  Save,
  Search,
  Settings,
  UserCircle,
  XCircle,
} from "lucide-react";
import "./App.css";

const cppStarterCode = `#include <iostream>
using namespace std;

int main() {
    cout << "Welcome to Codopi!" << endl;
    return 0;
}`;

const cStarterCode = `#include <stdio.h>

int main() {
    printf("Welcome to Codopi!\\n");
    return 0;
}`;

const copiStarterCode = `let x = 10;
print x;

while (x < 13) {
    print x;
    x = x + 1;
}`;

const pythonStarterCode = `x = 10
print(x)

while x < 15:
    print(x)
    x = x + 1`;

function getStarterCode(language: CodopiLanguage) {
  if (language === "c") return cStarterCode;
  if (language === "copi") return copiStarterCode;
  if (language === "py") return pythonStarterCode;
  return cppStarterCode;
}

function getSuggestion(message: string) {
  const lower = message.toLowerCase();

  if (lower.includes("lexical error")) {
    return "There is an unknown character. Remove unsupported symbols.";
  }

  if (lower.includes("syntax error")) {
    return "Check missing semicolon, bracket, colon, or wrong statement structure.";
  }

  if (lower.includes("semantic error")) {
    return "Check variable declaration or logical meaning of the code.";
  }

  if (lower.includes("undeclared variable")) {
    return "Declare the variable first before using it.";
  }

  if (lower.includes("variable already declared")) {
    return "This variable already exists. Use a different name or remove the second declaration.";
  }

  if (lower.includes("unexpected indentation")) {
    return "Check indentation. Python to C mode uses spaces for blocks.";
  }

  if (lower.includes("tabs are not supported")) {
    return "Use spaces instead of tabs for indentation.";
  }

  if (lower.includes("expected ';'")) {
    return "Check the previous line. You may have missed a semicolon.";
  }

  if (lower.includes("was not declared")) {
    return "Check if the variable or function is declared before using it.";
  }

  if (lower.includes("expected '}'")) {
    return "One opening brace may not be closed properly.";
  }

  if (lower.includes("no such file")) {
    return "Check the file name or missing header file.";
  }

  if (lower.includes("undefined reference")) {
    return "The function may be declared but not properly defined.";
  }

  if (lower.includes("cannot convert")) {
    return "Check the data type. You may be assigning one type to another incorrectly.";
  }

  return "Check the highlighted line and also the line before it.";
}

function App() {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);

  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const panelGridRef = useRef<HTMLDivElement | null>(null);
  const terminalSessionIdRef = useRef(
    `codopi-terminal-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );

  const [language, setLanguage] = useState<CodopiLanguage | null>(null);
  const [code, setCode] = useState("");
  const [output, setOutput] = useState("Output will appear here...");
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
  const [problems, setProblems] = useState<CodopiProblem[]>([]);
  const [running, setRunning] = useState(false);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(285);
  const [outputPanelWidth, setOutputPanelWidth] = useState(42);
  const [terminalPanelWidth, setTerminalPanelWidth] = useState(28);

  const [currentFolderPath, setCurrentFolderPath] = useState<string | null>(null);
  const [currentFolderName, setCurrentFolderName] = useState<string | null>(null);
  const [folderFiles, setFolderFiles] = useState<CodopiFolderFile[]>([]);

  const problemsPanelWidth = Math.max(
    18,
    100 - outputPanelWidth - terminalPanelWidth
  );

  function refitTerminalSoon() {
    setTimeout(() => {
      try {
        fitAddonRef.current?.fit();

        if (terminalRef.current) {
          window.codopi.terminalResize(
            terminalSessionIdRef.current,
            terminalRef.current.cols,
            terminalRef.current.rows
          );
        }
      } catch {}
    }, 50);
  }

  function startBottomPanelResize(event: any) {
    event.preventDefault();

    const startY = event.clientY;
    const startHeight = bottomPanelHeight;

    function handleMouseMove(moveEvent: MouseEvent) {
      const nextHeight = startHeight - (moveEvent.clientY - startY);
      setBottomPanelHeight(Math.min(540, Math.max(170, nextHeight)));
    }

    function handleMouseUp() {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      refitTerminalSoon();
    }

    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }

  function startPanelWidthResize(
    event: any,
    divider: "output-terminal" | "terminal-problems"
  ) {
    event.preventDefault();

    const gridWidth = panelGridRef.current?.getBoundingClientRect().width || 1;
    const startX = event.clientX;
    const startOutputWidth = outputPanelWidth;
    const startTerminalWidth = terminalPanelWidth;

    function handleMouseMove(moveEvent: MouseEvent) {
      const changePercent = ((moveEvent.clientX - startX) / gridWidth) * 100;

      if (divider === "output-terminal") {
        const nextOutput = Math.min(
          65,
          Math.max(18, startOutputWidth + changePercent)
        );

        const nextTerminal = Math.min(
          64,
          Math.max(18, startTerminalWidth - (nextOutput - startOutputWidth))
        );

        if (100 - nextOutput - nextTerminal >= 18) {
          setOutputPanelWidth(nextOutput);
          setTerminalPanelWidth(nextTerminal);
        }
      } else {
        const nextTerminal = Math.min(
          65,
          Math.max(18, startTerminalWidth + changePercent)
        );

        if (100 - startOutputWidth - nextTerminal >= 18) {
          setTerminalPanelWidth(nextTerminal);
        }
      }
    }

    function handleMouseUp() {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      refitTerminalSoon();
    }

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }

  function initializeTerminal() {
    if (terminalRef.current || !terminalContainerRef.current) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'Consolas, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      theme: {
        background: "#020617",
        foreground: "#d1d5db",
        cursor: "#ffffff",
        selectionBackground: "#334155",
      },
      convertEol: true,
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();

    terminal.loadAddon(fitAddon);
    terminal.open(terminalContainerRef.current);

    setTimeout(() => {
      try {
        fitAddon.fit();
      } catch {}
    }, 80);

    terminal.writeln("Codopi Live Terminal");
    terminal.writeln("Run a C or C++ program, then type input here when it asks.");
    terminal.writeln("");

    terminal.onData((data) => {
      window.codopi.terminalWrite(terminalSessionIdRef.current, data);
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
  }

  function clearTerminal() {
    initializeTerminal();

    if (terminalRef.current) {
      terminalRef.current.clear();
      terminalRef.current.writeln("Codopi Live Terminal");
      terminalRef.current.writeln("");
    }
  }

  async function stopTerminalProcess() {
    try {
      await window.codopi.terminalStop(terminalSessionIdRef.current);

      if (terminalRef.current) {
        terminalRef.current.writeln("");
        terminalRef.current.writeln("Process stopped by user.");
      }

      setRunning(false);
    } catch (error: any) {
      setOutput(error.message || "Could not stop terminal process.");
    }
  }

  useEffect(() => {
    const removeOutputListener = window.codopi.onTerminalOutput(
      (sessionId, data) => {
        if (sessionId !== terminalSessionIdRef.current) return;

        initializeTerminal();
        terminalRef.current?.write(data);
      }
    );

    const removeExitListener = window.codopi.onTerminalExit(
      (sessionId, data) => {
        if (sessionId !== terminalSessionIdRef.current) return;

        initializeTerminal();
        terminalRef.current?.write(data);
        setRunning(false);
      }
    );

    const handleResize = () => {
      try {
        fitAddonRef.current?.fit();

        if (terminalRef.current) {
          window.codopi.terminalResize(
            terminalSessionIdRef.current,
            terminalRef.current.cols,
            terminalRef.current.rows
          );
        }
      } catch {}
    };

    window.addEventListener("resize", handleResize);

    return () => {
      removeOutputListener();
      removeExitListener();
      window.removeEventListener("resize", handleResize);
      window.codopi.terminalStop(terminalSessionIdRef.current);

      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (language) {
      setTimeout(() => {
        initializeTerminal();

        try {
          fitAddonRef.current?.fit();
        } catch {}
      }, 100);
    }
  }, [language]);

  useEffect(() => {
    refitTerminalSoon();
  }, [bottomPanelHeight, outputPanelWidth, terminalPanelWidth]);

  function handleEditorMount(editor: any, monaco: any) {
    editorRef.current = editor;
    monacoRef.current = monaco;
  }

  function clearMarkers() {
    const model = editorRef.current?.getModel();

    if (model && monacoRef.current) {
      monacoRef.current.editor.setModelMarkers(model, "codopi", []);
    }
  }

  function closeCurrentFile() {
    setLanguage(null);
    setCode("");
    setCurrentFilePath(null);
    setOutput("Output will appear here...");
    setProblems([]);
    clearMarkers();
  }

  function applyMarkers(problemList: CodopiProblem[]) {
    const model = editorRef.current?.getModel();

    if (!model || !monacoRef.current) {
      return;
    }

    const markers = problemList.map((problem) => {
      const suggestion = getSuggestion(problem.message);

      return {
        startLineNumber: problem.line,
        startColumn: problem.column,
        endLineNumber: problem.line,
        endColumn: problem.column + 20,
        message: `${problem.type.toUpperCase()}: ${problem.message}\n\nSuggestion: ${suggestion}`,
        severity:
          problem.type === "warning"
            ? monacoRef.current.MarkerSeverity.Warning
            : monacoRef.current.MarkerSeverity.Error,
      };
    });

    monacoRef.current.editor.setModelMarkers(model, "codopi", markers);
  }

  function getCurrentFileName() {
    if (currentFilePath) {
      return currentFilePath.split(/[\\/]/).pop() || "main.cpp";
    }

    if (!language) return "Welcome";
    if (language === "c") return "main.c";
    if (language === "copi") return "main.copi";
    if (language === "py") return "main.py";
    return "main.cpp";
  }

  function getEditorLanguage() {
    if (language === "c") return "c";
    if (language === "cpp") return "cpp";
    if (language === "py") return "python";
    return "plaintext";
  }

  function getReadableLanguageName() {
    if (language === "c") return "C";
    if (language === "cpp") return "C++";
    if (language === "copi") return "CodopiLang";
    if (language === "py") return "Python to C";
    return "No mode selected";
  }

  function getPipelineText() {
    if (language === "cpp") return "C++ source → G++ → EXE";
    if (language === "c") return "C source → GCC → EXE";

    if (language === "copi") {
      return "CodopiLang → Flex lexer → Bison parser → C generator → GCC → EXE";
    }

    if (language === "py") {
      return "Python-like code → C generator → GCC → EXE";
    }

    return "Choose a compiler mode first.";
  }

  function startNewFile(nextLanguage: CodopiLanguage) {
    setLanguage(nextLanguage);
    setCode(getStarterCode(nextLanguage));
    setCurrentFilePath(null);
    setOutput("Output will appear here...");
    setProblems([]);
    clearMarkers();

    if (nextLanguage === "c" || nextLanguage === "cpp" || nextLanguage === "py") {
      setTimeout(() => {
        clearTerminal();
      }, 150);
    }
  }

  function handleNewFile() {
    setLanguage("cpp");
    setCode(getStarterCode("cpp"));
    setCurrentFilePath(null);
    setOutput("New C++ file created. You can change language from the top-right selector.");
    setProblems([]);
    clearMarkers();

    setTimeout(() => {
      clearTerminal();
    }, 150);
  }

  async function handleOpenFile() {
    try {
      const result = await window.codopi.openFile();

      if (!result.success || !result.content || !result.filePath) {
        return;
      }

      setCode(result.content);
      setCurrentFilePath(result.filePath);

      if (result.language) {
        setLanguage(result.language);
      } else {
        setLanguage("cpp");
      }

      setOutput(`Opened file:\n${result.filePath}`);
      setProblems([]);
      clearMarkers();

      if (result.language === "c" || result.language === "cpp" || result.language === "py") {
        setTimeout(() => {
          clearTerminal();
        }, 150);
      }
    } catch (error: any) {
      setOutput(error.message || "Could not open file.");
    }
  }

  async function handleOpenFolder() {
    try {
      const result = await window.codopi.openFolder();

      if (!result.success || !result.folderPath) {
        return;
      }

      setCurrentFolderPath(result.folderPath);
      setCurrentFolderName(result.folderName || "Opened Folder");
      setFolderFiles(result.files || []);
      setOutput(
        `Folder opened:\n${result.folderPath}\n\nFiles found: ${
          result.files?.length || 0
        }`
      );
    } catch (error: any) {
      setOutput(error.message || "Could not open folder.");
    }
  }

  async function handleOpenFolderFile(filePath: string) {
    try {
      const result = await window.codopi.readFileByPath(filePath);

      if (!result.success || !result.content || !result.filePath) {
        return;
      }

      setCode(result.content);
      setCurrentFilePath(result.filePath);

      if (result.language) {
        setLanguage(result.language);
      }

      setOutput(`Opened file:\n${result.filePath}`);
      setProblems([]);
      clearMarkers();

      if (result.language === "c" || result.language === "cpp" || result.language === "py") {
        setTimeout(() => {
          clearTerminal();
        }, 150);
      }
    } catch (error: any) {
      setOutput(error.message || "Could not open file from folder.");
    }
  }

  async function handleSaveFile() {
    try {
      if (!language) {
        setOutput("Please choose a compiler mode first.");
        return;
      }

      const currentCode = editorRef.current?.getValue() || code;

      const result = await window.codopi.saveFile(
        currentCode,
        currentFilePath,
        language
      );

      if (!result.success || !result.filePath) {
        return;
      }

      setCurrentFilePath(result.filePath);
      setOutput(`File saved successfully:\n${result.filePath}`);
    } catch (error: any) {
      setOutput(error.message || "Could not save file.");
    }
  }

  async function handleSaveAsFile() {
    try {
      if (!language) {
        setOutput("Please create or open a file first.");
        return;
      }

      const currentCode = editorRef.current?.getValue() || code;

      const result = await window.codopi.saveAsFile(currentCode, language);

      if (!result.success || !result.filePath) {
        return;
      }

      setCurrentFilePath(result.filePath);

      if (result.language) {
        setLanguage(result.language);
      }

      setOutput(`File saved as:\n${result.filePath}`);
    } catch (error: any) {
      setOutput(error.message || "Could not save as file.");
    }
  }

  async function handleRun() {
    try {
      if (!language) {
        setOutput("Please choose C, C++, CodopiLang, or Python to C first.");
        return;
      }

      setRunning(true);
      setOutput("Running...");
      setProblems([]);
      clearMarkers();

      const currentCode = editorRef.current?.getValue() || code;

      if (language === "c" || language === "cpp") {
        clearTerminal();

        const cols = terminalRef.current?.cols || 100;
        const rows = terminalRef.current?.rows || 24;

        const result = await window.codopi.terminalRunCode(
          currentCode,
          language,
          terminalSessionIdRef.current,
          cols,
          rows
        );

        setOutput(result.output || "Program started in live terminal.");
        setProblems(result.problems || []);
        applyMarkers(result.problems || []);

        if (!result.success || result.stage === "compile") {
          setRunning(false);

          if (result.output) {
            terminalRef.current?.writeln(result.output.replace(/\n/g, "\r\n"));
          }
        }

        return;
      }

      if (language === "py") {
        clearTerminal();

        const cols = terminalRef.current?.cols || 100;
        const rows = terminalRef.current?.rows || 24;

        const result = await window.codopi.terminalRunPythonToC(
          currentCode,
          terminalSessionIdRef.current,
          cols,
          rows
        );

        setOutput(result.output || "Python to C program started in live terminal.");
        setProblems(result.problems || []);
        applyMarkers(result.problems || []);

        if (!result.success || result.stage === "compile") {
          setRunning(false);

          if (result.output) {
            terminalRef.current?.writeln(result.output.replace(/\n/g, "\r\n"));
          }
        }

        return;
      }

      const result = await window.codopi.runCodopiLang(currentCode);

      setOutput(result.output || "No output.");
      setProblems(result.problems || []);
      applyMarkers(result.problems || []);
      setRunning(false);
    } catch (error: any) {
      setOutput(error.message || "Something went wrong.");
      setRunning(false);
    }
  }

  function handleLanguageChange(nextLanguage: CodopiLanguage) {
    startNewFile(nextLanguage);
  }

  return (
    <div className="app">
      <header className="titleBar">
        <div className="titleBrand">
          <div className="codopiBrandLogo">
            <div className="codopiIconShape">
              <span>C</span>
            </div>

            <span className="codopiBrandText">codopi</span>
          </div>
        </div>

        <nav className="menuBar">
          <button onClick={handleNewFile}>New File</button>
          <button onClick={handleOpenFile}>Open File</button>
          <button onClick={handleOpenFolder}>Open Folder</button>
          <button onClick={handleSaveFile}>Save</button>
          <button onClick={handleSaveAsFile}>Save As</button>

          <button
            onClick={() => {
              editorRef.current?.trigger("keyboard", "undo", null);
            }}
          >
            Undo
          </button>

          <button
            onClick={() => {
              editorRef.current?.trigger(
                "keyboard",
                "editor.action.selectAll",
                null
              );
            }}
          >
            Select All
          </button>

          <button onClick={handleRun}>Run</button>

          <button
            onClick={() => {
              setOutput("Output cleared.");
              setProblems([]);
              clearMarkers();

              if (terminalRef.current) {
                terminalRef.current.clear();
              }
            }}
          >
            Clear
          </button>

          <button onClick={() => window.codopi.maximizeWindow()}>Window</button>
        </nav>

        <div className="windowControls">
          <button onClick={() => window.codopi.minimizeWindow()}>−</button>
          <button onClick={() => window.codopi.maximizeWindow()}>□</button>
          <button onClick={() => window.codopi.closeWindow()}>×</button>
        </div>
      </header>

      <div className="workspace">
        <aside className="activityBar">
          <div className="activityTop">
            <button className="activityIcon active" title="Explorer">
              <Files size={24} />
            </button>

            <button className="activityIcon" title="Search">
              <Search size={24} />
            </button>

            <button className="activityIcon" title="Source Control">
              <GitBranch size={24} />
            </button>

            <button className="activityIcon" title="Run and Debug">
              <Play size={25} />
            </button>

            <button className="activityIcon" title="Extensions">
              <Package size={24} />
            </button>

            <button className="activityIcon" title="Compiler Lab">
              <Bug size={24} />
            </button>
          </div>

          <div className="activityBottom">
            <button className="activityIcon" title="Settings">
              <Settings size={24} />
            </button>

            <button className="activityIcon" title="Account">
              <UserCircle size={26} />
            </button>
          </div>
        </aside>

        <aside className="sidebar">
          <div className="explorerHeader">
            <span>EXPLORER</span>
            <span className="explorerDots">...</span>
          </div>

          <div className="folderBlock">
            <p className="folderMain">
              ⌄{" "}
              {currentFolderName
                ? currentFolderName.toUpperCase()
                : "NO FOLDER OPENED"}
            </p>

            {!currentFolderPath ? (
              <>
                <p className="folderText">You have not yet opened a folder.</p>

                <button className="openFolderButton" onClick={handleOpenFolder}>
                  Open Folder
                </button>

                <p className="folderNote">
                  Open a project folder to see your C, C++, CodopiLang and
                  Python files.
                </p>
              </>
            ) : (
              <>
                <p className="folderText folderPath">{currentFolderPath}</p>

                <button className="openFolderButton" onClick={handleOpenFolder}>
                  Change Folder
                </button>

                <div className="folderFileList">
                  {folderFiles.length === 0 ? (
                    <p className="folderNote">No supported files found.</p>
                  ) : (
                    folderFiles.map((file) => (
                      <button
                        key={file.path}
                        className={
                          currentFilePath === file.path
                            ? "folderFileItem activeFolderFile"
                            : "folderFileItem"
                        }
                        onClick={() => handleOpenFolderFile(file.path)}
                        title={file.path}
                      >
                        <span className="folderFileIcon">
                          {file.language === "cpp"
                            ? "C++"
                            : file.language === "c"
                            ? "C"
                            : file.language === "py"
                            ? "PY"
                            : "CO"}
                        </span>

                        <span className="folderFileName">
                          {file.relativePath}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>

          {language && (
            <div className="fileTree">
              <p className="folderName">OPEN EDITORS</p>
              <p className="fileName">{getCurrentFileName()}</p>
            </div>
          )}
        </aside>

        <main className="mainArea">
          {!language ? (
            <>
              <div className="editorTabBar">
                <div className="editorTab activeTab">
                  <div className="tabIcon">C</div>
                  Welcome
                  <button className="tabCloseButton" onClick={closeCurrentFile}>
                    ×
                  </button>
                </div>
              </div>

              <section className="welcomeScreen">
                <div className="watermarkLogo">
                  <img src="/codopi-icon.png" alt="Codopi center logo" />
                </div>

                <div className="welcomeCards">
                  <button onClick={handleOpenFile} className="welcomeCard">
                    <FolderOpen size={42} />
                    <strong>Open File</strong>
                    <span>Open an existing file</span>
                  </button>

                  <button onClick={handleOpenFolder} className="welcomeCard">
                    <FolderOpen size={42} />
                    <strong>Open Folder</strong>
                    <span>Open a project folder</span>
                  </button>

                  <button
                    onClick={() => startNewFile("cpp")}
                    className="welcomeCard"
                  >
                    <span className="cardTextIcon">C++</span>
                    <strong>New C++ File</strong>
                    <span>Create a new C++ source file</span>
                  </button>

                  <button
                    onClick={() => startNewFile("c")}
                    className="welcomeCard"
                  >
                    <span className="cardTextIcon">C</span>
                    <strong>New C File</strong>
                    <span>Create a new C source file</span>
                  </button>

                  <button
                    onClick={() => startNewFile("copi")}
                    className="welcomeCard"
                  >
                    <Code2 size={42} />
                    <strong>New CodopiLang File</strong>
                    <span>Create a new CodopiLang file</span>
                  </button>

                  <button
                    onClick={() => startNewFile("py")}
                    className="welcomeCard"
                  >
                    <FileCode2 size={42} />
                    <strong>New Python to C File</strong>
                    <span>Create a new Python to C file</span>
                  </button>
                </div>
              </section>
            </>
          ) : (
            <>
              <div className="editorTabBar">
                <div className="editorTab activeTab">
                  <div className="tabIcon">C</div>
                  {getCurrentFileName()}
                  <button className="tabCloseButton" onClick={closeCurrentFile}>
                    ×
                  </button>
                </div>

                <div className="editorActions">
                  <select
                    value={language}
                    onChange={(event) =>
                      handleLanguageChange(event.target.value as CodopiLanguage)
                    }
                    className="languageSelect"
                  >
                    <option value="cpp">C++</option>
                    <option value="c">C</option>
                    <option value="copi">CodopiLang</option>
                    <option value="py">Python to C</option>
                  </select>

                  <button className="editorButton" onClick={handleSaveFile}>
                    <Save size={16} />
                    Save
                  </button>

                  <button
                    className="runButton"
                    onClick={handleRun}
                    disabled={running}
                  >
                    <Play size={16} />
                    {running ? "Running..." : "Run"}
                  </button>
                </div>
              </div>

              <section className="editorArea">
                <Editor
                  height="100%"
                  language={getEditorLanguage()}
                  theme="vs-dark"
                  value={code}
                  onChange={(value) => setCode(value || "")}
                  onMount={handleEditorMount}
                  options={{
                    fontSize: 16,
                    minimap: { enabled: true },
                    automaticLayout: true,
                    scrollBeyondLastLine: false,
                    tabSize: 4,
                    wordWrap: "on",
                  }}
                />
              </section>

              <section
                className="bottomPanel"
                style={{ height: bottomPanelHeight }}
              >
                <div
                  className="bottomPanelResizeHandle"
                  onMouseDown={startBottomPanelResize}
                  title="Drag up or down to resize the bottom panel"
                />

                <div
                  className="panelGrid"
                  ref={panelGridRef}
                  style={{
                    gridTemplateColumns: `${outputPanelWidth}% 7px ${terminalPanelWidth}% 7px ${problemsPanelWidth}%`,
                  }}
                >
                  <div className="panelCard">
                    <div className="panelHeader">
                      <span>Output</span>
                      <small>{running ? "Running" : "Result"}</small>
                    </div>

                    <pre className="outputBox">{output}</pre>
                  </div>

                  <div
                    className="panelColumnResizeHandle"
                    onMouseDown={(event) =>
                      startPanelWidthResize(event, "output-terminal")
                    }
                    title="Drag left or right to resize Output and Terminal"
                  />

                  <div className="panelCard">
                    <div className="panelHeader">
                      <span>Terminal</span>
                      <small>{running ? "Active" : "Ready"}</small>
                      <button
                        className="terminalStopButton"
                        onClick={stopTerminalProcess}
                        disabled={!running}
                      >
                        Stop
                      </button>
                    </div>

                    <div
                      className="terminalBox liveTerminalBox"
                      ref={terminalContainerRef}
                      onClick={() => terminalRef.current?.focus()}
                    />
                  </div>

                  <div
                    className="panelColumnResizeHandle"
                    onMouseDown={(event) =>
                      startPanelWidthResize(event, "terminal-problems")
                    }
                    title="Drag left or right to resize Terminal and Problems"
                  />

                  <div className="panelCard">
                    <div className="panelHeader">
                      <span>Problems</span>
                      <small>{problems.length} detected</small>
                    </div>

                    <div className="problemsBox">
                      {problems.length === 0 ? (
                        <p className="muted">No problems detected.</p>
                      ) : (
                        problems.map((problem, index) => (
                          <div className="problemItem" key={index}>
                            <AlertCircle size={15} />

                            <div>
                              <strong>
                                Line {problem.line}, Column {problem.column}
                              </strong>

                              <p>{problem.message}</p>
                              <small>{getSuggestion(problem.message)}</small>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </section>
            </>
          )}
        </main>
      </div>

      <footer className="statusBar">
        <div className="statusLeft">
          <span>
            <CheckCircle2 size={16} />
            Ready
          </span>

          <span>No active project</span>

          <span>
            <XCircle size={16} />
            {problems.length}
          </span>

          <span>
            <AlertCircle size={16} />0
          </span>

          <span>
            <Info size={16} />0
          </span>
        </div>

        <div className="statusRight">
          <span>UTF-8</span>
          <span>LF</span>
          <span>Spaces: 4</span>
          <Bell size={17} />
        </div>
      </footer>
    </div>
  );
}

export default App;