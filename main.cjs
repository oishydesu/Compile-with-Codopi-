const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
const pty = require("node-pty");

const isDev = !app.isPackaged;
const terminalSessions = new Map();

function registerIpcHandler(channel, handler) {
  try {
    ipcMain.removeHandler(channel);
  } catch {}

  ipcMain.handle(channel, handler);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1350,
    height: 820,
    minWidth: 1000,
    minHeight: 650,
    title: "Codopi",
    backgroundColor: "#0b111a",
    frame: false,
    titleBarStyle: "hidden",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    win.loadURL("http://127.0.0.1:5173");
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

function getToolPath(toolName) {
  const msysPath = `C:\\msys64\\ucrt64\\bin\\${toolName}.exe`;

  if (fs.existsSync(msysPath)) {
    return msysPath;
  }

  return toolName;
}

function getMsysEnv() {
  const msysUsrBin = "C:\\msys64\\usr\\bin";
  const msysUcrtBin = "C:\\msys64\\ucrt64\\bin";

  return {
    ...process.env,
    PATH: `${msysUcrtBin};${msysUsrBin};${process.env.PATH}`,
  };
}

function getLanguageFromFilePath(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".c") return "c";
  if (ext === ".copi") return "copi";
  if (ext === ".py") return "py";

  return "cpp";
}

function listFolderFiles(folderPath) {
  const allowedExtensions = [".c", ".cpp", ".h", ".hpp", ".copi", ".py", ".txt"];
  const ignoredFolders = ["node_modules", ".git", "dist", "build", ".vite"];
  const result = [];

  function walk(currentPath, depth = 0) {
    if (depth > 4) return;

    const items = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const item of items) {
      const fullPath = path.join(currentPath, item.name);

      if (item.isDirectory()) {
        if (!ignoredFolders.includes(item.name)) {
          walk(fullPath, depth + 1);
        }
      } else {
        const ext = path.extname(item.name).toLowerCase();

        if (allowedExtensions.includes(ext)) {
          result.push({
            name: item.name,
            path: fullPath,
            relativePath: path.relative(folderPath, fullPath),
            language: getLanguageFromFilePath(fullPath),
          });
        }
      }
    }
  }

  walk(folderPath);
  return result;
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    let resolved = false;

    const child = spawn(command, args, {
      ...options,
      shell: false,
      env: getMsysEnv(),
    });

    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;

        try {
          child.kill();
        } catch {}

        resolve({
          code: -1,
          stdout,
          stderr:
            stderr +
            "\nProcess stopped because it took too long or waited for input.",
        });
      }
    }, 12000);

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (error) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);

        resolve({
          code: -1,
          stdout,
          stderr: error.message,
        });
      }
    });

    child.on("close", (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);

        resolve({
          code,
          stdout,
          stderr,
        });
      }
    });
  });
}

function stopTerminalSession(sessionId) {
  const session = terminalSessions.get(sessionId);

  if (session) {
    try {
      session.kill();
    } catch {}

    terminalSessions.delete(sessionId);
  }
}

function stopAllTerminalSessions() {
  for (const sessionId of terminalSessions.keys()) {
    stopTerminalSession(sessionId);
  }
}

function sendTerminalOutput(event, sessionId, data) {
  event.sender.send("codopi:terminal-data", data);
  event.sender.send("codopi:terminal-output", sessionId, data);
}

function sendTerminalExit(event, sessionId, exitCode) {
  const message = `\r\n\r\nProcess exited with code ${exitCode}.\r\n`;

  event.sender.send("codopi:terminal-data", message);
  event.sender.send("codopi:terminal-output", sessionId, message);
  event.sender.send("codopi:terminal-exit", sessionId, message);
}

function parseGccProblems(output) {
  const problems = [];
  const regex =
    /^(.+?):(\d+):(\d+):\s+(fatal error|error|warning|note):\s+(.+)$/gm;

  let match;

  while ((match = regex.exec(output)) !== null) {
    problems.push({
      file: match[1],
      line: Number(match[2]),
      column: Number(match[3]),
      type: match[4] === "fatal error" ? "error" : match[4],
      message: match[5],
    });
  }

  return problems;
}

