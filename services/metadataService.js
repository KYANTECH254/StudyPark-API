function normalizeMetadataName(value) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = String(value).trim().replace(/\s+/g, ' ');
  return normalized === '' ? undefined : normalized;
}

async function getOrCreateMetadataRecord(client, modelName, value) {
  const name = normalizeMetadataName(value);
  if (!name) {
    return null;
  }

  return client[modelName].upsert({
    where: { name },
    update: {},
    create: { name }
  });
}

async function buildUserUniversityData(client, university) {
  const normalizedUniversity = normalizeMetadataName(university);
  if (!normalizedUniversity) {
    return {};
  }

  const universityRecord = await getOrCreateMetadataRecord(client, 'university', normalizedUniversity);

  return {
    university: normalizedUniversity,
    universityId: universityRecord.id
  };
}

async function buildDocumentMetadataData(client, values = {}) {
  const data = {};

  const normalizedType = normalizeMetadataName(values.type);
  if (normalizedType) {
    const typeRecord = await getOrCreateMetadataRecord(client, 'documentType', normalizedType);
    data.type = normalizedType;
    data.documentTypeId = typeRecord.id;
  }

  const normalizedCategory = normalizeMetadataName(values.category);
  if (normalizedCategory) {
    const categoryRecord = await getOrCreateMetadataRecord(client, 'category', normalizedCategory);
    data.category = normalizedCategory;
    data.categoryId = categoryRecord.id;
  }

  const normalizedUniversity = normalizeMetadataName(values.university);
  if (normalizedUniversity) {
    const universityRecord = await getOrCreateMetadataRecord(client, 'university', normalizedUniversity);
    data.university = normalizedUniversity;
    data.universityId = universityRecord.id;
  }

  return data;
}

module.exports = {
  buildDocumentMetadataData,
  buildUserUniversityData,
  normalizeMetadataName
};
