import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  validateTargetLayoutsConfig,
} from '../../src/domain/install/layout';

describe('validateTargetLayoutsConfig', () => {
  it('validates a correct config', () => {
    const config = {
      layouts: {
        vscode: {
          user: {
            baseDir: '${HOME}/.config/Code/User',
            kindRoutes: { 'prompts/': 'prompts/' },
            skipPaths: ['deployment-manifest.yml']
          }
        }
      }
    };
    const result = validateTargetLayoutsConfig(config);
    expect(result).toEqual(config);
  });

  it('throws when config is not an object', () => {
    expect(() => validateTargetLayoutsConfig(null)).toThrow('must be an object');
    expect(() => validateTargetLayoutsConfig('string')).toThrow('must be an object');
    expect(() => validateTargetLayoutsConfig(123)).toThrow('must be an object');
  });

  it('throws when layouts is missing', () => {
    expect(() => validateTargetLayoutsConfig({})).toThrow('must have a "layouts" object');
  });

  it('throws when layouts is not an object', () => {
    expect(() => validateTargetLayoutsConfig({ layouts: null })).toThrow('must have a "layouts" object');
    expect(() => validateTargetLayoutsConfig({ layouts: 'string' })).toThrow('must have a "layouts" object');
  });

  it('throws when target type is not an object', () => {
    const config = {
      layouts: {
        vscode: null
      }
    };
    expect(() => validateTargetLayoutsConfig(config)).toThrow('"vscode" must be an object');
  });

  it('throws when user layout is not an object', () => {
    const config = {
      layouts: {
        vscode: {
          user: null
        }
      }
    };
    expect(() => validateTargetLayoutsConfig(config)).toThrow('"vscode.user" must be an object');
  });

  it('throws when baseDir is not a string', () => {
    const config = {
      layouts: {
        vscode: {
          user: {
            baseDir: 123,
            kindRoutes: { 'prompts/': 'prompts/' }
          }
        }
      }
    };
    expect(() => validateTargetLayoutsConfig(config)).toThrow('"vscode.user.baseDir" must be a string');
  });

  it('throws when kindRoutes is not an object', () => {
    const config = {
      layouts: {
        vscode: {
          user: {
            baseDir: '${HOME}/.config',
            kindRoutes: null
          }
        }
      }
    };
    expect(() => validateTargetLayoutsConfig(config)).toThrow('"vscode.user.kindRoutes" must be an object');
  });

  it('throws when kindRoutes value is not a string', () => {
    const config = {
      layouts: {
        vscode: {
          user: {
            baseDir: '${HOME}/.config',
            kindRoutes: { 'prompts/': 123 }
          }
        }
      }
    };
    expect(() => validateTargetLayoutsConfig(config)).toThrow('"vscode.user.kindRoutes.prompts/" must be a string');
  });

  it('throws when skipPaths is not an array', () => {
    const config = {
      layouts: {
        vscode: {
          user: {
            baseDir: '${HOME}/.config',
            kindRoutes: { 'prompts/': 'prompts/' },
            skipPaths: 'not-an-array'
          }
        }
      }
    };
    expect(() => validateTargetLayoutsConfig(config)).toThrow('"vscode.user.skipPaths" must be an array');
  });

  it('throws when skipPaths entry is not a string', () => {
    const config = {
      layouts: {
        vscode: {
          user: {
            baseDir: '${HOME}/.config',
            kindRoutes: { 'prompts/': 'prompts/' },
            skipPaths: [123]
          }
        }
      }
    };
    expect(() => validateTargetLayoutsConfig(config)).toThrow('"vscode.user.skipPaths" entries must be strings');
  });

  it('validates repository layout when present', () => {
    const config = {
      layouts: {
        vscode: {
          user: {
            baseDir: '${HOME}/.vscode',
            kindRoutes: { 'prompts/': 'prompts/' }
          },
          repository: {
            baseDir: '${workspaceRoot}',
            kindRoutes: { 'prompts/': '.tool/prompts/' }
          }
        }
      }
    };
    const result = validateTargetLayoutsConfig(config);
    expect(result).toEqual(config);
  });

  it('throws when repository layout is invalid', () => {
    const config = {
      layouts: {
        vscode: {
          user: {
            baseDir: '${HOME}/.vscode',
            kindRoutes: { 'prompts/': 'prompts/' }
          },
          repository: {
            baseDir: 123,
            kindRoutes: {}
          }
        }
      }
    };
    expect(() => validateTargetLayoutsConfig(config)).toThrow('"vscode.repository.baseDir" must be a string');
  });

  it('allows optional repository layout', () => {
    const config = {
      layouts: {
        vscode: {
          user: {
            baseDir: '${HOME}/.vscode',
            kindRoutes: { 'prompts/': 'prompts/' }
          }
        }
      }
    };
    const result = validateTargetLayoutsConfig(config);
    expect(result).toEqual(config);
  });

  it('allows optional skipPaths', () => {
    const config = {
      layouts: {
        vscode: {
          user: {
            baseDir: '${HOME}/.vscode',
            kindRoutes: { 'prompts/': 'prompts/' }
          }
        }
      }
    };
    const result = validateTargetLayoutsConfig(config);
    expect(result).toEqual(config);
  });
});
