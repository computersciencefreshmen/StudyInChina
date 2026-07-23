param(
  [string]$Bucket = 'studyinchina-releases'
)

$ErrorActionPreference = 'Stop'

& npx.cmd wrangler r2 bucket lifecycle add $Bucket 'backup-daily-35d' 'backups/daily/' --expire-days 35 --force
if ($LASTEXITCODE -ne 0) { throw 'Failed to configure daily backup retention.' }

# 370 days retains twelve complete calendar-month snapshots across leap years
# and month-length differences.
& npx.cmd wrangler r2 bucket lifecycle add $Bucket 'backup-monthly-12m' 'backups/monthly/' --expire-days 370 --force
if ($LASTEXITCODE -ne 0) { throw 'Failed to configure monthly backup retention.' }

& npx.cmd wrangler r2 bucket lifecycle list $Bucket
if ($LASTEXITCODE -ne 0) { throw 'Failed to verify R2 lifecycle configuration.' }
