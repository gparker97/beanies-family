import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The native delivery branch.
 *
 * The property that matters most here is the one a post-share `deleteFile`
 * would have broken: the hand-off file must still exist when the share
 * resolves, because on Android `Share.share` returns when the CHOOSER returns —
 * routinely before the receiving app has read the stream through the
 * FileProvider grant. Cleanup therefore happens at the top of the NEXT
 * delivery, and these tests pin that.
 */

const share = vi.fn();
const writeFile = vi.fn();
const getUri = vi.fn();
const deleteFile = vi.fn();
const readdir = vi.fn();

vi.mock('@capacitor/share', () => ({ Share: { share: (...a: unknown[]) => share(...a) } }));
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: {
    writeFile: (...a: unknown[]) => writeFile(...a),
    getUri: (...a: unknown[]) => getUri(...a),
    deleteFile: (...a: unknown[]) => deleteFile(...a),
    readdir: (...a: unknown[]) => readdir(...a),
  },
  Directory: { Cache: 'CACHE', Data: 'DATA' },
}));
vi.mock('@/services/sync/capabilities', () => ({
  isNative: () => true,
  getPlatform: () => 'android',
}));

async function load() {
  vi.resetModules();
  return import('@/utils/shareOrDownloadFile');
}

const blob = () => new Blob(['hello'], { type: 'application/pdf' });

