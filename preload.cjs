const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("codopi", {
  minimizeWindow: () => {
    return ipcRenderer.invoke("codopi:minimize-window");
  },

  maximizeWindow: () => {
    return ipcRenderer.invoke("codopi:maximize-window");
  },

  closeWindow: () => {
    return ipcRenderer.invoke("codopi:close-window");
  },

  runCode: (code, language, input) => {
    return ipcRenderer.invoke("codopi:run-code", {
      code,
      language,
      input,
    });
  },

  runCodopiLang: (code) => {
    return ipcRenderer.invoke("codopi:run-codopi-lang", {
      code,
    });
  },

  runPythonToC: (code) => {
    return ipcRenderer.invoke("codopi:run-python-to-c", {
      code,
    });
  },
terminalRunPythonToC: (code, sessionId, cols, rows) => {
  return ipcRenderer.invoke("codopi:terminal-run-python-to-c", {
    code,
    sessionId,
    cols,
    rows,
  });
},

  terminalRunCode: (code, language, sessionId, cols, rows) => {
    return ipcRenderer.invoke("codopi:terminal-run-code", {
      code,
      language,
      sessionId,
      cols,
      rows,
    });
  },

  terminalWrite: (sessionId, data) => {
    return ipcRenderer.invoke("codopi:terminal-write", {
      sessionId,
      data,
    });
  },

  terminalResize: (sessionId, cols, rows) => {
    return ipcRenderer.invoke("codopi:terminal-resize", {
      sessionId,
      cols,
      rows,
    });
  },

  terminalStop: (sessionId) => {
    return ipcRenderer.invoke("codopi:terminal-stop", {
      sessionId,
    });
  },

  onTerminalOutput: (callback) => {
    const listener = (_event, sessionId, data) => {
      callback(sessionId, data);
    };

    ipcRenderer.on("codopi:terminal-output", listener);

    return () => {
      ipcRenderer.removeListener("codopi:terminal-output", listener);
    };
  },

  onTerminalExit: (callback) => {
    const listener = (_event, sessionId, data) => {
      callback(sessionId, data);
    };

    ipcRenderer.on("codopi:terminal-exit", listener);

    return () => {
      ipcRenderer.removeListener("codopi:terminal-exit", listener);
    };
  },

  openFile: () => {
    return ipcRenderer.invoke("codopi:open-file");
  },

  readFileByPath: (filePath) => {
    return ipcRenderer.invoke("codopi:read-file-by-path", filePath);
  },

  openFolder: () => {
    return ipcRenderer.invoke("codopi:open-folder");
  },

  saveFile: (code, filePath, language) => {
    return ipcRenderer.invoke("codopi:save-file", {
      code,
      filePath,
      language,
    });
  },

  saveAsFile: (code, language) => {
    return ipcRenderer.invoke("codopi:save-as-file", {
      code,
      language,
    });
  },
});