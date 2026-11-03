# Production source and deployment

The production baseline is commit `74c0b0ffc35169a6f8b53ac5b2e97be902e27248`.
It contains the analytics dashboard, member activity, maker reviews, bug reports,
Extended Latin supplements, and the font-engine repairs deployed on October 29.

The November 1 release was mistakenly built from `03c66ca`, an older checkout.
That replaced those features with earlier versions. Recovery restores the full
production baseline and applies the mapping review, spacing checks, source-sheet
archive, and Fonthead attribution changes on top.

The main workspace has been advanced to the production baseline. Pending local
work was preserved separately from the release, including its color and build
configuration changes. Its backup and the original autostash are retained under
`.playwright-mcp/admin-recovery-workspace/` and Git's stash list.

For subsequent releases, use source history containing the production baseline.
Do not construct a release from an older checkout merely because its tests pass.
Check ancestry before building:

```powershell
git merge-base --is-ancestor 74c0b0ffc35169a6f8b53ac5b2e97be902e27248 HEAD
```

Review pending changes explicitly. Verify the authenticated admin analytics,
reviews, and bug-report sections, plus the affected maker flows. Deploy without
seeding or resetting production data. Inspect the existing live deployment before
uploading, and confirm the live panel and changed asset hashes afterward.
