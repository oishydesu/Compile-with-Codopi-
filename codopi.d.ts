export {};

declare global {
  type CodopiLanguage = "c" | "cpp" | "copi" | "py";

  interface CodopiProblem {
    file: string;
    line: number;
    column: number;
    type: "error" | "warning" | "note";
    message: string;
  }

  interface CodopiRunResult {
    success: boolean;
    stage: "compile" | "run" | "error";
    output: string;
    problems: CodopiProblem[];
  }

  interface CodopiOpenFileResult {
    success: boolean;
    canceled?: boolean;
    filePath?: string;
    content?: string;
    language?: CodopiLanguage;
    error?: string;
  }

  interface CodopiSaveFileResult {
    success: boolean;
    canceled?: boolean;
    filePath?: string;
    error?: string;
  }

  interface CodopiFolderFile {
    name: string;
    path: string;
    relativePath: string;
    language: CodopiLanguage;
  }

  interface CodopiOpenFolderResult {
    success: boolean;
    canceled?: boolean;
    folderPath?: string;
    folderName?: string;
    files?: CodopiFolderFile[];
    error?: string;
  }

  interface CodopiTerminalActionResult {
    success: boolean;
    error?: string;
  }

  interface Window {
    codopi: {
      minimizeWindow: () => Promise<void>;
      maximizeWindow: () => Promise<void>;
      closeWindow: () => Promise<void>;

      runCode: (
        code: string,
        language: "c" | "cpp",
        input?: string
      ) => Promise<CodopiRunResult>;

      runCodopiLang: (code: string) => Promise<CodopiRunResult>;

      runPythonToC: (code: string) => Promise<CodopiRunResult>;
terminalRunPythonToC: (
  code: string,
  sessionId: string,
  cols: number,
  rows: number
) => Promise<CodopiRunResult>;

      terminalRunCode: (
        code: string,
        language: "c" | "cpp",
        sessionId: string,
        cols?: number,
        rows?: number
      ) => Promise<CodopiRunResult>;

      terminalWrite: (
        sessionId: string,
        data: string
      ) => Promise<CodopiTerminalActionResult>;

      terminalResize: (
        sessionId: string,
        cols: number,
        rows: number
      ) => Promise<CodopiTerminalActionResult>;

      terminalStop: (
        sessionId: string
      ) => Promise<CodopiTerminalActionResult>;

      onTerminalOutput: (
        callback: (sessionId: string, data: string) => void
      ) => () => void;

      onTerminalExit: (
        callback: (sessionId: string, data: string) => void
      ) => () => void;

      openFile: () => Promise<CodopiOpenFileResult>;

      readFileByPath: (filePath: string) => Promise<CodopiOpenFileResult>;

      openFolder: () => Promise<CodopiOpenFolderResult>;

      saveFile: (
        code: string,
        filePath: string | null,
        language: CodopiLanguage
      ) => Promise<CodopiSaveFileResult>;

      saveAsFile: (
        code: string,
        language: CodopiLanguage
      ) => Promise<CodopiSaveFileResult & { language?: CodopiLanguage }>;
    };
  }
}