# StudyPark API Documentation

## Base URL
```
https://studypark.privatedns.org/api
```

## Authentication
Most endpoints require a Bearer token in the Authorization header:
```
Authorization: Bearer <token>
```

---

## Auth Endpoints

### Register
```
POST /auth/register
Content-Type: application/json

Request:
{
  "email": "user@example.com",
  "fullName": "John Doe",
  "password": "password123",
  "confirmPassword": "password123",
  "university": "University of Nairobi"
}

Response (201):
{
  "success": true,
  "message": "User registered successfully",
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "fullName": "John Doe",
    "university": "University of Nairobi",
    "course": null,
    "yearOfStudy": null,
    "documentsDownloaded": 0,
    "documentsViewed": 0,
    "favoritesCount": 0,
    "studyStreak": 0,
    "isPremium": false,
    "plan": null
  }
}
```

### Login
```
POST /auth/login
Content-Type: application/json

Request:
{
  "email": "user@example.com",
  "password": "password123"
}

Response (200):
{
  "success": true,
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": { ... }
}

Error (403) - Already logged in:
{
  "success": false,
  "message": "You are already logged in. Please log out first before logging in again."
}
```

### Update Profile
```
PUT /auth/profile
Authorization: Bearer <token>
Content-Type: application/json

Request:
{
  "fullName": "John Doe",
  "university": "University of Nairobi",
  "course": "Computer Science",
  "yearOfStudy": 3
}

Response (200):
{
  "success": true,
  "message": "Profile updated successfully",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "fullName": "John Doe",
    "university": "University of Nairobi",
    "course": "Computer Science",
    "yearOfStudy": 3,
    "documentsDownloaded": 0,
    "documentsViewed": 0,
    "favoritesCount": 0,
    "studyStreak": 0,
    "isPremium": false,
    "plan": null
  }
}
```

### Logout
```
POST /auth/logout
Authorization: Bearer <token>

Response (200):
{
  "success": true,
  "message": "Logout successful"
}
```

### Clear Session (Emergency)
```
POST /auth/clear-session
Authorization: Bearer <token>

Response (200):
{
  "success": true,
  "message": "All sessions cleared successfully"
}
```

---

## User Endpoints

### Update Study Streak
```
POST /users/study-streak
Authorization: Bearer <token>
Content-Type: application/json

Request:
{
  "incrementBy": 1
}

Notes:
- `incrementBy` is optional and defaults to `1`
- `incrementBy` must be a positive integer

Response (200):
{
  "success": true,
  "message": "Study streak updated successfully",
  "studyStreak": 5,
  "incrementedBy": 1,
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "fullName": "John Doe",
    "university": "University of Nairobi",
    "course": "Computer Science",
    "yearOfStudy": 3,
    "documentsDownloaded": 12,
    "documentsViewed": 21,
    "favoritesCount": 4,
    "studyStreak": 5,
    "isPremium": false,
    "isAdmin": false
  }
}

Error (400):
{
  "success": false,
  "message": "incrementBy must be a positive integer"
}
```

---

## App (Mobile) Endpoints

### Get App Version
```
GET /app/version

Response (200):
{
  "success": true,
  "version": {
    "version": "1.0.0",
    "notes": "Initial release",
    "downloadUrl": "https://studypark.privatedns.org/api/app/download",
    "createdAt": "2026-04-20T10:00:00.000Z"
  }
}

Error (404):
{
  "success": false,
  "message": "No version info available"
}
```

### Upload New App Version (Admin)
```
POST /app/upload
Authorization: Bearer <admin-token>
Content-Type: multipart/form-data

Form Data:
- file: (APK file)
- version: "1.0.1"
- notes: "Bug fixes and improvements"

Response (200):
{
  "success": true,
  "message": "APK uploaded successfully",
  "version": {
    "version": "1.0.1",
    "notes": "Bug fixes and improvements",
    "downloadUrl": "https://studypark.privatedns.org/api/app/download"
  }
}

Error (400):
{
  "success": false,
  "message": "APK file is required"
}
```

