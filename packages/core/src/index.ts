// Core package exports - domain types and ports

import * as path from 'node:path';

// Force runtime imports to ensure file emission
import './domain';
import './ports';

export * from './domain';
export * from './ports';

/**
 * Public schema directory path.
 * This directory contains JSON schemas for validation.
 */
export const SCHEMA_DIR = path.join(__dirname, './public/schemas');
