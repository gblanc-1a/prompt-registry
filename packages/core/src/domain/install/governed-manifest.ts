/**
 * Domain layer — the governed bundle manifest projection (U1).
 *
 * A bundle is installable only through a *validated* root manifest. The
 * validator in `domain/collection/manifest-validator.ts` already proves the
 * archive-level invariants (exactly one root `deployment-manifest.yml`, a
 * `files[]` inventory that exactly covers the archive with matching sizes and
 * digests, canonical archive-relative paths, canonical primitive kinds). This
 * module projects that validated shape into the vocabulary the shared
 * installation lifecycle speaks:
 *
 *   - {@link GovernedBundleManifest} — the validated manifest identity.
 *   - {@link ManifestItem} — routing identity for one canonical primitive
 *     (archive-relative path + kind), plus an *optional* integrity assertion.
 *   - {@link ArchiveFileRecord} — per-file integrity and the role that decides
 *     whether a file is ever written to a target.
 *   - {@link BundleProvenance} — immutable source facts, recorded for
 *     governance and never used to resolve a destination.
 *
 * The split is load-bearing: items carry routing identity, file records carry
 * integrity and role. Only a file record with the `installable` role makes its
 * item a write candidate (BR1.5), so `metadata` and `ignored` files stay in the
 * archive deliberately.
 *
 * Pure domain: no IO, no framework imports.
 * @module domain/install/governed-manifest
 */
import type {
  ReleaseManifestFileRole,
} from '../collection/types';
import type {
  PrimitiveKind,
} from '../primitive/types';

/**
 * The validated root manifest that authorises an installation.
 *
 * Only the validated form reaches routing or the registry; the raw manifest
 * read from the archive never does.
 */
export interface GovernedBundleManifest {
  /** Stable bundle identifier, unchanged across versions. */
  readonly bundleId: string;
  /** The bundle's own released version. */
  readonly version: string;
  /** Manifest format version; an unrecognised value rejects the bundle. */
  readonly formatVersion: number;
  readonly name: string;
  readonly description?: string;
}

/**
 * One canonical primitive declared by the manifest's `items[]` inventory.
 *
 * Carries routing identity, not integrity: integrity belongs to the matching
 * {@link ArchiveFileRecord}. `contentHash` is an *optional* per-item assertion
 * — when present it must match the referenced archive bytes before a target
 * write; when absent the item stays governed, because archive membership,
 * archive-relative path, and kind still come from `items[]` and the write is
 * verified by byte-for-byte target read-back.
 */
export interface ManifestItem {
  /** Unique within one manifest. */
  readonly itemId: string;
  /** Archive-relative; never absolute, never traversal-bearing. */
  readonly archivePath: string;
  /** Determines the destination subtree. */
  readonly kind: PrimitiveKind;
  /** Optional `sha256:<hex>` assertion over the referenced archive bytes. */
  readonly contentHash?: string;
  readonly name?: string;
  readonly description?: string;
}

/**
 * Integrity and policy record for one file inside the archive.
 *
 * The role decides whether the file is ever written to a target: only an
 * `installable` file is a write candidate.
 */
export interface ArchiveFileRecord {
  /** Archive-relative; excludes the root manifest itself. */
  readonly archivePath: string;
  readonly role: ReleaseManifestFileRole;
  /** Exact uncompressed byte length. */
  readonly size: number;
  /** `sha256:<hex>` over the archive bytes, when the manifest declares one. */
  readonly contentDigest?: string;
}

/**
 * Immutable source facts resolved when the bundle was packaged.
 *
 * Recorded for governance and reporting; never used to resolve a destination.
 */
export interface BundleProvenance {
  readonly source: string;
  readonly revision: string;
  readonly license: string;
}

/**
 * The complete governed projection handed to the shared lifecycle.
 */
export interface GovernedBundle {
  readonly manifest: GovernedBundleManifest;
  readonly items: readonly ManifestItem[];
  readonly fileRecords: readonly ArchiveFileRecord[];
  readonly provenance: BundleProvenance;
}

/**
 * Minimal validated-manifest shape this projection consumes.
 *
 * Structurally satisfied by `ReleaseDeploymentManifest`; declared separately so
 * this module does not depend on the validator's return type.
 */
export interface GovernableManifestSource {
  readonly formatVersion: number;
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly description?: string;
  readonly items: readonly {
    readonly id: string;
    readonly path: string;
    readonly kind: PrimitiveKind;
    readonly contentHash?: string;
    readonly name?: string;
    readonly description?: string;
  }[];
  readonly files: readonly {
    readonly path: string;
    readonly role: ReleaseManifestFileRole;
    readonly size: number;
    readonly sha256?: string;
  }[];
  readonly provenance: {
    readonly source: string;
    readonly revision: string;
    readonly license: string;
  };
}

/**
 * Project a validated governed manifest into the lifecycle's vocabulary.
 *
 * Pure: it re-shapes an already-validated manifest and asserts nothing the
 * validator has not already proven.
 * @param source - A manifest that passed governed (`formatVersion`) validation.
 * @returns The governed projection: manifest identity, items, file records, provenance.
 */
export function projectGovernedManifest(source: GovernableManifestSource): GovernedBundle {
  return {
    manifest: {
      bundleId: source.id,
      version: source.version,
      formatVersion: source.formatVersion,
      name: source.name,
      ...(source.description === undefined ? {} : { description: source.description })
    },
    items: source.items.map((item) => ({
      itemId: item.id,
      archivePath: item.path,
      kind: item.kind,
      ...(item.contentHash === undefined ? {} : { contentHash: item.contentHash }),
      ...(item.name === undefined ? {} : { name: item.name }),
      ...(item.description === undefined ? {} : { description: item.description })
    })),
    fileRecords: source.files.map((file) => ({
      archivePath: file.path,
      role: file.role,
      size: file.size,
      ...(file.sha256 === undefined ? {} : { contentDigest: file.sha256 })
    })),
    provenance: {
      source: source.provenance.source,
      revision: source.provenance.revision,
      license: source.provenance.license
    }
  };
}

/**
 * Index a governed bundle's file records by archive path.
 * @param bundle - Governed projection.
 * @returns Map from archive-relative path to its file record.
 */
export function indexFileRecords(
  bundle: GovernedBundle
): ReadonlyMap<string, ArchiveFileRecord> {
  return new Map(bundle.fileRecords.map((record) => [record.archivePath, record]));
}

/**
 * BR1.5 — an item is a write candidate only when its matching archive file
 * record carries the `installable` role.
 *
 * An item with no matching record is never a write candidate: the validator
 * rejects that archive, and this predicate must not resolve a destination for
 * one if it ever reaches here.
 * @param item - Manifest item to test.
 * @param records - File records indexed by archive path (see {@link indexFileRecords}).
 * @returns True only when the item's matching record has the installable role.
 */
export function isInstallableItem(
  item: ManifestItem,
  records: ReadonlyMap<string, ArchiveFileRecord>
): boolean {
  return records.get(item.archivePath)?.role === 'installable';
}

/**
 * The governed items that may produce a destination (BR1.5).
 * @param bundle - Governed projection.
 * @returns Items whose matching file record has the installable role, in manifest order.
 */
export function installableItems(bundle: GovernedBundle): readonly ManifestItem[] {
  const records = indexFileRecords(bundle);
  return bundle.items.filter((item) => isInstallableItem(item, records));
}
