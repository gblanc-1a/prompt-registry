// Mock vscode API for unit tests
module.exports = {
  workspace: {
    getConfiguration: (section) => ({
      get: (key, defaultValue) => {
        // Return mock configuration values for testing
        if (section === 'olaf') {
          const config = {
            'repositoryOwner': 'test-owner',
            'repositoryName': 'test-repo',
            'githubToken': 'test-token',
            'usePrivateRepository': false
          };
          return config[key] || defaultValue;
        }
        return defaultValue;
      },
      update: async (key, value, target) => undefined
    })
  },
  window: {
    showInformationMessage: () => Promise.resolve(),
    showWarningMessage: () => Promise.resolve(),
    showErrorMessage: () => Promise.resolve(),
    createOutputChannel: (name) => ({
      appendLine: () => undefined,
      show: () => undefined,
      dispose: () => undefined
    })
  },
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3
  }
};
