# Release Setup

This repository uses [semantic-release](https://github.com/semantic-release/semantic-release) with a GitHub App for automated releases.

## Required Secrets

The following repository secrets must be configured for the release workflow to function:

### SR_CLIENT_ID

The GitHub App ID (numeric identifier) for the semantic-release bot.

**Note**: Despite the name "CLIENT_ID", this is actually the GitHub App ID found in the app settings.

To obtain this:
1. Go to your GitHub App settings (Settings → Developer settings → GitHub Apps)
2. Find the App ID near the top of the page (it's a numeric value like `123456`)
3. Save this value as the `SR_CLIENT_ID` secret

### SR_CLIENT_SECRET

The GitHub App private key in PEM format.

**Important**: Despite the name "CLIENT_SECRET", this is actually the private key (certificate), not an OAuth client secret. The private key must include the full PEM format including headers and footers:

```
-----BEGIN RSA PRIVATE KEY-----
(key content here)
-----END RSA PRIVATE KEY-----
```

To obtain this:
1. In your GitHub App settings, scroll to "Private keys" section
2. Click "Generate a private key"
3. Download the `.pem` file
4. Copy the **entire contents** of the file (including `-----BEGIN` and `-----END` lines)
5. Paste it into the `SR_CLIENT_SECRET` secret

### Terminology Note

The secrets are named `SR_CLIENT_ID` and `SR_CLIENT_SECRET` for consistency with your existing configuration, but they contain:
- `SR_CLIENT_ID` = GitHub App ID (not OAuth client ID)
- `SR_CLIENT_SECRET` = GitHub App private key certificate (not OAuth client secret)

### Why GitHub App Instead of GITHUB_TOKEN?

The GitHub App token is required because:
- The default `GITHUB_TOKEN` cannot commit to protected branches (like `main`)
- The GitHub App can be configured to bypass branch protection policies
- This allows semantic-release to automatically commit version bumps and changelogs back to the main branch

## Troubleshooting

### "Invalid keyData" Error

This error occurs when the `SR_CLIENT_SECRET` (private key) is not properly formatted. Common issues:

1. **Wrong credential type**: If you have an OAuth client secret (a short string), this won't work. You need the GitHub App private key (a PEM certificate file).
2. **Missing PEM headers**: Ensure the key includes `-----BEGIN RSA PRIVATE KEY-----` at the start and `-----END RSA PRIVATE KEY-----` at the end
3. **Extra whitespace or newlines**: The key should be pasted exactly as it appears in the downloaded `.pem` file
4. **Partial key**: Make sure you copied the entire key, not just a portion
5. **Wrong key type**: Ensure you're using the private key, not a public key

### Validating Your Key Format

Your private key should look like this:

```
-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA...
(many lines of base64-encoded content)
...xyzABC123==
-----END RSA PRIVATE KEY-----
```

If your key starts with `-----BEGIN PRIVATE KEY-----` (without RSA), that's also valid and should work.

### GitHub App vs OAuth App

If you have a GitHub OAuth App (with client_id and client_secret as short strings), you need to create a GitHub App instead:

1. Go to Settings → Developer settings → GitHub Apps
2. Click "New GitHub App"
3. Fill in the required fields
4. Generate a private key (this will download a `.pem` file)
5. Install the app on your repository
6. Configure the App ID as `SR_CLIENT_ID` and the private key contents as `SR_CLIENT_SECRET`