describe('native delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeFile.mockResolvedValue({ uri: 'file:///cache/shared/kit.pdf' });
    share.mockResolvedValue(undefined);
    deleteFile.mockResolvedValue(undefined);
    readdir.mockResolvedValue({ files: [] });
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000_000);
  });

  it('writes bare base64 into Directory.Cache/shared and shares the returned uri', async () => {
    const { shareOrDownloadFile } = await load();
    const r = await shareOrDownloadFile(blob(), 'kit.pdf', 'application/pdf', 'Kit');

    expect(r).toMatchObject({ outcome: 'shared', delivered: true, mechanism: 'native-share' });

    const args = writeFile.mock.calls[0][0];
    expect(args.path).toBe('shared/kit.pdf');
    expect(args.directory).toBe('CACHE');
    expect(args.recursive).toBe(true);
    // Bare base64 — a `data:` prefix is only tolerated by the WEB implementation.
    expect(args.data).not.toMatch(/^data:/);
    expect(args.data).toBe(btoa('hello'));
    // `encoding` must be OMITTED: that is what tells the plugin it is binary.
    expect(args.encoding).toBeUndefined();

    // writeFile already returns the share uri — a getUri call is a wasted hop.
    expect(getUri).not.toHaveBeenCalled();
    // `dialogTitle` too: without it the Android chooser header is untranslated
    // English in every locale.
    expect(share).toHaveBeenCalledWith({
      title: 'Kit',
      dialogTitle: 'Kit',
      files: ['file:///cache/shared/kit.pdf'],
    });
  });

  it('does NOT delete the hand-off file in the same delivery as its share', async () => {
    const { shareOrDownloadFile } = await load();
    await shareOrDownloadFile(blob(), 'kit.pdf', 'application/pdf', 'Kit');
    // The race guard: deleting here can truncate the receiving app's read.
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it('sweeps the PREVIOUS delivery at the top of the next one', async () => {
    readdir.mockResolvedValue({ files: [{ name: 'old.pdf', mtime: 1_000_000_000 - 3_600_000 }] });
    const { shareOrDownloadFile } = await load();
    await shareOrDownloadFile(blob(), 'kit.pdf', 'application/pdf', 'Kit');

    expect(deleteFile).toHaveBeenCalledWith({ path: 'shared/old.pdf', directory: 'CACHE' });
    // And it swept BEFORE writing the new file.
    expect(deleteFile.mock.invocationCallOrder[0]).toBeLessThan(
      writeFile.mock.invocationCallOrder[0]
    );
  });

  it('sweeps up after a delivery that failed part-way', async () => {
    writeFile.mockRejectedValueOnce(new Error('disk full'));
    const { shareOrDownloadFile } = await load();
    const failed = await shareOrDownloadFile(blob(), 'kit.pdf', 'application/pdf', 'Kit');
    expect(failed).toMatchObject({ outcome: 'failed', stage: 'write' });

    readdir.mockResolvedValue({ files: [{ name: 'kit.pdf', mtime: 1_000_000_000 - 3_600_000 }] });
    writeFile.mockResolvedValue({ uri: 'file:///cache/shared/kit.pdf' });
    await shareOrDownloadFile(blob(), 'kit.pdf', 'application/pdf', 'Kit');
    expect(deleteFile).toHaveBeenCalledWith({ path: 'shared/kit.pdf', directory: 'CACHE' });
  });

  it('a sweep failure never turns a good delivery into a bad one', async () => {
    readdir.mockRejectedValue(new Error('readdir exploded'));
    const { shareOrDownloadFile } = await load();
    const r = await shareOrDownloadFile(blob(), 'kit.pdf', 'application/pdf', 'Kit');
    expect(r.outcome).toBe('shared');
    expect(r.delivered).toBe(true);
  });

  it('treats a dismissed sheet as cancelled, not failed', async () => {
    share.mockRejectedValue(new Error('Share canceled'));
    const { shareOrDownloadFile } = await load();
    const r = await shareOrDownloadFile(blob(), 'kit.pdf', 'application/pdf', 'Kit');
    expect(r).toMatchObject({ outcome: 'cancelled', delivered: false });
  });

  it('does NOT treat a cancel-shaped message at another stage as a cancel', async () => {
    // Message-matching is fragile, so it is only consulted at the share stage.
    writeFile.mockRejectedValue(new Error('write cancelled by the OS'));
    const { shareOrDownloadFile } = await load();
    const r = await shareOrDownloadFile(blob(), 'kit.pdf', 'application/pdf', 'Kit');
    expect(r).toMatchObject({ outcome: 'failed', stage: 'write' });
  });

  it.each([
    ['write', () => writeFile.mockRejectedValue(new Error('disk full'))],
    ['share', () => share.mockRejectedValue(new Error('no target'))],
  ])('attributes a %s failure to its stage', async (stage, arrange) => {
    arrange();
    const { shareOrDownloadFile } = await load();
    const r = await shareOrDownloadFile(blob(), 'kit.pdf', 'application/pdf', 'Kit');
    expect(r).toMatchObject({ outcome: 'failed', stage });
  });

  it('attributes a FileReader failure to the encode stage', async () => {
    const { shareOrDownloadFile } = await load();
    // A blob whose read rejects — the real `encode` failure mode (an OOM on a
    // large file surfaces the same way).
    const bad = { size: 1, type: 'application/pdf' } as unknown as Blob;
    const r = await shareOrDownloadFile(bad, 'kit.pdf', 'application/pdf', 'Kit');
    expect(r).toMatchObject({ outcome: 'failed', stage: 'encode' });
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('still uses the native path when preferDownload is set', async () => {
    // preferDownload means "save, don't share" on the WEB. On native the anchor
    // is inert, so honouring it there would deliver nothing — which is exactly
    // why the recovery kit was the worst-affected path.
    const { shareOrDownloadFile } = await load();
    const r = await shareOrDownloadFile(blob(), 'kit.pdf', 'application/pdf', 'Kit', {
      preferDownload: true,
    });
    expect(r.mechanism).toBe('native-share');
    expect(share).toHaveBeenCalled();
  });

  it('sanitises a traversal filename but keeps its extension', async () => {
    const { shareOrDownloadFile } = await load();
    await shareOrDownloadFile(blob(), '../../evil.pdf', 'application/pdf', 'Kit');
    const path = writeFile.mock.calls[0][0].path as string;
    expect(path.startsWith('shared/')).toBe(true);
    expect(path).not.toContain('..');
    // Exactly ONE separator — the SHARE_DIR one. Any more would mean the
    // traversal survived into a nested write.
    expect(path.split('/')).toHaveLength(2);
    expect(path.endsWith('.pdf')).toBe(true);
  });

  it('produces no trailing dot for a filename with no extension', async () => {
    const { shareOrDownloadFile } = await load();
    await shareOrDownloadFile(blob(), 'noextension', 'application/octet-stream', 'X');
    expect(writeFile.mock.calls[0][0].path).not.toMatch(/\.$/);
  });

  it('reports prepareMs, measured BEFORE the sheet is dismissed', async () => {
    // A slow share must not inflate the perf sample: it would otherwise measure
    // how long the user stared at the sheet.
    //
    // Asserted against the ELAPSED wall clock rather than a fixed millisecond
    // budget: a bare `toBeLessThan(50)` next to a real 500ms timer is really a
    // bet on how loaded the machine is, and would go red under parallel test
    // load while the code was perfectly correct.
    share.mockImplementation(() => new Promise((r) => setTimeout(r, 500)));
    const { shareOrDownloadFile } = await load();
    const started = performance.now();
    const r = await shareOrDownloadFile(blob(), 'kit.pdf', 'application/pdf', 'Kit');
    const elapsed = performance.now() - started;

    expect(r.prepareMs).toBeDefined();
    expect(elapsed).toBeGreaterThanOrEqual(400); // the share really did block
    // ...and the sample excludes essentially all of it.
    expect(r.prepareMs!).toBeLessThan(elapsed / 2);
  });

  it('omits prepareMs on a cancel', async () => {
    share.mockRejectedValue(new Error('Share canceled'));
    const { shareOrDownloadFile } = await load();
    const r = await shareOrDownloadFile(blob(), 'kit.pdf', 'application/pdf', 'Kit');
    expect(r.prepareMs).toBeUndefined();
  });

  it('downloadFile refuses on native instead of claiming success', async () => {
    const { downloadFile } = await load();
    const r = downloadFile(blob(), 'kit.pdf');
    expect(r).toMatchObject({ outcome: 'failed', delivered: false, stage: 'anchor' });
  });

  it('does NOT delete a file young enough to still be streaming', async () => {
    // The whole safety argument. `Share.share` resolves when the CHOOSER
    // returns, routinely before the receiving app has finished reading through
    // its FileProvider grant — so "the previous share is over" is not true, and
    // an unconditional sweep at the top of the next delivery truncates a
    // multi-megabyte upload that is still in flight.
    readdir.mockResolvedValue({
      files: [{ name: 'inflight.beanpod', mtime: 1_000_000_000 - 5_000 }],
    });
    const { shareOrDownloadFile } = await load();
    await shareOrDownloadFile(blob(), 'kit.pdf', 'application/pdf', 'Kit');
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it('deletes a file with no mtime rather than keeping it forever', async () => {
    // `mtime` is absent on Android 7 and older. Undeletable beats untidy is the
    // wrong trade here: these files are plaintext family data.
    readdir.mockResolvedValue({ files: [{ name: 'ancient.pdf' }] });
    const { shareOrDownloadFile } = await load();
    await shareOrDownloadFile(blob(), 'kit.pdf', 'application/pdf', 'Kit');
    expect(deleteFile).toHaveBeenCalledWith({ path: 'shared/ancient.pdf', directory: 'CACHE' });
  });

  it('sweepHandoffFiles deletes everything regardless of age', async () => {
    // Teardown: nothing can still be reading, and the two files this deletes
    // are the family in plaintext and a live credential.
    readdir.mockResolvedValue({ files: [{ name: 'fresh.json', mtime: 1_000_000_000 }] });
    const { sweepHandoffFiles } = await load();
    await sweepHandoffFiles();
    expect(deleteFile).toHaveBeenCalledWith({ path: 'shared/fresh.json', directory: 'CACHE' });
  });

  it('refuses to deliver an empty blob instead of shipping a 0-byte file', async () => {
    // `blobToDataUrl` yields "data:<type>;base64," for zero bytes, so the empty
    // string writes and shares perfectly happily — and at the delete-family
    // gate that empty file is the backup that authorises the deletion.
    const { shareOrDownloadFile } = await load();
    const r = await shareOrDownloadFile(
      new Blob([], { type: 'application/pdf' }),
      'e.pdf',
      'application/pdf',
      'E'
    );
    expect(r).toMatchObject({ outcome: 'failed', delivered: false, stage: 'encode' });
    expect(writeFile).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
  });

  it('serialises concurrent deliveries rather than letting them collide', async () => {
    // Two overlapping deliveries break twice over: the second's sweep can
    // delete the first's just-written file, and the plugin rejects the second
    // with "Can't share while sharing is in progress" — not a cancel, so a
    // share the user completed would be reported as a failure. A double-tap is
    // enough. Queuing keeps both.
    const order: string[] = [];
    share.mockImplementation(async () => {
      order.push('share-start');
      await new Promise((r) => setTimeout(r, 20));
      order.push('share-end');
    });
    writeFile.mockImplementation(async () => {
      order.push('write');
      return { uri: 'file:///cache/shared/kit.pdf' };
    });
    const { shareOrDownloadFile } = await load();
    const both = Promise.all([
      shareOrDownloadFile(blob(), 'a.pdf', 'application/pdf', 'A'),
      shareOrDownloadFile(blob(), 'b.pdf', 'application/pdf', 'B'),
    ]);
    const results = await both;

    expect(results.every((r) => r.outcome === 'shared')).toBe(true);
    // The second delivery does not even begin writing until the first share ends.
    expect(order).toEqual([
      'write',
      'share-start',
      'share-end',
      'write',
      'share-start',
      'share-end',
    ]);
  });

  it('attributes a write failure that followed a broken sweep to the sweep', async () => {
    // A failed readdir and a failed write nearly always share one cause, and it
    // is the only way the `sweep` stage is ever reported.
    readdir.mockRejectedValue(new Error('cache gone'));
    writeFile.mockRejectedValue(new Error('cache gone'));
    const { shareOrDownloadFile } = await load();
    const r = await shareOrDownloadFile(blob(), 'kit.pdf', 'application/pdf', 'Kit');
    expect(r).toMatchObject({ outcome: 'failed', stage: 'sweep' });
  });
});