### Download App APK
```
GET /app/download

Response: Binary APK file (application/vnd.android.package-archive)

Error (404):
{
  "success": false,
  "message": "No APK available"
}
```

---

## Document Endpoints

### Google Drive Config
Use Google service-account JSON from Google Cloud Console.

Single account options:
- `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON_PATH=/absolute/or/relative/path/to/service-account.json`
- `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\\n...","client_email":"..."}`
- Optional:
  - `GOOGLE_DRIVE_ACCOUNT_KEY=default`
  - `GOOGLE_DRIVE_FOLDER_ID=your-folder-id`
  - `GOOGLE_DRIVE_VISIBILITY=public`

Multiple account option:
- `GOOGLE_DRIVE_ACCOUNTS=[{"key":"drive-a","folderId":"folder-a","visibility":"public","credentialsPath":"C:\\\\secrets\\\\drive-a.json"},{"key":"drive-b","folderId":"folder-b","visibility":"private","credentialsJson":{"type":"service_account","project_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\\n...","client_email":"..."}}]`
- `GOOGLE_DRIVE_ACCOUNTS_PATH=/absolute/or/relative/path/to/google-drive-accounts.json`

`GOOGLE_DRIVE_ACCOUNTS_PATH` file formats supported:
```json
[
  {
    "key": "drive-a",
    "folderId": "folder-a",
    "visibility": "public",
    "credentialsPath": "./api/drive-a.json"
  },
  {
    "key": "drive-b",
    "folderId": "folder-b",
    "visibility": "private",
    "credentials": {
      "type": "service_account",
      "project_id": "...",
      "private_key": "-----BEGIN PRIVATE KEY-----\\n...",
      "client_email": "..."
    }
  }
]
```

```json
{
  "accounts": [
    {
      "key": "drive-a",
      "credentialsPath": "./api/drive-a.json"
    },
    {
      "key": "drive-b",
      "credentialsPath": "./api/drive-b.json"
    }
  ]
}
```

You can also place raw Google service-account objects directly inside that array and the backend will infer the credentials from each object.

Notes:
- When multiple accounts are configured, the backend can auto-pick the least-used account for new uploads.
- `driveAccountKey` on create/update lets admins force a specific configured account.

**PUBLIC FILE ACCESS:**
All documents uploaded to Google Drive are automatically set as **publicly accessible**. This means:
- Anyone with the `fileUrl` can download the file without authentication or login
- Files use public direct-download Google Drive links (format: `https://drive.google.com/uc?export=download&id=...`)
- Preview URLs allow direct viewing in a browser (format: `https://drive.google.com/file/d/.../preview`)
- No credentials needed to access shared documents

### Create Document (Admin)
```
POST /documents/documents
Authorization: Bearer <admin-token>
Content-Type: multipart/form-data

Form Data:
- title: "Computer Science Past Paper 2023"
- type: "Past Paper" // or "CAT", "Notes"
- category: "Computer Science"
- university: "University of Nairobi"
- year: "2023"
- file: (PDF, DOCX, etc. uploaded by backend to Google Drive)
- rating: 4.5
- driveAccountKey: "drive-a" // optional, force a specific configured Google Drive account
- driveVisibility: "public" // optional, "public" or "private"

Optional fallback fields:
- fileUrl: existing external file URL
- previewUrl: existing preview URL

Notes:
- If `file` is provided, the backend uploads it to Google Drive and stores the generated `fileUrl` and `previewUrl`.
- When `driveAccountKey` is omitted, the backend auto-selects one of the configured Google Drive accounts.
- The backend stores the Google Drive file ID and account key internally so later updates and deletes target the correct account.
- If you do not send `file`, then `fileUrl` is required.

Response (201):
{
  "success": true,
  "document": {
    "id": "uuid",
    "title": "Computer Science Past Paper 2023",
    "type": "Past Paper",
    "category": "Computer Science",
    "university": "University of Nairobi",
    "year": "2023",
    "fileUrl": "https://drive.google.com/uc?export=download&id=...",
    "previewUrl": "https://drive.google.com/file/d/.../preview",
    "rating": 4.5,
    "createdAt": "2026-04-20T10:00:00.000Z",
    "updatedAt": "2026-04-20T10:00:00.000Z"
  }
}
```

