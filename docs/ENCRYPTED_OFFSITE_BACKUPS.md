# Encrypted offsite PostgreSQL backups

Local backups are not sufficient protection against VPS loss, filesystem corruption, or operator error. Ops Solutions includes a provider-neutral staging workflow that encrypts a verified PostgreSQL backup set before it leaves the server.

## Design

The workflow deliberately does not hard-code AWS, Backblaze, Google Cloud, Hostinger, or another provider. It writes an encrypted bundle into a destination directory that can be:

- a mounted object-storage or SFTP filesystem;
- an encrypted secondary volume;
- a directory replicated by infrastructure tooling;
- a transfer staging directory consumed by a separately managed backup agent.

The application never needs cloud credentials. Provider credentials remain in the mounting or replication layer.

Each encrypted bundle contains the PostgreSQL custom-format archive, SHA-256 checksum, and source manifest. The three files are streamed through `age`; no plaintext tar archive is written to disk.

## Prerequisites

Install `age` on the VPS and create an encryption identity on a secure administrative device, not inside the repository:

```bash
age-keygen -o ops-solutions-backup-identity.txt
```

Store the private identity in an offline password manager or protected recovery vault. Copy only the public age recipient to the VPS:

```bash
printf '%s\n' 'age1...' > /root/Ops-Solutions/.backup-age-recipient
chmod 600 /root/Ops-Solutions/.backup-age-recipient
```

The age recipient is a public key, but it should still be managed outside Git so infrastructure can rotate it independently.

## Dry-run validation

Run a dry-run first. This validates the newest local backup set, recipient, dependencies, and destination without writing an encrypted bundle:

```bash
cd /root/Ops-Solutions
bash scripts/stage-encrypted-offsite-backup.sh \
  --destination-root /mnt/offsite/ops-solutions \
  --dry-run
```

## Stage an encrypted bundle

```bash
cd /root/Ops-Solutions
bash scripts/stage-encrypted-offsite-backup.sh \
  --destination-root /mnt/offsite/ops-solutions \
  --retention-days 35
```

Safety controls include:

- source archive size and SHA-256 verification before encryption;
- a non-blocking process lock to prevent overlapping runs;
- streaming encryption with no plaintext tar file;
- `.partial` output and atomic publication;
- permission-restricted directories and files;
- bounded retention between 7 and 365 days;
- cleanup limited to encrypted Ops Solutions bundle files;
- no private key, database password, OAuth token, or cloud credential access.

## Verify staged backups

Checksum and manifest verification does not need the private key:

```bash
bash scripts/verify-encrypted-offsite-backup.sh \
  --destination-root /mnt/offsite/ops-solutions
```

For a monthly deep verification, use the private identity from a secure temporary location. Decryption streams directly into `tar --list`; no plaintext archive is written:

```bash
bash scripts/verify-encrypted-offsite-backup.sh \
  --destination-root /mnt/offsite/ops-solutions \
  --identity-file /secure/ops-solutions-backup-identity.txt
```

Never leave the private key permanently on the production VPS.

## Recommended schedule

Run the local database backup first, then encrypted staging, then freshness monitoring. Example:

```cron
15 2 * * * cd /root/Ops-Solutions && bash scripts/backup-postgres.sh >> /var/log/ops-solutions-backup.log 2>&1
35 2 * * * cd /root/Ops-Solutions && bash scripts/stage-encrypted-offsite-backup.sh --destination-root /mnt/offsite/ops-solutions >> /var/log/ops-solutions-offsite.log 2>&1
30 4 * * * cd /root/Ops-Solutions && bash scripts/check-backup-freshness.sh --max-age-hours 26 --format json >> /var/log/ops-solutions-backup-health.log 2>&1
```

The mounted destination must itself be replicated or stored outside the VPS. A directory on the same root disk is staging only, not an offsite backup.

## Restore drill

At least monthly:

1. Copy one encrypted bundle and its offsite manifest to an isolated recovery host.
2. Verify the encrypted SHA-256 value.
3. Decrypt with the protected private identity into a temporary directory.
4. Verify the source `.sha256` and manifest.
5. Run the existing PostgreSQL restore tooling against a disposable database.
6. Validate workspace, migration, CRM mirror, and authentication tables.
7. Record restore duration, result, tested backup timestamp, and operator.
8. Securely remove the temporary plaintext files after the drill.

Example decryption on the isolated host:

```bash
mkdir -m 700 /secure/restore-drill
age --decrypt \
  --identity /secure/ops-solutions-backup-identity.txt \
  --output /secure/restore-drill/backup.tar \
  ops-solutions-host-YYYYMMDDTHHMMSSZ.tar.age

tar --extract --file /secure/restore-drill/backup.tar --directory /secure/restore-drill
```

## External decisions

The repository intentionally does not select the storage provider, replication credentials, geographic region, immutable retention policy, or legal retention duration. Those are infrastructure and compliance decisions. Before commercial production, choose an offsite provider, enable encryption at rest and transport security, restrict deletion permissions, and test recovery from that provider rather than only from local staging.
