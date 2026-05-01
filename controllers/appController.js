const fs = require('fs');
const path = require('path');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const METADATA_FILE = path.join(__dirname, '..', 'data', 'app-release.json');

function ensureDirs() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.mkdirSync(path.join(UPLOAD_DIR, 'tmp'), { recursive: true });
  fs.mkdirSync(path.dirname(METADATA_FILE), { recursive: true });
}

ensureDirs();

const loadMetadata = () => {
  if (!fs.existsSync(METADATA_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(METADATA_FILE, 'utf8'));
  } catch (error) {
    console.error('Failed to load app metadata:', error);
    return null;
  }
};

const saveMetadata = (metadata) => {
  fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata, null, 2), 'utf8');
};

class AppController {
  async upload(req, res) {
    try {
      const { version, notes } = req.body;
      const file = req.file;

      if (!file) {
        return res.status(400).json({ success: false, message: 'APK file is required' });
      }

      if (!version) {
        return res.status(400).json({ success: false, message: 'Version is required' });
      }

      const filename = `app-release-${version}.apk`;
      const targetPath = path.join(UPLOAD_DIR, filename);
      const latestPath = path.join(UPLOAD_DIR, 'app-release.apk');

      fs.renameSync(file.path, targetPath);
      fs.copyFileSync(targetPath, latestPath);

      // Load existing metadata and update it
      let metadata = loadMetadata() || {};
      
      // Preserve existing build metadata and update version/upload info
      metadata = {
        ...metadata,
        elements: metadata.elements || [
          {
            type: 'SINGLE',
            filters: [],
            attributes: [],
            versionCode: parseInt(version.split('.')[0]) || 1,
            versionName: version,
            outputFile: filename
          }
        ],
        uploadedAt: new Date().toISOString(),
        notes: notes || '',
        file: filename,
        downloadUrl: `${req.protocol}://${req.get('host')}/api/app/download`
      };

      // Update version info in elements
      if (metadata.elements && metadata.elements.length > 0) {
        metadata.elements[0].versionName = version;
        metadata.elements[0].outputFile = filename;
      }

      saveMetadata(metadata);

      res.status(201).json({
        success: true,
        message: 'APK uploaded successfully',
        data: {
          version: metadata.elements?.[0]?.versionName || version,
          file: filename,
          uploadedAt: metadata.uploadedAt,
          downloadUrl: metadata.downloadUrl
        }
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Failed to upload APK' });
    }
  }

  async version(req, res) {
    const metadata = loadMetadata();
    if (!metadata) {
      return res.status(404).json({ success: false, message: 'No app version available' });
    }

    // Extract version info from new metadata format
    const versionName = metadata.elements?.[0]?.versionName || metadata.version || 'unknown';
    const versionCode = metadata.elements?.[0]?.versionCode || '1';
    const outputFile = metadata.elements?.[0]?.outputFile || 'app-release.apk';
    const applicationId = metadata.applicationId || 'com.studypark.co.ke';

    res.json({
      success: true,
      version: versionName,
      versionCode,
      applicationId,
      outputFile,
      downloadUrl: `${req.protocol}://${req.get('host')}/api/app/download`,
      updatedAt: new Date().toISOString()
    });
  }

  async download(req, res) {
    const metadata = loadMetadata();
    if (!metadata) {
      return res.status(404).json({ success: false, message: 'No APK available' });
    }

    // Get APK filename from metadata - check both old and new format
    const filename = metadata.file || metadata.elements?.[0]?.outputFile || 'app-release.apk';
    const filePath = path.join(UPLOAD_DIR, filename);
    
    // If not found, try the generic app-release.apk
    const fallbackPath = path.join(UPLOAD_DIR, 'app-release.apk');
    const targetPath = fs.existsSync(filePath) ? filePath : fallbackPath;

    if (!fs.existsSync(targetPath)) {
      return res.status(404).json({ success: false, message: 'APK file not found' });
    }

    res.download(targetPath, 'app-release.apk');
  }
}

module.exports = new AppController();