### Get All Documents
```
GET /documents/documents
Query Parameters (optional):
- type: "Past Paper" | "CAT" | "Notes"
- category: "Computer Science" | "Mathematics" | etc.
- university: "University of Nairobi"
- year: "2023"
- search: "search term"
- page: 1, 2, 3, ... (defaults to 1)

Note:
- This endpoint returns 10 documents per request.
- Use the `page` value from the response metadata to fetch the next batch during infinite scroll.

Response (200):
{
  "success": true,
  "documents": [
    {
      "id": "uuid",
      "title": "Computer Science Past Paper 2023",
      "type": "Past Paper",
      "category": "Computer Science",
      "university": "University of Nairobi",
      "year": "2023",
      "fileUrl": "https://...",
      "rating": 4.5,
      "createdAt": "2026-04-20T10:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 42,
    "hasMore": true,
    "nextPage": 2
  }
}
```

### Get Single Document
```
GET /documents/documents/:id

Response (200):
{
  "success": true,
  "document": { ... }
}

Error (404):
{
  "success": false,
  "message": "Document not found"
}
```

### Update Document (Admin)
```
PUT /documents/documents/:id
Authorization: Bearer <admin-token>
Content-Type: application/json or multipart/form-data

Request:
{
  "title": "Updated Title",
  "rating": 4.8
  // other fields to update
}

Multipart form fields when replacing or re-securing a Drive file:
- file: (optional replacement file uploaded to Google Drive)
- driveAccountKey: "drive-b" // optional preferred account for the replacement upload
- driveVisibility: "public" // optional, "public" or "private"
- fileUrl: existing external file URL // optional, switches storage away from managed Drive
- previewUrl: existing external preview URL // optional

Notes:
- If `file` is uploaded, the backend creates a new Google Drive file, updates the database record, then attempts to delete the previous managed Drive file.
- If only `title` changes for a managed Drive document, the backend also attempts to rename the Google Drive file.
- If `driveVisibility` changes for a managed Drive document, the backend updates that file's sharing permissions.

Response (200):
{
  "success": true,
  "document": { ... }
}
```

### Delete Document (Admin)
```
DELETE /documents/documents/:id
Authorization: Bearer <admin-token>

Response (200):
{
  "success": true,
  "message": "Document deleted successfully"
}
```

Note:
- If the document was uploaded and managed by the backend in Google Drive, deleting the document also deletes the matching Drive file from the same configured account.

### Download Document
```
POST /documents/:id/download
Authorization: Bearer <token>

Response (200):
{
  "success": true,
  "document": {
    "id": "uuid",
    "title": "Computer Science Past Paper 2023",
    "type": "Past Paper",
    "category": "Computer Science",
    "university": "University of Nairobi",
    "year": "2023",
    "fileUrl": "https://drive.google.com/uc?export=download&id=...",      // For downloading the file
    "previewUrl": "https://drive.google.com/file/d/.../preview",         // For in-app PDF/DOCX viewer
    "rating": 4.5
  }
}

Error (404):
{
  "success": false,
  "message": "Document not found"
}
```

**Note:** 
- `fileUrl` - Use this link to download the document
- `previewUrl` - Use this link for in-app document preview (PDF, DOCX, etc.)

### Get Download History
```
GET /documents/downloads
Authorization: Bearer <token>

Response (200):
{
  "success": true,
  "downloads": [
    {
      "id": "uuid",
      "userId": "uuid",
      "documentId": "uuid",
      "document": { ... },
      "createdAt": "2026-04-20T10:00:00.000Z"
    }
  ]
}
```

### Add to Favorites
```
POST /documents/:id/favorite
Authorization: Bearer <token>

Response (200):
{
  "success": true,
  "message": "Added to favorites"
}

Error (400):
{
  "success": false,
  "message": "Already in favorites"
}

Error (404):
{
  "success": false,
  "message": "Document not found"
}
```

