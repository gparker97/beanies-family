# Deploy to Production (Skip CI)

Deploy the current `main` branch to production, skipping the CI/Security gate. Use this for small, verified changes (config tweaks, copy updates, hotfixes) that have already been tested locally.

## Steps

1. Ensure all changes are committed and pushed to `main`:
   ```bash
   git status
   git log --oneline -3
   ```
   If there are uncommitted changes, stop and ask the user.

2. Trigger the deploy workflow with `skip_gate: true`:
   ```bash
   gh workflow run deploy.yml --ref main -f skip_gate=true
   ```

3. Wait for the workflow to start, then monitor it:
   ```bash
   sleep 5 && gh run list --workflow=deploy.yml --limit=1 --json status,conclusion,databaseId,url
   ```

4. Poll until complete (check every 15s, timeout after 5 minutes):
   ```bash
   gh run watch <run-id> --exit-status
   ```

5. Report the result to the user with the run URL.

## Important

- This skips the CI test suite and security scanning gate — only use when the user explicitly requests it.
- The build and deploy jobs still run normally (code is compiled, uploaded to S3, CloudFront cache invalidated).
- If the build fails, it will still fail — skip_gate only bypasses waiting for the separate CI/Security workflows.
- Never trigger this without explicit user confirmation to deploy.
