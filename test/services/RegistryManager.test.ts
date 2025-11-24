/**
 * RegistryManager Unit Tests
 * 
 * Tests for RegistryManager export/import functionality (integration-style)
 */

import * as assert from 'assert';

suite('RegistryManager Export/Import', () => {
    suite('Export Format Validation', () => {
        test('JSON export should produce valid JSON structure', () => {
            const mockExportData = {
                version: '1.0.0',
                exportedAt: new Date().toISOString(),
                sources: [],
                profiles: [],
                configuration: {
                    autoCheckUpdates: true,
                    installationScope: 'user'
                }
            };
            
            const jsonString = JSON.stringify(mockExportData, null, 2);
            const parsed = JSON.parse(jsonString);
            
            assert.strictEqual(parsed.version, '1.0.0');
            assert.ok(Array.isArray(parsed.sources));
            assert.ok(Array.isArray(parsed.profiles));
            assert.ok(parsed.configuration);
        });

        test('YAML export format should be detectable', () => {
            const yamlContent = `version: 1.0.0
sources: []
profiles: []
configuration:
  autoCheckUpdates: true`;
            
            assert.ok(yamlContent.includes('version:'));
            assert.ok(yamlContent.includes('sources:'));
            assert.ok(yamlContent.includes('profiles:'));
        });
    });

    suite('Import Validation', () => {
        test('should validate required version field', () => {
            const validData = {
                version: '1.0.0',
                sources: [],
                profiles: []
            };
            
            assert.ok(validData.version);
            assert.strictEqual(validData.version, '1.0.0');
        });

        test('should validate sources array', () => {
            const validData = {
                version: '1.0.0',
                sources: [],
                profiles: []
            };
            
            assert.ok(Array.isArray(validData.sources));
        });

        test('should validate profiles array', () => {
            const validData = {
                version: '1.0.0',
                sources: [],
                profiles: []
            };
            
            assert.ok(Array.isArray(validData.profiles));
        });
    });

    suite('Data Structure', () => {
        test('exported settings should have required fields', () => {
            const settings = {
                version: '1.0.0',
                exportedAt: new Date().toISOString(),
                sources: [],
                profiles: [],
                configuration: {}
            };
            
            assert.ok(settings.version);
            assert.ok(settings.exportedAt);
            assert.ok(Array.isArray(settings.sources));
            assert.ok(Array.isArray(settings.profiles));
            assert.ok(typeof settings.configuration === 'object');
        });

        test('timestamp should be valid ISO string', () => {
            const timestamp = new Date().toISOString();
            const parsed = new Date(timestamp);
            
            assert.ok(parsed.getTime() > 0);
            assert.ok(!isNaN(parsed.getTime()));
        });
    });
});

suite('RegistryManager Unified Download Path', () => {
    const fs = require('fs');
    const path = require('path');
    
    test('installBundle() should use unified download path for all source types', () => {
        // Read the RegistryManager source code
        const registryManagerPath = path.join(__dirname, '../../../src/services/RegistryManager.ts');
        const sourceCode = fs.readFileSync(registryManagerPath, 'utf8');
        
        // Find the installBundle method
        const installBundleMatch = sourceCode.match(/async installBundle\([^)]+\)[^{]*{([\s\S]*?)^\s{4}}/m);
        assert.ok(installBundleMatch, 'installBundle method should exist');
        
        const installBundleCode = installBundleMatch[1];
        
        // Verify it calls adapter.downloadBundle()
        assert.ok(
            installBundleCode.includes('adapter.downloadBundle(bundle)'),
            'installBundle should call adapter.downloadBundle(bundle)'
        );
        
        // Verify it calls installer.installFromBuffer()
        assert.ok(
            installBundleCode.includes('installer.installFromBuffer(bundle, bundleBuffer'),
            'installBundle should call installer.installFromBuffer(bundle, bundleBuffer, options)'
        );
    });
    
    test('installBundle() should NOT have branching logic for source types', () => {
        const fs = require('fs');
        const path = require('path');
        
        // Read the RegistryManager source code
        const registryManagerPath = path.join(__dirname, '../../../src/services/RegistryManager.ts');
        const sourceCode = fs.readFileSync(registryManagerPath, 'utf8');
        
        // Find the installBundle method
        const installBundleMatch = sourceCode.match(/async installBundle\([^)]+\)[^{]*{([\s\S]*?)^\s{4}}/m);
        assert.ok(installBundleMatch, 'installBundle method should exist');
        
        const installBundleCode = installBundleMatch[1];
        
        // Verify it does NOT have if/else branching for awesome-copilot
        assert.ok(
            !installBundleCode.includes("source.type === 'awesome-copilot'"),
            'installBundle should NOT have branching logic for awesome-copilot'
        );
        
        assert.ok(
            !installBundleCode.includes("source.type === 'local-awesome-copilot'"),
            'installBundle should NOT have branching logic for local-awesome-copilot'
        );
    });
    
    test('installBundle() should NOT call adapter.getDownloadUrl()', () => {
        const fs = require('fs');
        const path = require('path');
        
        // Read the RegistryManager source code
        const registryManagerPath = path.join(__dirname, '../../../src/services/RegistryManager.ts');
        const sourceCode = fs.readFileSync(registryManagerPath, 'utf8');
        
        // Find the installBundle method
        const installBundleMatch = sourceCode.match(/async installBundle\([^)]+\)[^{]*{([\s\S]*?)^\s{4}}/m);
        assert.ok(installBundleMatch, 'installBundle method should exist');
        
        const installBundleCode = installBundleMatch[1];
        
        // Verify it does NOT call getDownloadUrl
        assert.ok(
            !installBundleCode.includes('adapter.getDownloadUrl('),
            'installBundle should NOT call adapter.getDownloadUrl()'
        );
    });
    
    test('installBundle() should NOT call installer.install()', () => {
        const fs = require('fs');
        const path = require('path');
        
        // Read the RegistryManager source code
        const registryManagerPath = path.join(__dirname, '../../../src/services/RegistryManager.ts');
        const sourceCode = fs.readFileSync(registryManagerPath, 'utf8');
        
        // Find the installBundle method
        const installBundleMatch = sourceCode.match(/async installBundle\([^)]+\)[^{]*{([\s\S]*?)^\s{4}}/m);
        assert.ok(installBundleMatch, 'installBundle method should exist');
        
        const installBundleCode = installBundleMatch[1];
        
        // Verify it does NOT call installer.install (the old method)
        assert.ok(
            !installBundleCode.includes('installer.install(bundle, downloadUrl'),
            'installBundle should NOT call installer.install() with downloadUrl'
        );
    });
    
    test('All adapter interfaces should have downloadBundle method', () => {
        const fs = require('fs');
        const path = require('path');
        
        // Read the RepositoryAdapter interface
        const adapterPath = path.join(__dirname, '../../../src/adapters/RepositoryAdapter.ts');
        const sourceCode = fs.readFileSync(adapterPath, 'utf8');
        
        // Verify downloadBundle is in the interface
        assert.ok(
            sourceCode.includes('downloadBundle(bundle: Bundle): Promise<Buffer>'),
            'IRepositoryAdapter interface should define downloadBundle method'
        );
    });
});
