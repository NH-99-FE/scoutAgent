import * as vscode from 'vscode';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SCOUT_COMPOSER_IMAGE_MAX_BYTES,
  SCOUT_COMPOSER_IMAGE_MAX_COUNT,
  type ScoutComposerContentPickResult,
} from '@scout-agent/shared';
import type { DiscoverFileMentions } from '../../../../src/host/protocol/services/file-mention-discovery.ts';
import { MentionProtocolService } from '../../../../src/host/protocol/services/mention-service.ts';

function makeService(
  options: {
    discoverFileMentions?: DiscoverFileMentions;
    fdPath?: Promise<string | undefined>;
    getCurrentCwd?: () => string;
    logError?: (message: string) => void;
    openTextFile?: (filePath: string) => Promise<void>;
  } = {},
) {
  return new MentionProtocolService({
    discoverFileMentions: options.discoverFileMentions ?? vi.fn().mockResolvedValue([]),
    fdPath: options.fdPath ?? Promise.resolve('fd'),
    getCurrentCwd: options.getCurrentCwd ?? (() => '/workspace'),
    logError: options.logError ?? vi.fn(),
    openTextFile: options.openTextFile,
  });
}

describe('MentionProtocolService', () => {
  beforeEach(() => {
    vi.mocked(vscode.window.showOpenDialog).mockReset();
    vi.mocked(vscode.workspace.fs.stat).mockReset();
    vi.mocked(vscode.workspace.fs.readFile).mockReset();
    vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(new Uint8Array());
  });

  it('opens a file picker and returns a current-cwd-relative file mention', async () => {
    const uri = vscode.Uri.file('/workspace/src/agent.ts');
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([uri]);
    vi.mocked(vscode.workspace.fs.stat).mockResolvedValue({
      type: vscode.FileType.File,
      ctime: 0,
      mtime: 0,
      size: 1,
    });
    const respond = vi.fn();

    await makeService().pickComposerContent(
      { type: 'pick_composer_content', selectionKind: 'file' },
      respond,
    );

    expect(vscode.window.showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: true,
        defaultUri: expect.objectContaining({ fsPath: '/workspace' }),
        openLabel: '添加',
      }),
    );
    expect(respond).toHaveBeenCalledWith({
      type: 'composer_content_pick_result',
      selections: [
        {
          type: 'reference',
          item: {
            id: 'src/agent.ts',
            kind: 'file',
            path: 'src/agent.ts',
            label: 'agent.ts',
            description: 'src',
          },
        },
      ],
    });
  });

  it('keeps an absolute path when a selected workspace file is outside the current cwd', async () => {
    const uri = vscode.Uri.file('/workspace-b/src/agent.ts');
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([uri]);
    vi.mocked(vscode.workspace.fs.stat).mockResolvedValue({
      type: vscode.FileType.File,
      ctime: 0,
      mtime: 0,
      size: 1,
    });
    const respond = vi.fn();

    await makeService().pickComposerContent(
      { type: 'pick_composer_content', selectionKind: 'file' },
      respond,
    );

    expect(respond).toHaveBeenCalledWith({
      type: 'composer_content_pick_result',
      selections: [
        {
          type: 'reference',
          item: {
            id: '/workspace-b/src/agent.ts',
            kind: 'file',
            path: '/workspace-b/src/agent.ts',
            label: 'agent.ts',
            description: '/workspace-b/src',
          },
        },
      ],
    });
  });

  it('returns an empty result when the picker is cancelled', async () => {
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue(undefined);
    const respond = vi.fn();

    await makeService().pickComposerContent(
      { type: 'pick_composer_content', selectionKind: 'file' },
      respond,
    );

    expect(respond).toHaveBeenCalledWith({ type: 'composer_content_pick_result', selections: [] });
    expect(vscode.workspace.fs.stat).not.toHaveBeenCalled();
  });

  it('resolves and opens a mentioned file against the current session cwd', async () => {
    const openTextFile = vi.fn(async (_filePath: string) => undefined);
    vi.mocked(vscode.workspace.fs.stat).mockResolvedValue({
      type: vscode.FileType.File,
      ctime: 0,
      mtime: 0,
      size: 1,
    });
    const respond = vi.fn();
    const cwd = process.cwd();

    await makeService({ getCurrentCwd: () => cwd, openTextFile }).openMentionedFile(
      { type: 'open_mentioned_file', path: 'src/agent.ts' },
      respond,
    );

    expect(openTextFile).toHaveBeenCalledWith(expect.stringMatching(/[\\/]src[\\/]agent\.ts$/u));
    expect(respond).toHaveBeenCalledWith({
      type: 'open_mentioned_file_result',
      success: true,
      path: openTextFile.mock.calls[0]?.[0],
    });
  });

  it('rejects a mentioned directory instead of sending it to the text editor', async () => {
    const openTextFile = vi.fn(async (_filePath: string) => undefined);
    vi.mocked(vscode.workspace.fs.stat).mockResolvedValue({
      type: vscode.FileType.Directory,
      ctime: 0,
      mtime: 0,
      size: 0,
    });
    const respond = vi.fn();

    await makeService({ openTextFile }).openMentionedFile(
      { type: 'open_mentioned_file', path: 'packages/webview' },
      respond,
    );

    expect(openTextFile).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'open_mentioned_file_result',
        success: false,
        error: expect.stringContaining('Mention path is not a file'),
      }),
    );
  });

  it('returns multiple supported images as composer image content', async () => {
    const firstUri = vscode.Uri.file('/workspace/screenshots/first.png');
    const secondUri = vscode.Uri.file('/workspace/screenshots/second.png');
    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52,
    ]);
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([firstUri, secondUri]);
    vi.mocked(vscode.workspace.fs.stat).mockResolvedValue({
      type: vscode.FileType.File,
      ctime: 0,
      mtime: 0,
      size: bytes.byteLength,
    });
    vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(bytes);
    const respond = vi.fn();

    await makeService().pickComposerContent(
      { type: 'pick_composer_content', selectionKind: 'file' },
      respond,
    );

    expect(respond).toHaveBeenCalledWith({
      type: 'composer_content_pick_result',
      selections: [
        {
          type: 'image',
          fileName: 'first.png',
          image: {
            type: 'image',
            data: Buffer.from(bytes).toString('base64'),
            mimeType: 'image/png',
          },
        },
        {
          type: 'image',
          fileName: 'second.png',
          image: {
            type: 'image',
            data: Buffer.from(bytes).toString('base64'),
            mimeType: 'image/png',
          },
        },
      ],
    });
  });

  it('does not read image bytes after the picker image limit is reached', async () => {
    const imageUris = Array.from({ length: SCOUT_COMPOSER_IMAGE_MAX_COUNT + 2 }, (_, index) =>
      vscode.Uri.file(`/workspace/screenshots/image-${index + 1}.png`),
    );
    const fileUri = vscode.Uri.file('/workspace/src/agent.ts');
    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52,
    ]);
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([...imageUris, fileUri]);
    vi.mocked(vscode.workspace.fs.stat).mockResolvedValue({
      type: vscode.FileType.File,
      ctime: 0,
      mtime: 0,
      size: bytes.byteLength,
    });
    vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(bytes);
    const respond = vi.fn();

    await makeService().pickComposerContent(
      { type: 'pick_composer_content', selectionKind: 'file' },
      respond,
    );

    const result = respond.mock.calls[0]?.[0] as ScoutComposerContentPickResult | undefined;
    expect(result?.selections.filter((selection) => selection.type === 'image')).toHaveLength(
      SCOUT_COMPOSER_IMAGE_MAX_COUNT,
    );
    expect(result?.selections.at(-1)).toEqual({
      type: 'reference',
      item: {
        id: 'src/agent.ts',
        kind: 'file',
        path: 'src/agent.ts',
        label: 'agent.ts',
        description: 'src',
      },
    });
    expect(result?.warnings).toEqual([`最多只能添加 ${SCOUT_COMPOSER_IMAGE_MAX_COUNT} 张图片`]);
    expect(vscode.workspace.fs.readFile).toHaveBeenCalledTimes(SCOUT_COMPOSER_IMAGE_MAX_COUNT);
  });

  it('rejects oversized image files without reading them into the protocol', async () => {
    const uri = vscode.Uri.file('/workspace/result.png');
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([uri]);
    vi.mocked(vscode.workspace.fs.stat).mockResolvedValue({
      type: vscode.FileType.File,
      ctime: 0,
      mtime: 0,
      size: 2 * 1024 * 1024 + 1,
    });
    const respond = vi.fn();

    await makeService().pickComposerContent(
      { type: 'pick_composer_content', selectionKind: 'file' },
      respond,
    );

    expect(respond).toHaveBeenCalledWith({
      type: 'composer_content_pick_result',
      selections: [],
      warnings: ['result.png 超过 2MB，已忽略'],
    });
    expect(vscode.workspace.fs.readFile).not.toHaveBeenCalled();
  });

  it('rejects an image that grows beyond the limit while it is being read', async () => {
    const uri = vscode.Uri.file('/workspace/result.png');
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([uri]);
    vi.mocked(vscode.workspace.fs.stat).mockResolvedValue({
      type: vscode.FileType.File,
      ctime: 0,
      mtime: 0,
      size: 1,
    });
    vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
      new Uint8Array(SCOUT_COMPOSER_IMAGE_MAX_BYTES + 1),
    );
    const respond = vi.fn();

    await makeService().pickComposerContent(
      { type: 'pick_composer_content', selectionKind: 'file' },
      respond,
    );

    expect(respond).toHaveBeenCalledWith({
      type: 'composer_content_pick_result',
      selections: [],
      warnings: ['result.png 超过 2MB，已忽略'],
    });
  });

  it('keeps valid references when another selected image is rejected', async () => {
    const oversizedImageUri = vscode.Uri.file('/workspace/result.png');
    const fileUri = vscode.Uri.file('/workspace/src/agent.ts');
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([oversizedImageUri, fileUri]);
    vi.mocked(vscode.workspace.fs.stat).mockImplementation(async (uri) => ({
      type: vscode.FileType.File,
      ctime: 0,
      mtime: 0,
      size: uri.fsPath.endsWith('.png') ? 2 * 1024 * 1024 + 1 : 1,
    }));
    const respond = vi.fn();

    await makeService().pickComposerContent(
      { type: 'pick_composer_content', selectionKind: 'file' },
      respond,
    );

    expect(respond).toHaveBeenCalledWith({
      type: 'composer_content_pick_result',
      selections: [
        {
          type: 'reference',
          item: {
            id: 'src/agent.ts',
            kind: 'file',
            path: 'src/agent.ts',
            label: 'agent.ts',
            description: 'src',
          },
        },
      ],
      warnings: ['result.png 超过 2MB，已忽略'],
    });
  });

  it('opens a folder-only picker and returns a directory reference', async () => {
    const uri = vscode.Uri.file('/workspace/packages/webview');
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([uri]);
    vi.mocked(vscode.workspace.fs.stat).mockResolvedValue({
      type: vscode.FileType.Directory,
      ctime: 0,
      mtime: 0,
      size: 0,
    });
    const respond = vi.fn();

    await makeService().pickComposerContent(
      { type: 'pick_composer_content', selectionKind: 'directory' },
      respond,
    );

    expect(vscode.window.showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        title: '添加文件夹',
      }),
    );
    expect(vscode.workspace.fs.readFile).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith({
      type: 'composer_content_pick_result',
      selections: [
        {
          type: 'reference',
          item: {
            id: 'packages/webview',
            kind: 'directory',
            path: 'packages/webview',
            label: 'webview',
            description: 'packages',
          },
        },
      ],
    });
  });

  it('delegates file mention discovery and projects its result', async () => {
    const controller = new AbortController();
    const items = [
      {
        id: 'packages/agent',
        kind: 'directory' as const,
        path: 'packages/agent',
        label: 'agent',
        description: 'packages',
      },
    ];
    const discoverFileMentions = vi.fn<DiscoverFileMentions>().mockResolvedValue(items);
    const respond = vi.fn();

    await makeService({ discoverFileMentions }).requestFileMentions(
      { type: 'request_file_mentions', query: 'agent', limit: 10 },
      respond,
      controller.signal,
    );

    expect(discoverFileMentions).toHaveBeenCalledWith({
      cwd: '/workspace',
      fdPath: 'fd',
      limit: 10,
      query: 'agent',
      signal: controller.signal,
    });
    expect(respond).toHaveBeenCalledWith({
      type: 'file_mentions_result',
      query: 'agent',
      items,
    });
  });

  it('returns an explicit unavailable result when fd preparation failed', async () => {
    const discoverFileMentions = vi.fn<DiscoverFileMentions>();
    const respond = vi.fn();

    await makeService({
      discoverFileMentions,
      fdPath: Promise.resolve(undefined),
    }).requestFileMentions(
      { type: 'request_file_mentions', query: 'agent', limit: 10 },
      respond,
      new AbortController().signal,
    );

    expect(discoverFileMentions).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith({
      type: 'file_mentions_result',
      query: 'agent',
      items: [],
      error: '文件搜索不可用：fd 未安装且自动下载失败',
    });
  });

  it('returns a search error when fd execution fails', async () => {
    const logError = vi.fn();
    const discoverFileMentions = vi
      .fn<DiscoverFileMentions>()
      .mockRejectedValue(new Error('fd exited with code 1'));
    const respond = vi.fn();

    await makeService({ discoverFileMentions, logError }).requestFileMentions(
      { type: 'request_file_mentions', query: 'agent', limit: 10 },
      respond,
      new AbortController().signal,
    );

    expect(respond).toHaveBeenCalledWith({
      type: 'file_mentions_result',
      query: 'agent',
      items: [],
      error: '文件搜索失败，请重试',
    });
    expect(logError).toHaveBeenCalledWith('[scout] File mentions failed: fd exited with code 1');
  });

  it('uses the current session cwd for every discovery request', async () => {
    let cwd = '/workspace-a';
    const discoverFileMentions = vi.fn<DiscoverFileMentions>().mockResolvedValue([]);
    const service = makeService({
      discoverFileMentions,
      getCurrentCwd: () => cwd,
    });

    await service.requestFileMentions(
      { type: 'request_file_mentions', query: 'agent', limit: 10 },
      vi.fn(),
      new AbortController().signal,
    );
    cwd = '/workspace-b';
    await service.requestFileMentions(
      { type: 'request_file_mentions', query: 'agent', limit: 10 },
      vi.fn(),
      new AbortController().signal,
    );

    expect(discoverFileMentions.mock.calls.map(([options]) => options.cwd)).toEqual([
      '/workspace-a',
      '/workspace-b',
    ]);
  });

  it('does not respond when discovery is cancelled', async () => {
    const controller = new AbortController();
    const logError = vi.fn();
    const discoverFileMentions = vi.fn<DiscoverFileMentions>().mockImplementation(async () => {
      controller.abort();
      return [];
    });
    const respond = vi.fn();

    await makeService({ discoverFileMentions, logError }).requestFileMentions(
      { type: 'request_file_mentions', query: 'agent', limit: 10 },
      respond,
      controller.signal,
    );

    expect(discoverFileMentions).toHaveBeenCalledOnce();
    expect(respond).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });
});
