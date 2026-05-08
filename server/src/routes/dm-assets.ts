import fs from 'node:fs/promises';
import path from 'node:path';
import { Router, type ErrorRequestHandler } from 'express';
import multer, { MulterError } from 'multer';
import type Database from 'better-sqlite3';
import { requireDm } from '../auth/dm-guard.js';
import { PipelineError, processImage } from '../assets/pipeline.js';
import {
  MAX_UPLOADS_BYTES,
  assetPath,
  atomicWrite,
  ensureUploadsDir,
  getUploadsDir,
  thumbPath,
  totalUploadsBytes,
} from '../assets/storage.js';
import {
  findAssetByHash,
  findAssetById,
  findReferences,
  insertAsset,
  listAssets,
  type AssetKind,
} from '../db/assets.js';
import type { AppSocketIOServer } from '../socket.js';

export interface DmAssetsDeps {
  db: Database.Database;
  io: AppSocketIOServer;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const multerErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (err instanceof MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: 'file too large (max 5 MB)' });
      return;
    }
    res.status(400).json({ error: err.message });
    return;
  }
  next(err);
};

export function dmAssetsRouter(deps: DmAssetsDeps): Router {
  const router = Router();
  router.use(requireDm);

  router.get('/', (req, res) => {
    const raw = req.query.kind;
    const kind: AssetKind = raw === 'token' ? 'token' : 'map';
    res.json({ assets: listAssets(deps.db, kind) });
  });

  router.post(
    '/upload',
    upload.single('file'),
    async (req, res, next) => {
      try {
        if (!req.file) {
          res.status(400).json({ error: 'file field required' });
          return;
        }
        const kind: AssetKind = req.body.kind === 'token' ? 'token' : 'map';

        if (totalUploadsBytes() > MAX_UPLOADS_BYTES) {
          res.status(507).json({ error: 'disk quota exceeded' });
          return;
        }

        let result;
        try {
          result = await processImage(req.file.buffer, kind);
        } catch (err) {
          if (err instanceof PipelineError) {
            res.status(400).json({ error: err.message, code: err.code });
            return;
          }
          throw err;
        }

        const existing = findAssetByHash(deps.db, result.hash);
        if (existing) {
          res.status(200).json({ asset: existing });
          return;
        }

        ensureUploadsDir();
        await atomicWrite(assetPath(result.hash), result.processed);
        await atomicWrite(thumbPath(result.hash), result.thumb);

        const asset = insertAsset(deps.db, {
          hash: result.hash,
          kind,
          originalName: req.file.originalname,
          mime: result.mime,
          width: result.width,
          height: result.height,
          sizeBytes: result.processed.length,
        });

        deps.io.to('dm').emit('asset:created', { asset });

        res.status(201).json({ asset });
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete('/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
    const asset = findAssetById(deps.db, id);
    if (!asset) return res.status(404).json({ error: 'not found' });

    const tx = deps.db.transaction(() => {
      const refs = findReferences(deps.db, id);
      if (refs.pages.length || refs.tokens.length) return { ok: false as const, refs };
      deps.db.prepare('DELETE FROM assets WHERE id = ?').run(id);
      return { ok: true as const };
    });
    let result;
    try {
      result = (tx as unknown as { immediate: () => { ok: boolean; refs?: ReturnType<typeof findReferences> } }).immediate();
    } catch (e) {
      const refs = findReferences(deps.db, id);
      return res.status(409).json({ references: refs });
    }
    if (!result.ok) return res.status(409).json({ references: result.refs });

    const dir = getUploadsDir();
    for (const suffix of ['.webp', '.thumb.webp']) {
      try {
        await fs.unlink(path.join(dir, `${asset.hash}${suffix}`));
      } catch (e: unknown) {
        const code = (e as NodeJS.ErrnoException)?.code;
        if (code !== 'ENOENT') throw e;
      }
    }
    deps.io.to('dm').emit('asset:deleted', { id, kind: asset.kind });
    return res.status(204).end();
  });

  router.use(multerErrorHandler);

  return router;
}
