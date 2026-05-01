const prisma = require('../db');
const { normalizeMetadataName } = require('../services/metadataService');

const VALID_METADATA_KINDS = new Set(['university', 'category', 'documentType']);

function resolveMetadataKind(kind) {
  if (!kind || typeof kind !== 'string') {
    return null;
  }

  const normalizedKind = String(kind).trim();
  return VALID_METADATA_KINDS.has(normalizedKind) ? normalizedKind : null;
}

class MetadataController {
  async getAll(req, res) {
    try {
      const kind = resolveMetadataKind(req.query.kind);
      if (!kind) {
        return res.status(400).json({ success: false, message: 'Invalid metadata kind' });
      }

      const items = await prisma[kind].findMany({ orderBy: { name: 'asc' } });
      res.json({ success: true, items });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Unable to load metadata' });
    }
  }

  async create(req, res) {
    try {
      const kind = resolveMetadataKind(req.body.kind);
      const name = normalizeMetadataName(req.body.name);

      if (!kind || !name) {
        return res.status(400).json({ success: false, message: 'Kind and name are required' });
      }

      const item = await prisma[kind].upsert({
        where: { name },
        update: {},
        create: { name },
      });

      res.status(201).json({ success: true, item });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Unable to create metadata item' });
    }
  }

  async remove(req, res) {
    try {
      const kind = resolveMetadataKind(req.params.kind);
      const id = req.params.id;

      if (!kind || !id) {
        return res.status(400).json({ success: false, message: 'Invalid metadata kind or ID' });
      }

      await prisma[kind].delete({ where: { id } });
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Unable to delete metadata item' });
    }
  }
}

module.exports = new MetadataController();
