/**
 * HttpAdapter Unit Tests
 */

import * as assert from 'assert';
import * as http from 'http';
import * as https from 'https';
import { HttpAdapter } from '../../src/adapters/HttpAdapter';
import { RegistrySource, Bundle } from '../../src/types/registry';

suite('HttpAdapter', () => {
    let server: http.Server;
    let serverPort: number;
    let serverUrl: string;

    // Helper to create a test server
    function createTestServer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<void> {
        return new Promise((resolve) => {
            server = http.createServer(handler);
            server.listen(0, () => {
                const address = server.address();
                if (address && typeof address === 'object') {
                    serverPort = address.port;
                    serverUrl = `http://localhost:${serverPort}`;
                }
                resolve();
            });
        });
    }

    // Helper to close test server
    function closeTestServer(): Promise<void> {
        return new Promise((resolve) => {
            if (server) {
                server.close(() => resolve());
            } else {
                resolve();
            }
        });
    }

    suite('downloadBundle', () => {
        teardown(async () => {
            await closeTestServer();
        });

        test('should download from HTTP URL and return correct Buffer', async () => {
            // Create test data
            const testData = Buffer.from('Test bundle content');
            
            await createTestServer((req, res) => {
                res.writeHead(200, { 'Content-Type': 'application/zip' });
                res.end(testData);
            });

            const source: RegistrySource = {
                id: 'test-http',
                name: 'Test HTTP',
                type: 'http',
                url: serverUrl,
                enabled: true,
                priority: 1,
            };

            const adapter = new HttpAdapter(source);
            const bundle: Bundle = {
                id: 'test-bundle',
                name: 'Test Bundle',
                version: '1.0.0',
                description: 'Test',
                author: 'Test',
                sourceId: 'test-http',
                environments: [],
                tags: [],
                lastUpdated: new Date().toISOString(),
                size: '0 B',
                dependencies: [],
                license: 'MIT',
                downloadUrl: `${serverUrl}/bundle.zip`,
                manifestUrl: `${serverUrl}/manifest.yml`,
            };

            const buffer = await adapter.downloadBundle(bundle);
            
            assert.ok(Buffer.isBuffer(buffer), 'Should return a Buffer');
            assert.strictEqual(buffer.length, testData.length, 'Buffer length should match');
            assert.ok(buffer.equals(testData), 'Buffer content should match exactly');
        });

        test('should preserve binary data integrity', async () => {
            // Create binary test data with various byte values
            const testData = Buffer.from([
                0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD,  // Various byte values
                0x50, 0x4B, 0x03, 0x04,              // ZIP magic number
                0x0A, 0x0D, 0x00,                    // Newlines and null
            ]);
            
            await createTestServer((req, res) => {
                res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
                res.end(testData);
            });

            const source: RegistrySource = {
                id: 'test-http',
                name: 'Test HTTP',
                type: 'http',
                url: serverUrl,
                enabled: true,
                priority: 1,
            };

            const adapter = new HttpAdapter(source);
            const bundle: Bundle = {
                id: 'test-bundle',
                name: 'Test Bundle',
                version: '1.0.0',
                description: 'Test',
                author: 'Test',
                sourceId: 'test-http',
                environments: [],
                tags: [],
                lastUpdated: new Date().toISOString(),
                size: '0 B',
                dependencies: [],
                license: 'MIT',
                downloadUrl: `${serverUrl}/bundle.zip`,
                manifestUrl: `${serverUrl}/manifest.yml`,
            };

            const buffer = await adapter.downloadBundle(bundle);
            
            // Verify byte-for-byte integrity
            assert.strictEqual(buffer.length, testData.length, 'Buffer length should match');
            for (let i = 0; i < testData.length; i++) {
                assert.strictEqual(
                    buffer[i],
                    testData[i],
                    `Byte at position ${i} should match (expected ${testData[i]}, got ${buffer[i]})`
                );
            }
        });

        test('should handle empty files', async () => {
            const testData = Buffer.alloc(0);
            
            await createTestServer((req, res) => {
                res.writeHead(200, { 'Content-Type': 'application/zip' });
                res.end(testData);
            });

            const source: RegistrySource = {
                id: 'test-http',
                name: 'Test HTTP',
                type: 'http',
                url: serverUrl,
                enabled: true,
                priority: 1,
            };

            const adapter = new HttpAdapter(source);
            const bundle: Bundle = {
                id: 'test-bundle',
                name: 'Test Bundle',
                version: '1.0.0',
                description: 'Test',
                author: 'Test',
                sourceId: 'test-http',
                environments: [],
                tags: [],
                lastUpdated: new Date().toISOString(),
                size: '0 B',
                dependencies: [],
                license: 'MIT',
                downloadUrl: `${serverUrl}/bundle.zip`,
                manifestUrl: `${serverUrl}/manifest.yml`,
            };

            const buffer = await adapter.downloadBundle(bundle);
            
            assert.ok(Buffer.isBuffer(buffer), 'Should return a Buffer');
            assert.strictEqual(buffer.length, 0, 'Buffer should be empty');
        });

        test('should handle large binary files', async () => {
            // Create a 1MB test file
            const testData = Buffer.alloc(1024 * 1024);
            for (let i = 0; i < testData.length; i++) {
                testData[i] = i % 256;
            }
            
            await createTestServer((req, res) => {
                res.writeHead(200, { 'Content-Type': 'application/zip' });
                res.end(testData);
            });

            const source: RegistrySource = {
                id: 'test-http',
                name: 'Test HTTP',
                type: 'http',
                url: serverUrl,
                enabled: true,
                priority: 1,
            };

            const adapter = new HttpAdapter(source);
            const bundle: Bundle = {
                id: 'test-bundle',
                name: 'Test Bundle',
                version: '1.0.0',
                description: 'Test',
                author: 'Test',
                sourceId: 'test-http',
                environments: [],
                tags: [],
                lastUpdated: new Date().toISOString(),
                size: '1 MB',
                dependencies: [],
                license: 'MIT',
                downloadUrl: `${serverUrl}/bundle.zip`,
                manifestUrl: `${serverUrl}/manifest.yml`,
            };

            const buffer = await adapter.downloadBundle(bundle);
            
            assert.strictEqual(buffer.length, testData.length, 'Buffer length should match');
            assert.ok(buffer.equals(testData), 'Buffer content should match exactly');
        });

        test('should handle HTTP 404 error', async () => {
            await createTestServer((req, res) => {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not Found');
            });

            const source: RegistrySource = {
                id: 'test-http',
                name: 'Test HTTP',
                type: 'http',
                url: serverUrl,
                enabled: true,
                priority: 1,
            };

            const adapter = new HttpAdapter(source);
            const bundle: Bundle = {
                id: 'test-bundle',
                name: 'Test Bundle',
                version: '1.0.0',
                description: 'Test',
                author: 'Test',
                sourceId: 'test-http',
                environments: [],
                tags: [],
                lastUpdated: new Date().toISOString(),
                size: '0 B',
                dependencies: [],
                license: 'MIT',
                downloadUrl: `${serverUrl}/bundle.zip`,
                manifestUrl: `${serverUrl}/manifest.yml`,
            };

            await assert.rejects(
                () => adapter.downloadBundle(bundle),
                /Failed to download bundle/,
                'Should throw error for 404'
            );
        });

        test('should handle HTTP 500 error', async () => {
            await createTestServer((req, res) => {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal Server Error');
            });

            const source: RegistrySource = {
                id: 'test-http',
                name: 'Test HTTP',
                type: 'http',
                url: serverUrl,
                enabled: true,
                priority: 1,
            };

            const adapter = new HttpAdapter(source);
            const bundle: Bundle = {
                id: 'test-bundle',
                name: 'Test Bundle',
                version: '1.0.0',
                description: 'Test',
                author: 'Test',
                sourceId: 'test-http',
                environments: [],
                tags: [],
                lastUpdated: new Date().toISOString(),
                size: '0 B',
                dependencies: [],
                license: 'MIT',
                downloadUrl: `${serverUrl}/bundle.zip`,
                manifestUrl: `${serverUrl}/manifest.yml`,
            };

            await assert.rejects(
                () => adapter.downloadBundle(bundle),
                /Failed to download bundle/,
                'Should throw error for 500'
            );
        });

        test('should handle network errors', async () => {
            const source: RegistrySource = {
                id: 'test-http',
                name: 'Test HTTP',
                type: 'http',
                url: 'http://localhost:1',  // Invalid port
                enabled: true,
                priority: 1,
            };

            const adapter = new HttpAdapter(source);
            const bundle: Bundle = {
                id: 'test-bundle',
                name: 'Test Bundle',
                version: '1.0.0',
                description: 'Test',
                author: 'Test',
                sourceId: 'test-http',
                environments: [],
                tags: [],
                lastUpdated: new Date().toISOString(),
                size: '0 B',
                dependencies: [],
                license: 'MIT',
                downloadUrl: 'http://localhost:1/bundle.zip',
                manifestUrl: 'http://localhost:1/manifest.yml',
            };

            await assert.rejects(
                () => adapter.downloadBundle(bundle),
                /Failed to download bundle/,
                'Should throw error for network failure'
            );
        });

        test('should handle redirects', async () => {
            const testData = Buffer.from('Redirected content');
            
            await createTestServer((req, res) => {
                if (req.url === '/bundle.zip') {
                    // Redirect to final location
                    res.writeHead(302, { 'Location': `${serverUrl}/final.zip` });
                    res.end();
                } else if (req.url === '/final.zip') {
                    // Serve actual content
                    res.writeHead(200, { 'Content-Type': 'application/zip' });
                    res.end(testData);
                } else {
                    res.writeHead(404);
                    res.end();
                }
            });

            const source: RegistrySource = {
                id: 'test-http',
                name: 'Test HTTP',
                type: 'http',
                url: serverUrl,
                enabled: true,
                priority: 1,
            };

            const adapter = new HttpAdapter(source);
            const bundle: Bundle = {
                id: 'test-bundle',
                name: 'Test Bundle',
                version: '1.0.0',
                description: 'Test',
                author: 'Test',
                sourceId: 'test-http',
                environments: [],
                tags: [],
                lastUpdated: new Date().toISOString(),
                size: '0 B',
                dependencies: [],
                license: 'MIT',
                downloadUrl: `${serverUrl}/bundle.zip`,
                manifestUrl: `${serverUrl}/manifest.yml`,
            };

            const buffer = await adapter.downloadBundle(bundle);
            
            assert.ok(buffer.equals(testData), 'Should follow redirect and download correct content');
        });

        test('should handle multiple redirects', async () => {
            const testData = Buffer.from('Final content');
            
            await createTestServer((req, res) => {
                if (req.url === '/bundle.zip') {
                    res.writeHead(301, { 'Location': `${serverUrl}/redirect1.zip` });
                    res.end();
                } else if (req.url === '/redirect1.zip') {
                    res.writeHead(302, { 'Location': `${serverUrl}/redirect2.zip` });
                    res.end();
                } else if (req.url === '/redirect2.zip') {
                    res.writeHead(302, { 'Location': `${serverUrl}/final.zip` });
                    res.end();
                } else if (req.url === '/final.zip') {
                    res.writeHead(200, { 'Content-Type': 'application/zip' });
                    res.end(testData);
                } else {
                    res.writeHead(404);
                    res.end();
                }
            });

            const source: RegistrySource = {
                id: 'test-http',
                name: 'Test HTTP',
                type: 'http',
                url: serverUrl,
                enabled: true,
                priority: 1,
            };

            const adapter = new HttpAdapter(source);
            const bundle: Bundle = {
                id: 'test-bundle',
                name: 'Test Bundle',
                version: '1.0.0',
                description: 'Test',
                author: 'Test',
                sourceId: 'test-http',
                environments: [],
                tags: [],
                lastUpdated: new Date().toISOString(),
                size: '0 B',
                dependencies: [],
                license: 'MIT',
                downloadUrl: `${serverUrl}/bundle.zip`,
                manifestUrl: `${serverUrl}/manifest.yml`,
            };

            const buffer = await adapter.downloadBundle(bundle);
            
            assert.ok(buffer.equals(testData), 'Should follow multiple redirects and download correct content');
        });

        test('should preserve binary data with null bytes', async () => {
            // Create test data with null bytes
            const testData = Buffer.from([
                0x50, 0x4B, 0x03, 0x04,  // ZIP header
                0x00, 0x00, 0x00, 0x00,  // Null bytes
                0xFF, 0xFE, 0xFD, 0xFC,  // High bytes
            ]);
            
            await createTestServer((req, res) => {
                res.writeHead(200, { 'Content-Type': 'application/zip' });
                res.end(testData);
            });

            const source: RegistrySource = {
                id: 'test-http',
                name: 'Test HTTP',
                type: 'http',
                url: serverUrl,
                enabled: true,
                priority: 1,
            };

            const adapter = new HttpAdapter(source);
            const bundle: Bundle = {
                id: 'test-bundle',
                name: 'Test Bundle',
                version: '1.0.0',
                description: 'Test',
                author: 'Test',
                sourceId: 'test-http',
                environments: [],
                tags: [],
                lastUpdated: new Date().toISOString(),
                size: '0 B',
                dependencies: [],
                license: 'MIT',
                downloadUrl: `${serverUrl}/bundle.zip`,
                manifestUrl: `${serverUrl}/manifest.yml`,
            };

            const buffer = await adapter.downloadBundle(bundle);
            
            assert.strictEqual(buffer.length, testData.length, 'Buffer length should match');
            assert.ok(buffer.equals(testData), 'Buffer with null bytes should match exactly');
        });
    });
});