function parseCodopiLangProblems(output) {
  const problems = [];
  const regex =
    /^(Lexical Error|Syntax Error|Semantic Error) at line (\d+):\s+(.+)$/gm;

  let match;

  while ((match = regex.exec(output)) !== null) {
    problems.push({
      file: "main.copi",
      line: Number(match[2]),
      column: 1,
      type: "error",
      message: `${match[1]}: ${match[3]}`,
    });
  }

  return problems;
}

function parsePythonToCProblems(output) {
  const problems = [];
  const regex =
    /^(Lexical Error|Syntax Error|Semantic Error) at line (\d+):\s+(.+)$/gm;

  let match;

  while ((match = regex.exec(output)) !== null) {
    problems.push({
      file: "main.py",
      line: Number(match[2]),
      column: 1,
      type: "error",
      message: `${match[1]}: ${match[3]}`,
    });
  }

  return problems;
}

function sanitizePythonExpression(expr) {
  return expr
    .replace(/\band\b/g, "&&")
    .replace(/\bor\b/g, "||")
    .replace(/\bnot\b/g, "!")
    .replace(/\bTrue\b/g, "1")
    .replace(/\bFalse\b/g, "0")
    .replace(/\bNone\b/g, "0");
}

function isSafeExpression(expr) {
  return /^[a-zA-Z0-9_+\-*/%<>=!&|().,\s]+$/.test(expr);
}

function escapeCString(text) {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function splitPythonArgs(argsText) {
  const args = [];
  let current = "";
  let quote = null;
  let depth = 0;

  for (let i = 0; i < argsText.length; i++) {
    const ch = argsText[i];
    const prev = argsText[i - 1];

    if ((ch === '"' || ch === "'") && prev !== "\\") {
      if (quote === ch) {
        quote = null;
      } else if (!quote) {
        quote = ch;
      }

      current += ch;
      continue;
    }

    if (!quote) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;

      if (ch === "," && depth === 0) {
        args.push(current.trim());
        current = "";
        continue;
      }
    }

    current += ch;
  }

  if (current.trim() !== "") {
    args.push(current.trim());
  }

  return args;
}

function isStringLiteral(value) {
  return (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  );
}

function removeStringQuotes(value) {
  return value.slice(1, -1);
}

function buildPrintfFromPythonPrint(argsText, lineNumber) {
  const args = splitPythonArgs(argsText);

  if (args.length === 0) {
    return {
      success: true,
      lines: ['printf("\\n");'],
    };
  }

  let format = "";
  const values = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i].trim();

    if (i > 0) {
      format += " ";
    }

    if (isStringLiteral(arg)) {
      format += escapeCString(removeStringQuotes(arg));
    } else {
      const expression = sanitizePythonExpression(arg);

      if (!isSafeExpression(expression)) {
        return {
          success: false,
          error: `Syntax Error at line ${lineNumber}: invalid print expression\n`,
        };
      }

      format += "%d";
      values.push(expression);
    }
  }

  format += "\\n";

  if (values.length === 0) {
    return {
      success: true,
      lines: [`printf("${format}");`],
    };
  }

  return {
    success: true,
    lines: [`printf("${format}", ${values.join(", ")});`],
  };
}

