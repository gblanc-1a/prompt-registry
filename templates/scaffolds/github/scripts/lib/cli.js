/**
 * Shared CLI argument parsing utilities.
 * @module lib/cli
 */

/**
 * Parse a single-value CLI argument.
 * @param {string[]} argv - Command line arguments
 * @param {string} flag - Flag name (e.g., '--collection-file')
 * @returns {string|undefined} The value if found, undefined otherwise
 */
function parseSingleArg(argv, flag) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag && argv[i + 1]) {
      return argv[i + 1];
    }
  }
  return undefined;
}

/**
 * Parse a multi-value CLI argument (can appear multiple times).
 * @param {string[]} argv - Command line arguments
 * @param {string} flag - Flag name (e.g., '--changed-path')
 * @returns {string[]} Array of values
 */
function parseMultiArg(argv, flag) {
  const values = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag && argv[i + 1]) {
      values.push(argv[i + 1]);
      i++;
    }
  }
  return values;
}

/**
 * Check if a boolean flag is present.
 * @param {string[]} argv - Command line arguments
 * @param {string} flag - Flag name (e.g., '--dry-run')
 * @returns {boolean} True if flag is present
 */
function hasFlag(argv, flag) {
  return argv.includes(flag);
}

/**
 * Get positional argument at index (after filtering out flags).
 * @param {string[]} argv - Command line arguments
 * @param {number} index - Positional index (0-based)
 * @returns {string|undefined} The positional argument if found
 */
function getPositionalArg(argv, index) {
  let posIndex = 0;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      // Skip flag and its value if it has one
      if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        i++;
      }
      continue;
    }
    if (posIndex === index) {
      return arg;
    }
    posIndex++;
  }
  return undefined;
}

module.exports = {
  parseSingleArg,
  parseMultiArg,
  hasFlag,
  getPositionalArg,
};