### Remove from Favorites
```
DELETE /documents/:id/favorite
Authorization: Bearer <token>

Response (200):
{
  "success": true,
  "message": "Removed from favorites"
}
```

### Get User's Favorites
```
GET /documents/favorites
Authorization: Bearer <token>

Response (200):
{
  "success": true,
  "favorites": [
    {
      "id": "uuid",
      "userId": "uuid",
      "documentId": "uuid",
      "document": { ... },
      "createdAt": "2026-04-20T10:00:00.000Z"
    }
  ]
}
```

### Record View
```
POST /documents/:id/view
Authorization: Bearer <token>

Response (200):
{
  "success": true,
  "message": "View recorded"
}

Error (404):
{
  "success": false,
  "message": "Document not found"
}
```

### Get View History
```
GET /documents/view-history
Authorization: Bearer <token>

Response (200):
{
  "success": true,
  "views": [
    {
      "id": "uuid",
      "userId": "uuid",
      "documentId": "uuid",
      "document": { ... },
      "viewedAt": "2026-04-20T10:00:00.000Z"
    }
  ]
}
```

### Clear All View History
```
DELETE /documents/view-history
Authorization: Bearer <token>

Response (200):
{
  "success": true,
  "message": "Recently viewed documents cleared",
  "clearedCount": 3
}
```

### Clear One Recently Viewed Document
```
DELETE /documents/view-history/:documentId
Authorization: Bearer <token>

Response (200):
{
  "success": true,
  "message": "Recently viewed document cleared",
  "clearedCount": 1
}

Error (404):
{
  "success": false,
  "message": "Recently viewed document not found"
}
```

---

## Document Types
```javascript
{
  "Past Paper": "Past exam papers",
  "CAT": "Class test papers",
  "Notes": "Study notes"
}
```

---

## Notification Endpoints

### Get All Notifications
```
GET /notifications
Authorization: Bearer <token>

Query Parameters (optional):
- unreadOnly: true/false

Response (200):
{
  "success": true,
  "notifications": [
    {
      "id": "uuid",
      "userId": "uuid",
      "title": "New Document Available",
      "message": "A new past paper has been uploaded",
      "type": "DOCUMENT_UPLOADED",
      "isRead": false,
      "actionUrl": null,
      "createdAt": "2026-04-20T10:00:00.000Z",
      "updatedAt": "2026-04-20T10:00:00.000Z"
    }
  ],
  "unreadCount": 1
}
```

### Get Single Notification
```
GET /notifications/:id
Authorization: Bearer <token>

Response (200):
{
  "success": true,
  "notification": { ... }
}

Error (404):
{
  "success": false,
  "message": "Notification not found"
}
```

### Mark Notification as Read
```
PUT /notifications/:id/read
Authorization: Bearer <token>

Response (200):
{
  "success": true,
  "message": "Notification marked as read"
}

Error (404):
{
  "success": false,
  "message": "Notification not found"
}
```

### Mark All Notifications as Read
```
PUT /notifications/read-all
Authorization: Bearer <token>

Response (200):
{
  "success": true,
  "message": "All notifications marked as read"
}
```

### Delete Notification
```
DELETE /notifications/:id
Authorization: Bearer <token>

Response (200):
{
  "success": true,
  "message": "Notification deleted"
}
```

### Delete All Read Notifications
```
DELETE /notifications/clear/read
Authorization: Bearer <token>

Response (200):
{
  "success": true,
  "message": "Read notifications deleted"
}
```

### Create Notification (Admin)
```
POST /notifications
Authorization: Bearer <admin-token>
Content-Type: application/json

Request:
{
  "userId": "uuid (optional - null for broadcast)",
  "title": "System Update",
  "message": "App has been updated",
  "type": "SYSTEM_UPDATE",
  "actionUrl": "app://update"
}

Response (201):
{
  "success": true,
  "notification": { ... }
}
```

### Broadcast Notification (Admin)
```
POST /notifications/broadcast
Authorization: Bearer <admin-token>
Content-Type: application/json

Request:
{
  "title": "Important Notice",
  "message": "Server maintenance tonight",
  "type": "GENERAL"
}

Response (201):
{
  "success": true,
  "message": "Broadcast to 150 users"
}
```