function transpilePythonToC(code) {
  const lines = code.replace(/\r\n/g, "\n").split("\n");
  const declaredVars = new Set();
  const cLines = [];
  const indentStack = [0];

  let errors = "";

  cLines.push("#include <stdio.h>");
  cLines.push("");
  cLines.push("int main() {");

  function countIndent(line) {
    const match = line.match(/^ */);
    return match ? match[0].length : 0;
  }

  function closeBlocksUntil(currentIndent) {
    while (
      indentStack.length > 1 &&
      currentIndent < indentStack[indentStack.length - 1]
    ) {
      cLines.push("}");
      indentStack.pop();
    }
  }

  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const originalLine = lines[index];

    if (originalLine.trim() === "" || originalLine.trim().startsWith("#")) {
      continue;
    }

    if (/^\t/.test(originalLine)) {
      errors += `Syntax Error at line ${lineNumber}: tabs are not supported, use spaces for indentation\n`;
      continue;
    }

    const indent = countIndent(originalLine);
    const line = originalLine.trim();

    if (/[@#$`~\[\]{}]/.test(line)) {
      errors += `Lexical Error at line ${lineNumber}: unsupported character found\n`;
      continue;
    }

    if (line === "else:") {
      while (
        indentStack.length > 1 &&
        indent + 4 < indentStack[indentStack.length - 1]
      ) {
        cLines.push("}");
        indentStack.pop();
      }

      if (
        indentStack.length <= 1 ||
        indent + 4 !== indentStack[indentStack.length - 1]
      ) {
        errors += `Syntax Error at line ${lineNumber}: else without matching if block\n`;
        continue;
      }

      cLines.push("} else {");
      indentStack.pop();
      indentStack.push(indent + 4);
      continue;
    }

    closeBlocksUntil(indent);

    if (indent > indentStack[indentStack.length - 1]) {
      errors += `Syntax Error at line ${lineNumber}: unexpected indentation\n`;
      continue;
    }

    let match;

    match = line.match(/^while\s+(.+):$/);
    if (match) {
      const condition = sanitizePythonExpression(match[1]);

      if (!isSafeExpression(condition)) {
        errors += `Syntax Error at line ${lineNumber}: invalid while condition\n`;
        continue;
      }

      cLines.push(`while (${condition}) {`);
      indentStack.push(indent + 4);
      continue;
    }

    match = line.match(/^if\s+(.+):$/);
    if (match) {
      const condition = sanitizePythonExpression(match[1]);

      if (!isSafeExpression(condition)) {
        errors += `Syntax Error at line ${lineNumber}: invalid if condition\n`;
        continue;
      }

      cLines.push(`if (${condition}) {`);
      indentStack.push(indent + 4);
      continue;
    }

    match = line.match(
      /^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*int\s*\(\s*input\s*\(\s*["'](.*)["']\s*\)\s*\)$/
    );
    if (match) {
      const variableName = match[1];
      const promptText = match[2];

      if (!declaredVars.has(variableName)) {
        declaredVars.add(variableName);
        cLines.push(`int ${variableName};`);
      }

      cLines.push(`printf("${escapeCString(promptText)}");`);
      cLines.push("fflush(stdout);");
      cLines.push(`scanf("%d", &${variableName});`);
      continue;
    }

    match = line.match(
      /^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*input\s*\(\s*["'](.*)["']\s*\)$/
    );
    if (match) {
      const variableName = match[1];
      const promptText = match[2];

      if (!declaredVars.has(variableName)) {
        declaredVars.add(variableName);
        cLines.push(`int ${variableName};`);
      }

      cLines.push(`printf("${escapeCString(promptText)}");`);
      cLines.push("fflush(stdout);");
      cLines.push(`scanf("%d", &${variableName});`);
      continue;
    }

    match = line.match(/^print\s*\((.*)\)$/);
    if (match) {
      const printResult = buildPrintfFromPythonPrint(match[1], lineNumber);

      if (!printResult.success) {
        errors += printResult.error;
        continue;
      }

      for (const outputLine of printResult.lines) {
        cLines.push(outputLine);
      }

      continue;
    }

    match = line.match(/^print\s+(.+)$/);
    if (match) {
      const printResult = buildPrintfFromPythonPrint(match[1], lineNumber);

      if (!printResult.success) {
        errors += printResult.error;
        continue;
      }

      for (const outputLine of printResult.lines) {
        cLines.push(outputLine);
      }

      continue;
    }

    match = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/);
    if (match) {
      const variableName = match[1];
      const expression = sanitizePythonExpression(match[2]);

      if (!isSafeExpression(expression)) {
        errors += `Syntax Error at line ${lineNumber}: invalid assignment expression\n`;
        continue;
      }

      if (!declaredVars.has(variableName)) {
        declaredVars.add(variableName);
        cLines.push(`int ${variableName} = ${expression};`);
      } else {
        cLines.push(`${variableName} = ${expression};`);
      }

      continue;
    }

    errors += `Syntax Error at line ${lineNumber}: unsupported statement '${line}'\n`;
  }

  while (indentStack.length > 1) {
    cLines.push("}");
    indentStack.pop();
  }

  cLines.push("return 0;");
  cLines.push("}");

  return {
    success: errors.length === 0,
    cCode: cLines.join("\n"),
    errors,
  };
}

registerIpcHandler("codopi:minimize-window", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win?.minimize();
});

registerIpcHandler("codopi:maximize-window", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);

  if (!win) return;

  if (win.isMaximized()) {
    win.unmaximize();
  } else {
    win.maximize();
  }
});

registerIpcHandler("codopi:close-window", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win?.close();
});

