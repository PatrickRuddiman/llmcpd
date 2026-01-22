# Release Setup

This repository uses [semantic-release](https://github.com/semantic-release/semantic-release) with a GitHub App for automated releases.

## Required Secrets

The following repository secrets must be configured for the release workflow to function:

### SR_APP_ID

The GitHub App ID for the semantic-release bot.

To obtain this:
1. Create a GitHub App or use an existing one
2. Find the App ID in the app settings

### SR_PRIVATE_KEY

The private key for the GitHub App in PEM format.

**Important**: The private key must include the full PEM format including headers and footers:

```
-----BEGIN RSA PRIVATE KEY-----
(key content here)
-----END RSA PRIVATE KEY-----
```

To obtain this:
1. In your GitHub App settings, generate a private key
2. Download the `.pem` file
3. Copy the **entire contents** of the file (including `-----BEGIN` and `-----END` lines)
4. Paste it into the `SR_PRIVATE_KEY` secret

### Why GitHub App Instead of GITHUB_TOKEN?

The GitHub App token is required because:
- The default `GITHUB_TOKEN` cannot commit to protected branches (like `main`)
- The GitHub App can be configured to bypass branch protection policies
- This allows semantic-release to automatically commit version bumps and changelogs back to the main branch

## Troubleshooting

### "Invalid keyData" Error

This error occurs when the `SR_PRIVATE_KEY` is not properly formatted. Common issues:

1. **Missing PEM headers**: Ensure the key includes `-----BEGIN RSA PRIVATE KEY-----` at the start and `-----END RSA PRIVATE KEY-----` at the end
2. **Extra whitespace or newlines**: The key should be pasted exactly as it appears in the downloaded `.pem` file
3. **Partial key**: Make sure you copied the entire key, not just a portion
4. **Wrong key type**: Ensure you're using the private key, not a public key

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
