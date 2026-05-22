/**
 * Tests for EngagementHydrator
 * Orchestrates rating cache warm-up and user rating hydration for a hub.
 */

import * as assert from 'node:assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import {
  EngagementHydrator,
} from '../../../src/services/engagement/engagement-hydrator';
import {
  EngagementService,
} from '../../../src/services/engagement/engagement-service';
import {
  RatingCache,
} from '../../../src/services/engagement/rating-cache';
import {
  HubEngagementConfig,
  Rating,
} from '../../../src/types/engagement';
import {
  GitHubDiscussionsBackend,
} from '../../../src/services/engagement/backends/github-discussions-backend';
import {
  HubSource,
} from '../../../src/types/hub';

suite('EngagementHydrator', () => {
  let sandbox: sinon.SinonSandbox;
  let mockEngagementService: sinon.SinonStubbedInstance<EngagementService>;
  let mockRatingCache: sinon.SinonStubbedInstance<RatingCache>;
  let hydrator: EngagementHydrator;

  const baseSource = (overrides: Partial<HubSource> = {}): HubSource => ({
    id: 'src-id',
    name: 'Source',
    type: 'github',
    url: 'https://github.com/owner/repo',
    enabled: true,
    priority: 1,
    ...overrides
  });

  setup(() => {
    sandbox = sinon.createSandbox();

    mockEngagementService = {
      getHubBackend: sandbox.stub(),
      getAllRatings: sandbox.stub().resolves([]),
      saveRatings: sandbox.stub().resolves()
    } as unknown as sinon.SinonStubbedInstance<EngagementService>;

    mockRatingCache = {
      refreshFromHub: sandbox.stub().resolves(),
      hydrateUserRatings: sandbox.stub(),
      reapplyHydratedVotes: sandbox.stub()
    } as unknown as sinon.SinonStubbedInstance<RatingCache>;

    sandbox.stub(vscode.authentication, 'getSession').resolves(undefined);

    hydrator = new EngagementHydrator(
      mockEngagementService,
      mockRatingCache
    );
  });

  teardown(() => {
    sandbox.restore();
  });

  suite('buildSourceIdMap()', () => {
    test('returns undefined when sources are missing', () => {
      assert.strictEqual(hydrator.buildSourceIdMap(undefined), undefined);
    });

    test('returns undefined for empty sources array', () => {
      assert.strictEqual(hydrator.buildSourceIdMap([]), undefined);
    });

    test('skips disabled sources', () => {
      const map = hydrator.buildSourceIdMap([
        baseSource({ id: 'enabled-one', enabled: true }),
        baseSource({ id: 'disabled-one', enabled: false, url: 'https://github.com/owner/other' })
      ]);

      assert.ok(map);
      assert.strictEqual(map.size, 1);
      assert.ok(map.has('enabled-one'));
      assert.ok(!map.has('disabled-one'));
    });

    test('maps each enabled config source id to a deterministic adapter source id', () => {
      const map = hydrator.buildSourceIdMap([
        baseSource({ id: 'a', url: 'https://github.com/owner/repo-a' }),
        baseSource({ id: 'b', url: 'https://github.com/owner/repo-b' })
      ]);

      assert.ok(map);
      const adapterA = map.get('a');
      const adapterB = map.get('b');
      assert.ok(adapterA);
      assert.ok(adapterB);
      assert.notStrictEqual(adapterA, adapterB);
    });
  });

  suite('hydrate()', () => {
    const config = (overrides: Partial<HubEngagementConfig> = {}): HubEngagementConfig => ({
      enabled: true,
      backend: { type: 'file', storagePath: '/tmp/x' },
      ratings: { enabled: true, ratingsUrl: 'https://example.com/ratings.json' },
      ...overrides
    });

    test('warms the rating cache when ratingsUrl is present', async () => {
      await hydrator.hydrate('hub-1', config(), new Map([['src', 'adapter-src']]));

      assert.ok(mockRatingCache.refreshFromHub.calledOnce);
      const call = mockRatingCache.refreshFromHub.firstCall;
      assert.strictEqual(call.args[0], 'hub-1');
      assert.strictEqual(call.args[1], 'https://example.com/ratings.json');
    });

    test('skips rating cache refresh when ratingsUrl is absent', async () => {
      await hydrator.hydrate(
        'hub-1',
        config({ ratings: { enabled: true } }),
        new Map([['src', 'adapter-src']])
      );

      assert.strictEqual(mockRatingCache.refreshFromHub.callCount, 0);
    });

    test('does not call fetchViewerRatings for non-github-discussions backends', async () => {
      await hydrator.hydrate('hub-1', config(), new Map([['src', 'adapter-src']]));

      // No backend lookup for file backend
      assert.strictEqual(mockEngagementService.getHubBackend.callCount, 0);
    });

    test('hydrates local storage ratings when sourceIdMap is provided', async () => {
      const localRatings: Rating[] = [
        {
          id: 'r1',
          resourceType: 'bundle',
          resourceId: 'bundle-x',
          score: 4,
          timestamp: '2024-01-01T00:00:00Z',
          sourceId: 'src'
        }
      ];
      mockEngagementService.getAllRatings.resolves(localRatings);

      await hydrator.hydrate('hub-1', config(), new Map([['src', 'adapter-src']]));

      assert.ok(mockRatingCache.hydrateUserRatings.calledOnce);
      assert.ok(mockRatingCache.reapplyHydratedVotes.calledOnce);

      const args = mockRatingCache.hydrateUserRatings.firstCall.args;
      assert.deepStrictEqual(args[0], [
        { sourceId: 'adapter-src', bundleId: 'bundle-x', score: 4 }
      ]);
    });

    test('does not touch local hydration when sourceIdMap is undefined', async () => {
      await hydrator.hydrate('hub-1', config(), undefined);

      assert.strictEqual(mockEngagementService.getAllRatings.callCount, 0);
      assert.strictEqual(mockRatingCache.hydrateUserRatings.callCount, 0);
    });

    test('applies remote ratings as authoritative overwrite when github-discussions backend yields ratings', async () => {
      const fakeBackend = {
        type: 'github-discussions',
        fetchViewerRatings: sandbox.stub().resolves([
          { resourceId: 'src:bundle-y', score: 5 }
        ])
      };
      mockEngagementService.getHubBackend.returns(fakeBackend as any);

      await hydrator.hydrate(
        'hub-1',
        config({ backend: { type: 'github-discussions', repository: 'owner/repo' } }),
        new Map([['src', 'adapter-src']])
      );

      // hydrateUserRatings called twice: once for local, once for remote-overwrite
      const overwriteCall = mockRatingCache.hydrateUserRatings.getCalls()
        .find((c) => c.args[1]?.overwrite === true);
      assert.ok(overwriteCall, 'expected an overwrite call from remote ratings');
      assert.deepStrictEqual(overwriteCall.args[0], [
        { sourceId: 'adapter-src', bundleId: 'bundle-y', score: 5 }
      ]);

      // Cross-session persistence: remote ratings written to local storage
      assert.ok(mockEngagementService.saveRatings.calledOnce);
      const persisted = mockEngagementService.saveRatings.firstCall.args[0];
      assert.strictEqual(persisted.length, 1);
      assert.strictEqual(persisted[0].resourceId, 'bundle-y');
      assert.strictEqual(persisted[0].sourceId, 'src');
    });

    test('skips remote-rating overwrite path when fetchViewerRatings returns empty', async () => {
      const fakeBackend = {
        type: 'github-discussions',
        fetchViewerRatings: sandbox.stub().resolves([])
      };
      mockEngagementService.getHubBackend.returns(fakeBackend as any);

      await hydrator.hydrate(
        'hub-1',
        config({ backend: { type: 'github-discussions', repository: 'owner/repo' } }),
        new Map([['src', 'adapter-src']])
      );

      const overwriteCall = mockRatingCache.hydrateUserRatings.getCalls()
        .find((c) => c.args[1]?.overwrite === true);
      assert.strictEqual(overwriteCall, undefined);
      assert.strictEqual(mockEngagementService.saveRatings.callCount, 0);
    });

    test('tolerates missing hub backend (returns no remote ratings)', async () => {
      mockEngagementService.getHubBackend.returns(undefined);

      await hydrator.hydrate(
        'hub-1',
        config({ backend: { type: 'github-discussions', repository: 'owner/repo' } }),
        new Map([['src', 'adapter-src']])
      );

      // No overwrite, no persistence
      const overwriteCall = mockRatingCache.hydrateUserRatings.getCalls()
        .find((c) => c.args[1]?.overwrite === true);
      assert.strictEqual(overwriteCall, undefined);
      assert.strictEqual(mockEngagementService.saveRatings.callCount, 0);
    });
  });

  suite('lazy discussion creation contract', () => {
    test('GitHubDiscussionsBackend no longer exposes loadCollectionsMappings', () => {
      const backend = new GitHubDiscussionsBackend('/tmp/engagement-hydrator-test');
      assert.strictEqual(
        (backend as unknown as { loadCollectionsMappings?: unknown }).loadCollectionsMappings,
        undefined,
        'loadCollectionsMappings should be removed; mappings populate lazily on first vote'
      );
    });
  });
});