registerIpcHandler("codopi:run-code", async (_event, payload) => {
  try {
    const { code, language } = payload;

    const runDir = path.join(os.tmpdir(), "codopi-run");
    fs.mkdirSync(runDir, { recursive: true });

    const isCpp = language === "cpp";
    const runId = Date.now();

    const sourceFile = path.join(
      runDir,
      isCpp ? `main_${runId}.cpp` : `main_${runId}.c`
    );
    const exeFile = path.join(runDir, `main_${runId}.exe`);

    fs.writeFileSync(sourceFile, code, "utf8");

    const compiler = isCpp ? getToolPath("g++") : getToolPath("gcc");

    const compileArgs = isCpp
      ? ["-O0", "-pipe", "-std=c++17", sourceFile, "-o", exeFile]
      : ["-O0", "-pipe", "-std=c17", sourceFile, "-o", exeFile];

    const compileStart = Date.now();

    const compileResult = await runProcess(compiler, compileArgs, {
      cwd: runDir,
    });

    const compileTime = ((Date.now() - compileStart) / 1000).toFixed(2);
    const compilerOutput = compileResult.stderr || compileResult.stdout;
    const problems = parseGccProblems(compilerOutput);

    if (compileResult.code !== 0) {
      return {
        success: false,
        stage: "compile",
        output:
          "Compilation failed.\n" +
          `Compile time: ${compileTime}s\n\n` +
          "Compiler output:\n" +
          (compilerOutput || "No compiler message received."),
        problems,
      };
    }

    return {
      success: true,
      stage: "run",
      output:
        "Compilation successful.\n" +
        `Compile time: ${compileTime}s\n\n` +
        "Program compiled successfully. Use the live terminal run for programs that need input.",
      problems: [],
    };
  } catch (error) {
    return {
      success: false,
      stage: "error",
      output: error.message,
      problems: [],
    };
  }
});

