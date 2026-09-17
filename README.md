# Nudge local setup

## Meta Instagram connection setup

Nudge uses Meta's official **Instagram API with Instagram Login (Business Login for Instagram)** flow. It does not request or store an Instagram password.

1. Create or open an app in [Meta for Developers](https://developers.facebook.com/apps/).
2. Add the **Instagram API with Instagram Login** product and configure Business Login for Instagram.
3. Add this exact redirect URI to the product's OAuth redirect URI allowlist:

   `http://localhost:3000/api/instagram/callback`

4. Copy `.env.example` to `.env` and set:

   ```text
   PORT=3000
   JWT_SECRET=your-existing-long-random-jwt-secret
   NODE_ENV=development
   ADMIN_EMAIL=the-email-of-the-one-admin-account
   META_APP_ID=the-app-id-from-meta
   META_APP_SECRET=the-app-secret-from-meta
   META_REDIRECT_URI=http://localhost:3000/api/instagram/callback
   META_API_VERSION=v25.0
   META_TOKEN_ENCRYPTION_KEY=64-character-hex-key
   ```

   Generate the encryption key with:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

5. Use a professional Instagram account (Business or Creator) that is available to your Meta app. During development, add test users/roles in Meta's app dashboard as required.

The application requests only `instagram_business_basic`, which is enough to read the connected account ID and username. The server exchanges the authorization code and long-lived token, encrypts the token with AES-256-GCM before storing it in SQLite, and never returns the token to browser JavaScript.

## Database and admin access

The application uses SQLite at `data/nudge.sqlite`. On first startup it imports existing records from `data/users.json` and `data/instagram-accounts.json`; subsequent changes are written only to SQLite. The database file is ignored by Git and should be backed up securely.

Set `ADMIN_EMAIL` in `.env` to the exact email of the one administrator account. That authenticated account can open `http://localhost:3000/admin.html` and call the admin overview API. Other authenticated users receive HTTP 403. Admin responses contain user and Instagram account metadata only; password hashes, JWT secrets, Meta secrets, and encrypted access tokens are never exposed.

## Run

```powershell
cd C:\Users\Hemanth\Downloads\files
npm install
npm start
```

Open `http://localhost:3000/login.html?tab=signup` to create an account, then open `http://localhost:3000/instagram-accounts.html` to start the connection.

`instagram_business_basic` generally works with Standard Access for app roles/test users. Connecting accounts outside the app's roles requires Advanced Access and Meta App Review. Future messaging, comment-management, and publishing permissions also require the corresponding current `instagram_business_*` permission and Advanced Access/App Review for non-role users.