---

## Notification Types
```javascript
{
  "GENERAL": "General notification",
  "SYSTEM_UPDATE": "System/app update notification",
  "PREMIUM_EXPIRY": "Premium subscription expiring",
  "DOCUMENT_UPLOADED": "New document uploaded",
  "FAVORITE_UPDATE": "Update to favorited document"
}
```

---

## Subscription Endpoints

### Get Current Subscription
```
GET /subscription/subscription
Authorization: Bearer <token>

Response (200):
{
  "success": true,
  "subscription": {
    "id": "uuid",
    "userId": "uuid",
    "planType": "MONTHLY_PREMIUM",
    "status": "ACTIVE",
    "startDate": "2026-04-01T00:00:00.000Z",
    "endDate": "2026-05-01T00:00:00.000Z",
    "paymentId": "uuid",
    "createdAt": "2026-04-01T00:00:00.000Z",
    "updatedAt": "2026-04-01T00:00:00.000Z"
  }
}
```

### Create Subscription
```
POST /subscription/subscription
Authorization: Bearer <token>
Content-Type: application/json 

Request:
{
  "planType": "MONTHLY_PREMIUM", // or ANNUAL_PREMIUM, LIFETIME
  "paymentId": "uuid (optional)",
  "endDate": "2026-05-01T00:00:00.000Z (optional)"
}

Response (201):
{
  "success": true,
  "subscription": { ... }
}

Error (400):
{
  "success": false,
  "message": "You already have an active subscription"
}
```

### Cancel Subscription
```
POST /subscription/subscription/cancel
Authorization: Bearer <token>

Response (200):
{
  "success": true,
  "message": "Subscription cancelled successfully"
}
```

### Create Payment
```
POST /subscription/payment
Authorization: Bearer <token>
Content-Type: application/json

Request:
{
  "amount": 499.00,
  "currency": "KES",
  "method": "MPESA", // or CARD, PAYPAL, GOOGLE_PAY
  "transactionId": "TXN123456"
}

Response (201):
{
  "success": true,
  "payment": {
    "id": "uuid",
    "userId": "uuid",
    "amount": 499,
    "currency": "KES",
    "method": "MPESA",
    "status": "PENDING",
    "transactionId": "TXN123456",
    "createdAt": "2026-04-20T10:00:00.000Z"
  }
}
```

### Get Payment History
```
GET /subscription/payments
Authorization: Bearer <token>

Response (200):
{
  "success": true,
  "payments": [
    {
      "id": "uuid",
      "userId": "uuid",
      "amount": 499,
      "currency": "KES",
      "method": "MPESA",
      "status": "SUCCESS",
      "transactionId": "TXN123456",
      "createdAt": "2026-04-20T10:00:00.000Z"
    }
  ]
}
```

### Update Payment Status (Webhook)
```
PUT /subscription/payment/:id/status
Content-Type: application/json

Request:
{
  "status": "SUCCESS", // PENDING, SUCCESS, FAILED, REFUNDED
  "transactionId": "TXN123456",
  "planType": "MONTHLY_PREMIUM"
}

Response (200):
{
  "success": true,
  "payment": { ... }
}
```

---

## Plan Types
```javascript
{
  "FREE": "Free plan",
  "MONTHLY_PREMIUM": "Monthly premium subscription",
  "ANNUAL_PREMIUM": "Annual premium subscription",
  "LIFETIME": "Lifetime premium"
}
```

## Subscription Status
```javascript
{
  "ACTIVE": "Subscription is active",
  "EXPIRED": "Subscription has expired",
  "CANCELLED": "Subscription was cancelled"
}
```

## Payment Methods
```javascript
{
  "MPESA": "M-Pesa",
  "CARD": "Credit/Debit Card",
  "PAYPAL": "PayPal",
  "GOOGLE_PAY": "Google Pay"
}
```

## Payment Status
```javascript
{
  "PENDING": "Payment pending",
  "SUCCESS": "Payment successful",
  "FAILED": "Payment failed",
  "REFUNDED": "Payment refunded"
}
```