registerIpcHandler("codopi:terminal-run-code", async (event, payload) => {
  try {
    const { code, language, sessionId: givenSessionId, cols, rows } = payload;

    const sessionId = givenSessionId || "main";
    stopTerminalSession(sessionId);
    stopTerminalSession("main");

    const runDir = path.join(os.tmpdir(), "codopi-terminal-run");
    fs.mkdirSync(runDir, { recursive: true });

    const isCpp = language === "cpp";
    const runId = Date.now();

    const sourceFile = path.join(
      runDir,
      isCpp ? `main_${runId}.cpp` : `main_${runId}.c`
    );
    const exeFile = path.join(runDir, `main_${runId}.exe`);

    fs.writeFileSync(sourceFile, code, "utf8");

    const compiler = isCpp ? getToolPath("g++") : getToolPath("gcc");

    const compileArgs = isCpp
      ? ["-O0", "-pipe", "-std=c++17", sourceFile, "-o", exeFile]
      : ["-O0", "-pipe", "-std=c17", sourceFile, "-o", exeFile];

    const compileStart = Date.now();

    const compileResult = await runProcess(compiler, compileArgs, {
      cwd: runDir,
    });

    const compileTime = ((Date.now() - compileStart) / 1000).toFixed(2);
    const compilerOutput = compileResult.stderr || compileResult.stdout;
    const problems = parseGccProblems(compilerOutput);

    if (compileResult.code !== 0) {
      return {
        success: false,
        stage: "compile",
        output:
          "Compilation failed.\n" +
          `Compile time: ${compileTime}s\n\n` +
          "Compiler output:\n" +
          (compilerOutput || "No compiler message received."),
        problems,
      };
    }

    const terminal = pty.spawn(exeFile, [], {
      name: "xterm-color",
      cols: Number(cols) || 80,
      rows: Number(rows) || 30,
      cwd: runDir,
      env: getMsysEnv(),
    });

    terminalSessions.set(sessionId, terminal);
    terminalSessions.set("main", terminal);

    sendTerminalOutput(event, sessionId, "Codopi Live Terminal\r\n\r\n");

    terminal.onData((data) => {
      sendTerminalOutput(event, sessionId, data);
    });

    terminal.onExit(({ exitCode }) => {
      sendTerminalExit(event, sessionId, exitCode);
      terminalSessions.delete(sessionId);
      terminalSessions.delete("main");
    });

    return {
      success: true,
      stage: "run",
      output:
        "Compilation successful.\n" +
        `Compile time: ${compileTime}s\n\n` +
        "Program started in live terminal.\n" +
        "Click inside the terminal, type input, then press Enter.",
      problems: [],
    };
  } catch (error) {
    return {
      success: false,
      stage: "error",
      output: error.message,
      problems: [],
    };
  }
});

registerIpcHandler("codopi:terminal-run-python-to-c", async (event, payload) => {
  try {
    const { code, sessionId: givenSessionId, cols, rows } = payload;

    const sessionId = givenSessionId || "main";
    stopTerminalSession(sessionId);
    stopTerminalSession("main");

    const runDir = path.join(os.tmpdir(), "codopi-python-terminal-run");
    fs.mkdirSync(runDir, { recursive: true });

    const runId = Date.now();

    const pythonFile = path.join(runDir, `main_${runId}.py`);
    const generatedCFile = path.join(runDir, `generated_python_${runId}.c`);
    const generatedExeFile = path.join(runDir, `generated_python_${runId}.exe`);

    fs.writeFileSync(pythonFile, code, "utf8");

    const convertStart = Date.now();
    const transpileResult = transpilePythonToC(code);
    const conversionTime = ((Date.now() - convertStart) / 1000).toFixed(2);

    if (!transpileResult.success) {
      return {
        success: false,
        stage: "compile",
        output:
          "Python to C conversion failed.\n" +
          `Conversion time: ${conversionTime}s\n\n` +
          "Compiler output:\n" +
          transpileResult.errors,
        problems: parsePythonToCProblems(transpileResult.errors),
      };
    }

    fs.writeFileSync(generatedCFile, transpileResult.cCode, "utf8");

    const gccPath = getToolPath("gcc");
    const compileStart = Date.now();

    const gccResult = await runProcess(
      gccPath,
      ["-O0", "-pipe", "-std=c17", generatedCFile, "-o", generatedExeFile],
      {
        cwd: runDir,
      }
    );

    const compileTime = ((Date.now() - compileStart) / 1000).toFixed(2);
    const gccOutput = gccResult.stderr || gccResult.stdout;
    const gccProblems = parseGccProblems(gccOutput);

    if (gccResult.code !== 0) {
      return {
        success: false,
        stage: "compile",
        output:
          "Generated C compilation failed.\n" +
          `Conversion time: ${conversionTime}s\n` +
          `Compile time: ${compileTime}s\n\n` +
          "Generated C code:\n" +
          transpileResult.cCode +
          "\n\nGCC output:\n" +
          (gccOutput || "No GCC message received."),
        problems: gccProblems,
      };
    }

    const terminal = pty.spawn(generatedExeFile, [], {
      name: "xterm-color",
      cols: Number(cols) || 80,
      rows: Number(rows) || 30,
      cwd: runDir,
      env: getMsysEnv(),
    });

    terminalSessions.set(sessionId, terminal);
    terminalSessions.set("main", terminal);

    sendTerminalOutput(event, sessionId, "Codopi Live Terminal\r\n\r\n");

    terminal.onData((data) => {
      sendTerminalOutput(event, sessionId, data);
    });

    terminal.onExit(({ exitCode }) => {
      sendTerminalExit(event, sessionId, exitCode);
      terminalSessions.delete(sessionId);
      terminalSessions.delete("main");
    });

    return {
      success: true,
      stage: "run",
      output:
        "Python to C conversion successful.\n" +
        `Conversion time: ${conversionTime}s\n` +
        `Compile time: ${compileTime}s\n\n` +
        "Generated C code:\n" +
        "-------------------------\n" +
        transpileResult.cCode +
        "\n-------------------------\n\n" +
        "Program started in live terminal.\n" +
        "Click inside the terminal, type input, then press Enter.",
      problems: [],
    };
  } catch (error) {
    return {
      success: false,
      stage: "error",
      output: error.message,
      problems: [],
    };
  }
});

