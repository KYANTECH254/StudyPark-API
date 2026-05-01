const prisma = require('../db');

async function dedupeModel(model, dateField, userCounterField) {
  const duplicates = await prisma[model].groupBy({
    by: ['userId', 'documentId'],
    _count: {
      _all: true
    },
    _max: {
      [dateField]: true
    },
    having: {
      documentId: {
        _count: {
          gt: 1
        }
      }
    }
  });

  let removedRows = 0;

  for (const duplicate of duplicates) {
    const records = await prisma[model].findMany({
      where: {
        userId: duplicate.userId,
        documentId: duplicate.documentId
      },
      orderBy: [
        { [dateField]: 'desc' },
        { id: 'desc' }
      ],
      select: {
        id: true,
        [dateField]: true
      }
    });

    const [recordToKeep, ...recordsToDelete] = records;

    if (!recordToKeep || recordsToDelete.length === 0) {
      continue;
    }

    await prisma.$transaction([
      prisma[model].update({
        where: { id: recordToKeep.id },
        data: { [dateField]: duplicate._max[dateField] ?? recordToKeep[dateField] }
      }),
      prisma[model].deleteMany({
        where: {
          id: {
            in: recordsToDelete.map(record => record.id)
          }
        }
      })
    ]);

    removedRows += recordsToDelete.length;
  }

  const userCounts = await prisma[model].groupBy({
    by: ['userId']
  });

  for (const userCount of userCounts) {
    const distinctDocuments = await prisma[model].groupBy({
      by: ['documentId'],
      where: { userId: userCount.userId }
    });

    await prisma.user.update({
      where: { id: userCount.userId },
      data: {
        [userCounterField]: distinctDocuments.length
      }
    });
  }

  const documentCounts = await prisma[model].groupBy({
    by: ['documentId']
  });

  for (const documentCount of documentCounts) {
    const distinctUsers = await prisma[model].groupBy({
      by: ['userId'],
      where: { documentId: documentCount.documentId }
    });

    const documentField = model === 'download' ? 'downloadsCount' : 'viewsCount';

    await prisma.document.update({
      where: { id: documentCount.documentId },
      data: {
        [documentField]: distinctUsers.length
      }
    });
  }

  return {
    duplicateGroups: duplicates.length,
    removedRows
  };
}

async function main() {
  console.log('[dedupe] Checking duplicate engagement rows');

  const downloadResult = await dedupeModel('download', 'createdAt', 'documentsDownloaded');
  const viewResult = await dedupeModel('viewHistory', 'viewedAt', 'documentsViewed');

  console.log(
    `[dedupe] Download duplicate groups: ${downloadResult.duplicateGroups}, rows removed: ${downloadResult.removedRows}`
  );
  console.log(
    `[dedupe] ViewHistory duplicate groups: ${viewResult.duplicateGroups}, rows removed: ${viewResult.removedRows}`
  );
}

main()
  .catch(error => {
    console.error('[dedupe] Failed to clean duplicate engagement rows');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