registerIpcHandler("codopi:terminal-write", async (_event, firstArg, secondArg) => {
  let sessionId = "main";
  let data = firstArg;

  if (typeof firstArg === "object" && firstArg !== null) {
    sessionId = firstArg.sessionId || "main";
    data = firstArg.data;
  } else if (typeof secondArg === "string") {
    sessionId = firstArg || "main";
    data = secondArg;
  }

  const session = terminalSessions.get(sessionId) || terminalSessions.get("main");

  if (session && typeof data === "string") {
    session.write(data);
  }

  return {
    success: true,
  };
});

registerIpcHandler("codopi:terminal-resize", async (_event, firstArg, secondArg, thirdArg) => {
  let sessionId = "main";
  let cols = 80;
  let rows = 30;

  if (typeof firstArg === "object" && firstArg !== null) {
    sessionId = firstArg.sessionId || "main";
    cols = Number(firstArg.cols) || 80;
    rows = Number(firstArg.rows) || 30;
  } else {
    sessionId = firstArg || "main";
    cols = Number(secondArg) || 80;
    rows = Number(thirdArg) || 30;
  }

  const session = terminalSessions.get(sessionId) || terminalSessions.get("main");

  if (!session) {
    return {
      success: false,
      error: "No running terminal process.",
    };
  }

  try {
    session.resize(cols, rows);

    return {
      success: true,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
});

registerIpcHandler("codopi:terminal-stop", async (_event, firstArg) => {
  let sessionId = "main";

  if (typeof firstArg === "object" && firstArg !== null) {
    sessionId = firstArg.sessionId || "main";
  } else if (typeof firstArg === "string") {
    sessionId = firstArg;
  }

  stopTerminalSession(sessionId);
  stopTerminalSession("main");

  return {
    success: true,
  };
});

registerIpcHandler("codopi:run-codopi-lang", async (_event, payload) => {
  try {
    const { code } = payload;

    const runDir = path.join(os.tmpdir(), "codopi-lang-run");
    fs.mkdirSync(runDir, { recursive: true });

    const inputFile = path.join(runDir, "main.copi");
    const generatedCFile = path.join(runDir, "generated.c");
    const generatedExeFile = path.join(runDir, "generated.exe");

    const compilerExe = path.join(
      __dirname,
      "../compiler-lab/codopi_lang_compiler.exe"
    );

    if (!fs.existsSync(compilerExe)) {
      return {
        success: false,
        stage: "compile",
        output:
          "CodopiLang compiler not found.\n\nExpected path:\n" + compilerExe,
        problems: [],
      };
    }

    fs.writeFileSync(inputFile, code, "utf8");

    if (fs.existsSync(generatedCFile)) {
      fs.unlinkSync(generatedCFile);
    }

    if (fs.existsSync(generatedExeFile)) {
      fs.unlinkSync(generatedExeFile);
    }

    const customCompileResult = await runProcess(
      compilerExe,
      [inputFile, generatedCFile],
      {
        cwd: runDir,
      }
    );

    const customCompilerOutput =
      customCompileResult.stderr || customCompileResult.stdout;

    const customProblems = parseCodopiLangProblems(customCompilerOutput);

    if (customCompileResult.code !== 0) {
      return {
        success: false,
        stage: "compile",
        output:
          "CodopiLang compilation failed.\n\n" +
          "Compiler used:\n" +
          compilerExe +
          "\n\nCompiler output:\n" +
          (customCompilerOutput || "No compiler message received."),
        problems: customProblems,
      };
    }

    const gccPath = getToolPath("gcc");

    const gccResult = await runProcess(
      gccPath,
      [generatedCFile, "-o", generatedExeFile],
      {
        cwd: runDir,
      }
    );

    const gccOutput = gccResult.stderr || gccResult.stdout;
    const gccProblems = parseGccProblems(gccOutput);

    if (gccResult.code !== 0) {
      return {
        success: false,
        stage: "compile",
        output:
          "Generated C compilation failed.\n\n" +
          "GCC output:\n" +
          (gccOutput || "No GCC message received."),
        problems: gccProblems,
      };
    }

    const runResult = await runProcess(generatedExeFile, [], {
      cwd: runDir,
    });

    return {
      success: runResult.code === 0,
      stage: "run",
      output:
        "CodopiLang compilation successful.\n\n" +
        "Pipeline:\n" +
        "Flex lexer → Bison parser → C code generator → GCC backend\n\n" +
        "Program output:\n" +
        `${runResult.stdout || ""}` +
        `${runResult.stderr ? "\nErrors:\n" + runResult.stderr : ""}`,
      problems: [],
    };
  } catch (error) {
    return {
      success: false,
      stage: "error",
      output: error.message,
      problems: [],
    };
  }
});

registerIpcHandler("codopi:run-python-to-c", async (_event, payload) => {
  try {
    const { code } = payload;

    const runDir = path.join(os.tmpdir(), "codopi-python-run");
    fs.mkdirSync(runDir, { recursive: true });

    const pythonFile = path.join(runDir, "main.py");
    const generatedCFile = path.join(runDir, "generated_python.c");
    const generatedExeFile = path.join(runDir, "generated_python.exe");

    fs.writeFileSync(pythonFile, code, "utf8");

    const transpileResult = transpilePythonToC(code);

    if (!transpileResult.success) {
      return {
        success: false,
        stage: "compile",
        output:
          "Python to C conversion failed.\n\n" +
          "Compiler output:\n" +
          transpileResult.errors,
        problems: parsePythonToCProblems(transpileResult.errors),
      };
    }

    fs.writeFileSync(generatedCFile, transpileResult.cCode, "utf8");

    if (fs.existsSync(generatedExeFile)) {
      fs.unlinkSync(generatedExeFile);
    }

    const gccPath = getToolPath("gcc");

    const gccResult = await runProcess(
      gccPath,
      ["-O0", "-pipe", "-std=c17", generatedCFile, "-o", generatedExeFile],
      {
        cwd: runDir,
      }
    );

    const gccOutput = gccResult.stderr || gccResult.stdout;
    const gccProblems = parseGccProblems(gccOutput);

    if (gccResult.code !== 0) {
      return {
        success: false,
        stage: "compile",
        output:
          "Generated C compilation failed.\n\n" +
          "Generated C file:\n" +
          generatedCFile +
          "\n\nGenerated C code:\n" +
          transpileResult.cCode +
          "\n\nGCC output:\n" +
          (gccOutput || "No GCC message received."),
        problems: gccProblems,
      };
    }

    return {
      success: true,
      stage: "run",
      output:
        "Python to C conversion successful.\n\n" +
        "Generated C code:\n" +
        transpileResult.cCode +
        "\n\nProgram compiled successfully. Use the live terminal run for programs that need input.",
      problems: [],
    };
  } catch (error) {
    return {
      success: false,
      stage: "error",
      output: error.message,
      problems: [],
    };
  }
});

registerIpcHandler("codopi:open-file", async () => {
  try {
    const result = await dialog.showOpenDialog({
      title: "Open Codopi File",
      properties: ["openFile"],
      filters: [
        {
          name: "C/C++/CodopiLang/Python Files",
          extensions: ["c", "cpp", "h", "hpp", "copi", "py"],
        },
        { name: "All Files", extensions: ["*"] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return {
        success: false,
        canceled: true,
      };
    }

    const filePath = result.filePaths[0];
    const content = fs.readFileSync(filePath, "utf8");

    return {
      success: true,
      filePath,
      content,
      language: getLanguageFromFilePath(filePath),
    };
  } catch (error) {
    return {
      success: false,
      canceled: false,
      error: error.message,
    };
  }
});

registerIpcHandler("codopi:read-file-by-path", async (_event, filePath) => {
  try {
    const content = fs.readFileSync(filePath, "utf8");

    return {
      success: true,
      filePath,
      content,
      language: getLanguageFromFilePath(filePath),
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
});

registerIpcHandler("codopi:open-folder", async () => {
  try {
    const result = await dialog.showOpenDialog({
      title: "Open Folder in Codopi",
      properties: ["openDirectory"],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return {
        success: false,
        canceled: true,
      };
    }

    const folderPath = result.filePaths[0];
    const files = listFolderFiles(folderPath);

    return {
      success: true,
      folderPath,
      folderName: path.basename(folderPath),
      files,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
});

registerIpcHandler("codopi:save-file", async (_event, payload) => {
  try {
    const { code, filePath, language } = payload;

    let finalPath = filePath;

    if (!finalPath) {
      let defaultFileName = "main.cpp";

      if (language === "c") defaultFileName = "main.c";
      if (language === "copi") defaultFileName = "main.copi";
      if (language === "py") defaultFileName = "main.py";

      const result = await dialog.showSaveDialog({
        title: "Save Codopi File",
        defaultPath: defaultFileName,
        filters: [
          {
            name: "C/C++/CodopiLang/Python Files",
            extensions: ["c", "cpp", "h", "hpp", "copi", "py"],
          },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (result.canceled || !result.filePath) {
        return {
          success: false,
          canceled: true,
        };
      }

      finalPath = result.filePath;
    }

    fs.writeFileSync(finalPath, code, "utf8");

    return {
      success: true,
      filePath: finalPath,
    };
  } catch (error) {
    return {
      success: false,
      canceled: false,
      error: error.message,
    };
  }
});

registerIpcHandler("codopi:save-as-file", async (_event, payload) => {
  try {
    const { code, language } = payload;

    let defaultFileName = "main.cpp";

    if (language === "c") defaultFileName = "main.c";
    if (language === "copi") defaultFileName = "main.copi";
    if (language === "py") defaultFileName = "main.py";

    const result = await dialog.showSaveDialog({
      title: "Save As",
      defaultPath: defaultFileName,
      filters: [
        {
          name: "C/C++/CodopiLang/Python Files",
          extensions: ["c", "cpp", "h", "hpp", "copi", "py"],
        },
        { name: "All Files", extensions: ["*"] },
      ],
    });

    if (result.canceled || !result.filePath) {
      return {
        success: false,
        canceled: true,
      };
    }

    fs.writeFileSync(result.filePath, code, "utf8");

    return {
      success: true,
      filePath: result.filePath,
      language: getLanguageFromFilePath(result.filePath),
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
});

app.whenReady().then(createWindow);

app.on("before-quit", () => {
  stopAllTerminalSessions();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});